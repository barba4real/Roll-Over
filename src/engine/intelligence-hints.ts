/**
 * Intelligence Hints Engine
 * 
 * Computes actionable hints from historical match data for tooltip display.
 * All hints are computed from the in-memory database — no network calls.
 * 
 * Hint categories:
 * - Streaks (consecutive W/D/L home/away)
 * - Goal scoring patterns (2+, 3+, at least 1)
 * - Conceding patterns
 * - Over/Under rates
 * - BTTS rates
 * - Both halves scoring
 * - Early goal likelihood
 * - Handicap viability
 * - Corner patterns
 * - H2H intelligence
 * - Contradiction detection
 */

import type { HistoricalMatch } from './football-data-uk';
import { isSameTeam } from './team-aliases';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntelligenceHint {
  type: 'streak' | 'goals' | 'conceding' | 'over_under' | 'btts' | 'both_halves' | 'early_goal' | 'handicap' | 'corners' | 'h2h' | 'contradiction';
  icon: string;
  text: string;
  strength: 'strong' | 'moderate' | 'weak'; // strong = 5+/7, moderate = 4/7, weak = 3/5
  relevantTo?: string[]; // Which pick types this hint supports (e.g. ['over_1.5', 'btts_yes'])
}

export interface FormMatch {
  opponent: string;
  result: 'W' | 'D' | 'L';
  goalsFor: number;
  goalsAgainst: number;
  date: string;
  htGoalsFor: number | null;
  htGoalsAgainst: number | null;
  foulsCommitted: number | null;
  foulsAgainst: number | null;
  isHome: boolean;
}

export interface TeamIntelligence {
  teamName: string;
  homeForm: FormMatch[];
  awayForm: FormMatch[];
  hints: IntelligenceHint[];
  dataPoints: number; // Total matches used
}

export interface MatchIntelligence {
  homeTeam: TeamIntelligence;
  awayTeam: TeamIntelligence;
  h2h: FormMatch[];
  h2hHints: IntelligenceHint[];
  combinedHints: IntelligenceHint[];
  contradictions: IntelligenceHint[];
  dataConfidence: 'high' | 'medium' | 'low'; // Based on data quantity
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Compute full intelligence for a fixture.
 * @param homeTeam Home team name
 * @param awayTeam Away team name
 * @param allMatches Full match database
 * @param limit Max recent matches to consider per team (default 20)
 */
export function computeMatchIntelligence(
  homeTeam: string,
  awayTeam: string,
  allMatches: HistoricalMatch[],
  limit: number = 20
): MatchIntelligence {
  // Get recent matches for each team
  const homeMatches = getTeamMatches(homeTeam, allMatches, limit);
  const awayMatches = getTeamMatches(awayTeam, allMatches, limit);
  const homeHomeMatches = homeMatches.filter(m => m.isHome);
  const awayAwayMatches = awayMatches.filter(m => !m.isHome);
  const h2hMatches = getH2HMatches(homeTeam, awayTeam, allMatches, 10);

  // Compute hints for each team
  const homeHints = computeTeamHints(homeTeam, homeHomeMatches, 'home');
  const awayHints = computeTeamHints(awayTeam, awayAwayMatches, 'away');
  const h2hHints = computeH2HHints(homeTeam, awayTeam, h2hMatches);
  const combinedHints = computeCombinedHints(homeHomeMatches, awayAwayMatches, homeTeam, awayTeam);
  const contradictions = detectContradictions([...homeHints, ...awayHints, ...combinedHints]);

  // Data confidence
  const totalData = homeMatches.length + awayMatches.length;
  const dataConfidence: 'high' | 'medium' | 'low' =
    totalData >= 20 ? 'high' : totalData >= 10 ? 'medium' : 'low';

  return {
    homeTeam: {
      teamName: homeTeam,
      homeForm: homeHomeMatches.slice(0, 5),
      awayForm: homeMatches.filter(m => !m.isHome).slice(0, 5),
      hints: homeHints,
      dataPoints: homeMatches.length,
    },
    awayTeam: {
      teamName: awayTeam,
      homeForm: awayMatches.filter(m => m.isHome).slice(0, 5),
      awayForm: awayAwayMatches.slice(0, 5),
      hints: awayHints,
      dataPoints: awayMatches.length,
    },
    h2h: h2hMatches,
    h2hHints,
    combinedHints,
    contradictions,
    dataConfidence,
  };
}

// ─── Data Retrieval ──────────────────────────────────────────────────────────

export function getTeamMatches(team: string, allMatches: HistoricalMatch[], limit: number): FormMatch[] {
  const matches = allMatches
    .filter(m => isSameTeam(m.homeTeam, team) || isSameTeam(m.awayTeam, team))
    .sort((a, b) => compareDates(b.date, a.date)) // Most recent first
    .slice(0, limit);

  return matches.map(m => {
    const isHome = isSameTeam(m.homeTeam, team);
    const goalsFor = isHome ? m.ftHomeGoals : m.ftAwayGoals;
    const goalsAgainst = isHome ? m.ftAwayGoals : m.ftHomeGoals;
    const result: 'W' | 'D' | 'L' = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
    return {
      opponent: isHome ? m.awayTeam : m.homeTeam,
      result,
      goalsFor,
      goalsAgainst,
      date: m.date,
      htGoalsFor: isHome ? m.htHomeGoals : m.htAwayGoals,
      htGoalsAgainst: isHome ? m.htAwayGoals : m.htHomeGoals,
      foulsCommitted: isHome ? m.homeFouls : m.awayFouls,
      foulsAgainst: isHome ? m.awayFouls : m.homeFouls,
      isHome,
    };
  });
}

function getH2HMatches(team1: string, team2: string, allMatches: HistoricalMatch[], limit: number): FormMatch[] {
  const matches = allMatches
    .filter(m =>
      (isSameTeam(m.homeTeam, team1) && isSameTeam(m.awayTeam, team2)) ||
      (isSameTeam(m.homeTeam, team2) && isSameTeam(m.awayTeam, team1))
    )
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, limit);

