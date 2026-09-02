/**
 * MatchTooltip — Rich hover card for fixture intelligence.
 * 
 * Shows different content based on match state:
 * - Settled: HT/FT scores, goals, cards, possession, corners
 * - Upcoming/Pending: form, H2H, intelligence hints, streaks
 * - Live: current score, elapsed time, pick status
 * - Ended: same as upcoming + "awaiting result" note
 */

import React, { useState, useEffect, useRef } from 'react';
import { ParsedSelection } from '../engine/types';
import { EnrichedMatchData, getCachedEnrichment, getCachedEnrichmentByTeams, fetchMatchEnrichment } from '../engine/match-enrichment';
import { computeMatchIntelligence, MatchIntelligence, FormMatch, getFormString, getGoalAverages, IntelligenceHint } from '../engine/intelligence-hints';
import { getAllMatches } from '../engine/historical-stats';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  selection: ParsedSelection;
  selResult: 'pending' | 'won' | 'lost';
  matchStatus: 'live' | 'won' | 'lost' | 'upcoming' | 'ended';
  flashscoreMatchId?: string | null;
  children: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MatchTooltip({ selection, selResult, matchStatus, flashscoreMatchId, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichedMatchData | null>(null);
  const [intelligence, setIntelligence] = useState<MatchIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [formHover, setFormHover] = useState<{ match: FormMatch; x: number; y: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [pinned, setPinned] = useState(false);

  const isSettled = matchStatus === 'won' || matchStatus === 'lost';

  // Load data on hover
  useEffect(() => {
    if (!visible) return;

    if (isSettled) {
      // Try to load enrichment data
      const cached = flashscoreMatchId
        ? getCachedEnrichment(flashscoreMatchId)
        : getCachedEnrichmentByTeams(selection.homeTeam, selection.awayTeam);
      if (cached) {
        setEnrichment(cached);
      } else if (!loading) {
        setLoading(true);
        // If we have a matchId, fetch directly. Otherwise, find it from Flashscore day page.
        (async () => {
          try {
            if (flashscoreMatchId) {
              const data = await fetchMatchEnrichment(flashscoreMatchId);
              setEnrichment(data);
            } else {
              // Find matchId by looking up the match in Flashscore's day page
              const { fetchDayFixtures } = await import('../engine/flashscore');
              const { isSameTeam } = await import('../engine/team-aliases');
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
                const data = await fetchMatchEnrichment(match.matchId);
                setEnrichment(data);
              }
            }
          } catch { /* non-critical */ }
          setLoading(false);
        })();
      }
    }

    // Always compute intelligence (instant, from memory)
    const allMatches = getAllMatches();
    if (allMatches.length > 0) {
      const intel = computeMatchIntelligence(selection.homeTeam, selection.awayTeam, allMatches);
      setIntelligence(intel);
    }
  }, [visible]);

  function handleMouseEnter() {
    if (pinned) return;
    timeoutRef.current = setTimeout(() => setVisible(true), 300);
  }

  function handleMouseLeave() {
    if (pinned) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
    setFormHover(null);
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (visible && pinned) {
      // Clicking again unpins and closes
      setPinned(false);
      setVisible(false);
    } else {
      // Pin it open
      setPinned(true);
      setVisible(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    setPinned(false);
    setVisible(false);
    setFormHover(null);
  }

  return (
    <div className="relative inline-block w-full" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} onClick={handleClick}>
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className="absolute z-50 left-0 top-full mt-1 w-[340px] max-h-[300px] overflow-y-auto bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 text-xs"
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }}
          onMouseLeave={() => { if (!pinned) { setVisible(false); setFormHover(null); } }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-700">
            <span className="font-medium text-gray-200">{selection.homeTeam} v {selection.awayTeam}</span>
            <div className="flex items-center gap-1">
              {intelligence && (
                <span className={`text-[9px] px-1 py-0.5 rounded ${
                  intelligence.dataConfidence === 'high' ? 'bg-green-900 text-green-400' :
                  intelligence.dataConfidence === 'medium' ? 'bg-yellow-900 text-yellow-400' :
                  'bg-red-900 text-red-400'
                }`}>
                  {intelligence.homeTeam.dataPoints + intelligence.awayTeam.dataPoints} matches
                </span>
              )}
              {pinned && (
                <button onClick={handleClose} className="ml-1 text-gray-500 hover:text-white text-sm leading-none">✕</button>
              )}
            </div>
          </div>

          {/* Settled match: show stats */}
          {isSettled && (
            <SettledContent
              selection={selection}
              enrichment={enrichment}
              loading={loading}
            />
          )}

          {/* Upcoming/Pending/Ended: show intelligence */}
          {(matchStatus === 'upcoming' || matchStatus === 'ended') && intelligence && (
            <UpcomingContent
              selection={selection}
              intelligence={intelligence}
              matchStatus={matchStatus}
              formHover={formHover}
              setFormHover={setFormHover}
            />
          )}

          {/* Live: show status */}
          {matchStatus === 'live' && intelligence && (
            <LiveContent selection={selection} intelligence={intelligence} />
          )}

          {/* Contradictions removed — too noisy for general use */}

          {/* Form hover sub-tooltip */}
          {formHover && (
            <div
              className="absolute z-[60] bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg"
              style={{ left: formHover.x, top: formHover.y }}
            >
              <span className={formHover.match.result === 'W' ? 'text-green-400' : formHover.match.result === 'L' ? 'text-red-400' : 'text-yellow-400'}>
                {formHover.match.result}
              </span>
              {' '}
              {formHover.match.isHome ? selection.homeTeam.split(' ')[0] : formHover.match.opponent.split(' ')[0]}
              {' '}{formHover.match.goalsFor}-{formHover.match.goalsAgainst}{' '}
              {formHover.match.isHome ? formHover.match.opponent.split(' ')[0] : selection.awayTeam.split(' ')[0]}
              <span className="text-gray-500 ml-1">{formHover.match.date}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function SettledContent({ selection, enrichment, loading }: {
  selection: ParsedSelection;
  enrichment: EnrichedMatchData | null;
  loading: boolean;
}) {
  if (loading) return <div className="text-gray-500 text-[10px]">Loading match details...</div>;

  return (
    <div className="space-y-1.5">
      {/* Score breakdown */}
      {enrichment && (enrichment.ftScore[0] + enrichment.ftScore[1] > 0 || enrichment.goals.length > 0) ? (
        <>
          <div className="flex items-center gap-3">
            {enrichment.htScore && (
              <span className="text-gray-400">HT: <span className="text-white font-medium">{enrichment.htScore[0]}-{enrichment.htScore[1]}</span></span>
            )}
            <span className="text-gray-400">FT: <span className="text-white font-medium">{enrichment.ftScore[0]}-{enrichment.ftScore[1]}</span></span>
          </div>

          {/* Goals */}
          {enrichment.goals.length > 0 && (
            <div className="mt-1">
              <span className="text-gray-500 text-[9px]">GOALS</span>
              {enrichment.goals.map((g, i) => (
                <div key={i} className="text-[10px]">
                  <span className="text-gray-500">{g.minute}</span>{' '}
                  <span className={g.team === 'home' ? 'text-blue-300' : 'text-orange-300'}>{g.scorer}</span>
                  {g.assist && <span className="text-gray-600"> ({g.assist})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Cards */}
          {enrichment.cards.length > 0 && (
            <div className="mt-1">
              <span className="text-gray-500 text-[9px]">CARDS</span>
              <div className="text-[10px]">
                <span className="text-yellow-400">🟨 {enrichment.cards.filter(c => c.type === 'yellow').length}</span>
                {enrichment.cards.some(c => c.type === 'red') && (
                  <span className="text-red-400 ml-2">🟥 {enrichment.cards.filter(c => c.type === 'red').length}</span>
                )}
              </div>
            </div>
          )}

          {/* Stats — only show if we have real data (not all zeros) */}
          {enrichment.stats.possession && (enrichment.stats.possession[0] + enrichment.stats.possession[1]) > 0 && (
            <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-center">
              {enrichment.stats.possession && (
                <div>
                  <div className="text-gray-500">Poss</div>
                  <div className="text-white">{enrichment.stats.possession[0]}%-{enrichment.stats.possession[1]}%</div>
                </div>
              )}
              {enrichment.stats.corners && (
                <div>
                  <div className="text-gray-500">Corners</div>
                  <div className="text-white">{enrichment.stats.corners[0]}-{enrichment.stats.corners[1]}</div>
                </div>
              )}
              {enrichment.stats.shotsOnTarget && (
                <div>
                  <div className="text-gray-500">On Target</div>
                  <div className="text-white">{enrichment.stats.shotsOnTarget[0]}-{enrichment.stats.shotsOnTarget[1]}</div>
                </div>
              )}
              {enrichment.stats.xG && (
                <div>
                  <div className="text-gray-500">xG</div>
                  <div className="text-white">{enrichment.stats.xG[0]}-{enrichment.stats.xG[1]}</div>
                </div>
              )}
              {enrichment.stats.fouls && (
                <div>
                  <div className="text-gray-500">Fouls</div>
                  <div className="text-white">{enrichment.stats.fouls[0]}-{enrichment.stats.fouls[1]}</div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* Fallback when no enrichment data — just show the basic score */
        selection.score && (
          <div className="text-gray-400">
            FT: <span className="text-white font-medium">{selection.score.home}-{selection.score.away}</span>
          </div>
        )
      )}
    </div>
  );
}

function UpcomingContent({ selection, intelligence, matchStatus, formHover, setFormHover }: {
  selection: ParsedSelection;
  intelligence: MatchIntelligence;
  matchStatus: 'upcoming' | 'ended';
  formHover: { match: FormMatch; x: number; y: number } | null;
  setFormHover: (v: { match: FormMatch; x: number; y: number } | null) => void;
}) {
  // Kickoff countdown
  const kickoff = new Date(selection.kickOffDateTime).getTime();
  const now = Date.now();
  const diff = kickoff - now;
  const countdown = diff > 0
    ? diff > 3600000 ? `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m` : `${Math.floor(diff / 60000)}m`
    : null;

  const homeForm = intelligence.homeTeam.homeForm;
  const awayForm = intelligence.awayTeam.awayForm;
  const homeAvg = getGoalAverages(homeForm);
  const awayAvg = getGoalAverages(awayForm);

  // Top hints (max 5, prioritized by strength)
  const allHints = [
    ...intelligence.homeTeam.hints,
    ...intelligence.awayTeam.hints,
    ...intelligence.h2hHints,
    ...intelligence.combinedHints,
  ].sort((a, b) => {
    const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
    return strengthOrder[a.strength] - strengthOrder[b.strength];
  }).slice(0, 5);

  return (
    <div className="space-y-1.5">
      {/* Status line */}
      <div className="flex items-center justify-between text-[10px]">
        {matchStatus === 'ended' ? (
          <span className="text-yellow-400">Match ended — awaiting result</span>
        ) : countdown ? (
          <span className="text-gray-400">⏱ Starts in {countdown}</span>
        ) : null}
        <span className="text-gray-500">{selection.market}</span>
      </div>

      {/* Form display */}
      <div className="mt-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-gray-500">HOME FORM (last {Math.min(5, homeForm.length)})</span>
          <span className="text-[9px] text-gray-600">avg {homeAvg.scored} scored, {homeAvg.conceded} conceded</span>
        </div>
        <div className="flex gap-0.5">
          {homeForm.slice(0, 5).map((m, i) => (
            <span
              key={i}
              onMouseEnter={(e) => setFormHover({ match: m, x: e.nativeEvent.offsetX, y: -25 })}
              onMouseLeave={() => setFormHover(null)}
              className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold cursor-default ${
                m.result === 'W' ? 'bg-green-800 text-green-300' :
                m.result === 'D' ? 'bg-yellow-800 text-yellow-300' :
                'bg-red-800 text-red-300'
              }`}
            >
              {m.result}
            </span>
          ))}
          {homeForm.length === 0 && <span className="text-gray-600 text-[10px]">No data</span>}
        </div>
      </div>

      <div className="mt-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-gray-500">AWAY FORM (last {Math.min(5, awayForm.length)})</span>
          <span className="text-[9px] text-gray-600">avg {awayAvg.scored} scored, {awayAvg.conceded} conceded</span>
        </div>
        <div className="flex gap-0.5">
          {awayForm.slice(0, 5).map((m, i) => (
            <span
              key={i}
              onMouseEnter={(e) => setFormHover({ match: m, x: e.nativeEvent.offsetX, y: -25 })}
              onMouseLeave={() => setFormHover(null)}
              className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold cursor-default ${
                m.result === 'W' ? 'bg-green-800 text-green-300' :
                m.result === 'D' ? 'bg-yellow-800 text-yellow-300' :
                'bg-red-800 text-red-300'
              }`}
            >
              {m.result}
            </span>
          ))}
          {awayForm.length === 0 && <span className="text-gray-600 text-[10px]">No data</span>}
        </div>
      </div>

      {/* H2H summary */}
      {intelligence.h2h.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-700">
          <span className="text-[9px] text-gray-500">H2H (last {intelligence.h2h.length}): </span>
          <span className="text-[10px]">
            <span className="text-green-400">{intelligence.h2h.filter(m => m.result === 'W').length}W</span>
            {' '}
            <span className="text-yellow-400">{intelligence.h2h.filter(m => m.result === 'D').length}D</span>
            {' '}
            <span className="text-red-400">{intelligence.h2h.filter(m => m.result === 'L').length}L</span>
          </span>
        </div>
      )}

      {/* Intelligence hints */}
      {allHints.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-700 space-y-0.5">
          {allHints.map((hint, i) => (
            <div key={i} className={`text-[10px] ${
              hint.strength === 'strong' ? 'text-green-300' : 'text-gray-400'
            }`}>
              {hint.icon} {hint.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveContent({ selection, intelligence }: {
  selection: ParsedSelection;
  intelligence: MatchIntelligence;
}) {
  const kickoff = new Date(selection.kickOffDateTime).getTime();
  const elapsed = Math.floor((Date.now() - kickoff) / 60000);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-green-400 font-medium">LIVE {elapsed > 0 ? `${elapsed}'` : ''}</span>
        {selection.score && (
          <span className="text-white font-bold">{selection.score.home}-{selection.score.away}</span>
        )}
      </div>
      <div className="text-[10px] text-gray-400">
        Pick: {selection.pick} ({selection.market})
      </div>
      {/* Show relevant hints for context */}
      {intelligence.combinedHints.slice(0, 3).map((hint, i) => (
        <div key={i} className="text-[10px] text-gray-500">{hint.icon} {hint.text}</div>
      ))}
    </div>
  );
}
