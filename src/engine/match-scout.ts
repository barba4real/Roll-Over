/**
 * Match Scout - Analyzes fixtures and suggests safe picks
 * Primary: Football-Data.org (unlimited, fixtures + standings + form)
 * Secondary: API-Football (100/day, predictions — optional bonus)
 */

import { getAllUpcomingMatches, getStandings, getTeamMatches, getFootballDataKey } from './football-data-org';
import { getPrediction, getApiKey } from './api-football';

export interface ScoutedMatch {
  fixtureId: number;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  league: { id: number; name: string; country: string };
  kickOff: Date;
  suggestions: PickSuggestion[];
  redFlags: string[];
  isSkipped: boolean;
}

export interface PickSuggestion {
  market: string;
  pick: string;
  confidence: number; // 0-100
  reasoning: string[];
  estimatedOdds: string;
}

interface TeamForm {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  played: number;
  winRate: number;
  scoringRate: number;
  cleanSheetRate: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
}

/**
 * Analyze team's recent results to build form profile
 */
function analyzeForm(matches: any[], teamId: number, isHome: boolean): TeamForm {
  // Filter to home or away matches
  const relevant = matches.filter((m: any) => {
    if (isHome) return m.homeTeam?.id === teamId;
    return m.awayTeam?.id === teamId;
  }).slice(0, 10);

  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;

  for (const m of relevant) {
    const homeScore = m.score?.fullTime?.home ?? 0;
    const awayScore = m.score?.fullTime?.away ?? 0;

    if (isHome) {
      goalsFor += homeScore;
      goalsAgainst += awayScore;
      if (homeScore > awayScore) wins++;
      else if (homeScore === awayScore) draws++;
      else losses++;
    } else {
      goalsFor += awayScore;
      goalsAgainst += homeScore;
      if (awayScore > homeScore) wins++;
      else if (awayScore === homeScore) draws++;
      else losses++;
    }
  }

  const played = relevant.length || 1;
  return {
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    played,
    winRate: Math.round((wins / played) * 100),
    scoringRate: Math.round((relevant.filter((m: any) => {
      const score = isHome ? m.score?.fullTime?.home : m.score?.fullTime?.away;
      return (score ?? 0) > 0;
    }).length / played) * 100),
    cleanSheetRate: Math.round((relevant.filter((m: any) => {
      const conceded = isHome ? m.score?.fullTime?.away : m.score?.fullTime?.home;
      return (conceded ?? 0) === 0;
    }).length / played) * 100),
    avgGoalsFor: Math.round((goalsFor / played) * 10) / 10,
    avgGoalsAgainst: Math.round((goalsAgainst / played) * 10) / 10,
  };
}

/**
 * Get league position for a team from standings
 */
function getPosition(standings: any, teamId: number): number | null {
  if (!standings?.standings) return null;
  for (const group of standings.standings) {
    for (const entry of group.table || []) {
      if (entry.team?.id === teamId) return entry.position;
    }
  }
  return null;
}

/**
 * Generate pick suggestions based on form analysis
 */