  return matches.map(m => {
    const isTeam1Home = isSameTeam(m.homeTeam, team1);
    return {
      opponent: isTeam1Home ? m.awayTeam : m.homeTeam,
      result: (isTeam1Home ? (m.ftHomeGoals > m.ftAwayGoals ? 'W' : m.ftHomeGoals < m.ftAwayGoals ? 'L' : 'D')
                           : (m.ftAwayGoals > m.ftHomeGoals ? 'W' : m.ftAwayGoals < m.ftHomeGoals ? 'L' : 'D')) as 'W' | 'D' | 'L',
      goalsFor: isTeam1Home ? m.ftHomeGoals : m.ftAwayGoals,
      goalsAgainst: isTeam1Home ? m.ftAwayGoals : m.ftHomeGoals,
      date: m.date,
      htGoalsFor: isTeam1Home ? m.htHomeGoals : m.htAwayGoals,
      htGoalsAgainst: isTeam1Home ? m.htAwayGoals : m.htHomeGoals,
      foulsCommitted: isTeam1Home ? m.homeFouls : m.awayFouls,
      foulsAgainst: isTeam1Home ? m.awayFouls : m.homeFouls,
      isHome: isTeam1Home,
    };
  });
}

// ─── Hint Computation ────────────────────────────────────────────────────────

