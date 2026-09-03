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
import { computeMatchIntelligence, MatchIntelligence, IntelligenceHint, getTeamMatches, computeVenueMetrics, computeMomentum, computeFixtureVerdict, computeAverageStats, getFormString, MomentumTrend } from '../engine/intelligence-hints';
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
              {activeTab === 'stats' && <StatsTab enrichment={enrichment} selection={selection} />}
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

/**
 * Build a plain-language read for the SPECIFIC market in the selection, using
 * both teams' venue-form rates. Returns whether the recent form supports the
 * pick. Descriptive only — never staking advice.
 */
function buildMarketRead(
  market: string,
  H: import('../engine/intelligence-hints').VenueMetrics,
  A: import('../engine/intelligence-hints').VenueMetrics,
  homeTeam: string,
  awayTeam: string
): { text: string; supportive: boolean } | null {
  if (H.played < 3 || A.played < 3) return null;
  const m = (market || '').toLowerCase();
  const hf = homeTeam.split(' ')[0];
  const af = awayTeam.split(' ')[0];

  // Over/Under goals
  if (m.includes('over') || m.includes('under') || m.includes('o/u') || m.includes('goal')) {
    const combined = Math.round((H.over25Pct + A.over25Pct) / 2);
    const combined15 = Math.round((H.over15Pct + A.over15Pct) / 2);
    if (m.includes('under')) {
      const supportive = combined <= 45;
      return { text: `${hf} O2.5 rate ${H.over25Pct}% at home, ${af} ${A.over25Pct}% away (avg ${combined}%). ${supportive ? 'Recent form leans toward Under.' : 'Recent form runs against Under — goals have been landing.'}`, supportive };
    }
    if (m.includes('1.5')) {
      const supportive = combined15 >= 70;
      return { text: `Over 1.5 landed in ${H.over15Pct}% of ${hf}'s home games and ${A.over15Pct}% of ${af}'s away (avg ${combined15}%). ${supportive ? 'Form supports Over 1.5.' : 'Mixed — Over 1.5 not a lock on form.'}`, supportive };
    }
    const supportive = combined >= 55;
    return { text: `Over 2.5 landed in ${H.over25Pct}% of ${hf}'s home games and ${A.over25Pct}% of ${af}'s away (avg ${combined}%). ${supportive ? 'Form supports the Over.' : 'Form is lukewarm for the Over.'}`, supportive };
  }

  // BTTS / GG
  if (m.includes('btts') || m.includes('gg') || m.includes('both teams')) {
    const combined = Math.round((H.bttsPct + A.bttsPct) / 2);
    const supportive = combined >= 55;
    return { text: `BTTS hit in ${H.bttsPct}% of ${hf}'s home games and ${A.bttsPct}% of ${af}'s away (avg ${combined}%). ${supportive ? 'Both sides tend to score.' : 'One side often keeps it tight.'}`, supportive };
  }

  // Home / 1 / home win
  if (m.includes('home') || m === '1' || m.includes('1x2') && m.includes('home')) {
    const supportive = H.winPct >= 55 && A.winPct <= 35;
    return { text: `${hf} won ${H.winPct}% at home; ${af} won ${A.winPct}% away. ${supportive ? 'Form favours the home side.' : 'Not a clear home edge on form.'}`, supportive };
  }
  // Away / 2
  if (m.includes('away') || m === '2') {
    const supportive = A.winPct >= 50 && H.winPct <= 40;
    return { text: `${af} won ${A.winPct}% away; ${hf} won ${H.winPct}% at home. ${supportive ? 'Form favours the away side.' : 'Away win not strongly backed by form.'}`, supportive };
  }
  // Double chance / draw
  if (m.includes('draw') || m.includes('x') || m.includes('double')) {
    return { text: `${hf} at home: ${H.wins}W ${H.draws}D ${H.losses}L. ${af} away: ${A.wins}W ${A.draws}D ${A.losses}L.`, supportive: true };
  }
  // Fouls / cards markets
  if (m.includes('foul') || m.includes('card')) {
    return { text: `Discipline market — check the Stats tab for per-game fouls averages. ${hf} & ${af} form shown there.`, supportive: true };
  }

  // Generic fallback
  return { text: `${hf} at home: ${H.wins}W-${H.draws}D-${H.losses}L, avg ${H.avgScored} scored. ${af} away: ${A.wins}W-${A.draws}D-${A.losses}L, avg ${A.avgScored} scored.`, supportive: true };
}

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

  // Team-vs-team form header + pick-specific market read (from DB form)
  const all = getAllMatches();
  const homeHome = getTeamMatches(selection.homeTeam, all, 500).filter(m => m.isHome);
  const awayAway = getTeamMatches(selection.awayTeam, all, 500).filter(m => !m.isHome);
  const homeFormStr = getFormString(homeHome, 5);
  const awayFormStr = getFormString(awayAway, 5);
  const Hm = computeVenueMetrics(homeHome.slice(0, 6));
  const Am = computeVenueMetrics(awayAway.slice(0, 6));
  const marketRead = buildMarketRead(selection.market, Hm, Am, selection.homeTeam, selection.awayTeam);

  const FormChars = ({ str }: { str: string }) => (
    <span className="inline-flex gap-0.5">
      {str.split('').map((c, i) => (
        <span key={i} className={`w-3.5 h-3.5 flex items-center justify-center rounded-sm text-[8px] font-bold ${
          c === 'W' ? 'bg-green-700 text-green-100' : c === 'D' ? 'bg-yellow-700 text-yellow-100' : 'bg-red-700 text-red-100'
        }`}>{c}</span>
      ))}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Team-vs-team form header */}
      {(homeFormStr || awayFormStr) && (
        <div className="flex items-center justify-between bg-gray-800 rounded-lg p-2.5">
          <div className="flex-1 text-center">
            <div className="text-[11px] font-bold text-blue-300 truncate">{selection.homeTeam.split(' ')[0]}</div>
            <div className="text-[8px] text-gray-500 uppercase mb-1">Home form</div>
            {homeFormStr ? <FormChars str={homeFormStr} /> : <span className="text-[10px] text-gray-600">no data</span>}
          </div>
          <div className="px-2 text-gray-600 text-[10px]">vs</div>
          <div className="flex-1 text-center">
            <div className="text-[11px] font-bold text-orange-300 truncate">{selection.awayTeam.split(' ')[0]}</div>
            <div className="text-[8px] text-gray-500 uppercase mb-1">Away form</div>
            {awayFormStr ? <FormChars str={awayFormStr} /> : <span className="text-[10px] text-gray-600">no data</span>}
          </div>
        </div>
      )}

      {/* Pick-specific market read */}
      {marketRead && (
        <div className={`rounded-lg border p-2.5 ${marketRead.supportive ? 'border-green-800 bg-green-900/20' : 'border-yellow-800 bg-yellow-900/15'}`}>
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Your pick: {selection.market}</div>
          <p className="text-[12px] text-gray-200 leading-snug">{marketRead.text}</p>
        </div>
      )}

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

