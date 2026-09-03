/**
 * MatchStatsModal — Full-screen modal for match statistics.
 * 
 * Fetches all data from Flashscore detail page and displays:
 * - HT/FT scores
 * - Goal scorers with minutes
 * - Cards (yellow/red)
 * - Match stats (possession, corners, shots, xG)
 * - Intelligence hints (form, streaks, patterns)
 * - Form letters with match details
 */

import React, { useState, useEffect } from 'react';
import { ParsedSelection } from '../engine/types';
import { EnrichedMatchData, fetchMatchEnrichment, getCachedEnrichment, getCachedEnrichmentByTeams } from '../engine/match-enrichment';
import { computeMatchIntelligence, MatchIntelligence, IntelligenceHint, getTeamMatches } from '../engine/intelligence-hints';
import { getAllMatches } from '../engine/historical-stats';
import { fetchDayFixtures } from '../engine/flashscore';
import { isSameTeam } from '../engine/team-aliases';
import { hasLocalData, crawlMatchHistory } from '../engine/match-crawl';

interface Props {
  selection: ParsedSelection;
  selResult: 'pending' | 'won' | 'lost';
  onClose: () => void;
}

type Tab = 'summary' | 'stats' | 'intelligence' | 'form';

export default function MatchStatsModal({ selection, selResult, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [enrichment, setEnrichment] = useState<EnrichedMatchData | null>(null);
  const [intelligence, setIntelligence] = useState<MatchIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Loading...');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // bump to recompute intel after sync

  // Force a fresh crawl from ALL sources (manual override — ignores DB check)
  async function handleForceSync() {
    setSyncing(true);
    setSyncMsg('Syncing from crawl sources...');
    try {
      const result = await crawlMatchHistory(
        selection.homeTeam,
        selection.awayTeam,
        (msg) => setSyncMsg(msg)
      );
      // Recompute intelligence from the now-enriched DB
      const allMatches = getAllMatches();
      if (allMatches.length > 0) {
        setIntelligence(computeMatchIntelligence(selection.homeTeam, selection.awayTeam, allMatches));
      }
      // Also re-attempt live match enrichment (Summary/Stats) from Flashscore
      try {
        const kickoffDate = new Date(selection.kickOffDateTime);
        const today = new Date(); today.setHours(0, 0, 0, 0); kickoffDate.setHours(0, 0, 0, 0);
        const dayOffset = Math.round((kickoffDate.getTime() - today.getTime()) / 86400000);
        const fixtures = await fetchDayFixtures(dayOffset);
        const match = fixtures.find(f =>
          (isSameTeam(f.homeTeam, selection.homeTeam) || f.homeTeam.toLowerCase().includes(selection.homeTeam.toLowerCase().split(' ')[0])) &&
          (isSameTeam(f.awayTeam, selection.awayTeam) || f.awayTeam.toLowerCase().includes(selection.awayTeam.toLowerCase().split(' ')[0]))
        );
        if (match?.matchId) {
          const enr = await fetchMatchEnrichment(match.matchId);
          if (enr) setEnrichment(enr);
        }
      } catch {}
      setRefreshKey(k => k + 1);
      setSyncMsg(result.added > 0
        ? `Added ${result.added} results from ${result.sources.join(', ')}`
        : 'No new data found from any source.');
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e?.message || 'unknown error'}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      // 1. Try cached enrichment first
      let data = getCachedEnrichmentByTeams(selection.homeTeam, selection.awayTeam);

      // 2. If not cached, find on Flashscore and fetch
      if (!data) {
        setStatus('Finding match on Flashscore...');
        try {
          const kickoffDate = new Date(selection.kickOffDateTime);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          kickoffDate.setHours(0, 0, 0, 0);
          const dayOffset = Math.round((kickoffDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

          const fixtures = await fetchDayFixtures(dayOffset);
          const match = fixtures.find(f =>
            f.isFinished &&
            (isSameTeam(f.homeTeam, selection.homeTeam) || f.homeTeam.toLowerCase().includes(selection.homeTeam.toLowerCase().split(' ')[0])) &&
            (isSameTeam(f.awayTeam, selection.awayTeam) || f.awayTeam.toLowerCase().includes(selection.awayTeam.toLowerCase().split(' ')[0]))
          );

          if (match?.matchId) {
            setStatus('Fetching match details...');
            data = await fetchMatchEnrichment(match.matchId);
          }
        } catch {}
      }

      if (!cancelled) {
        setEnrichment(data);
      }

      // 3. Ensure we have local history for these teams. If the DB is empty for
      // this fixture, crawl all sources on-demand (only happens the first time —
      // results are saved to the DB so future analyses are instant).
      if (!cancelled && !hasLocalData(selection.homeTeam, selection.awayTeam)) {
        setStatus('No local data — searching all sources...');
        try {
          const result = await crawlMatchHistory(
            selection.homeTeam,
            selection.awayTeam,
            (msg) => { if (!cancelled) setStatus(msg); }
          );
          if (!cancelled && result.added > 0) {
            setStatus(`Found ${result.added} results from ${result.sources.length} source(s)`);
          }
        } catch { /* best-effort */ }
      }

      // 4. Compute intelligence from DB (now possibly enriched by the crawl)
      const allMatches = getAllMatches();
      if (allMatches.length > 0 && !cancelled) {
        const intel = computeMatchIntelligence(selection.homeTeam, selection.awayTeam, allMatches);
        setIntelligence(intel);
      }

      if (!cancelled) {
        setLoading(false);
        setStatus('');
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  const isSettled = selResult === 'won' || selResult === 'lost';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'stats', label: 'Stats' },
    { id: 'intelligence', label: 'Intel' },
    { id: 'form', label: 'Form' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-200">
                {selection.homeTeam} <span className="text-gray-500">vs</span> {selection.awayTeam}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{selection.date} {selection.time}</span>
                <span className="text-xs text-gray-500">{selection.market}</span>
                {selection.score && (
                  <span className="text-xs font-bold text-blue-400">
                    {selection.score.htHome !== undefined && `HT ${selection.score.htHome}-${selection.score.htAway} | `}
                    FT {selection.score.home}-{selection.score.away}
                  </span>
                )}
                {selResult !== 'pending' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selResult === 'won' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                    {selResult === 'won' ? '✓ Won' : '✗ Lost'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleForceSync}
                disabled={syncing}
                className="px-2 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-600 rounded text-[11px] font-medium text-white flex items-center gap-1"
                title="Fetch fresh data from all crawl sources (Flashscore, 11v11, SoccerPunter, TheSportsDB)"
              >
                {syncing ? 'Syncing…' : '⟳ Sync sources'}
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-white text-lg px-2">✕</button>
            </div>
          </div>
          {syncMsg && (
            <div className="mt-2 text-[11px] text-indigo-300">{syncMsg}</div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 bg-gray-850">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-500 py-8">
              <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full mx-auto mb-2"></div>
              <p className="text-xs">{status}</p>
            </div>
          ) : (
            <>
              {activeTab === 'summary' && <SummaryTab enrichment={enrichment} selection={selection} intelligence={intelligence} />}
              {activeTab === 'stats' && <StatsTab enrichment={enrichment} />}
              {activeTab === 'intelligence' && <IntelligenceTab intelligence={intelligence} />}
              {activeTab === 'form' && <FormTab intelligence={intelligence} selection={selection} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Tab ─────────────────────────────────────────────────────────────

function SummaryTab({ enrichment, selection, intelligence }: { enrichment: EnrichedMatchData | null; selection: ParsedSelection; intelligence: MatchIntelligence | null }) {
  // Look up this exact fixture's final score from the local results DB. The
  // crawl/sync stores results there, so a played match has a score even when
  // live enrichment (possession/xG) isn't available.
  const dbScore = (() => {
    const all = getAllMatches();
    const hit = all.find(m =>
      (isSameTeam(m.homeTeam, selection.homeTeam) && isSameTeam(m.awayTeam, selection.awayTeam)) ||
      (isSameTeam(m.homeTeam, selection.awayTeam) && isSameTeam(m.awayTeam, selection.homeTeam))
    );
    if (!hit) return null;
    // Orient the score so [home, away] matches the selection's home/away
    const homeIsFirst = isSameTeam(hit.homeTeam, selection.homeTeam);
    return {
      home: homeIsFirst ? hit.ftHomeGoals : hit.ftAwayGoals,
      away: homeIsFirst ? hit.ftAwayGoals : hit.ftHomeGoals,
    };
  })();

  const enrichmentPlayed = !!enrichment && (
    enrichment.goals.length > 0 ||
    !!enrichment.stats.possession ||
    enrichment.ftScore[0] > 0 || enrichment.ftScore[1] > 0
  );
  const played = !!selection.score || enrichmentPlayed || !!dbScore;

  // Resolve the score to display, in priority: live enrichment → paste score → DB
  const displayScore: [number, number] | null =
    enrichmentPlayed && enrichment ? [enrichment.ftScore[0], enrichment.ftScore[1]]
    : selection.score ? [selection.score.home, selection.score.away]
    : dbScore ? [dbScore.home, dbScore.away]
    : null;

  return (
    <div className="space-y-4">
      {/* Score — shown for a played match; otherwise a clear notice */}
      {played && displayScore ? (
        <div className="text-center py-3 bg-gray-800 rounded-lg">
          <div className="text-2xl font-bold text-white">
            {displayScore[0]} - {displayScore[1]}
          </div>
          {(enrichment?.htScore || selection.score?.htHome !== undefined) && (
            <div className="text-xs text-gray-400 mt-1">
              Half-time: {enrichment?.htScore ? `${enrichment.htScore[0]} - ${enrichment.htScore[1]}` : `${selection.score?.htHome} - ${selection.score?.htAway}`}
            </div>
          )}
          {!enrichmentPlayed && (
            <div className="text-[10px] text-gray-600 mt-1">Final score from results database. Live match stats (possession, xG) unavailable for this match.</div>
          )}
        </div>
      ) : (
        <div className="text-center py-3 bg-gray-800 rounded-lg border border-gray-700">
          <div className="text-sm text-gray-400">Score unavailable</div>
          <div className="text-[11px] text-gray-600 mt-1">Not found in results database yet. Try "Sync sources", or see Form & Intel below.</div>
        </div>
      )}

      {/* Goals */}
      {enrichment && enrichment.goals.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-400 mb-2 uppercase">Goals</h3>
          <div className="space-y-1">
            {enrichment.goals.map((g, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-800">
                <div className={g.team === 'home' ? 'text-blue-300' : 'text-orange-300'}>
                  ⚽ {g.scorer} {g.assist && <span className="text-gray-500">({g.assist})</span>}
                </div>
                <span className="text-gray-500">{g.minute}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cards */}
      {enrichment && enrichment.cards.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-400 mb-2 uppercase">Cards</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-gray-500">Home</span>
              {enrichment.cards.filter(c => c.team === 'home').map((c, i) => (
                <div key={i} className="text-[11px] text-gray-300">
                  {c.type === 'yellow' ? '🟨' : '🟥'} {c.player} <span className="text-gray-600">{c.minute}</span>
                </div>
              ))}
              {enrichment.cards.filter(c => c.team === 'home').length === 0 && <div className="text-[11px] text-gray-600">None</div>}
            </div>
            <div>
              <span className="text-[10px] text-gray-500">Away</span>
              {enrichment.cards.filter(c => c.team === 'away').map((c, i) => (
                <div key={i} className="text-[11px] text-gray-300">
                  {c.type === 'yellow' ? '🟨' : '🟥'} {c.player} <span className="text-gray-600">{c.minute}</span>
                </div>
              ))}
              {enrichment.cards.filter(c => c.team === 'away').length === 0 && <div className="text-[11px] text-gray-600">None</div>}
            </div>
          </div>
        </div>
      )}

      {/* Quick intelligence */}
      {intelligence && (
        <div>
          <h3 className="text-xs font-bold text-gray-400 mb-2 uppercase">Key Insights</h3>
          <div className="space-y-1">
            {[...intelligence.homeTeam.hints, ...intelligence.awayTeam.hints, ...intelligence.h2hHints]
              .filter(h => h.strength === 'strong')
              .slice(0, 4)
              .map((h, i) => (
                <div key={i} className="text-xs text-green-300">{h.icon} {h.text}</div>
              ))}
          </div>
        </div>
      )}

      {!enrichment && !intelligence && (
        <p className="text-xs text-gray-500 text-center py-4">No detailed data available for this match</p>
      )}
    </div>
  );
}

// ─── Stats Tab ───────────────────────────────────────────────────────────────

function StatsTab({ enrichment }: { enrichment: EnrichedMatchData | null }) {
  if (!enrichment || !enrichment.stats.possession) {
    return <p className="text-xs text-gray-500 text-center py-8">No match statistics available. Stats are fetched from Flashscore for finished matches.</p>;
  }

  const stats = enrichment.stats;
  const statRows: { label: string; home: string; away: string }[] = [];

  if (stats.possession) statRows.push({ label: 'Possession', home: `${stats.possession[0]}%`, away: `${stats.possession[1]}%` });
  if (stats.shots) statRows.push({ label: 'Total Shots', home: `${stats.shots[0]}`, away: `${stats.shots[1]}` });
  if (stats.shotsOnTarget) statRows.push({ label: 'Shots on Target', home: `${stats.shotsOnTarget[0]}`, away: `${stats.shotsOnTarget[1]}` });
  if (stats.corners) statRows.push({ label: 'Corners', home: `${stats.corners[0]}`, away: `${stats.corners[1]}` });
  if (stats.fouls) statRows.push({ label: 'Fouls', home: `${stats.fouls[0]}`, away: `${stats.fouls[1]}` });
  if (stats.xG) statRows.push({ label: 'Expected Goals (xG)', home: `${stats.xG[0]}`, away: `${stats.xG[1]}` });
  if (stats.offsides) statRows.push({ label: 'Offsides', home: `${stats.offsides[0]}`, away: `${stats.offsides[1]}` });
  if (stats.passes) statRows.push({ label: 'Passes', home: stats.passes[0], away: stats.passes[1] });

  return (
    <div>
      <div className="grid grid-cols-3 gap-1 text-center text-xs mb-2 text-gray-500">
        <span>{enrichment.homeTeam}</span>
        <span></span>
        <span>{enrichment.awayTeam}</span>
      </div>
      <div className="space-y-1">
        {statRows.map((row, i) => (
          <div key={i} className="grid grid-cols-3 gap-1 text-center text-xs py-1.5 border-b border-gray-800">
            <span className="text-white font-medium">{row.home}</span>
            <span className="text-gray-500">{row.label}</span>
            <span className="text-white font-medium">{row.away}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Intelligence Tab ────────────────────────────────────────────────────────

function IntelligenceTab({ intelligence }: { intelligence: MatchIntelligence | null }) {
  if (!intelligence) {
    return <p className="text-xs text-gray-500 text-center py-8">No historical data in database for these teams.</p>;
  }

  const Section = ({ title, hints }: { title: string; hints: IntelligenceHint[] }) => (
    hints.length > 0 ? (
      <div className="mb-4">
        <h4 className="text-[10px] font-bold text-gray-500 mb-1.5 uppercase">{title}</h4>
        <div className="space-y-1">
          {hints.map((h, i) => (
            <div key={i} className={`text-xs ${h.strength === 'strong' ? 'text-green-300' : 'text-gray-400'}`}>
              {h.icon} {h.text}
            </div>
          ))}
        </div>
      </div>
    ) : null
  );

  return (
    <div>
      <div className="mb-3 text-[10px] text-gray-600">
        Based on {intelligence.homeTeam.dataPoints + intelligence.awayTeam.dataPoints} matches in database
        ({intelligence.dataConfidence} confidence)
      </div>
      <Section title={`${intelligence.homeTeam.teamName} (Home)`} hints={intelligence.homeTeam.hints} />
      <Section title={`${intelligence.awayTeam.teamName} (Away)`} hints={intelligence.awayTeam.hints} />
      <Section title="Head to Head" hints={intelligence.h2hHints} />
      <Section title="Combined Analysis" hints={intelligence.combinedHints} />
    </div>
  );
}

// ─── Form Tab ────────────────────────────────────────────────────────────────

type Venue = 'all' | 'home' | 'away';
type Count = 6 | 12 | 0; // 0 = All

/**
 * A single team's form panel — venue toggle (All/Home/Away) + count selector
 * (6/12/All), like a standard livescore layout. Pulls the full match list for
 * the team from the DB so switching venue reveals every home / away game.
 */
function TeamFormPanel({
  teamName,
  defaultVenue,
}: {
  teamName: string;
  defaultVenue: Venue;
}) {
  const [venue, setVenue] = useState<Venue>(defaultVenue);
  const [count, setCount] = useState<Count>(6);

  // All matches for this team (most recent first), unfiltered by venue.
  const allTeamMatches = React.useMemo(
    () => getTeamMatches(teamName, getAllMatches(), 500),
    [teamName]
  );

  const venueFiltered = React.useMemo(() => {
    if (venue === 'home') return allTeamMatches.filter(m => m.isHome);
    if (venue === 'away') return allTeamMatches.filter(m => !m.isHome);
    return allTeamMatches;
  }, [allTeamMatches, venue]);

  const shown = count === 0 ? venueFiltered : venueFiltered.slice(0, count);

  // Compact W/D/L summary for the current venue selection
  const w = venueFiltered.filter(m => m.result === 'W').length;
  const d = venueFiltered.filter(m => m.result === 'D').length;
  const l = venueFiltered.filter(m => m.result === 'L').length;

  const venueBtn = (v: Venue, label: string) => (
    <button
      onClick={() => setVenue(v)}
      className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
        venue === v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );

  const countBtn = (c: Count, label: string) => (
    <button
      onClick={() => setCount(c)}
      className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
        count === c ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mb-5">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-gray-200">{teamName}</h4>
        <span className="text-[10px] text-gray-500">
          {venue === 'all' ? 'Overall' : venue === 'home' ? 'At Home' : 'Away'} · {w}W {d}D {l}L
        </span>
      </div>

      {/* Controls: venue toggle + count selector */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          {venueBtn('all', 'All')}
          {venueBtn('home', 'Home')}
          {venueBtn('away', 'Away')}
        </div>
        <div className="flex items-center gap-1">
          {countBtn(6, 'Last 6')}
          {countBtn(12, 'Last 12')}
          {countBtn(0, 'All')}
        </div>
      </div>

      {/* Rows */}
      {shown.length === 0 ? (
        <p className="text-[11px] text-gray-600 py-2">No {venue === 'all' ? '' : venue + ' '}matches in database.</p>
      ) : (
        <div className="space-y-0.5">
          {shown.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] py-0.5 border-b border-gray-800">
              <span className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${
                m.result === 'W' ? 'bg-green-800 text-green-300' :
                m.result === 'D' ? 'bg-yellow-800 text-yellow-300' :
                'bg-red-800 text-red-300'
              }`}>{m.result}</span>
              <span className="text-gray-500 w-20 shrink-0">{m.date}</span>
              <span className="text-gray-300 flex-1">
                {/* Render as the TRUE fixture: whoever actually played at home is
                    listed first with their real goals, never reoriented. */}
                {m.isHome ? (
                  <>
                    <span className="font-medium text-gray-200">{teamName.split(' ')[0]}</span>{' '}
                    <span className="text-white font-bold">{m.goalsFor}-{m.goalsAgainst}</span>{' '}
                    {m.opponent.split(' ')[0]}
                  </>
                ) : (
                  <>
                    {m.opponent.split(' ')[0]}{' '}
                    <span className="text-white font-bold">{m.goalsAgainst}-{m.goalsFor}</span>{' '}
                    <span className="font-medium text-gray-200">{teamName.split(' ')[0]}</span>
                  </>
                )}
              </span>
              {m.htGoalsFor !== null && (
                <span className="text-gray-600 text-[10px] shrink-0">HT {m.isHome ? `${m.htGoalsFor}-${m.htGoalsAgainst}` : `${m.htGoalsAgainst}-${m.htGoalsFor}`}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormTab({ intelligence, selection }: { intelligence: MatchIntelligence | null; selection: ParsedSelection }) {
  if (!intelligence) {
    return <p className="text-xs text-gray-500 text-center py-8">No form data available.</p>;
  }

  return (
    <div>
      {/* Home team defaults to its Home form; away team defaults to its Away
          form — the standard livescore view — but both are fully switchable. */}
      <TeamFormPanel teamName={selection.homeTeam} defaultVenue="home" />
      <TeamFormPanel teamName={selection.awayTeam} defaultVenue="away" />

      {/* Head to Head — true fixture perspective */}
      {intelligence.h2h.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-bold text-gray-200 mb-2">Head to Head</h4>
          <div className="space-y-0.5">
            {intelligence.h2h.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5 border-b border-gray-800">
                <span className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${
                  m.result === 'W' ? 'bg-green-800 text-green-300' :
                  m.result === 'D' ? 'bg-yellow-800 text-yellow-300' :
                  'bg-red-800 text-red-300'
                }`}>{m.result}</span>
                <span className="text-gray-500 w-20 shrink-0">{m.date}</span>
                <span className="text-gray-300 flex-1">
                  {m.isHome ? (
                    <>
                      <span className="font-medium text-gray-200">{selection.homeTeam.split(' ')[0]}</span>{' '}
                      <span className="text-white font-bold">{m.goalsFor}-{m.goalsAgainst}</span>{' '}
                      {m.opponent.split(' ')[0]}
                    </>
                  ) : (
                    <>
                      {m.opponent.split(' ')[0]}{' '}
                      <span className="text-white font-bold">{m.goalsAgainst}-{m.goalsFor}</span>{' '}
                      <span className="font-medium text-gray-200">{selection.homeTeam.split(' ')[0]}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