function computeTeamHints(team: string, venueMatches: FormMatch[], venue: 'home' | 'away'): IntelligenceHint[] {
  const hints: IntelligenceHint[] = [];
  if (venueMatches.length < 3) return hints;

  const venueLabel = venue === 'home' ? 'home' : 'away';
  const last5 = venueMatches.slice(0, 5);
  const last7 = venueMatches.slice(0, 7);

  // ── Result Streaks ──
  const winStreak = countConsecutive(venueMatches, m => m.result === 'W');
  const unbeatenStreak = countConsecutive(venueMatches, m => m.result !== 'L');
  const lossStreak = countConsecutive(venueMatches, m => m.result === 'L');
  const winlessStreak = countConsecutive(venueMatches, m => m.result !== 'W');

  if (winStreak >= 4) {
    hints.push({ type: 'streak', icon: '🔥', text: `Won last ${winStreak} ${venueLabel} games`, strength: winStreak >= 6 ? 'strong' : 'moderate', relevantTo: ['home_win', 'away_win'] });
  } else if (unbeatenStreak >= 5) {
    hints.push({ type: 'streak', icon: '🛡️', text: `Unbeaten in last ${unbeatenStreak} ${venueLabel} (${countIn(venueMatches.slice(0, unbeatenStreak), 'W')}W ${countIn(venueMatches.slice(0, unbeatenStreak), 'D')}D)`, strength: unbeatenStreak >= 7 ? 'strong' : 'moderate' });
  }
  if (lossStreak >= 3) {
    hints.push({ type: 'streak', icon: '📉', text: `${lossStreak} consecutive ${venueLabel} losses`, strength: lossStreak >= 5 ? 'strong' : 'moderate' });
  } else if (winlessStreak >= 4) {
    hints.push({ type: 'streak', icon: '🧊', text: `Winless in last ${winlessStreak} ${venueLabel} games`, strength: winlessStreak >= 6 ? 'strong' : 'moderate' });
  }

  // ── Goal Scoring Patterns ──
  const scoredStreak = countConsecutive(venueMatches, m => m.goalsFor >= 1);
  const scored2Plus = countOf(last7, m => m.goalsFor >= 2);
  const scored3Plus = countOf(last7, m => m.goalsFor >= 3);
  const failedToScore = countOf(last5, m => m.goalsFor === 0);

  if (scoredStreak >= 5) {
    hints.push({ type: 'goals', icon: '⚽', text: `Scored in last ${scoredStreak} ${venueLabel} games`, strength: scoredStreak >= 8 ? 'strong' : 'moderate', relevantTo: ['over_0.5', 'over_1.5', 'btts_yes'] });
  }
  if (scored2Plus >= 5) {
    hints.push({ type: 'goals', icon: '⚽', text: `Scored 2+ in ${scored2Plus} of last 7 ${venueLabel}`, strength: scored2Plus >= 6 ? 'strong' : 'moderate', relevantTo: ['over_1.5', 'over_2.5'] });
  }
  if (scored3Plus >= 4) {
    hints.push({ type: 'goals', icon: '🎯', text: `Scored 3+ in ${scored3Plus} of last 7 ${venueLabel}`, strength: 'strong', relevantTo: ['over_2.5', 'over_3.5'] });
  }
  if (failedToScore >= 3) {
    hints.push({ type: 'goals', icon: '🚫', text: `Failed to score in ${failedToScore} of last 5 ${venueLabel}`, strength: failedToScore >= 4 ? 'strong' : 'moderate', relevantTo: ['under_1.5', 'btts_no'] });
  }

  // ── Conceding Patterns ──
  const cleanSheetStreak = countConsecutive(venueMatches, m => m.goalsAgainst === 0);
  const cleanSheets = countOf(last5, m => m.goalsAgainst === 0);
  const conceded2Plus = countOf(last7, m => m.goalsAgainst >= 2);
  const concededStreak = countConsecutive(venueMatches, m => m.goalsAgainst >= 1);

  if (cleanSheetStreak >= 3) {
    hints.push({ type: 'conceding', icon: '🛡️', text: `Clean sheet in last ${cleanSheetStreak} ${venueLabel}`, strength: cleanSheetStreak >= 4 ? 'strong' : 'moderate', relevantTo: ['under_1.5', 'btts_no'] });
  } else if (cleanSheets >= 3) {
    hints.push({ type: 'conceding', icon: '🛡️', text: `Clean sheet in ${cleanSheets} of last 5 ${venueLabel}`, strength: cleanSheets >= 4 ? 'strong' : 'moderate', relevantTo: ['under_1.5', 'btts_no'] });
  }
  if (conceded2Plus >= 4) {
    hints.push({ type: 'conceding', icon: '💧', text: `Conceded 2+ in ${conceded2Plus} of last 7 ${venueLabel}`, strength: conceded2Plus >= 5 ? 'strong' : 'moderate', relevantTo: ['over_2.5', 'btts_yes'] });
  }
  if (concededStreak >= 5) {
    hints.push({ type: 'conceding', icon: '💧', text: `Conceded in every ${venueLabel} match (last ${concededStreak})`, strength: concededStreak >= 7 ? 'strong' : 'moderate', relevantTo: ['btts_yes', 'over_1.5'] });
  }

  // ── Over/Under Patterns ──
  const over15 = countOf(last7, m => (m.goalsFor + m.goalsAgainst) > 1.5);
  const over25 = countOf(last7, m => (m.goalsFor + m.goalsAgainst) > 2.5);
  const under25 = countOf(last7, m => (m.goalsFor + m.goalsAgainst) < 2.5);

  if (over25 >= 5) {
    hints.push({ type: 'over_under', icon: '📈', text: `Over 2.5 in ${over25} of last 7 ${venueLabel}`, strength: over25 >= 6 ? 'strong' : 'moderate', relevantTo: ['over_2.5'] });
  }
  if (over15 >= 6) {
    hints.push({ type: 'over_under', icon: '📈', text: `Over 1.5 in ${over15} of last 7 ${venueLabel}`, strength: over15 >= 7 ? 'strong' : 'moderate', relevantTo: ['over_1.5'] });
  }
  if (under25 >= 5) {
    hints.push({ type: 'over_under', icon: '📉', text: `Under 2.5 in ${under25} of last 7 ${venueLabel}`, strength: under25 >= 6 ? 'strong' : 'moderate', relevantTo: ['under_2.5'] });
  }

  // ── BTTS ──
  const bttsYes = countOf(last7, m => m.goalsFor >= 1 && m.goalsAgainst >= 1);
  const bttsNo = countOf(last7, m => m.goalsFor === 0 || m.goalsAgainst === 0);

  if (bttsYes >= 5) {
    hints.push({ type: 'btts', icon: '🤝', text: `BTTS in ${bttsYes} of last 7 ${venueLabel}`, strength: bttsYes >= 6 ? 'strong' : 'moderate', relevantTo: ['btts_yes'] });
  }
  if (bttsNo >= 5) {
    hints.push({ type: 'btts', icon: '🚫', text: `BTTS failed in ${bttsNo} of last 7 ${venueLabel}`, strength: bttsNo >= 6 ? 'strong' : 'moderate', relevantTo: ['btts_no'] });
  }

  // ── Both Halves Scoring (when HT data available) ──
  const matchesWithHT = venueMatches.filter(m => m.htGoalsFor !== null).slice(0, 7);
  if (matchesWithHT.length >= 4) {
    const scoredBothHalves = countOf(matchesWithHT, m =>
      m.htGoalsFor! > 0 && (m.goalsFor - m.htGoalsFor!) > 0
    );
    const scoredFirstHalf = countOf(matchesWithHT, m => m.htGoalsFor! > 0);
    const scoredSecondHalf = countOf(matchesWithHT, m => (m.goalsFor - (m.htGoalsFor || 0)) > 0);

    if (scoredBothHalves >= 3) {
      hints.push({ type: 'both_halves', icon: '⏱️', text: `Scored both halves in ${scoredBothHalves} of last ${matchesWithHT.length} ${venueLabel}`, strength: scoredBothHalves >= 4 ? 'strong' : 'moderate' });
    }
    if (scoredFirstHalf >= 5) {
      hints.push({ type: 'both_halves', icon: '1️⃣', text: `Scored in 1st half in ${scoredFirstHalf} of last ${matchesWithHT.length} ${venueLabel}`, strength: 'moderate' });
    }
    if (scoredSecondHalf >= 5) {
      hints.push({ type: 'both_halves', icon: '2️⃣', text: `Scored in 2nd half in ${scoredSecondHalf} of last ${matchesWithHT.length} ${venueLabel}`, strength: 'moderate' });
    }
  }

  // ── Handicap / Win Margin ──
  const winBy2Plus = countOf(last7, m => m.goalsFor - m.goalsAgainst >= 2);
  const loseBy2Plus = countOf(last7, m => m.goalsAgainst - m.goalsFor >= 2);

  if (winBy2Plus >= 3) {
    hints.push({ type: 'handicap', icon: '💪', text: `Won by 2+ goals in ${winBy2Plus} of last 7 ${venueLabel}`, strength: winBy2Plus >= 4 ? 'strong' : 'moderate', relevantTo: ['handicap'] });
  }
  if (loseBy2Plus >= 3) {
    hints.push({ type: 'handicap', icon: '😰', text: `Lost by 2+ goals in ${loseBy2Plus} of last 7 ${venueLabel}`, strength: loseBy2Plus >= 4 ? 'strong' : 'moderate', relevantTo: ['handicap'] });
  }

  // ── Fouls patterns (when data available) ──
  const matchesWithFouls = venueMatches.filter(m => m.foulsCommitted !== null);
  if (matchesWithFouls.length >= 3) {
    const avgFouls = matchesWithFouls.reduce((sum, m) => sum + (m.foulsCommitted || 0), 0) / matchesWithFouls.length;
    const last5Fouls = matchesWithFouls.slice(0, 5);
    const under13Count = countOf(last5Fouls, m => (m.foulsCommitted || 0) < 13.5);
    const under12Count = countOf(last5Fouls, m => (m.foulsCommitted || 0) < 12.5);
    const over14Count = countOf(last5Fouls, m => (m.foulsCommitted || 0) > 14.5);

    if (avgFouls >= 14) {
      hints.push({ type: 'goals', icon: '⚠️', text: `Avg ${avgFouls.toFixed(1)} fouls per ${venueLabel} game — risky for Under 13.5`, strength: avgFouls >= 15 ? 'strong' : 'moderate', relevantTo: ['fouls'] });
    }
    if (avgFouls <= 11) {
      hints.push({ type: 'goals', icon: '🛡️', text: `Low fouls avg: ${avgFouls.toFixed(1)} per ${venueLabel} game — Under 12.5 viable`, strength: avgFouls <= 10 ? 'strong' : 'moderate', relevantTo: ['fouls'] });
    }
    if (under13Count >= 4) {
      hints.push({ type: 'goals', icon: '✓', text: `Under 13.5 fouls in ${under13Count} of last 5 ${venueLabel}`, strength: under13Count >= 5 ? 'strong' : 'moderate', relevantTo: ['fouls'] });
    }
    if (over14Count >= 3) {
      hints.push({ type: 'goals', icon: '⚠️', text: `Over 14.5 fouls in ${over14Count} of last 5 ${venueLabel}`, strength: over14Count >= 4 ? 'strong' : 'moderate', relevantTo: ['fouls'] });
    }
  }

  return hints;
}

