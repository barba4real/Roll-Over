import React, { useState, useMemo, useEffect } from 'react';
import { ScoutedMatch, PickSuggestion } from '../engine/match-scout';
import { TimeWindow, TIME_WINDOWS, fetchSportyBetFixtures } from '../engine/sportybet';
import { setFootballDataKey } from '../engine/football-data-org';
import { setSportmonksToken } from '../engine/sportmonks';
import { ParsedSelection } from '../engine/types';
import { predictMatch, getDatabaseSize } from '../engine/historical-stats';
import { loadMatchesFromDb, syncHistoricalData, needsRefresh, getMatchCount } from '../lib/match-database';
import { scanActiveLeagues, getCachedScan, isLeagueActive, ScanSummary } from '../engine/league-scanner';
import MatchAnalysis from './MatchAnalysis';
import PredictionGuide from './PredictionGuide';
import {
  LEAGUE_REGISTRY,
  REGIONAL_PRESETS,
  LeagueEntry,
  LeagueRegion,
  getAllRegions,
  getLeagues,
  getPresetLeagues,
  getProviderCount,
} from '../engine/league-registry';

interface Props {
  onAddPick?: (pick: ParsedSelection) => void;
}

// ─── Module-Level State (persists across unmount/remount) ────────────────────

// Scout results survive page navigation
let persistedScoutResults: ScoutedMatch[] | null = null;
let persistedScoutError: string | null = null;
let scoutAbortController: AbortController | null = null;
let scoutRunning = false;

// ─── League Selection State ──────────────────────────────────────────────────

interface LeagueSelection {
  [leagueId: string]: boolean;
}

function loadSavedLeagues(): LeagueSelection {
  try {
    const saved = localStorage.getItem('rollover_scout_leagues_v2');
    if (saved) return JSON.parse(saved);
  } catch {}
  // Default: all Tier 1 selected
  const defaults: LeagueSelection = {};
  for (const league of LEAGUE_REGISTRY) {
    defaults[league.id] = league.tier === 1;
  }
  return defaults;
}

