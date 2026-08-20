import React, { useState } from 'react';
import { ParsedSelection } from '../engine/types';
import { getAllUpcomingMatches, getStandings, getFootballDataKey, FREE_COMPETITIONS } from '../engine/football-data-org';
import { getAllUpcomingEvents as getSportsDbEvents, SPORTSDB_LEAGUES } from '../engine/thesportsdb';
import { getAllUpcomingEvents as getEspnEvents, ESPN_LEAGUES } from '../engine/espn';
import { getFixturesForDays as getApiFootballFixtures, getApiKey as getApiFootballKey, TOP_LEAGUES } from '../engine/api-football';
import { getUpcomingFixtures as getKickoffFixtures, getKickoffApiKey, KICKOFF_LEAGUES } from '../engine/kickoff-api';
import { getAllUpcomingEvents as getSportmonksEvents, getSportmonksToken } from '../engine/sportmonks';
import { getAllUpcomingEvents as getOpenLigaEvents } from '../engine/openligadb';
import { fetchAllProviders } from '../engine/provider-orchestrator';
import { fetchLeagueStats, getCachedTeamStats, TeamStats } from '../engine/stats-calculator';
import { LockedMatch, loadLockedMatches, saveLockedMatches, isMatchLocked, lockedToSelections } from '../engine/fixture-store';

interface Props {
  onAddPicks: (picks: ParsedSelection[]) => void;
  onStatsLoaded?: () => void;
}

type ApiProvider = 'thesportsdb' | 'espn' | 'football-data' | 'api-football' | 'kickoff-api' | 'sportmonks' | 'openligadb' | 'all';

interface SearchResult {
  matchId: number;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  league: string;
  leagueCode: string;
  kickOff: Date;
  homeWinRate: number;
  homeScoringRate: number;
  homeAvgGoals: number;
  awayWinRate: number;
  awayScoringRate: number;
  awayAvgGoals: number;
  positionGap: number | null; // positive = home higher in table
  selected: boolean;
  suggestedPick: string;
  suggestedMarket: string;
  estimatedOdds: number;
  // v2.1.0 stats
  homeForm: string;
  awayForm: string;
  over25Pct: number;
  bttsPct: number;
  hasStats: boolean;
}

type SearchFilter = 'home_advantage' | 'home_scoring' | 'away_weak' | 'goals_expected' | 'all';

const FILTER_OPTIONS: { value: SearchFilter; label: string; description: string }[] = [
  { value: 'home_advantage', label: 'Strong Home Teams', description: 'Home win rate ≥ 70%' },
  { value: 'home_scoring', label: 'Home Always Scores', description: 'Home scoring rate ≥ 80%' },
  { value: 'away_weak', label: 'Weak Away Teams', description: 'Away win rate ≤ 25%' },
  { value: 'goals_expected', label: 'High Scoring Matches', description: 'Combined avg goals ≥ 2.5' },
  { value: 'all', label: 'All Matches (no filter)', description: 'Show everything, you decide' },
];