/**
 * A single comparison row rendered as a proportional split bar (livescore
 * style): the side with the larger value gets the brighter/wider fill.
 */
function StatBar({ label, home, away, homeText, awayText, invert }: {
  label: string;
  home: number;
  away: number;
  homeText: string;
  awayText: string;
  invert?: boolean; // when true, LOWER is better (e.g. fouls) — flip who is highlighted
}) {
  const total = home + away;
  const homePct = total > 0 ? Math.round((home / total) * 100) : 50;
  const awayPct = 100 - homePct;
  const homeBetter = invert ? home < away : home > away;
  const awayBetter = invert ? away < home : away > home;
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className={`font-bold ${homeBetter ? 'text-blue-300' : 'text-gray-300'}`}>{homeText}</span>
        <span className="text-gray-500 text-[10px] uppercase">{label}</span>
        <span className={`font-bold ${awayBetter ? 'text-orange-300' : 'text-gray-300'}`}>{awayText}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800">
        <div className={`${homeBetter ? 'bg-blue-500' : 'bg-blue-800'}`} style={{ width: `${homePct}%` }} />
        <div className={`${awayBetter ? 'bg-orange-500' : 'bg-orange-800'}`} style={{ width: `${awayPct}%` }} />
      </div>
    </div>
  );
}