function computeH2HHints(team1: string, team2: string, h2h: FormMatch[]): IntelligenceHint[] {
  const hints: IntelligenceHint[] = [];
  if (h2h.length < 3) return hints;

  const last7 = h2h.slice(0, 7);
  const team1Wins = countOf(last7, m => m.result === 'W');
  const draws = countOf(last7, m => m.result === 'D');
  const team2Wins = last7.length - team1Wins - draws;

  // Dominance
  if (team1Wins >= 5) {
    hints.push({ type: 'h2h', icon: '🏆', text: `Won ${team1Wins} of last ${last7.length} meetings`, strength: 'strong' });
  } else if (team2Wins >= 5) {
    hints.push({ type: 'h2h', icon: '⚠️', text: `Lost ${team2Wins} of last ${last7.length} meetings`, strength: 'strong' });
  }

  // Draws
  if (draws >= 3) {
    hints.push({ type: 'h2h', icon: '⚖️', text: `${draws} draws in last ${last7.length} H2H`, strength: draws >= 4 ? 'strong' : 'moderate', relevantTo: ['draw'] });
  }

  // H2H goals
  const h2hOver25 = countOf(last7, m => (m.goalsFor + m.goalsAgainst) > 2.5);
  const h2hBtts = countOf(last7, m => m.goalsFor >= 1 && m.goalsAgainst >= 1);

  if (h2hOver25 >= 4) {
    hints.push({ type: 'h2h', icon: '⚽', text: `Over 2.5 in ${h2hOver25} of last ${last7.length} H2H`, strength: h2hOver25 >= 5 ? 'strong' : 'moderate', relevantTo: ['over_2.5'] });
  }
  if (h2hBtts >= 4) {
    hints.push({ type: 'h2h', icon: '🤝', text: `BTTS in ${h2hBtts} of last ${last7.length} H2H`, strength: h2hBtts >= 5 ? 'strong' : 'moderate', relevantTo: ['btts_yes'] });
  }

  // Home advantage in H2H
  const homeH2H = h2h.filter(m => m.isHome);
  if (homeH2H.length >= 3) {
    const homeWins = countOf(homeH2H, m => m.result === 'W');
    if (homeWins >= 4) {
      hints.push({ type: 'h2h', icon: '🏠', text: `Won ${homeWins} of last ${homeH2H.length} H2H at home`, strength: 'strong' });
    }
    const neverLostHome = homeH2H.every(m => m.result !== 'L');
    if (neverLostHome && homeH2H.length >= 4) {
      hints.push({ type: 'h2h', icon: '🏠', text: `Never lost at home vs this opponent (last ${homeH2H.length})`, strength: 'strong' });
    }
  }

  return hints;
}