export default function MatchSearch({ onAddPicks, onStatsLoaded }: Props) {
  const [filter, setFilter] = useState<SearchFilter>('home_advantage');
  const [days, setDays] = useState(7);
  const [provider, setProvider] = useState<ApiProvider>(() => {
    return (localStorage.getItem('rollover_search_provider') as ApiProvider) || 'thesportsdb';
  });
  const [results, setResults] = useState<SearchResult[]>(() => {
    // Load from fixture library cache on mount
    try {
      const cached = localStorage.getItem('rollover_fixture_library');
      if (cached) {
        const lib = JSON.parse(cached);
        // Only use if less than 12 hours old
        if (lib.cachedAt && Date.now() - lib.cachedAt < 12 * 60 * 60 * 1000) {
          return lib.results || [];
        }
      }
    } catch { /* ignore */ }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedMatches, setLockedMatches] = useState<LockedMatch[]>(() => loadLockedMatches());
  const [leagues, setLeagues] = useState(() => {
    const saved = localStorage.getItem('rollover_search_leagues');
    return saved ? JSON.parse(saved) : FREE_COMPETITIONS.map(c => ({ ...c, checked: true }));
  });

  function handleLock(r: SearchResult) {
    const locked: LockedMatch = {
      id: crypto.randomUUID(),
      homeTeam: r.homeTeam.name,
      awayTeam: r.awayTeam.name,
      kickOff: new Date(r.kickOff).toISOString(),
      league: r.league,
      leagueCode: r.leagueCode,
      provider,
      lockedAt: new Date().toISOString(),
      suggestedPick: r.suggestedPick !== '-' ? r.suggestedPick : undefined,
      suggestedMarket: r.suggestedMarket !== '-' ? r.suggestedMarket : undefined,
      estimatedOdds: r.estimatedOdds > 0 ? r.estimatedOdds : undefined,
      homeForm: r.homeForm || undefined,
      awayForm: r.awayForm || undefined,
      over25Pct: r.hasStats ? r.over25Pct : undefined,
      bttsPct: r.hasStats ? r.bttsPct : undefined,
      positionGap: r.positionGap ?? undefined,
    };
    const updated = [...lockedMatches, locked];
    setLockedMatches(updated);
    saveLockedMatches(updated);
  }

  function handleUnlock(lockedId: string) {
    const updated = lockedMatches.filter(m => m.id !== lockedId);
    setLockedMatches(updated);
    saveLockedMatches(updated);
  }

  function handleAddAllLocked() {
    const selections = lockedToSelections(lockedMatches);
    if (selections.length > 0) {
      onAddPicks(selections);
    }
  }

  function isLocked(homeTeam: string, awayTeam: string): boolean {
    const key = `${homeTeam.toLowerCase().trim()}|${awayTeam.toLowerCase().trim()}`;
    return lockedMatches.some(m =>
      `${m.homeTeam.toLowerCase().trim()}|${m.awayTeam.toLowerCase().trim()}` === key
    );
  }

  function toggleLeague(code: string) {
    const updated = leagues.map((l: any) => l.code === code ? { ...l, checked: !l.checked } : l);
    setLeagues(updated);
    localStorage.setItem('rollover_search_leagues', JSON.stringify(updated));
  }

  async function handleSearch() {
    if (provider === 'football-data' && !getFootballDataKey()) {
      setError('Football-Data.org API key required. Set it in Match Scout > API Settings.');
      return;
    }
    // TheSportsDB and ESPN need no keys

    setLoading(true);
    setError(null);
    setResults([]);

    const selectedCodes = leagues.filter((l: any) => l.checked).map((l: any) => l.code);
    if (selectedCodes.length === 0) {
      setError('Select at least one league.');
      setLoading(false);
      return;
    }

    try {
      let fixtures: any[] = [];

      if (provider === 'thesportsdb') {
        const selectedIds = leagues.filter((l: any) => l.checked).map((l: any) => l.code);
        const sportsDbIds = SPORTSDB_LEAGUES
          .filter(l => selectedIds.some((code: string) => l.name.toLowerCase().includes(code.toLowerCase()) || code === l.id))
          .map(l => l.id);
        const events = await getSportsDbEvents(sportsDbIds.length > 0 ? sportsDbIds : undefined);
        fixtures = events.map((e: any) => ({
          id: e.idEvent || e.id,
          homeTeam: { id: 0, name: e.strHomeTeam || e.homeTeam || '' },
          awayTeam: { id: 0, name: e.strAwayTeam || e.awayTeam || '' },
          utcDate: e.strTimestamp || e.dateEvent || '',
          competitionName: e.leagueName || e.strLeague || '',
          competitionCode: e.leagueId || '',
        }));
      } else if (provider === 'espn') {
        const events = await getEspnEvents(undefined, days);
        fixtures = events.map((e: any) => ({
          id: e.id,
          homeTeam: { id: 0, name: e.homeTeam },
          awayTeam: { id: 0, name: e.awayTeam },
          utcDate: e.kickOff,
          competitionName: e.leagueName || '',
          competitionCode: e.leagueSlug || '',
        }));
      } else if (provider === 'football-data') {
        fixtures = await getAllUpcomingMatches(days, selectedCodes);
      } else if (provider === 'api-football') {
        if (!getApiFootballKey()) { setError('API-Football key not set. Add it in API Settings.'); setLoading(false); return; }
        const leagueIds = TOP_LEAGUES.filter(l =>
          selectedCodes.some((code: string) => l.name.toLowerCase().includes(code.toLowerCase()))
        ).map(l => l.id);
        const raw = await getApiFootballFixtures(Math.min(days, 3), leagueIds.length > 0 ? leagueIds : TOP_LEAGUES.map(l => l.id));
        fixtures = raw.map((f: any) => ({
          id: f.fixture?.id || 0,
          homeTeam: { id: f.teams?.home?.id || 0, name: f.teams?.home?.name || '' },
          awayTeam: { id: f.teams?.away?.id || 0, name: f.teams?.away?.name || '' },
          utcDate: f.fixture?.date || '',
          competitionName: f.league?.name || '',
          competitionCode: f.league?.id?.toString() || '',
        }));
      } else if (provider === 'kickoff-api') {
        if (!getKickoffApiKey()) { setError('KickoffAPI key not set. Get free key at kickoffapi.com'); setLoading(false); return; }
        const leagueIds = Object.entries(KICKOFF_LEAGUES)
          .filter(([code]) => selectedCodes.includes(code))
          .map(([, id]) => id);
        const targetLeagues = leagueIds.length > 0 ? leagueIds : Object.values(KICKOFF_LEAGUES).slice(0, 5);
        const allRaw: any[] = [];
        for (const leagueId of targetLeagues) {
          const raw = await getKickoffFixtures(leagueId, days);
          allRaw.push(...raw);
        }
        fixtures = allRaw.map((f: any) => ({
          id: f.id || 0,
          homeTeam: { id: f.homeTeam?.id || 0, name: f.homeTeam?.name || '' },
          awayTeam: { id: f.awayTeam?.id || 0, name: f.awayTeam?.name || '' },
          utcDate: f.date || '',
          competitionName: '',
          competitionCode: '',
        }));
      } else if (provider === 'sportmonks') {
        if (!getSportmonksToken()) { setError('Sportmonks token not set. Get free token at sportmonks.com'); setLoading(false); return; }
        const events = await getSportmonksEvents(days);
        fixtures = events.map((e: any) => ({
          id: e.id || 0,
          homeTeam: { id: e.homeTeamId || 0, name: e.homeTeam || '' },
          awayTeam: { id: e.awayTeamId || 0, name: e.awayTeam || '' },
          utcDate: e.kickOff || '',
          competitionName: e.league || 'Danish/Scottish',
          competitionCode: e.leagueId?.toString() || '',
        }));
      } else if (provider === 'openligadb') {
        const events = await getOpenLigaEvents(days);
        fixtures = events.map((e: any) => ({
          id: e.id || 0,
          homeTeam: { id: e.homeTeamId || 0, name: e.homeTeam || '' },
          awayTeam: { id: e.awayTeamId || 0, name: e.awayTeam || '' },
          utcDate: e.kickOff || '',
          competitionName: e.league || '',
          competitionCode: e.leagueShortcut || '',
        }));
      } else if (provider === 'all') {
        // Multi-provider merge via orchestrator
        const result = await fetchAllProviders({ days, leagueCodes: selectedCodes, useFootballData: true, useTheSportsDb: true, useEspn: true, useApiFootball: true, useKickoffApi: true });
        fixtures = result.fixtures.map(f => ({
          id: f.id,
          homeTeam: { id: f.homeTeam.id, name: f.homeTeam.name },
          awayTeam: { id: f.awayTeam.id, name: f.awayTeam.name },
          utcDate: f.kickOff.toISOString(),
          competitionName: f.league,
          competitionCode: f.leagueCode,
          // Pre-filled stats from orchestrator merge
          _homeForm: f.homeForm,
          _awayForm: f.awayForm,
          _over25Pct: f.over25Pct,
          _bttsPct: f.bttsPct,
          _homeWinRate: f.homeWinRate,
          _awayWinRate: f.awayWinRate,
          _positionGap: f.positionGap,
        }));
        // Show which providers contributed
        if (result.providersFailed.length > 0) {
          setError(`Used: ${result.providersUsed.join(', ')}. Failed: ${result.providersFailed.join(', ')}`);
        }
      }

      const searchResults: SearchResult[] = [];

      // Fetch standings for each league upfront (cached, one call per league)
      const standingsCache: Record<string, any> = {};
      for (const code of selectedCodes) {
        try {
          standingsCache[code] = await getStandings(code);
        } catch {
          standingsCache[code] = null;
        }
      }

      // Fetch stats from TheSportsDB past events (free, unlimited)
      const leagueStatsMap = new Map<string, Map<string, TeamStats>>();
      try {
        setLoadingStats(true);
        // Map selected league codes to TheSportsDB IDs for stats
        const statsLeagueIds = SPORTSDB_LEAGUES
          .filter(l => selectedCodes.some((code: string) =>
            l.name.toLowerCase().includes(code.toLowerCase()) || code === l.id
          ))
          .map(l => l.id);

        // Fetch stats for each league (uses cache internally)
        for (const leagueId of statsLeagueIds) {
          const stats = await fetchLeagueStats(leagueId);
          if (stats.size > 0) {
            leagueStatsMap.set(leagueId, stats);
          }
        }
      } catch (e) {
        console.error('Stats fetch failed (non-blocking):', e);
      } finally {
        setLoadingStats(false);
        if (onStatsLoaded) onStatsLoaded();
      }

      // Helper to find team stats from any league
      function findTeamStats(teamName: string): TeamStats | null {
        // First try cache directly
        const cached = getCachedTeamStats(teamName);
        if (cached && cached.matchesAnalyzed > 0) return cached;
        // Then search league maps
        const normalized = teamName.toLowerCase();
        for (const [, statsMap] of leagueStatsMap) {
          for (const [key, stats] of statsMap) {
            if (key.includes(normalized) || normalized.includes(key)) {
              return stats;
            }
          }
        }
        return null;
      }

      for (const fixture of fixtures) {
        const homeId = fixture.homeTeam?.id ?? 0;
        const awayId = fixture.awayTeam?.id ?? 0;
        const homeName = fixture.homeTeam?.name || fixture.homeTeam?.shortName || '';
        const awayName = fixture.awayTeam?.name || fixture.awayTeam?.shortName || '';
        if (!homeName || !awayName) continue;

        // Get real stats — prefer orchestrator pre-fill, fallback to TheSportsDB cache
        const homeStatsData = findTeamStats(homeName);
        const awayStatsData = findTeamStats(awayName);

        const homeWinRate = (fixture as any)._homeWinRate ?? homeStatsData?.homeWinPct ?? 50;
        const homeScoringRate = homeStatsData ? Math.round(((homeStatsData.matchesAnalyzed - (homeStatsData.cleanSheetPct * homeStatsData.matchesAnalyzed / 100)) / homeStatsData.matchesAnalyzed) * 100) || 50 : 50;
        const homeAvgGoals = homeStatsData?.avgGoalsScored ?? 1.0;
        const awayWinRate = (fixture as any)._awayWinRate ?? awayStatsData?.awayWinPct ?? 50;
        const awayScoringRate = awayStatsData ? 100 - (awayStatsData.cleanSheetPct || 50) : 50;
        const awayAvgGoals = awayStatsData?.avgGoalsScored ?? 1.0;

        const homeForm = (fixture as any)._homeForm || homeStatsData?.form?.join('') || '';
        const awayForm = (fixture as any)._awayForm || awayStatsData?.form?.join('') || '';
        const over25Pct = (fixture as any)._over25Pct ?? (homeStatsData && awayStatsData
          ? Math.round((homeStatsData.over25Pct + awayStatsData.over25Pct) / 2)
          : 50);
        const bttsPct = (fixture as any)._bttsPct ?? (homeStatsData && awayStatsData
          ? Math.round((homeStatsData.bttsPct + awayStatsData.bttsPct) / 2)
          : 50);
        const hasStats = !!((fixture as any)._homeForm || homeStatsData || awayStatsData);

        let positionGap: number | null = (fixture as any)._positionGap ?? null;

        // Use cached standings if available (skip if orchestrator already provided gap)
        if (positionGap === null) {
          const compCode = fixture.competitionCode;
          if (standingsCache[compCode]?.standings) {
            let homePos = 0, awayPos = 0;
            for (const group of standingsCache[compCode].standings) {
              for (const entry of group.table || []) {
                if (entry.team?.id === homeId) homePos = entry.position;
                if (entry.team?.id === awayId) awayPos = entry.position;
              }
            }
            if (homePos && awayPos) positionGap = awayPos - homePos;
          }
        }

          // Apply filter with real stats data
          let passes = true;
          let suggestedPick = '-';
          let suggestedMarket = '-';
          let estimatedOdds = 0;

          // If we have position gap, suggest based on that
          if (positionGap !== null && positionGap >= 8) {
            suggestedPick = 'Home'; suggestedMarket = '1X2'; estimatedOdds = 1.35;
          } else if (positionGap !== null && positionGap <= -8) {
            suggestedPick = 'Away'; suggestedMarket = '1X2'; estimatedOdds = 1.50;
          }

          // Filter by criteria using real stats when available
          switch (filter) {
            case 'home_advantage':
              passes = hasStats ? homeWinRate >= 70 : (positionGap !== null && positionGap >= 5);
              if (passes && !estimatedOdds) { suggestedPick = 'Home'; suggestedMarket = '1X2'; estimatedOdds = 1.40; }
              break;
            case 'away_weak':
              passes = hasStats ? awayWinRate <= 25 : (positionGap !== null && positionGap >= 10);
              if (passes && !estimatedOdds) { suggestedPick = 'Home'; suggestedMarket = '1X2'; estimatedOdds = 1.30; }
              break;
            case 'home_scoring':
              passes = hasStats ? (homeStatsData?.avgGoalsScored ?? 0) >= 1.5 : true;
              if (passes && !estimatedOdds) { suggestedPick = 'Over 1.5'; suggestedMarket = 'Over/Under'; estimatedOdds = 1.25; }
              break;
            case 'goals_expected':
              passes = hasStats ? over25Pct >= 60 : true;
              if (passes && !estimatedOdds) { suggestedPick = 'Over 2.5'; suggestedMarket = 'Over/Under'; estimatedOdds = 1.65; }
              break;
            case 'all':
              passes = true;
              break;
          }

          if (passes) {
            searchResults.push({
              matchId: fixture.id,
              homeTeam: { id: homeId, name: homeName },
              awayTeam: { id: awayId, name: awayName },
              league: fixture.competitionName,
              leagueCode: fixture.competitionCode,
              kickOff: new Date(fixture.utcDate),
              homeWinRate,
              homeScoringRate,
              homeAvgGoals,
              awayWinRate,
              awayScoringRate,
              awayAvgGoals,
              positionGap,
              selected: false,
              suggestedPick,
              suggestedMarket,
              estimatedOdds,
              homeForm,
              awayForm,
              over25Pct,
              bttsPct,
              hasStats,
            });
          }
      } // end for loop

      // Sort by home win rate descending
      searchResults.sort((a, b) => b.homeWinRate - a.homeWinRate);
      setResults(searchResults);

      // Save to fixture library (persists until next search or 12h expiry)
      try {
        localStorage.setItem('rollover_fixture_library', JSON.stringify({
          results: searchResults,
          cachedAt: Date.now(),
          provider,
          days,
        }));
      } catch { /* ignore if storage full */ }

      if (searchResults.length === 0) {
        setError('No matches match your criteria for the selected period.');
      }
    } catch (e: any) {
      setError(e.message || 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(matchId: number) {
    setResults(prev => prev.map(r => r.matchId === matchId ? { ...r, selected: !r.selected } : r));
  }

  function selectAll() {
    setResults(prev => prev.map(r => ({ ...r, selected: true })));
  }

  function deselectAll() {
    setResults(prev => prev.map(r => ({ ...r, selected: false })));
  }

  function handleAddSelected() {
    const selected = results.filter(r => r.selected && r.estimatedOdds > 0);
    const picks: ParsedSelection[] = selected.map(r => {
      const kickOff = new Date(r.kickOff);
      const day = kickOff.getDate().toString().padStart(2, '0');
      const month = (kickOff.getMonth() + 1).toString().padStart(2, '0');
      const hour = kickOff.getHours().toString().padStart(2, '0');
      const min = kickOff.getMinutes().toString().padStart(2, '0');

      return {
        id: crypto.randomUUID(),
        index: 0,
        date: `${day}/${month}`,
        time: `${hour}:${min}`,
        kickOffDateTime: kickOff,
        gameId: r.matchId.toString(),
        homeTeam: r.homeTeam.name,
        awayTeam: r.awayTeam.name,
        status: 'not_started' as const,
        score: null,
        pick: r.suggestedPick,
        pickCategory: r.suggestedPick === 'Home' ? 'home' as const :
                      r.suggestedPick.includes('Over') ? 'over' as const :
                      r.suggestedPick === 'Away' ? 'away' as const : 'other' as const,
        odds: r.estimatedOdds,
        market: r.suggestedMarket,
        marketType: r.suggestedMarket === '1X2' ? '1x2' as const : 'over_under' as const,
        marketVariant: null,
        result: null,
        resultMessage: null,
        isSettled: false,
        isVoid: false,
        isSuspended: false,
        isEligibleForGrouping: true,
      };
    });

    onAddPicks(picks);
    // Mark added
    setResults(prev => prev.map(r => r.selected ? { ...r, selected: false } : r));
  }

  const selectedCount = results.filter(r => r.selected).length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-bold mb-3 text-blue-400">Match Search</h2>

        {/* Filter & Controls */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${
                filter === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title={opt.description}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Provider:</span>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as ApiProvider;
                setProvider(p);
                localStorage.setItem('rollover_search_provider', p);
              }}
              className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs focus:outline-none"
            >
              <option value="all">All Providers (merged)</option>
              <option value="thesportsdb">TheSportsDB (no key)</option>
              <option value="espn">ESPN (no key)</option>
              <option value="football-data">Football-Data.org (key)</option>
              <option value="api-football">API-Football (key, 100/day)</option>
              <option value="kickoff-api">KickoffAPI (key, 100/day)</option>
              <option value="sportmonks">Sportmonks (key, Danish/Scottish)</option>
              <option value="openligadb">OpenLigaDB (no key, German/European)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Timeframe:</span>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs focus:outline-none"
            >
              <option value={3}>3 days</option>
              <option value={5}>5 days</option>
              <option value={7}>1 week</option>
              <option value={14}>2 weeks</option>
            </select>
          </div>

          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-xs font-medium"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* League chips */}
        <div className="flex flex-wrap gap-1">
          {leagues.map((league: any) => (
            <label
              key={league.code}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer ${
                league.checked ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-500'
              }`}
            >
              <input type="checkbox" checked={league.checked} onChange={() => toggleLeague(league.code)} className="hidden" />
              {league.name}
            </label>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Locked Matches Panel */}
        {lockedMatches.length > 0 && (
          <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-yellow-900">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded font-bold">🔒 {lockedMatches.length}</span>
                <span className="text-sm text-gray-300 font-medium">Locked Matches</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddAllLocked}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium text-white"
                >
                  Add All to Selections
                </button>
                <button
                  onClick={() => { setLockedMatches([]); saveLockedMatches([]); }}
                  className="px-2 py-1 bg-gray-700 hover:bg-red-900 rounded text-xs text-gray-400 hover:text-red-300"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {lockedMatches.map(m => (
                <div key={m.id} className="flex items-center justify-between text-xs py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300">{m.homeTeam} v {m.awayTeam}</span>
                    {m.suggestedPick && (
                      <span className="text-green-400 font-medium">{m.suggestedPick}</span>
                    )}
                    {m.estimatedOdds && (
                      <span className="text-gray-500 font-mono">@{m.estimatedOdds.toFixed(2)}</span>
                    )}
                    <span className="text-gray-600">{m.league}</span>
                  </div>
                  <button
                    onClick={() => handleUnlock(m.id)}
                    className="text-gray-600 hover:text-red-400 px-1"
                    title="Unlock"
                  >
                    ✗
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 animate-pulse">
              {loadingStats ? 'Loading team statistics...' : 'Searching matches...'}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {results.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400">{results.length} matches found</span>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-blue-400 hover:text-blue-300">Select All</button>
                <button onClick={deselectAll} className="text-xs text-gray-500 hover:text-gray-300">Deselect</button>
                {selectedCount > 0 && (
                  <button
                    onClick={handleAddSelected}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
                  >
                    Add {selectedCount} to Selections
                  </button>
                )}
              </div>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-500">
                  <th className="py-2 w-6"></th>
                  <th className="py-2 text-left">Match</th>
                  <th className="py-2 text-left">League</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">H.Win%</th>
                  <th className="py-2">O2.5%</th>
                  <th className="py-2">BTTS%</th>
                  <th className="py-2">Form(H)</th>
                  <th className="py-2">Form(A)</th>
                  <th className="py-2">Gap</th>
                  <th className="py-2 text-left">Pick</th>
                  <th className="py-2">~Odds</th>
                  <th className="py-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.matchId}
                    onClick={() => toggleSelect(r.matchId)}
                    className={`border-b border-gray-800 cursor-pointer ${
                      r.selected ? 'bg-blue-900/30' : 'hover:bg-gray-800'
                    }`}
                  >
                    <td className="py-2 text-center">
                      <input type="checkbox" checked={r.selected} readOnly className="rounded" />
                    </td>
                    <td className="py-2">
                      <span className="text-gray-200">{r.homeTeam.name}</span>
                      <span className="text-gray-500"> v </span>
                      <span className="text-gray-300">{r.awayTeam.name}</span>
                    </td>
                    <td className="py-2 text-gray-500">{r.league}</td>
                    <td className="py-2 text-gray-400 text-center">
                      {new Date(r.kickOff).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}
                    </td>
                    <td className={`py-2 text-center font-mono ${r.homeWinRate >= 70 ? 'text-green-400' : r.homeWinRate >= 50 ? 'text-gray-300' : 'text-red-400'}`}>
                      {r.hasStats ? `${r.homeWinRate}%` : '-'}
                    </td>
                    <td className={`py-2 text-center font-mono ${r.over25Pct >= 65 ? 'text-green-400' : r.over25Pct >= 50 ? 'text-gray-300' : 'text-gray-500'}`}>
                      {r.hasStats ? `${r.over25Pct}%` : '-'}
                    </td>
                    <td className={`py-2 text-center font-mono ${r.bttsPct >= 60 ? 'text-green-400' : r.bttsPct >= 45 ? 'text-gray-300' : 'text-gray-500'}`}>
                      {r.hasStats ? `${r.bttsPct}%` : '-'}
                    </td>
                    <td className="py-2 text-center font-mono">
                      {r.homeForm ? r.homeForm.split('').map((c, i) => (
                        <span key={i} className={c === 'W' ? 'text-green-400' : c === 'D' ? 'text-gray-400' : 'text-red-400'}>{c}</span>
                      )) : <span className="text-gray-600">-</span>}
                    </td>
                    <td className="py-2 text-center font-mono">
                      {r.awayForm ? r.awayForm.split('').map((c, i) => (
                        <span key={i} className={c === 'W' ? 'text-green-400' : c === 'D' ? 'text-gray-400' : 'text-red-400'}>{c}</span>
                      )) : <span className="text-gray-600">-</span>}
                    </td>
                    <td className={`py-2 text-center font-mono ${r.positionGap && r.positionGap >= 8 ? 'text-green-400' : 'text-gray-500'}`}>
                      {r.positionGap !== null ? (r.positionGap > 0 ? `+${r.positionGap}` : r.positionGap) : '-'}
                    </td>
                    <td className="py-2 text-green-400 font-medium">{r.suggestedPick}</td>
                    <td className="py-2 text-center font-mono text-gray-300">
                      {r.estimatedOdds > 0 ? r.estimatedOdds.toFixed(2) : '-'}
                    </td>
                    <td className="py-2 text-center">
                      {isLocked(r.homeTeam.name, r.awayTeam.name) ? (
                        <span className="text-yellow-400 text-xs" title="Locked">🔒</span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleLock(r); }}
                          className="text-gray-600 hover:text-yellow-400 text-xs"
                          title="Lock this match"
                        >
                          🔓
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