function StatsTab({ enrichment, selection }: { enrichment: EnrichedMatchData | null; selection: ParsedSelection }) {
  const hasLive = !!enrichment && !!enrichment.stats.possession;

  // ── Live match stats (finished-match detail from Flashscore) ──
  if (hasLive && enrichment) {
    const s = enrichment.stats;
    const rows: React.ReactNode[] = [];
    if (s.possession) rows.push(<StatBar key="pos" label="Possession" home={s.possession[0]} away={s.possession[1]} homeText={`${s.possession[0]}%`} awayText={`${s.possession[1]}%`} />);
    if (s.xG) rows.push(<StatBar key="xg" label="Expected Goals" home={s.xG[0]} away={s.xG[1]} homeText={`${s.xG[0]}`} awayText={`${s.xG[1]}`} />);
    if (s.shots) rows.push(<StatBar key="sh" label="Total Shots" home={s.shots[0]} away={s.shots[1]} homeText={`${s.shots[0]}`} awayText={`${s.shots[1]}`} />);
    if (s.shotsOnTarget) rows.push(<StatBar key="sot" label="Shots on Target" home={s.shotsOnTarget[0]} away={s.shotsOnTarget[1]} homeText={`${s.shotsOnTarget[0]}`} awayText={`${s.shotsOnTarget[1]}`} />);
    if (s.corners) rows.push(<StatBar key="cor" label="Corners" home={s.corners[0]} away={s.corners[1]} homeText={`${s.corners[0]}`} awayText={`${s.corners[1]}`} />);
    if (s.fouls) rows.push(<StatBar key="fls" label="Fouls" home={s.fouls[0]} away={s.fouls[1]} homeText={`${s.fouls[0]}`} awayText={`${s.fouls[1]}`} invert />);
    if (s.offsides) rows.push(<StatBar key="off" label="Offsides" home={s.offsides[0]} away={s.offsides[1]} homeText={`${s.offsides[0]}`} awayText={`${s.offsides[1]}`} />);

    return (
      <div>
        <div className="flex items-center justify-between text-[11px] font-bold mb-3">
          <span className="text-blue-300">{enrichment.homeTeam}</span>
          <span className="text-gray-500 text-[9px] uppercase">Match Stats</span>
          <span className="text-orange-300">{enrichment.awayTeam}</span>
        </div>
        {rows}
        {s.passes && (
          <div className="grid grid-cols-2 gap-2 mt-3 text-center">
            <div className="bg-gray-800 rounded p-1.5"><div className="text-[11px] text-gray-200 font-medium">{s.passes[0]}</div><div className="text-[8px] text-gray-500 uppercase">Home Passes</div></div>
            <div className="bg-gray-800 rounded p-1.5"><div className="text-[11px] text-gray-200 font-medium">{s.passes[1]}</div><div className="text-[8px] text-gray-500 uppercase">Away Passes</div></div>
          </div>
        )}
      </div>
    );
  }

  // ── Fallback: season-average comparison from the results DB ──
  // When live per-match stats aren't available, still give a useful team-vs-team
  // read using per-game averages (home team at home vs away team away).
  const all = getAllMatches();
  const homeMatches = getTeamMatches(selection.homeTeam, all, 500).filter(m => m.isHome).slice(0, 12);
  const awayMatches = getTeamMatches(selection.awayTeam, all, 500).filter(m => !m.isHome).slice(0, 12);
  const H = computeAverageStats(homeMatches);
  const A = computeAverageStats(awayMatches);

  if (H.played < 3 || A.played < 3) {
    return <p className="text-xs text-gray-500 text-center py-8">No match statistics available. Live stats come from Flashscore for finished matches; season averages need at least 3 games per team in the database. Try "Sync sources".</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold mb-1">
        <span className="text-blue-300">{selection.homeTeam.split(' ')[0]}</span>
        <span className="text-gray-500 text-[9px] uppercase">Season Averages</span>
        <span className="text-orange-300">{selection.awayTeam.split(' ')[0]}</span>
      </div>
      <p className="text-[9px] text-gray-600 text-center mb-3">Per-game — {selection.homeTeam.split(' ')[0]} at home ({H.played}), {selection.awayTeam.split(' ')[0]} away ({A.played})</p>
      <StatBar label="Avg Goals Scored" home={H.avgScored} away={A.avgScored} homeText={H.avgScored.toFixed(2)} awayText={A.avgScored.toFixed(2)} />
      <StatBar label="Avg Goals Conceded" home={H.avgConceded} away={A.avgConceded} homeText={H.avgConceded.toFixed(2)} awayText={A.avgConceded.toFixed(2)} invert />
      {H.avgFouls !== null && A.avgFouls !== null && (
        <StatBar label="Avg Fouls" home={H.avgFouls} away={A.avgFouls} homeText={H.avgFouls.toFixed(1)} awayText={A.avgFouls.toFixed(1)} invert />
      )}
      <div className="mt-3 text-[9px] text-gray-600 text-center">Live shot/possession/xG data unavailable for this match — showing form-based averages.</div>
    </div>
  );
}