function computeCombinedHints(homeForm: FormMatch[], awayForm: FormMatch[], homeTeam: string, awayTeam: string): IntelligenceHint[] {
  const hints: IntelligenceHint[] = [];
  if (homeForm.length < 3 || awayForm.length < 3) return hints;

  // Combined over/under: home team's home goals + away team's away conceding
  const homeAvgScored = average(homeForm.slice(0, 5), m => m.goalsFor);
  const awayAvgConceded = average(awayForm.slice(0, 5), m => m.goalsAgainst);
  const awayAvgScored = average(awayForm.slice(0, 5), m => m.goalsFor);
  const homeAvgConceded = average(homeForm.slice(0, 5), m => m.goalsAgainst);

  const expectedTotal = homeAvgScored + awayAvgScored;

  if (expectedTotal >= 3.0) {
    hints.push({ type: 'over_under', icon: '📊', text: `Combined avg: ${expectedTotal.toFixed(1)} goals/game (H scores ${homeAvgScored.toFixed(1)}, A scores ${awayAvgScored.toFixed(1)})`, strength: expectedTotal >= 3.5 ? 'strong' : 'moderate', relevantTo: ['over_2.5'] });
  }
  if (expectedTotal <= 1.8) {
    hints.push({ type: 'over_under', icon: '📊', text: `Combined avg: ${expectedTotal.toFixed(1)} goals/game — low-scoring fixture`, strength: expectedTotal <= 1.5 ? 'strong' : 'moderate', relevantTo: ['under_2.5'] });
  }

  // BTTS likelihood from both sides
  const homeScoringRate = countOf(homeForm.slice(0, 5), m => m.goalsFor >= 1) / Math.min(5, homeForm.length);
  const awayScoringRate = countOf(awayForm.slice(0, 5), m => m.goalsFor >= 1) / Math.min(5, awayForm.length);
  const bttsLikelihood = homeScoringRate * awayScoringRate;

  if (bttsLikelihood >= 0.8) {
    hints.push({ type: 'btts', icon: '🤝', text: `High BTTS likelihood — home scores ${Math.round(homeScoringRate * 100)}% of games, away ${Math.round(awayScoringRate * 100)}%`, strength: 'strong', relevantTo: ['btts_yes'] });
  }

  // Mismatch: strong home attack vs weak away defense
  if (homeAvgScored >= 2.0 && awayAvgConceded >= 1.8) {
    hints.push({ type: 'goals', icon: '💪', text: `Mismatch: home avg ${homeAvgScored.toFixed(1)} scored vs away concedes ${awayAvgConceded.toFixed(1)}`, strength: 'strong', relevantTo: ['over_1.5', 'over_2.5', 'home_win'] });
  }
  if (awayAvgScored >= 1.5 && homeAvgConceded >= 1.5) {
    hints.push({ type: 'goals', icon: '⚠️', text: `Away team dangerous: scores ${awayAvgScored.toFixed(1)} avg, home concedes ${homeAvgConceded.toFixed(1)}`, strength: 'moderate', relevantTo: ['btts_yes', 'over_2.5'] });
  }

  return hints;
}