function generateSuggestions(
  homeForm: TeamForm,
  awayForm: TeamForm,
  homeName: string,
  awayName: string,
  posGap: number | null,
): PickSuggestion[] {
  const suggestions: PickSuggestion[] = [];

  // HOME WIN analysis
  if (homeForm.winRate >= 60) {
    const reasons: string[] = [];
    let conf = 50;

    if (homeForm.winRate >= 80) { conf += 20; reasons.push(`Home win rate: ${homeForm.winRate}%`); }
    else if (homeForm.winRate >= 70) { conf += 15; reasons.push(`Home win rate: ${homeForm.winRate}%`); }
    else { conf += 10; reasons.push(`Home win rate: ${homeForm.winRate}%`); }

    if (awayForm.winRate <= 30) { conf += 10; reasons.push(`${awayName} away win rate: ${awayForm.winRate}%`); }
    if (posGap !== null && posGap >= 8) { conf += 8; reasons.push(`Position gap: ${posGap} places`); }
    if (homeForm.avgGoalsFor >= 2.0) { conf += 5; reasons.push(`Home avg goals: ${homeForm.avgGoalsFor}`); }
    if (awayForm.losses >= 5) { reasons.push(`${awayName} lost ${awayForm.losses}/${awayForm.played} away`); }

    conf = Math.min(92, conf);
    if (conf >= 65) {
      suggestions.push({
        market: '1X2',
        pick: 'Home',
        confidence: conf,
        reasoning: reasons,
        estimatedOdds: conf >= 80 ? '1.15-1.35' : conf >= 72 ? '1.30-1.50' : '1.45-1.70',
      });
    }
  }

  // AWAY WIN analysis
  if (awayForm.winRate >= 55) {
    const reasons: string[] = [];
    let conf = 45;

    if (awayForm.winRate >= 70) { conf += 20; reasons.push(`${awayName} away win rate: ${awayForm.winRate}%`); }
    else if (awayForm.winRate >= 60) { conf += 15; reasons.push(`${awayName} away win rate: ${awayForm.winRate}%`); }
    else { conf += 10; reasons.push(`${awayName} away win rate: ${awayForm.winRate}%`); }

    if (homeForm.winRate <= 40) { conf += 10; reasons.push(`${homeName} home win rate: ${homeForm.winRate}%`); }
    if (posGap !== null && posGap <= -8) { conf += 8; reasons.push(`Position gap: ${Math.abs(posGap)} places (away higher)`); }
    if (awayForm.avgGoalsFor >= 1.5) { conf += 5; reasons.push(`${awayName} away avg goals: ${awayForm.avgGoalsFor}`); }

    conf = Math.min(90, conf);
    if (conf >= 65) {
      suggestions.push({
        market: '1X2',
        pick: 'Away',
        confidence: conf,
        reasoning: reasons,
        estimatedOdds: conf >= 75 ? '1.35-1.60' : '1.55-1.90',
      });
    }
  }

  // OVER 1.5 analysis
  const totalAvgGoals = homeForm.avgGoalsFor + awayForm.avgGoalsFor;
  if (totalAvgGoals >= 2.5 || (homeForm.scoringRate >= 80 && awayForm.scoringRate >= 60)) {
    const reasons: string[] = [];
    let conf = 50;

    if (homeForm.avgGoalsFor >= 2.0) { conf += 12; reasons.push(`${homeName} scores ${homeForm.avgGoalsFor} avg at home`); }
    if (awayForm.avgGoalsFor >= 1.0) { conf += 8; reasons.push(`${awayName} scores ${awayForm.avgGoalsFor} avg away`); }
    if (homeForm.scoringRate >= 90) { conf += 8; reasons.push(`${homeName} scores in ${homeForm.scoringRate}% of home games`); }
    if (homeForm.avgGoalsAgainst >= 1.0) { conf += 5; reasons.push(`${homeName} concedes ${homeForm.avgGoalsAgainst} avg at home`); }

    conf = Math.min(88, conf);
    if (conf >= 65) {
      suggestions.push({
        market: 'Over/Under',
        pick: 'Over 1.5',
        confidence: conf,
        reasoning: reasons,
        estimatedOdds: conf >= 78 ? '1.15-1.30' : '1.28-1.50',
      });
    }
  }

  // BOTH TEAMS SCORE
  if (homeForm.scoringRate >= 75 && awayForm.scoringRate >= 65 &&
      homeForm.cleanSheetRate <= 40 && awayForm.avgGoalsAgainst < 2.5) {
    const reasons: string[] = [];
    let conf = 50;

    if (homeForm.scoringRate >= 90) { conf += 10; reasons.push(`${homeName} scores in ${homeForm.scoringRate}% at home`); }
    if (awayForm.scoringRate >= 75) { conf += 10; reasons.push(`${awayName} scores in ${awayForm.scoringRate}% away`); }
    if (homeForm.cleanSheetRate <= 20) { conf += 8; reasons.push(`${homeName} rarely keeps clean sheet (${homeForm.cleanSheetRate}%)`); }

    conf = Math.min(85, conf);
    if (conf >= 62) {
      suggestions.push({
        market: 'GG/NG',
        pick: 'Both Teams Score',
        confidence: conf,
        reasoning: reasons,
        estimatedOdds: '1.50-1.85',
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Detect red flags
 */
function detectRedFlags(homeForm: TeamForm, awayForm: TeamForm): string[] {
  const flags: string[] = [];

  if (Math.abs(homeForm.winRate - awayForm.winRate) < 15) {
    flags.push('Teams evenly matched — unpredictable');
  }
  if (homeForm.played < 3 || awayForm.played < 3) {
    flags.push('Insufficient data — early season or new team');
  }

  return flags;
}

/**
 * Scout matches using Football-Data.org as primary source
 */
export async function scoutMatches(days: number = 2, leagueCodes?: string[]): Promise<ScoutedMatch[]> {
  if (!getFootballDataKey()) {
    throw new Error('Football-Data.org API key not set. Add it in API Settings.');
  }

  const allMatches: ScoutedMatch[] = [];

  // Get upcoming fixtures (pass league codes to filter)
  const fixtures = await getAllUpcomingMatches(days, leagueCodes);

  // Cache standings per competition
  const standingsCache: Record<string, any> = {};

  for (const fixture of fixtures) {
    try {
      const homeTeamId = fixture.homeTeam?.id;
      const awayTeamId = fixture.awayTeam?.id;
      if (!homeTeamId || !awayTeamId) continue;

      // Get team form (recent matches)
      const [homeMatches, awayMatches] = await Promise.all([
        getTeamMatches(homeTeamId, 10),
        getTeamMatches(awayTeamId, 10),
      ]);

      const homeForm = analyzeForm(homeMatches.matches || [], homeTeamId, true);
      const awayForm = analyzeForm(awayMatches.matches || [], awayTeamId, false);

      // Get standings for position gap
      const compCode = fixture.competitionCode;
      if (!standingsCache[compCode]) {
        try {
          standingsCache[compCode] = await getStandings(compCode);
        } catch { standingsCache[compCode] = null; }
      }

      const homePos = getPosition(standingsCache[compCode], homeTeamId);
      const awayPos = getPosition(standingsCache[compCode], awayTeamId);
      const posGap = (homePos && awayPos) ? awayPos - homePos : null; // Positive = home higher in table

      // Generate suggestions
      const suggestions = generateSuggestions(homeForm, awayForm, fixture.homeTeam.name, fixture.awayTeam.name, posGap);
      const redFlags = detectRedFlags(homeForm, awayForm);

      if (suggestions.length > 0 && !suggestions.every(s => s.confidence < 65)) {
        allMatches.push({
          fixtureId: fixture.id,
          homeTeam: { id: homeTeamId, name: fixture.homeTeam.name || fixture.homeTeam.shortName },
          awayTeam: { id: awayTeamId, name: fixture.awayTeam.name || fixture.awayTeam.shortName },
          league: { id: fixture.competition?.id || 0, name: fixture.competitionName || '', country: '' },
          kickOff: new Date(fixture.utcDate),
          suggestions,
          redFlags,
          isSkipped: false,
        });
      }
    } catch (e) {
      // Skip matches that fail — don't break the whole scout
      console.error(`Failed to analyze match:`, e);
    }
  }

  // Sort by highest confidence first
  allMatches.sort((a, b) => {
    const aConf = a.suggestions[0]?.confidence || 0;
    const bConf = b.suggestions[0]?.confidence || 0;
    return bConf - aConf;
  });

  return allMatches;
}