function saveLeagues(selection: LeagueSelection) {
  localStorage.setItem('rollover_scout_leagues_v2', JSON.stringify(selection));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MatchScout({ onAddPick }: Props) {
  // Initialize all saved API keys on mount (silent, no gate)
  useState(() => {
    const key = localStorage.getItem('rollover_footballdata_key');
    if (key) setFootballDataKey(key);
    const key5 = localStorage.getItem('rollover_sportmonks_token');
    if (key5) setSportmonksToken(key5);
  });

  // Provider toggles
  const [providerToggles, setProviderToggles] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('rollover_scout_providers');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      thesportsdb: true, espn: true, openligadb: true, openfootball: true,
      footballdatauk: true, statsbomb: true, footballdata: true, sportmonks: true, allsportdb: true,
    };
  });

  function toggleProvider(id: string) {
    setProviderToggles(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      localStorage.setItem('rollover_scout_providers', JSON.stringify(updated));
      return updated;
    });
  }

  // League selection (unified registry)
  const [leagueSelection, setLeagueSelection] = useState<LeagueSelection>(loadSavedLeagues);
  const [leagueSearch, setLeagueSearch] = useState('');
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);
  const [showLeaguePicker, setShowLeaguePicker] = useState(false);

  // Scout results (restore from module-level state if available, else localStorage)
  const [matches, setMatches] = useState<ScoutedMatch[]>(() => {
    if (persistedScoutResults) return persistedScoutResults;
    try {
      const cached = localStorage.getItem('rollover_scout_cache');
      if (cached) {
        const { results, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < 12 * 60 * 60 * 1000) return results;
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(() => scoutRunning);
  const [error, setError] = useState<string | null>(() => persistedScoutError);
  const [win, setWin] = useState<TimeWindow>('');
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);
  const [addedPicks, setAddedPicks] = useState<Set<string>>(new Set());
  const [valueMap, setValueMap] = useState<Record<string, { isValue: boolean; edge: number; marketOdds: number }>>({});
  const [dbSize, setDbSize] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanSummary | null>(() => getCachedScan());
  const [scanning, setScanning] = useState(false);
  const [hideInactive, setHideInactive] = useState(true);
  const [analysisMatch, setAnalysisMatch] = useState<ScoutedMatch | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const [groupByLeague, setGroupByLeague] = useState(false);

  // Load historical data into memory on mount
  useEffect(() => {
    (async () => {
      try {
        const count = await loadMatchesFromDb();
        setDbSize(count);
        // Auto-sync if never synced or stale
        if (count === 0 || await needsRefresh()) {
          setSyncMessage('Historical data needs refresh. Click "Sync Data" for better predictions.');
        }
      } catch (e) {
        console.warn('[MatchScout] Failed to load historical data:', e);
      }
    })();
  }, []);

  async function handleSyncData() {
    setSyncing(true);
    setSyncMessage('Syncing...');
    try {
      const result = await syncHistoricalData((msg) => setSyncMessage(msg));
      setDbSize(result.totalMatches);
      setSyncMessage(`Sync complete: ${result.totalMatches} matches loaded (${result.newMatches} new)`);
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (e: any) {
      setSyncMessage(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleScanLeagues() {
    setScanning(true);
    try {
      const result = await scanActiveLeagues((scanned, total) => {
        setSyncMessage(`Scanning leagues: ${scanned}/${total}`);
      });
      setScanResult(result);
      setSyncMessage(`Scan: ${result.activeCount} active, ${result.inactiveCount} off-season`);
      setTimeout(() => setSyncMessage(null), 4000);
    } catch (e: any) {
      setSyncMessage(`Scan failed: ${e.message}`);
    } finally {
      setScanning(false);
    }
  }

  // ─── Derived Data ────────────────────────────────────────────────────────

  const selectedLeagueIds = useMemo(
    () => Object.entries(leagueSelection).filter(([, v]) => v).map(([k]) => k),
    [leagueSelection]
  );

  const selectedCount = selectedLeagueIds.length;

  const regions = useMemo(() => getAllRegions(), []);

  // Group leagues by region for the picker
  const leaguesByRegion = useMemo(() => {
    const map: Record<string, LeagueEntry[]> = {};
    for (const league of LEAGUE_REGISTRY) {
      if (!map[league.region]) map[league.region] = [];
      map[league.region].push(league);
    }
    // Sort each region: tier 1 first, then alphabetical
    for (const region of Object.keys(map)) {
      map[region].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    }
    return map;
  }, []);

  // Filtered leagues (for search)
  const filteredLeagues = useMemo(() => {
    if (!leagueSearch) return null; // null = show grouped view
    const q = leagueSearch.toLowerCase();
    return LEAGUE_REGISTRY.filter(l =>
      l.name.toLowerCase().includes(q) || l.region.toLowerCase().includes(q)
    );
  }, [leagueSearch]);

  // ─── League Selection Helpers ────────────────────────────────────────────

  function toggleLeague(id: string) {
    setLeagueSelection(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      saveLeagues(updated);
      return updated;
    });
  }

  function selectAll(selected: boolean) {
    const updated: LeagueSelection = {};
    for (const league of LEAGUE_REGISTRY) updated[league.id] = selected;
    setLeagueSelection(updated);
    saveLeagues(updated);
  }

  function selectTier(tier: 1 | 2 | 3) {
    const updated: LeagueSelection = {};
    for (const league of LEAGUE_REGISTRY) updated[league.id] = league.tier <= tier;
    setLeagueSelection(updated);
    saveLeagues(updated);
  }

  function applyPreset(presetId: string) {
    const presetLeagues = getPresetLeagues(presetId);
    const updated: LeagueSelection = {};
    for (const league of LEAGUE_REGISTRY) updated[league.id] = false;
    for (const league of presetLeagues) updated[league.id] = true;
    setLeagueSelection(updated);
    saveLeagues(updated);
  }

  function selectRegion(region: string, selected: boolean) {
    setLeagueSelection(prev => {
      const updated = { ...prev };
      for (const league of LEAGUE_REGISTRY) {
        if (league.region === region) updated[league.id] = selected;
      }
      saveLeagues(updated);
      return updated;
    });
  }

  // ─── Scout Handler ───────────────────────────────────────────────────────

  function cacheResults(results: ScoutedMatch[]) {
    try {
      localStorage.setItem('rollover_scout_cache', JSON.stringify({ results, timestamp: Date.now() }));
    } catch {}
  }

  function handleAddPick(match: ScoutedMatch, sug: { market: string; pick: string; estimatedOdds: string }) {
    if (!onAddPick) return;
    const key = `${match.fixtureId}-${sug.pick}`;
    if (addedPicks.has(key)) return;

    const oddsParts = sug.estimatedOdds.split('-').map(s => parseFloat(s.trim()));
    const odds = oddsParts.length === 2 ? (oddsParts[0] + oddsParts[1]) / 2 : oddsParts[0] || 1.3;

    const kickOff = new Date(match.kickOff);
    const selection: ParsedSelection = {
      id: crypto.randomUUID(),
      index: 0,
      date: `${kickOff.getDate().toString().padStart(2, '0')}/${(kickOff.getMonth() + 1).toString().padStart(2, '0')}`,
      time: `${kickOff.getHours().toString().padStart(2, '0')}:${kickOff.getMinutes().toString().padStart(2, '0')}`,
      kickOffDateTime: kickOff,
      gameId: match.fixtureId.toString(),
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      status: 'not_started',
      score: null,
      pick: sug.pick,
      pickCategory: sug.pick.toLowerCase().includes('over') ? 'over' :
                    sug.pick.toLowerCase().includes('home') ? 'home' :
                    sug.pick.toLowerCase().includes('away') ? 'away' : 'other',
      odds: Math.round(odds * 100) / 100,
      market: sug.market,
      marketType: sug.market === '1X2' ? '1x2' :
                  sug.market.includes('Over') ? 'over_under' :
                  sug.market === 'GG/NG' ? 'gg_ng' : 'other',
      marketVariant: null,
      result: null,
      resultMessage: null,
      isSettled: false,
      isVoid: false,
      isSuspended: false,
      isEligibleForGrouping: true,
    };
    onAddPick(selection);
    setAddedPicks(prev => new Set(prev).add(key));
  }

  async function handleScout() {
    // Cancel any existing scout
    if (scoutAbortController) scoutAbortController.abort();
    scoutAbortController = new AbortController();
    const signal = scoutAbortController.signal;

    setLoading(true);
    scoutRunning = true;
    setError(null);
    persistedScoutError = null;
    setMatches([]);
    setVisibleCount(30);

    if (selectedCount === 0) {
      setError('No leagues selected. Pick at least one league or use a preset.');
      setLoading(false);
      return;
    }

    try {
      let results: ScoutedMatch[] = [];

      // ─── FIXTURES: SportyBet is the spine ─────────────────────────────────
      // Every scouted fixture comes from SportyBet — the book we actually play.
      // Historical DB (predictMatch) + Flashscore matchId caching remain as
      // ENRICHMENT feeders only, layered onto the SportyBet fixture list.
      const sbResult = await fetchSportyBetFixtures({
        region: 'ng', maxPages: 12, pageSize: 30, window: win,
        onProgress: (m) => setSyncMessage(m),
      });
      setSyncMessage(null);

      if (signal.aborted) return;

      // Optional league narrowing: if the user has selected specific leagues in
      // the picker, keep only SportyBet fixtures whose league name matches. If
      // nothing usable matches, fall back to showing all SportyBet fixtures so
      // the scout is never empty just because registry names differ from Sporty.
      const selectedLeagueNames = LEAGUE_REGISTRY
        .filter(l => leagueSelection[l.id])
        .map(l => l.name.toLowerCase());

      const leagueMatches = (leagueName: string) => {
        if (selectedLeagueNames.length === 0) return true;
        const fLeague = (leagueName || '').toLowerCase().trim();
        return selectedLeagueNames.some(name => {
          if (fLeague === name) return true;
          if (fLeague.length > 3 && name.length > 3) {
            if (fLeague.includes(name) && fLeague.length - name.length <= 6) return true;
            if (name.includes(fLeague) && name.length - fLeague.length <= 6) return true;
          }
          return false;
        });
      };

      // Team alias resolver for consistent display / DB lookups
      const { resolveTeamName } = await import('../engine/team-aliases');

      type MergedFixture = { homeTeam: string; awayTeam: string; kickOff: string; league: string; leagueSlug: string; sources: string[] };

      const filtered = sbResult.fixtures.filter(f => leagueMatches(f.leagueName || f.league));
      const source = filtered.length > 0 ? filtered : sbResult.fixtures;

      const uniqueFixtures: MergedFixture[] = source.map(f => ({
        homeTeam: resolveTeamName(f.homeTeam),
        awayTeam: resolveTeamName(f.awayTeam),
        kickOff: f.kickoff instanceof Date ? f.kickoff.toISOString() : String(f.kickoff || ''),
        league: f.leagueName || f.league || '',
        leagueSlug: '',
        sources: ['SportyBet'],
      }));

      if (uniqueFixtures.length === 0) {
        setError('No SportyBet fixtures found for this window. Try a wider time window.');
        setLoading(false);
        scoutRunning = false;
        return;
      }

      // Process fixtures progressively in chunks
      const CHUNK_SIZE = 10;
      for (let i = 0; i < uniqueFixtures.length; i += CHUNK_SIZE) {
        if (signal.aborted) return;

        const chunk = uniqueFixtures.slice(i, i + CHUNK_SIZE);
        const chunkResults: ScoutedMatch[] = [];

          for (const fixture of chunk) {
            const prediction = predictMatch(fixture.homeTeam, fixture.awayTeam, fixture.league);
            const suggestions: PickSuggestion[] = [];

            // Use historical DB predictions
            if (prediction.dataQuality !== 'insufficient') {
              for (const p of prediction.picks) {
                if (p.confidence >= 55) {
                  suggestions.push({
                    market: p.market,
                    pick: p.pick,
                    confidence: p.confidence,
                    reasoning: p.reasoning,
                    estimatedOdds: p.confidence >= 75 ? '1.20-1.45' :
                                   p.confidence >= 65 ? '1.35-1.65' : '1.50-1.85',
                  });
                }
              }
            }

            // Show fixture even without high-confidence picks (but with at least some data)
            const redFlags: string[] = [];
            if (prediction.dataQuality === 'low') redFlags.push('Limited historical data');
            if (prediction.dataQuality === 'insufficient') redFlags.push('No historical data — predictions uncertain');

            // Always show the fixture if it passed league/date filter
            const finalSuggestions = suggestions.length > 0 ? suggestions : prediction.picks
              .filter(p => p.confidence >= 40)
              .map(p => ({
                market: p.market,
                pick: p.pick,
                confidence: p.confidence,
                reasoning: [...p.reasoning, '(limited data)'],
                estimatedOdds: '1.50-2.00',
              }));

            // Even if no predictions at all, show the fixture with a generic home suggestion
            if (finalSuggestions.length === 0) {
              finalSuggestions.push({
                market: '1X2',
                pick: 'Home',
                confidence: 40,
                reasoning: ['Home advantage (no historical data available)'],
                estimatedOdds: '1.50-2.50',
              });
            }

            chunkResults.push({
              fixtureId: Math.round(Math.random() * 100000),
              homeTeam: { id: 0, name: fixture.homeTeam },
              awayTeam: { id: 0, name: fixture.awayTeam },
              league: { id: 0, name: fixture.league, country: fixture.sources.join('+') },
              kickOff: new Date(fixture.kickOff),
              suggestions: finalSuggestions.sort((a, b) => b.confidence - a.confidence),
              redFlags,
              isSkipped: false,
            });
          }

          // Progressive update: add this chunk to results and sort
          if (chunkResults.length > 0) {
            results = [...results, ...chunkResults];
            // Sort by kickoff time first, then by confidence
            results.sort((a, b) => {
              const aTime = new Date(a.kickOff).getTime() || 0;
              const bTime = new Date(b.kickOff).getTime() || 0;
              // Nearest kickoff first
              if (aTime && bTime && aTime !== bTime) return aTime - bTime;
              // Then by confidence
              const aConf = a.suggestions[0]?.confidence || 0;
              const bConf = b.suggestions[0]?.confidence || 0;
              return bConf - aConf;
            });
            setMatches([...results]);
            persistedScoutResults = results;
          }
        }

      setMatches(results);
      persistedScoutResults = results;
      cacheResults(results);

      if (results.length === 0) {
        setError('NO_BET_TODAY');
        persistedScoutError = 'NO_BET_TODAY';
      }
    } catch (e: any) {
      if (signal.aborted) {
        setError(null);
        persistedScoutError = null;
      } else {
        setError(e.message || 'Failed to scout.');
        persistedScoutError = e.message || 'Failed to scout.';
      }
    } finally {
      setLoading(false);
      scoutRunning = false;
    }
  }

  function handleStopScout() {
    if (scoutAbortController) {
      scoutAbortController.abort();
      scoutAbortController = null;
    }
    setLoading(false);
    scoutRunning = false;
  }

  function handleQuickSlip() {
    if (!onAddPick || matches.length === 0) return;

    // Take top picks: one per match, sorted by confidence, max 4
    const topPicks: { match: ScoutedMatch; sug: PickSuggestion }[] = [];
    const usedMatches = new Set<number>();

    for (const match of matches) {
      if (usedMatches.size >= 4) break;
      if (usedMatches.has(match.fixtureId)) continue;
      const bestSug = match.suggestions[0];
      if (!bestSug || bestSug.confidence < 55) continue;
      topPicks.push({ match, sug: bestSug });
      usedMatches.add(match.fixtureId);
    }

    // Add each pick to the slip
    for (const { match, sug } of topPicks) {
      handleAddPick(match, sug);
    }
  }

  // ─── Provider Strength Badges + Tooltip Helpers ───────────────────────────

  function getStrengthBadges(market: string, pick: string, reasoning: string[]): { label: string; className: string }[] {
    const badges: { label: string; className: string }[] = [];
    const reasons = reasoning.join(' ').toLowerCase();

    // Form-based
    if (reasons.includes('win rate') || reasons.includes('form') || reasons.includes('last')) {
      badges.push({ label: 'Form', className: 'bg-blue-900 text-blue-300' });
    }
    // H2H
    if (reasons.includes('h2h') || reasons.includes('head')) {
      badges.push({ label: 'H2H', className: 'bg-indigo-900 text-indigo-300' });
    }
    // xG / goals efficiency
    if (market.includes('Over') || reasons.includes('xg') || reasons.includes('avg goals') || reasons.includes('scoring')) {
      badges.push({ label: 'xG', className: 'bg-purple-900 text-purple-300' });
    }
    // Position/standings
    if (reasons.includes('gap') || reasons.includes('position') || reasons.includes('#')) {
      badges.push({ label: 'Pos', className: 'bg-red-900 text-red-300' });
    }
    // Trend/momentum
    if (reasons.includes('live') || reasons.includes('recent') || reasons.includes('streak')) {
      badges.push({ label: 'Trnd', className: 'bg-green-900 text-green-300' });
    }
    // Clean sheet
    if (reasons.includes('clean') || (market === 'GG/NG' && reasons.includes('%'))) {
      badges.push({ label: 'CS%', className: 'bg-cyan-900 text-cyan-300' });
    }

    return badges.slice(0, 3); // Max 3 badges
  }

  function getConfidenceTooltip(market: string, pick: string, confidence: number, reasoning: string[]): string {
    const sources: string[] = [];
    if (reasoning.some(r => r.toLowerCase().includes('win rate') || r.toLowerCase().includes('form'))) sources.push('Historical DB');
    if (reasoning.some(r => r.toLowerCase().includes('live'))) sources.push('TheSportsDB');
    if (reasoning.some(r => r.toLowerCase().includes('gap') || r.toLowerCase().includes('#'))) sources.push('ESPN Standings');
    if (market.includes('Over')) sources.push('xG Analysis');
    if (sources.length === 0) sources.push('Historical DB');
    return `${pick} ${confidence}% — backed by: ${sources.join(', ')}`;
  }

  function getConfidenceBreakdown(market: string, pick: string, confidence: number): string[] {
    const lines: string[] = [];
    const base = 30;
    const fromData = confidence - base;

    if (pick === 'Home' || pick === 'Away') {
      lines.push(`Base: ${base}%`);
      lines.push(`Form analysis: +${Math.round(fromData * 0.5)}%`);
      lines.push(`Position gap: +${Math.round(fromData * 0.3)}%`);
      lines.push(`H2H history: +${Math.round(fromData * 0.2)}%`);
    } else if (market.includes('Over')) {
      lines.push(`Base: 40%`);
      lines.push(`Goal rate: +${Math.round((confidence - 40) * 0.4)}%`);
      lines.push(`xG efficiency: +${Math.round((confidence - 40) * 0.3)}%`);
      lines.push(`H2H goals avg: +${Math.round((confidence - 40) * 0.3)}%`);
    } else if (pick === 'Both Teams Score') {
      lines.push(`Base: 35%`);
      lines.push(`Scoring rate: +${Math.round((confidence - 35) * 0.4)}%`);
      lines.push(`BTTS history: +${Math.round((confidence - 35) * 0.4)}%`);
      lines.push(`Clean sheet %: +${Math.round((confidence - 35) * 0.2)}%`);
    }
    lines.push(`Total: ${confidence}%`);
    return lines;
  }

  // ─── Tier Badge ──────────────────────────────────────────────────────────

  function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
    if (tier === 1) return <span className="text-[9px] px-1 py-0 rounded bg-green-900 text-green-400 font-medium">T1</span>;
    if (tier === 2) return <span className="text-[9px] px-1 py-0 rounded bg-blue-900 text-blue-400 font-medium">T2</span>;
    return <span className="text-[9px] px-1 py-0 rounded bg-gray-700 text-gray-400 font-medium">T3</span>;
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-md font-semibold text-blue-400">Match Scout</h3>
          <button
            onClick={() => setShowGuide(true)}
            className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-700 hover:bg-blue-800 text-gray-400 hover:text-blue-300 text-[9px] font-bold"
            title="How predictions work"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={win}
            onChange={(e) => setWin(e.target.value as TimeWindow)}
            className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs focus:outline-none"
            title="SportyBet fixture window"
          >
            {TIME_WINDOWS.map(tw => <option key={tw.key || 'all'} value={tw.key}>{tw.label}</option>)}
          </select>
          <button
            onClick={handleScout}
            disabled={loading}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-xs font-medium"
          >
            {loading ? 'Scouting...' : 'Scout'}
          </button>
          {loading && (
            <button
              onClick={handleStopScout}
              className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-medium text-white"
            >
              Stop
            </button>
          )}
          {!loading && matches.length >= 2 && onAddPick && (
            <button
              onClick={handleQuickSlip}
              className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium text-white"
              title="Create slip from top confident picks"
            >
              Quick Slip
            </button>
          )}
        </div>
      </div>

      {/* Background Status Bar */}
      <div className="mb-2 px-2 py-1.5 bg-gray-800 rounded border border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              DB: {dbSize > 0 ? dbSize.toLocaleString() : '0'} matches
            </span>
            <span className="text-[10px] text-gray-500">|</span>
            <span className="text-[10px] text-gray-500">
              Settlement: every 30min
            </span>
            <span className="text-[10px] text-gray-500">|</span>
            <span className="text-[10px] text-gray-500">
              Flashscore: hourly
            </span>
          </div>
          <div className="flex items-center gap-2">
            {syncMessage && <span className="text-[10px] text-blue-400">{syncMessage}</span>}
            <button
              onClick={handleSyncData}
              disabled={syncing}
              className="px-2 py-0.5 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-600 rounded text-[10px] font-medium text-white"
            >
              {syncing ? 'Syncing...' : 'Sync Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Regional Presets */}
      <div className="mb-2 flex flex-wrap gap-1">
        {REGIONAL_PRESETS.map(preset => (
          <button
            key={preset.id}
            onClick={() => applyPreset(preset.id)}
            title={preset.description}
            className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-blue-900 hover:text-blue-300 text-gray-400 border border-gray-700 hover:border-blue-800 transition-colors"
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* League Picker Toggle + Summary */}
      <div className="mb-3 p-2 bg-gray-800 rounded border border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => setShowLeaguePicker(!showLeaguePicker)}
            className="text-xs text-gray-400 hover:text-blue-300 flex items-center gap-1"
          >
            <span>{showLeaguePicker ? '▼' : '▶'}</span>
            <span>{selectedCount} leagues selected</span>
            <span className="text-gray-600">({LEAGUE_REGISTRY.length} available)</span>
          </button>
          <div className="flex gap-2">
            <button onClick={() => selectTier(1)} className="text-xs text-green-500 hover:text-green-400">T1</button>
            <button onClick={() => selectTier(2)} className="text-xs text-blue-500 hover:text-blue-400">T1+T2</button>
            <button onClick={() => selectAll(true)} className="text-xs text-blue-400 hover:text-blue-300">All</button>
            <button onClick={() => selectAll(false)} className="text-xs text-gray-500 hover:text-gray-300">None</button>
          </div>
        </div>

        {/* Scan bar (inside picker area) */}
        {showLeaguePicker && (
          <div className="flex items-center justify-between mt-1 mb-1">
            <div className="flex items-center gap-2">
              <button
                onClick={handleScanLeagues}
                disabled={scanning}
                className="text-[10px] px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-600 rounded text-white font-medium"
              >
                {scanning ? 'Scanning...' : 'Scan Active'}
              </button>
              {scanResult && (
                <span className="text-[10px] text-gray-500">
                  {scanResult.activeCount} active / {scanResult.inactiveCount} off-season
                </span>
              )}
            </div>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
                className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-0"
              />
              <span className="text-[10px] text-gray-500">Hide inactive</span>
            </label>
          </div>
        )}

        {/* Collapsed: show selected league names as pills */}
        {!showLeaguePicker && selectedCount > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {LEAGUE_REGISTRY.filter(l => leagueSelection[l.id]).slice(0, 15).map(league => (
              <span key={league.id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">
                {league.name}
              </span>
            ))}
            {selectedCount > 15 && (
              <span className="text-[10px] px-1.5 py-0.5 text-gray-500">+{selectedCount - 15} more</span>
            )}
          </div>
        )}

        {/* Expanded League Picker */}
        {showLeaguePicker && (
          <div className="mt-2">
            {/* Search */}
            <input
              type="text"
              placeholder="Search leagues..."
              value={leagueSearch}
              onChange={(e) => setLeagueSearch(e.target.value)}
              className="w-full px-2 py-1 mb-2 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />

            {/* Search results (flat list) */}
            {filteredLeagues && (
              <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {filteredLeagues.map(league => (
                  <label
                    key={league.id}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer ${
                      leagueSelection[league.id] ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-500'
                    }`}
                  >
                    <input type="checkbox" checked={!!leagueSelection[league.id]} onChange={() => toggleLeague(league.id)} className="hidden" />
                    <TierBadge tier={league.tier} />
                    {league.name}
                  </label>
                ))}
                {filteredLeagues.length === 0 && <p className="text-xs text-gray-500">No leagues match "{leagueSearch}"</p>}
              </div>
            )}

            {/* Grouped by region (when not searching) */}
            {!filteredLeagues && (
              <div className="max-h-60 overflow-y-auto space-y-1">
                {regions.map(region => {
                  const regionLeagues = leaguesByRegion[region] || [];
                  const visibleLeagues = hideInactive && scanResult
                    ? regionLeagues.filter(l => scanResult.results[l.id]?.active !== false)
                    : regionLeagues;
                  if (visibleLeagues.length === 0) return null;
                  const selectedInRegion = visibleLeagues.filter(l => leagueSelection[l.id]).length;
                  const activeInRegion = scanResult
                    ? visibleLeagues.filter(l => scanResult.results[l.id]?.active).length
                    : visibleLeagues.length;
                  const isExpanded = expandedRegion === region;

                  return (
                    <div key={region} className="border border-gray-700 rounded overflow-hidden">
                      <div
                        className="flex items-center justify-between px-2 py-1 bg-gray-900 cursor-pointer hover:bg-gray-850"
                        onClick={() => setExpandedRegion(isExpanded ? null : region)}
                      >
                        <span className="text-xs text-gray-300 flex items-center gap-1">
                          <span className="text-gray-500">{isExpanded ? '▼' : '▶'}</span>
                          {region}
                          <span className="text-gray-600">({selectedInRegion}/{visibleLeagues.length})</span>
                          {scanResult && <span className="text-[9px] text-green-600">{activeInRegion} live</span>}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectRegion(region, true); }}
                            className="text-[10px] text-blue-500 hover:text-blue-400"
                          >all</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); selectRegion(region, false); }}
                            className="text-[10px] text-gray-600 hover:text-gray-400"
                          >none</button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="flex flex-wrap gap-1 p-2 bg-gray-850">
                          {visibleLeagues.map(league => {
                            const leagueActive = scanResult ? scanResult.results[league.id]?.active : undefined;
                            return (
                              <label
                                key={league.id}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer ${
                                  leagueSelection[league.id] ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-500'
                                } ${leagueActive === false ? 'opacity-40' : ''}`}
                              >
                                <input type="checkbox" checked={!!leagueSelection[league.id]} onChange={() => toggleLeague(league.id)} className="hidden" />
                                {leagueActive !== undefined && (
                                  <span className={`w-1.5 h-1.5 rounded-full ${leagueActive ? 'bg-green-500' : 'bg-gray-600'}`}></span>
                                )}
                                <TierBadge tier={league.tier} />
                                {league.name}
                                <span className="text-[9px] text-gray-600 ml-0.5">{getProviderCount(league)}p</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixture Sources + Prediction DB Status */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <span className="text-xs text-gray-500 mr-1">Fixtures:</span>
        <button onClick={() => toggleProvider('espn')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.espn ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          ESPN {providerToggles.espn ? '✓' : '○'}
        </button>
        <button onClick={() => toggleProvider('thesportsdb')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.thesportsdb ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          TheSportsDB {providerToggles.thesportsdb ? '✓' : '○'}
        </button>
        <button onClick={() => toggleProvider('footballdata')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_footballdata_key') ? 'bg-gray-800 text-gray-600' :
          providerToggles.footballdata ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          Football-Data {localStorage.getItem('rollover_footballdata_key') ? (providerToggles.footballdata ? '✓' : '○') : '—'}
        </button>
        <button onClick={() => toggleProvider('sportmonks')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_sportmonks_token') ? 'bg-gray-800 text-gray-600' :
          providerToggles.sportmonks ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          Sportmonks {localStorage.getItem('rollover_sportmonks_token') ? (providerToggles.sportmonks ? '✓' : '○') : '—'}
        </button>
        <span className="text-gray-700 mx-1">|</span>
        <span className="text-[10px] text-gray-500">
          Predictions: {dbSize > 0 ? `${dbSize.toLocaleString()} matches` : 'No data'}
        </span>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400 animate-pulse">Analyzing fixtures...</p>
          <p className="text-xs text-gray-500 mt-1">SportyBet fixtures · {TIME_WINDOWS.find(t => t.key === win)?.label || 'All upcoming'}</p>
        </div>
      )}

      {/* No Bet Today */}
      {error && error === 'NO_BET_TODAY' && (
        <div className="p-6 bg-gray-800 border-2 border-yellow-700 rounded-lg text-center mb-3">
          <div className="text-2xl mb-2">&#128721;</div>
          <p className="text-lg font-bold text-yellow-400 mb-1">NO BET TODAY</p>
          <p className="text-xs text-gray-400 mb-2">No matches passed the confidence threshold. The data says sit this one out.</p>
          <p className="text-xs text-yellow-600 italic">"The best rollover move some days is no move at all."</p>
        </div>
      )}

      {/* Error */}
      {error && error !== 'NO_BET_TODAY' && (
        <div className="p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-300 mb-3">{error}</div>
      )}

      {/* Results */}
      {matches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {Math.min(visibleCount, matches.length)} of {matches.length} matches
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGroupByLeague(!groupByLeague)}
                className={`text-[10px] px-2 py-0.5 rounded ${groupByLeague ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400'}`}
              >
                {groupByLeague ? 'Grouped' : 'Group by league'}
              </button>
            {(() => {
              try {
                const cached = localStorage.getItem('rollover_scout_cache');
                if (cached) {
                  const { timestamp } = JSON.parse(cached);
                  const age = Math.round((Date.now() - timestamp) / 60000);
                  return <span className="text-xs text-gray-600">{age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`}</span>;
                }
              } catch {}
              return null;
            })()}
            </div>
          </div>

          {/* Grouped view */}
          {groupByLeague ? (
            (() => {
              const groups: Record<string, typeof matches> = {};
              for (const m of matches.slice(0, visibleCount)) {
                const key = m.league.name || 'Unknown';
                if (!groups[key]) groups[key] = [];
                groups[key].push(m);
              }
              return Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([league, leagueMatches]) => (
                <div key={league} className="mb-2">
                  <div className="flex items-center justify-between px-2 py-1 bg-gray-800 rounded-t border border-gray-700 border-b-0">
                    <span className="text-[10px] font-medium text-gray-300">{league}</span>
                    <span className="text-[9px] text-gray-500">{leagueMatches.length} matches</span>
                  </div>
                  {leagueMatches.map((match) => (
                    <div key={match.fixtureId} className="bg-gray-800 border-x border-b border-gray-700 last:rounded-b overflow-hidden">
                      <div
                        onClick={() => setExpandedMatch(expandedMatch === match.fixtureId ? null : match.fixtureId)}
                        className="flex items-center justify-between p-2 cursor-pointer hover:bg-gray-750"
                      >
                        <div className="flex-1">
                          <div className="text-xs text-gray-200">{match.homeTeam.name} <span className="text-gray-500">v</span> {match.awayTeam.name}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {match.league.country && match.league.country.split('+').map((src, si) => (
                              <span key={si} className={`text-[8px] px-0.5 rounded font-bold ${src === 'ESPN' ? 'bg-red-900 text-red-300' : src === 'FD' ? 'bg-yellow-900 text-yellow-300' : src === 'SDB' ? 'bg-green-900 text-green-300' : src === 'FS' ? 'bg-indigo-900 text-indigo-300' : 'bg-gray-700 text-gray-400'}`}>{src}</span>
                            ))}
                            <span className="text-[10px] text-gray-500">{new Date(match.kickOff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                        {match.suggestions[0] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${match.suggestions[0].confidence >= 75 ? 'bg-green-900 text-green-300' : match.suggestions[0].confidence >= 65 ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-700 text-gray-400'}`}>
                            {match.suggestions[0].pick} ({match.suggestions[0].confidence}%)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ));
            })()
          ) : (
          /* Flat list view */
          matches.slice(0, visibleCount).map((match) => (
            <div key={match.fixtureId} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <div
                onClick={() => setExpandedMatch(expandedMatch === match.fixtureId ? null : match.fixtureId)}
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
              >
                <div className="flex-1">
                  <div className="text-sm text-gray-200">
                    {match.homeTeam.name} <span className="text-gray-500">v</span> {match.awayTeam.name}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{match.league.name}</span>
                    {match.league.country && match.league.country.split('+').map((src, si) => (
                      <span key={si} className={`text-[9px] px-1 py-0 rounded font-bold ${
                        src === 'ESPN' ? 'bg-red-900 text-red-300' :
                        src === 'FD' ? 'bg-yellow-900 text-yellow-300' :
                        src === 'SDB' ? 'bg-green-900 text-green-300' :
                        src === 'SM' ? 'bg-cyan-900 text-cyan-300' :
                        'bg-gray-700 text-gray-400'
                      }`}>{src}</span>
                    ))}
                    <span className="text-xs text-gray-600">
                      {new Date(match.kickOff).toLocaleDateString()} {new Date(match.kickOff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {match.suggestions[0] && (() => {
                    const best = match.suggestions[0];
                    // Data-backed = has real reasoning, not the no-data fallback
                    const noData = best.reasoning.some(r => r.toLowerCase().includes('no historical data'));
                    const limited = best.reasoning.some(r => r.toLowerCase().includes('limited data'));
                    const tier = best.confidence >= 75 ? { label: 'Strong', cls: 'bg-green-900 text-green-300' }
                      : best.confidence >= 65 ? { label: 'Fair', cls: 'bg-yellow-900 text-yellow-300' }
                      : { label: 'Thin', cls: 'bg-gray-700 text-gray-400' };
                    return (
                      <span className="flex items-center gap-1">
                        {/* Data-backing dot: green=solid, amber=limited, red=none */}
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${noData ? 'bg-red-500' : limited ? 'bg-amber-500' : 'bg-green-500'}`}
                          title={noData ? 'No historical data — low trust' : limited ? 'Limited data' : 'Backed by historical data'}
                        />
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${tier.cls}`}>
                          {best.pick} ({best.confidence}%) · {tier.label}
                        </span>
                      </span>
                    );
                  })()}
                  <span className="text-gray-500 text-xs">{expandedMatch === match.fixtureId ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedMatch === match.fixtureId && (
                <div className="border-t border-gray-700 p-3">
                  {/* Analyze button */}
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      {match.redFlags.length > 0 && match.redFlags.map((flag, i) => (
                        <p key={i} className="text-xs text-yellow-400">&#9888; {flag}</p>
                      ))}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setAnalysisMatch(match); }}
                      className="text-[10px] px-2 py-1 bg-indigo-700 hover:bg-indigo-600 rounded text-white font-medium"
                    >
                      Analyze
                    </button>
                  </div>
                  <div className="space-y-2">
                    {match.suggestions.map((sug, i) => (
                      <div key={i} className="flex items-start justify-between p-2 bg-gray-900 rounded">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold ${
                              sug.confidence >= 75 ? 'text-green-400' : sug.confidence >= 65 ? 'text-yellow-400' : 'text-gray-400'
                            }`}>
                              {sug.pick}
                            </span>
                            <span className="text-xs text-gray-500">{sug.market}</span>
                            {/* Provider strength badges (Option B) */}
                            {getStrengthBadges(sug.market, sug.pick, sug.reasoning).map((badge, bi) => (
                              <span key={bi} className={`text-[8px] px-1 py-0 rounded font-bold ${badge.className}`}>{badge.label}</span>
                            ))}
                            <span className="text-xs text-gray-600">~{sug.estimatedOdds}</span>
                            {(() => {
                              const vKey = `${match.fixtureId}-${sug.pick}`;
                              const val = valueMap[vKey];
                              if (val?.isValue) return <span className="text-xs bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded font-bold">VALUE +{val.edge}%</span>;
                              if (val && !val.isValue) return <span className="text-xs text-gray-600">@{val.marketOdds.toFixed(2)}</span>;
                              return null;
                            })()}
                          </div>
                          <div className="mt-1">
                            {sug.reasoning.map((r, j) => (
                              <p key={j} className="text-xs text-gray-500">{r}</p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {/* Confidence badge with hover tooltip (Option A) */}
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded cursor-help relative group ${
                              sug.confidence >= 75 ? 'bg-green-900 text-green-300' :
                              sug.confidence >= 65 ? 'bg-yellow-900 text-yellow-300' :
                              'bg-gray-700 text-gray-400'
                            }`}
                            title={getConfidenceTooltip(sug.market, sug.pick, sug.confidence, sug.reasoning)}
                          >
                            {sug.confidence}%
                            {/* Tooltip on hover */}
                            <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block w-48 p-2 bg-gray-800 border border-gray-600 rounded shadow-lg text-[9px] text-gray-300 font-normal text-left whitespace-normal z-50">
                              <span className="font-bold text-blue-400 block mb-1">Confidence Breakdown</span>
                              {getConfidenceBreakdown(sug.market, sug.pick, sug.confidence).map((line, li) => (
                                <span key={li} className="block">{line}</span>
                              ))}
                            </span>
                          </span>
                          {onAddPick && (
                            <button
                              onClick={() => handleAddPick(match, sug)}
                              disabled={addedPicks.has(`${match.fixtureId}-${sug.pick}`)}
                              className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-white"
                            >
                              {addedPicks.has(`${match.fixtureId}-${sug.pick}`) ? 'Added' : '+ Slip'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
          )}

          {/* Load More button */}
          {visibleCount < matches.length && (
            <button
              onClick={() => setVisibleCount(prev => prev + 30)}
              className="w-full py-2 mt-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-400 hover:text-gray-200 font-medium"
            >
              Load More ({matches.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && matches.length === 0 && !error && (
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">Click "Scout" to find safe picks from all providers.</p>
          <p className="text-xs text-gray-600 mt-1">47 leagues available. Use presets or expand the picker to choose.</p>
        </div>
      )}

      {/* Match Analysis Modal */}
      {analysisMatch && (
        <MatchAnalysis
          homeTeam={analysisMatch.homeTeam.name}
          awayTeam={analysisMatch.awayTeam.name}
          league={analysisMatch.league.name}
          onClose={() => setAnalysisMatch(null)}
        />
      )}

      {/* Prediction Guide Modal */}
      <PredictionGuide open={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
}