// ─── Intelligence Tab ────────────────────────────────────────────────────────

/** Tally strong-signal directions across all hints into a market consensus. */
function buildConsensus(hints: IntelligenceHint[]): { label: string; count: number; tone: 'pos' | 'neg' | 'neutral' }[] {
  const buckets: Record<string, { count: number; tone: 'pos' | 'neg' | 'neutral' }> = {};
  const bump = (label: string, tone: 'pos' | 'neg' | 'neutral', weight: number) => {
    if (!buckets[label]) buckets[label] = { count: 0, tone };
    buckets[label].count += weight;
  };
  for (const h of hints) {
    const weight = h.strength === 'strong' ? 2 : h.strength === 'moderate' ? 1 : 0;
    if (weight === 0) continue;
    for (const r of h.relevantTo || []) {
      if (r.startsWith('over_')) bump(`Over ${r.split('_')[1]}`, 'pos', weight);
      else if (r.startsWith('under_')) bump(`Under ${r.split('_')[1]}`, 'neg', weight);
      else if (r === 'btts_yes') bump('BTTS', 'pos', weight);
      else if (r === 'btts_no') bump('BTTS No', 'neg', weight);
      else if (r === 'home_win') bump('Home', 'pos', weight);
      else if (r === 'away_win') bump('Away', 'pos', weight);
      else if (r === 'draw') bump('Draw', 'neutral', weight);
      else if (r === 'handicap') bump('Handicap', 'neutral', weight);
      else if (r === 'fouls') bump('Fouls', 'neutral', weight);
    }
  }
  return Object.entries(buckets)
    .map(([label, v]) => ({ label, count: v.count, tone: v.tone }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function IntelligenceTab({ intelligence }: { intelligence: MatchIntelligence | null }) {
  if (!intelligence) {
    return <p className="text-xs text-gray-500 text-center py-8">No historical data in database for these teams.</p>;
  }

  const allHints = [
    ...intelligence.homeTeam.hints,
    ...intelligence.awayTeam.hints,
    ...intelligence.h2hHints,
    ...intelligence.combinedHints,
  ];
  const consensus = buildConsensus(allHints);
  const strongCount = allHints.filter(h => h.strength === 'strong').length;

  const Section = ({ title, hints, accent }: { title: string; hints: IntelligenceHint[]; accent: string }) => (
    hints.length > 0 ? (
      <div className="mb-4">
        <h4 className={`text-[10px] font-bold mb-1.5 uppercase ${accent}`}>{title}</h4>
        <div className="space-y-1">
          {hints.map((h, i) => (
            <div key={i} className={`text-xs flex items-start gap-1.5 ${h.strength === 'strong' ? 'text-green-300' : 'text-gray-400'}`}>
              <span className="shrink-0">{h.icon}</span>
              <span>{h.text}{h.strength === 'strong' && <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-green-900 text-green-400 uppercase align-middle">strong</span>}</span>
            </div>
          ))}
        </div>
      </div>
    ) : null
  );

  const confColor = intelligence.dataConfidence === 'high' ? 'text-green-400' : intelligence.dataConfidence === 'medium' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div>
      {/* Data confidence + strong signal count */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-gray-500">
          {intelligence.homeTeam.dataPoints + intelligence.awayTeam.dataPoints} matches ·{' '}
          <span className={confColor}>{intelligence.dataConfidence} confidence</span>
        </div>
        <div className="text-[10px] text-gray-500">{strongCount} strong signal{strongCount === 1 ? '' : 's'}</div>
      </div>

      {/* Signal consensus */}
      {consensus.length > 0 && (
        <div className="mb-4 bg-gray-800 rounded-lg p-2.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Signal Consensus</div>
          <div className="flex flex-wrap gap-1.5">
            {consensus.map((c, i) => (
              <span key={i} className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                c.tone === 'pos' ? 'bg-green-900 text-green-200' : c.tone === 'neg' ? 'bg-red-900 text-red-200' : 'bg-gray-700 text-gray-200'
              }`}>
                {c.label}<span className="opacity-60">×{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contradictions — surfaced prominently */}
      {intelligence.contradictions.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/15 p-2.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-yellow-400 mb-1.5">Conflicting Signals</div>
          {intelligence.contradictions.map((h, i) => (
            <div key={i} className="text-[11px] text-yellow-200">{h.icon} {h.text}</div>
          ))}
        </div>
      )}

      <Section title={`${intelligence.homeTeam.teamName} (Home)`} hints={intelligence.homeTeam.hints} accent="text-blue-400" />
      <Section title={`${intelligence.awayTeam.teamName} (Away)`} hints={intelligence.awayTeam.hints} accent="text-orange-400" />
      <Section title="Head to Head" hints={intelligence.h2hHints} accent="text-purple-400" />
      <Section title="Combined Analysis" hints={intelligence.combinedHints} accent="text-gray-400" />
    </div>
  );
}

// ─── Form Tab ────────────────────────────────────────────────────────────────

type Venue = 'all' | 'home' | 'away';
type Count = 6 | 12 | 0; // 0 = All

/** Single metric cell in the venue stat strip. */
function Metric({ label, value, sub, highlight, warn }: { label: string; value: string; sub?: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded px-1 py-1 ${highlight ? (warn ? 'bg-red-900/40' : 'bg-green-900/40') : 'bg-gray-800'}`}>
      <div className={`text-[12px] font-bold ${highlight ? (warn ? 'text-red-300' : 'text-green-300') : 'text-gray-200'}`}>{value}</div>
      <div className="text-[8px] text-gray-500 uppercase leading-tight">{label}{sub ? ` ${sub}` : ''}</div>
    </div>
  );
}

/** Momentum trend badge comparing recent 3 vs prior 3 matches (points/game). */
function MomentumBadge({ trend, recentPpg, priorPpg }: { trend: MomentumTrend; recentPpg: number; priorPpg: number }) {
  const cfg = trend === 'rising'
    ? { icon: '▲', cls: 'text-green-400', label: 'Rising' }
    : trend === 'falling'
    ? { icon: '▼', cls: 'text-red-400', label: 'Falling' }
    : { icon: '▬', cls: 'text-gray-500', label: 'Steady' };
  return (
    <span className={`text-[10px] font-medium flex items-center gap-1 ${cfg.cls}`} title={`Recent 3: ${recentPpg} pts/game vs prior 3: ${priorPpg} pts/game`}>
      {cfg.icon} {cfg.label} <span className="text-gray-600">({recentPpg}→ from {priorPpg})</span>
    </span>
  );
}

/**
 * A single team's form panel — venue toggle (All/Home/Away) + count selector
 * (6/12/All), like a standard livescore layout. Pulls the full match list for
 * the team from the DB so switching venue reveals every home / away game.
 */
// Persisted toggle prefs. Count is a global display preference; venue is keyed
// per panel role (home/away) so each panel remembers its own last choice while
// still falling back to the sensible role default (home team → Home form).
const COUNT_PREF_KEY = 'rollover_form_count';
const venuePrefKey = (role: Venue) => `rollover_form_venue_${role}`;

function readCountPref(): Count {
  const v = localStorage.getItem(COUNT_PREF_KEY);
  if (v === '12') return 12;
  if (v === '0') return 0;
  return 6;
}
function readVenuePref(role: Venue): Venue {
  const v = localStorage.getItem(venuePrefKey(role));
  if (v === 'all' || v === 'home' || v === 'away') return v;
  return role; // fall back to the panel's role default
}

function TeamFormPanel({
  teamName,
  defaultVenue,
}: {
  teamName: string;
  defaultVenue: Venue;
}) {
  const [venue, setVenueState] = useState<Venue>(() => readVenuePref(defaultVenue));
  const [count, setCountState] = useState<Count>(() => readCountPref());

  // Wrap setters to persist the choice.
  const setVenue = (v: Venue) => { setVenueState(v); localStorage.setItem(venuePrefKey(defaultVenue), v); };
  const setCount = (c: Count) => { setCountState(c); localStorage.setItem(COUNT_PREF_KEY, String(c)); };

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

  // Metrics + momentum are computed over the SHOWN window (respects count),
  // so the numbers always match the rows the user is looking at.
  const metrics = React.useMemo(() => computeVenueMetrics(shown), [shown]);
  const momentum = React.useMemo(() => computeMomentum(shown), [shown]);

  // Compact W/D/L summary for the current venue selection (full filtered set)
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

      {/* Form-string ribbon + momentum trend (Enhancement 3) */}
      {shown.length > 0 && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            {shown.slice(0, 10).map((m, i) => (
              <span
                key={i}
                title={`${m.date}: ${m.result}`}
                className={`w-4 h-4 flex items-center justify-center rounded-sm text-[9px] font-bold ${
                  m.result === 'W' ? 'bg-green-700 text-green-100' :
                  m.result === 'D' ? 'bg-yellow-700 text-yellow-100' :
                  'bg-red-700 text-red-100'
                }`}
              >{m.result}</span>
            ))}
          </div>
          <MomentumBadge trend={momentum.trend} recentPpg={momentum.recentPpg} priorPpg={momentum.priorPpg} />
        </div>
      )}

      {/* Venue metrics strip (Enhancement 1) */}
      {metrics.played > 0 && (
        <div className="grid grid-cols-4 gap-1 mb-2 text-center">
          <Metric label="Scored" value={metrics.avgScored.toFixed(1)} sub="avg" />
          <Metric label="Conceded" value={metrics.avgConceded.toFixed(1)} sub="avg" />
          <Metric label="Win%" value={`${metrics.winPct}%`} highlight={metrics.winPct >= 60} />
          <Metric label="CS%" value={`${metrics.cleanSheetPct}%`} />
          <Metric label="O1.5" value={`${metrics.over15Pct}%`} highlight={metrics.over15Pct >= 75} />
          <Metric label="O2.5" value={`${metrics.over25Pct}%`} highlight={metrics.over25Pct >= 60} />
          <Metric label="BTTS" value={`${metrics.bttsPct}%`} highlight={metrics.bttsPct >= 60} />
          <Metric label="FTS%" value={`${metrics.failedToScorePct}%`} highlight={metrics.failedToScorePct >= 40} warn />
        </div>
      )}

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

  // Fixture verdict — fuse home team's HOME form with away team's AWAY form.
  const verdict = React.useMemo(() => {
    const all = getAllMatches();
    const homeHome = getTeamMatches(selection.homeTeam, all, 500).filter(m => m.isHome);
    const awayAway = getTeamMatches(selection.awayTeam, all, 500).filter(m => !m.isHome);
    return computeFixtureVerdict(selection.homeTeam, selection.awayTeam, homeHome, awayAway);
  }, [selection.homeTeam, selection.awayTeam]);

  return (
    <div>
      {/* Verdict banner (Enhancement 2) */}
      {verdict && (
        <div className={`mb-4 rounded-lg border p-3 ${
          verdict.confidence === 'strong' ? 'border-green-700 bg-green-900/25' :
          verdict.confidence === 'moderate' ? 'border-blue-700 bg-blue-900/20' :
          'border-gray-700 bg-gray-800/50'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Fixture Verdict</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
              verdict.confidence === 'strong' ? 'bg-green-800 text-green-200' :
              verdict.confidence === 'moderate' ? 'bg-blue-800 text-blue-200' :
              'bg-gray-700 text-gray-300'
            }`}>{verdict.confidence}</span>
          </div>
          <p className="text-[12px] text-gray-200 leading-snug">{verdict.headline}</p>
          {verdict.leans.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {verdict.leans.map((lean, i) => (
                <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-800 text-indigo-100">{lean}</span>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-500 mt-1.5">Descriptive read from venue-specific form — not staking advice.</p>
        </div>
      )}

      {/* Home team defaults to its Home form; away team defaults to its Away
          form — the standard livescore view — but both are fully switchable. */}
      <TeamFormPanel teamName={selection.homeTeam} defaultVenue="home" />
      <TeamFormPanel teamName={selection.awayTeam} defaultVenue="away" />

      {/* Head to Head — with venue split (all meetings vs home-team-at-home) */}
      {intelligence.h2h.length > 0 && (
        <H2HSection h2h={intelligence.h2h} homeTeam={selection.homeTeam} awayTeam={selection.awayTeam} />
      )}
    </div>
  );
}

/**
 * Head-to-head section with a venue split: "All meetings" vs just the ones
 * played at the current home team's ground. FormMatch.isHome here means the
 * fixture's home team (the selection's home side) hosted that meeting.
 */
function H2HSection({ h2h, homeTeam, awayTeam }: { h2h: import('../engine/intelligence-hints').FormMatch[]; homeTeam: string; awayTeam: string }) {
  const [venue, setVenue] = useState<'all' | 'home'>('all');
  const homeFirst = homeTeam.split(' ')[0];
  const awayFirst = awayTeam.split(' ')[0];

  const rows = venue === 'home' ? h2h.filter(m => m.isHome) : h2h;
  const w = rows.filter(m => m.result === 'W').length; // home team wins
  const d = rows.filter(m => m.result === 'D').length;
  const l = rows.filter(m => m.result === 'L').length;

  const tab = (v: 'all' | 'home', label: string) => (
    <button
      onClick={() => setVenue(v)}
      className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
        venue === v ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
      }`}
    >{label}</button>
  );

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-gray-200">Head to Head</h4>
        <div className="flex items-center gap-1">
          {tab('all', 'All meetings')}
          {tab('home', `${homeFirst} at home`)}
        </div>
      </div>
      <div className="text-[10px] text-gray-500 mb-1.5">
        From {homeFirst}'s view: {w}W {d}D {l}L <span className="text-gray-600">({awayFirst} won {l})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-600">No {venue === 'home' ? `meetings at ${homeFirst}'s ground` : 'meetings'} in database.</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map((m, i) => (
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
                    <span className="font-medium text-gray-200">{homeFirst}</span>{' '}
                    <span className="text-white font-bold">{m.goalsFor}-{m.goalsAgainst}</span>{' '}
                    {m.opponent.split(' ')[0]}
                  </>
                ) : (
                  <>
                    {m.opponent.split(' ')[0]}{' '}
                    <span className="text-white font-bold">{m.goalsAgainst}-{m.goalsFor}</span>{' '}
                    <span className="font-medium text-gray-200">{homeFirst}</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