function detectContradictions(allHints: IntelligenceHint[]): IntelligenceHint[] {
  const contradictions: IntelligenceHint[] = [];

  // Check for opposing signals
  const hasOverSignal = allHints.some(h => h.relevantTo?.some(r => r.startsWith('over_')));
  const hasUnderSignal = allHints.some(h => h.relevantTo?.some(r => r.startsWith('under_')));
  const hasBttsYes = allHints.some(h => h.relevantTo?.includes('btts_yes'));
  const hasBttsNo = allHints.some(h => h.relevantTo?.includes('btts_no'));

  if (hasOverSignal && hasUnderSignal) {
    contradictions.push({
      type: 'contradiction',
      icon: '⚠️',
      text: 'Conflicting signals: over AND under indicators present',
      strength: 'moderate',
    });
  }
  if (hasBttsYes && hasBttsNo) {
    contradictions.push({
      type: 'contradiction',
      icon: '⚠️',
      text: 'Conflicting signals: BTTS indicators point both ways',
      strength: 'moderate',
    });
  }

  return contradictions;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function countConsecutive(matches: FormMatch[], predicate: (m: FormMatch) => boolean): number {
  let count = 0;
  for (const m of matches) {
    if (predicate(m)) count++;
    else break;
  }
  return count;
}

function countOf(matches: FormMatch[], predicate: (m: FormMatch) => boolean): number {
  return matches.filter(predicate).length;
}

function countIn(matches: FormMatch[], result: 'W' | 'D' | 'L'): number {
  return matches.filter(m => m.result === result).length;
}

function average(matches: FormMatch[], selector: (m: FormMatch) => number): number {
  if (matches.length === 0) return 0;
  return matches.reduce((sum, m) => sum + selector(m), 0) / matches.length;
}

function compareDates(a: string, b: string): number {
  // Handle DD/MM/YYYY or YYYY-MM-DD
  const parseDate = (d: string): number => {
    if (d.includes('/')) {
      const [day, month, year] = d.split('/');
      return new Date(`${year}-${month}-${day}`).getTime();
    }
    return new Date(d).getTime();
  };
  return parseDate(a) - parseDate(b);
}

/**
 * Get a compact form string for a team's recent matches.
 * Returns e.g. "WWDLW" (most recent first).
 */
export function getFormString(matches: FormMatch[], count: number = 5): string {
  return matches.slice(0, count).map(m => m.result).join('');
}

/**
 * Get goal averages for display.
 */
export function getGoalAverages(matches: FormMatch[]): { scored: number; conceded: number; total: number } {
  if (matches.length === 0) return { scored: 0, conceded: 0, total: 0 };
  const scored = matches.reduce((s, m) => s + m.goalsFor, 0) / matches.length;
  const conceded = matches.reduce((s, m) => s + m.goalsAgainst, 0) / matches.length;
  return { scored: +scored.toFixed(1), conceded: +conceded.toFixed(1), total: +(scored + conceded).toFixed(1) };
}
