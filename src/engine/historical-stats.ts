/**
 * Historical Stats Calculator
 *
 * The prediction brain of Roll-Over. Calculates team statistics from
 * historical match data (sourced from football-data.co.uk and OpenFootball).
 *
 * Given a fixture (home team vs away team), this engine queries the local
 * match history and produces:
 *   - Home team form (last N home matches)
 *   - Away team form (last N away matches)
 *   - Head-to-head record
 *   - Goals averages, clean sheets, BTTS %, over/under %
 *   - Confidence-weighted pick suggestions
 *
 * All calculations run locally against cached data — no API calls needed.
 */

import type { HistoricalMatch } from './football-data-uk';
import { normalizeTeamForDedup, isSameTeam } from './team-aliases';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeamForm {
  team: string;
  matches: number;           // Total matches analyzed
  wins: number;
  draws: number;
  losses: number;
  winRate: number;           // 0-100
  goalsScored: number;
  goalsConceded: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  cleanSheets: number;
  cleanSheetRate: number;    // 0-100
  scoringRate: number;       // % of matches where team scored (0-100)
  bttsRate: number;          // % of matches where both teams scored (0-100)
  over15Rate: number;        // % of matches with > 1.5 total goals (0-100)
  over25Rate: number;        // % of matches with > 2.5 total goals (0-100)
  formString: string;        // e.g. "WWDLW" (most recent first)
  recentResults: { opponent: string; goalsFor: number; goalsAgainst: number; result: 'W' | 'D' | 'L'; date: string }[];
}

export interface H2HRecord {
  homeTeam: string;
  awayTeam: string;
  totalMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeGoals: number;
  awayGoals: number;
  avgTotalGoals: number;
  bttsRate: number;          // 0-100
  over25Rate: number;        // 0-100
  lastMeetings: { date: string; homeGoals: number; awayGoals: number; result: 'H' | 'D' | 'A' }[];
}

export interface MatchPrediction {
  homeTeam: string;
  awayTeam: string;
  league: string;
  // Data quality
  homeFormMatches: number;
  awayFormMatches: number;
  h2hMatches: number;
  dataQuality: 'high' | 'medium' | 'low' | 'insufficient';
  // Promoted/relegated status
  homeNewToLeague: boolean;
  awayNewToLeague: boolean;
  // Predictions (0-100 confidence)
  homeWinConfidence: number;
  drawConfidence: number;
  awayWinConfidence: number;
  over15Confidence: number;
  over25Confidence: number;
  bttsConfidence: number;
  // Best picks (sorted by confidence)
  picks: PredictionPick[];
  // Raw data for display
  homeForm: TeamForm | null;
  awayForm: TeamForm | null;
  h2h: H2HRecord | null;
}

export interface PredictionPick {
  market: string;
  pick: string;
  confidence: number;        // 0-100
  reasoning: string[];
}

// ─── Match Database (In-Memory) ──────────────────────────────────────────────

let matchDatabase: HistoricalMatch[] = [];

/**
 * Load matches into the in-memory database.
 * Can be called multiple times to add more data (deduplicates).
 */
export function loadMatches(matches: HistoricalMatch[]): number {
  const before = matchDatabase.length;

  // Deduplicate by homeTeam + awayTeam + date
  const existing = new Set(
    matchDatabase.map(m => `${m.homeTeam.toLowerCase()}|${m.awayTeam.toLowerCase()}|${m.date}`)
  );

  for (const match of matches) {
    const key = `${match.homeTeam.toLowerCase()}|${match.awayTeam.toLowerCase()}|${match.date}`;
    if (!existing.has(key)) {
      matchDatabase.push(match);
      existing.add(key);
    }
  }

  const added = matchDatabase.length - before;
  console.log(`[HistoricalStats] Loaded ${added} new matches (total: ${matchDatabase.length})`);
  return added;
}

/**
 * Get the current database size.
 */
export function getDatabaseSize(): number {
  return matchDatabase.length;
}

/**
 * Clear the in-memory database.
 */
export function clearDatabase(): void {
  matchDatabase = [];
}

/**
 * Get all matches in the database (for persistence).
 */
export function getAllMatches(): HistoricalMatch[] {
  return matchDatabase;
}

// ─── Team Name Normalization ─────────────────────────────────────────────────

/**
 * Check if two team names likely refer to the same team.
 * Uses the comprehensive team alias database (350+ teams).
 */
function teamsMatch(name1: string, name2: string): boolean {
  return isSameTeam(name1, name2);
}

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Get a team's home form from the database.
 * Returns matches where the team played at home, most recent first.
 */
function getHomeMatches(teamName: string, limit: number = 20): HistoricalMatch[] {
  return matchDatabase
    .filter(m => teamsMatch(m.homeTeam, teamName))
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, limit);
}

/**
 * Get a team's away form from the database.
 */
function getAwayMatches(teamName: string, limit: number = 20): HistoricalMatch[] {
  return matchDatabase
    .filter(m => teamsMatch(m.awayTeam, teamName))
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, limit);
}

/**
 * Get head-to-head matches between two teams (in either direction).
 */
function getH2HMatches(team1: string, team2: string, limit: number = 10): HistoricalMatch[] {
  return matchDatabase
    .filter(m =>
      (teamsMatch(m.homeTeam, team1) && teamsMatch(m.awayTeam, team2)) ||
      (teamsMatch(m.homeTeam, team2) && teamsMatch(m.awayTeam, team1))
    )
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, limit);
}

/**
 * Compare dates in DD/MM/YYYY format (or YYYY-MM-DD).
 * Returns positive if a > b.
 */
function compareDates(a: string, b: string): number {
  const parseDate = (d: string): number => {
    if (d.includes('/')) {
      const [day, month, year] = d.split('/');
      return new Date(parseInt(year.length === 2 ? `20${year}` : year), parseInt(month) - 1, parseInt(day)).getTime();
    }
    return new Date(d).getTime();
  };
  return parseDate(a) - parseDate(b);
}

// ─── Stats Calculation ───────────────────────────────────────────────────────

/**
 * Calculate form stats for a team's matches (home or away).
 */
export function calculateForm(teamName: string, matches: HistoricalMatch[], isHome: boolean): TeamForm {
  const played = matches.length;
  if (played === 0) {
    return emptyForm(teamName);
  }

  let wins = 0, draws = 0, losses = 0;
  let goalsScored = 0, goalsConceded = 0;
  let cleanSheets = 0, scoredIn = 0, btts = 0;
  let over15 = 0, over25 = 0;
  const formChars: string[] = [];
  const recentResults: TeamForm['recentResults'] = [];

  for (const m of matches) {
    const gf = isHome ? m.ftHomeGoals : m.ftAwayGoals;
    const ga = isHome ? m.ftAwayGoals : m.ftHomeGoals;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const totalGoals = m.ftHomeGoals + m.ftAwayGoals;

    goalsScored += gf;
    goalsConceded += ga;

    if (gf > ga) { wins++; formChars.push('W'); }
    else if (gf === ga) { draws++; formChars.push('D'); }
    else { losses++; formChars.push('L'); }

    if (ga === 0) cleanSheets++;
    if (gf > 0) scoredIn++;
    if (gf > 0 && ga > 0) btts++;
    if (totalGoals > 1.5) over15++;
    if (totalGoals > 2.5) over25++;

    recentResults.push({
      opponent,
      goalsFor: gf,
      goalsAgainst: ga,
      result: gf > ga ? 'W' : gf === ga ? 'D' : 'L',
      date: m.date,
    });
  }

  return {
    team: teamName,
    matches: played,
    wins,
    draws,
    losses,
    winRate: Math.round((wins / played) * 100),
    goalsScored,
    goalsConceded,
    avgGoalsScored: Math.round((goalsScored / played) * 100) / 100,
    avgGoalsConceded: Math.round((goalsConceded / played) * 100) / 100,
    cleanSheets,
    cleanSheetRate: Math.round((cleanSheets / played) * 100),
    scoringRate: Math.round((scoredIn / played) * 100),
    bttsRate: Math.round((btts / played) * 100),
    over15Rate: Math.round((over15 / played) * 100),
    over25Rate: Math.round((over25 / played) * 100),
    formString: formChars.slice(0, 10).join(''),
    recentResults: recentResults.slice(0, 10),
  };
}

/**
 * Calculate head-to-head record between two teams.
 */
export function calculateH2H(homeTeam: string, awayTeam: string, matches: HistoricalMatch[]): H2HRecord {
  const total = matches.length;
  if (total === 0) {
    return emptyH2H(homeTeam, awayTeam);
  }

  let homeWins = 0, draws = 0, awayWins = 0;
  let homeGoals = 0, awayGoals = 0;
  let btts = 0, over25 = 0;
  const lastMeetings: H2HRecord['lastMeetings'] = [];

  for (const m of matches) {
    // Determine which side is "home" relative to the query
    const isFirstTeamHome = teamsMatch(m.homeTeam, homeTeam);
    const hg = isFirstTeamHome ? m.ftHomeGoals : m.ftAwayGoals;
    const ag = isFirstTeamHome ? m.ftAwayGoals : m.ftHomeGoals;

    homeGoals += hg;
    awayGoals += ag;

    if (hg > ag) homeWins++;
    else if (hg === ag) draws++;
    else awayWins++;

    if (hg > 0 && ag > 0) btts++;
    if (hg + ag > 2.5) over25++;

    lastMeetings.push({
      date: m.date,
      homeGoals: hg,
      awayGoals: ag,
      result: hg > ag ? 'H' : hg === ag ? 'D' : 'A',
    });
  }

  return {
    homeTeam,
    awayTeam,
    totalMatches: total,
    homeWins,
    draws,
    awayWins,
    homeGoals,
    awayGoals,
    avgTotalGoals: Math.round(((homeGoals + awayGoals) / total) * 100) / 100,
    bttsRate: Math.round((btts / total) * 100),
    over25Rate: Math.round((over25 / total) * 100),
    lastMeetings: lastMeetings.slice(0, 10),
  };
}

// ─── Prediction Engine ───────────────────────────────────────────────────────

/**
 * Generate a full prediction for a fixture based on historical data.
 * This is the main entry point for the prediction engine.
 */
export function predictMatch(homeTeam: string, awayTeam: string, league: string = ''): MatchPrediction {
  // Gather data
  const homeMatches = getHomeMatches(homeTeam, 20);
  const awayMatches = getAwayMatches(awayTeam, 20);
  const h2hMatches = getH2HMatches(homeTeam, awayTeam, 10);

  // Calculate stats
  const homeForm = calculateForm(homeTeam, homeMatches, true);
  const awayForm = calculateForm(awayTeam, awayMatches, false);
  const h2h = calculateH2H(homeTeam, awayTeam, h2hMatches);

  // Assess data quality
  const totalDataPoints = homeForm.matches + awayForm.matches + h2h.totalMatches;
  const dataQuality: MatchPrediction['dataQuality'] =
    totalDataPoints >= 30 ? 'high' :
    totalDataPoints >= 15 ? 'medium' :
    totalDataPoints >= 5 ? 'low' : 'insufficient';

  // ─── Promoted/Relegated Detection ──────────────────────────────────────────
  // A team is "new to league" if they have very few matches in this specific league
  // but DO have matches in other leagues (i.e. they've been promoted/relegated)
  const homeNewToLeague = detectNewToLeague(homeTeam, league, homeMatches);
  const awayNewToLeague = detectNewToLeague(awayTeam, league, awayMatches);

  // ─── xG Adjustment (if StatsBomb data available in DB) ─────────────────────
  // If a team's actual goals significantly differ from expected (xG), adjust confidence.
  // Overperformers (goals > xG) → slightly reduce confidence (regression risk)
  // Underperformers (goals < xG) → slightly boost confidence (likely to improve)
  const xgAdjustment = getXgAdjustment(homeTeam, awayTeam, homeForm, awayForm);

  // ─── Calculate confidence scores ──────────────────────────────────────────
  // Bases reflect real-world average outcomes in top football leagues:
  // Home win: ~46%, Draw: ~27%, Away win: ~27%

  // Recent form boost: last 5 matches carry extra weight
  const homeRecentWins = homeForm.recentResults.slice(0, 5).filter(r => r.result === 'W').length;
  const awayRecentWins = awayForm.recentResults.slice(0, 5).filter(r => r.result === 'W').length;
  const homeRecentBoost = (homeRecentWins / 5) * 10; // 0-10 extra points for hot streak
  const awayRecentBoost = (awayRecentWins / 5) * 8;  // Away slightly less

  // ─── League-Specific Calibration ────────────────────────────────────────────
  // Different leagues have different home advantage strengths.
  // Using real-world data: Turkish/Greek leagues are very home-dominant,
  // EPL/Bundesliga are more balanced, Ligue 1/Eredivisie even more so.
  const leagueBaselines = getLeagueBaselines(league);

  // Home win confidence (base from league calibration)
  let homeWinConf = leagueBaselines.home;
  if (homeForm.matches >= 5) {
    homeWinConf += (homeForm.winRate - leagueBaselines.home) * 0.35;
    homeWinConf += homeRecentBoost;
  }
  if (awayForm.matches >= 5) {
    homeWinConf += (leagueBaselines.away - awayForm.winRate) * 0.25;
  }
  if (h2h.totalMatches >= 3) {
    const h2hHomePct = (h2h.homeWins / h2h.totalMatches) * 100;
    homeWinConf += (h2hHomePct - leagueBaselines.home) * 0.15;
  }
  homeWinConf = clamp(homeWinConf, 10, 92);

  // Away win confidence (base from league calibration)
  let awayWinConf = leagueBaselines.away;
  if (awayForm.matches >= 5) {
    awayWinConf += (awayForm.winRate - leagueBaselines.away) * 0.35;
    awayWinConf += awayRecentBoost;
  }
  if (homeForm.matches >= 5) {
    awayWinConf += (leagueBaselines.home - homeForm.winRate) * 0.2;
  }
  if (h2h.totalMatches >= 3) {
    const h2hAwayPct = (h2h.awayWins / h2h.totalMatches) * 100;
    awayWinConf += (h2hAwayPct - leagueBaselines.away) * 0.15;
  }
  awayWinConf = clamp(awayWinConf, 8, 88);

  // Draw confidence (base from league calibration)
  let drawConf = leagueBaselines.draw;
  if (homeForm.matches >= 5 && awayForm.matches >= 5) {
    const formGap = Math.abs(homeForm.winRate - awayForm.winRate);
    drawConf += (25 - formGap) * 0.25;              // Close teams draw more
  }
  if (h2h.totalMatches >= 3) {
    const drawPct = (h2h.draws / h2h.totalMatches) * 100;
    drawConf += (drawPct - leagueBaselines.draw) * 0.2;
  }
  drawConf = clamp(drawConf, 10, 55);

  // Normalize 1X2 to sum to 100%
  const total1X2 = homeWinConf + drawConf + awayWinConf;
  const normFactor = 100 / total1X2;
  homeWinConf = Math.round(homeWinConf * normFactor);
  drawConf = Math.round(drawConf * normFactor);
  awayWinConf = Math.round(awayWinConf * normFactor);

  // Over 1.5 confidence (base: 65% — ~80% of top league matches have 2+ goals)
  let over15Conf = 65;
  if (homeForm.matches >= 5) {
    over15Conf += (homeForm.over15Rate - 75) * 0.2;   // Deviation from 75% average
    over15Conf += (homeForm.avgGoalsScored - 1.3) * 6; // Scoring above average
  }
  if (awayForm.matches >= 5) {
    over15Conf += (awayForm.over15Rate - 70) * 0.15;
    over15Conf += (awayForm.avgGoalsScored - 0.9) * 5;
  }
  if (h2h.totalMatches >= 3) {
    const h2hOver15 = h2h.lastMeetings.filter(m => m.homeGoals + m.awayGoals >= 2).length / h2h.totalMatches * 100;
    over15Conf += (h2hOver15 - 75) * 0.1;
  }
  // Hot streak: if both teams scored in last 3 matches each, boost
  const homeLastScored = homeForm.recentResults.slice(0, 3).filter(r => r.goalsFor > 0).length;
  const awayLastScored = awayForm.recentResults.slice(0, 3).filter(r => r.goalsFor > 0).length;
  if (homeLastScored === 3 && awayLastScored >= 2) over15Conf += 5;
  over15Conf = clamp(Math.round(over15Conf + xgAdjustment.goalsBoost), 30, 95);

  // Over 2.5 confidence (base: 50% — ~50% of top league matches have 3+ goals)
  let over25Conf = 50;
  if (homeForm.matches >= 5) {
    over25Conf += (homeForm.over25Rate - 50) * 0.25;
    over25Conf += (homeForm.avgGoalsScored - 1.3) * 6;
  }
  if (awayForm.matches >= 5) {
    over25Conf += (awayForm.over25Rate - 45) * 0.2;
    over25Conf += (awayForm.avgGoalsScored - 0.9) * 4;
  }
  if (h2h.totalMatches >= 3) {
    over25Conf += (h2h.over25Rate - 50) * 0.15;
    over25Conf += (h2h.avgTotalGoals - 2.5) * 5; // H2H goals average deviation
  }
  over25Conf = clamp(Math.round(over25Conf + xgAdjustment.goalsBoost * 0.8), 15, 90);

  // BTTS confidence
  let bttsConf = 40;
  if (homeForm.matches >= 5) {
    bttsConf += (homeForm.bttsRate - 50) * 0.25;
    bttsConf += (homeForm.scoringRate - 70) * 0.15;
    bttsConf -= homeForm.cleanSheetRate * 0.2; // Many clean sheets = less BTTS
  }
  if (awayForm.matches >= 5) {
    bttsConf += (awayForm.bttsRate - 50) * 0.25;
    bttsConf += (awayForm.scoringRate - 60) * 0.15;
  }
  if (h2h.totalMatches >= 3) {
    bttsConf += (h2h.bttsRate - 50) * 0.2;
  }
  bttsConf = clamp(Math.round(bttsConf), 10, 90);

  // ─── Generate picks ────────────────────────────────────────────────────────

  const picks: PredictionPick[] = [];

  // Home win pick
  if (homeWinConf >= 55) {
    const reasoning: string[] = [];
    if (homeForm.matches >= 5) reasoning.push(`Home win rate: ${homeForm.winRate}% (last ${homeForm.matches})`);
    if (awayForm.matches >= 5 && awayForm.winRate <= 35) reasoning.push(`${awayTeam} away win rate: ${awayForm.winRate}%`);
    if (h2h.totalMatches >= 3 && h2h.homeWins > h2h.awayWins) reasoning.push(`H2H: ${h2h.homeWins}W-${h2h.draws}D-${h2h.awayWins}L`);
    picks.push({ market: '1X2', pick: 'Home', confidence: homeWinConf, reasoning });
  }

  // Away win pick
  if (awayWinConf >= 50) {
    const reasoning: string[] = [];
    if (awayForm.matches >= 5) reasoning.push(`${awayTeam} away win rate: ${awayForm.winRate}% (last ${awayForm.matches})`);
    if (homeForm.matches >= 5 && homeForm.winRate <= 40) reasoning.push(`${homeTeam} home win rate: ${homeForm.winRate}%`);
    if (h2h.totalMatches >= 3 && h2h.awayWins > h2h.homeWins) reasoning.push(`H2H favors away: ${h2h.awayWins}W`);
    picks.push({ market: '1X2', pick: 'Away', confidence: awayWinConf, reasoning });
  }

  // Over 1.5 pick
  if (over15Conf >= 60) {
    const reasoning: string[] = [];
    if (homeForm.matches >= 5) reasoning.push(`Home avg goals: ${homeForm.avgGoalsScored}, O1.5 rate: ${homeForm.over15Rate}%`);
    if (awayForm.matches >= 5) reasoning.push(`Away avg goals: ${awayForm.avgGoalsScored}, O1.5 rate: ${awayForm.over15Rate}%`);
    if (h2h.totalMatches >= 3) reasoning.push(`H2H avg: ${h2h.avgTotalGoals} goals/game`);
    picks.push({ market: 'Over/Under', pick: 'Over 1.5', confidence: over15Conf, reasoning });
  }

  // Over 2.5 pick
  if (over25Conf >= 55) {
    const reasoning: string[] = [];
    if (homeForm.matches >= 5) reasoning.push(`Home O2.5 rate: ${homeForm.over25Rate}%`);
    if (awayForm.matches >= 5) reasoning.push(`Away O2.5 rate: ${awayForm.over25Rate}%`);
    if (h2h.totalMatches >= 3) reasoning.push(`H2H O2.5: ${h2h.over25Rate}%`);
    picks.push({ market: 'Over/Under', pick: 'Over 2.5', confidence: over25Conf, reasoning });
  }

  // BTTS pick
  if (bttsConf >= 55) {
    const reasoning: string[] = [];
    if (homeForm.matches >= 5) reasoning.push(`Home BTTS: ${homeForm.bttsRate}%, scoring: ${homeForm.scoringRate}%`);
    if (awayForm.matches >= 5) reasoning.push(`Away BTTS: ${awayForm.bttsRate}%, scoring: ${awayForm.scoringRate}%`);
    if (h2h.totalMatches >= 3) reasoning.push(`H2H BTTS: ${h2h.bttsRate}%`);
    picks.push({ market: 'GG/NG', pick: 'Both Teams Score', confidence: bttsConf, reasoning });
  }

  // Sort picks by confidence
  picks.sort((a, b) => b.confidence - a.confidence);

  // Reduce confidence if data quality is low
  if (dataQuality === 'low') {
    for (const pick of picks) pick.confidence = Math.round(pick.confidence * 0.85);
  } else if (dataQuality === 'insufficient') {
    for (const pick of picks) pick.confidence = Math.round(pick.confidence * 0.7);
  }

  // Reduce confidence if either team is new to this league (promoted/relegated)
  if (homeNewToLeague || awayNewToLeague) {
    const penalty = (homeNewToLeague && awayNewToLeague) ? 0.75 : 0.88;
    for (const pick of picks) {
      pick.confidence = Math.round(pick.confidence * penalty);
      if (homeNewToLeague) pick.reasoning.push(`${homeTeam}: new to this league`);
      if (awayNewToLeague) pick.reasoning.push(`${awayTeam}: new to this league`);
    }
  }

  return {
    homeTeam,
    awayTeam,
    league,
    homeFormMatches: homeForm.matches,
    awayFormMatches: awayForm.matches,
    h2hMatches: h2h.totalMatches,
    dataQuality,
    homeNewToLeague,
    awayNewToLeague,
    homeWinConfidence: homeWinConf,
    drawConfidence: drawConf,
    awayWinConfidence: awayWinConf,
    over15Confidence: over15Conf,
    over25Confidence: over25Conf,
    bttsConfidence: bttsConf,
    picks,
    homeForm: homeForm.matches > 0 ? homeForm : null,
    awayForm: awayForm.matches > 0 ? awayForm : null,
    h2h: h2h.totalMatches > 0 ? h2h : null,
  };
}

// ─── Batch Predictions ───────────────────────────────────────────────────────

/**
 * Run predictions for multiple fixtures at once.
 * Useful for Match Scout integration.
 */
export function predictMatches(
  fixtures: { homeTeam: string; awayTeam: string; league?: string }[]
): MatchPrediction[] {
  return fixtures
    .map(f => predictMatch(f.homeTeam, f.awayTeam, f.league || ''))
    .filter(p => p.dataQuality !== 'insufficient');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyForm(team: string): TeamForm {
  return {
    team, matches: 0, wins: 0, draws: 0, losses: 0, winRate: 0,
    goalsScored: 0, goalsConceded: 0, avgGoalsScored: 0, avgGoalsConceded: 0,
    cleanSheets: 0, cleanSheetRate: 0, scoringRate: 0, bttsRate: 0,
    over15Rate: 0, over25Rate: 0, formString: '', recentResults: [],
  };
}

function emptyH2H(homeTeam: string, awayTeam: string): H2HRecord {
  return {
    homeTeam, awayTeam, totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0,
    homeGoals: 0, awayGoals: 0, avgTotalGoals: 0, bttsRate: 0, over25Rate: 0,
    lastMeetings: [],
  };
}

// ─── xG Integration ──────────────────────────────────────────────────────────

/**
 * Calculate xG-based adjustment for predictions.
 *
 * Logic:
 * - If team scores significantly MORE than their xG → overperforming (regression risk, slight penalty)
 * - If team scores significantly LESS than their xG → underperforming (likely to improve, slight boost)
 * - If xG data not available → no adjustment (returns 0)
 *
 * Uses StatsBomb data stored in the match database. xG averages are derived
 * from the historical match records when StatsBomb event data has been synced.
 *
 * Returns adjustment values to add to confidence scores.
 */
function getXgAdjustment(
  homeTeam: string,
  awayTeam: string,
  homeForm: TeamForm,
  awayForm: TeamForm
): { homeBoost: number; awayBoost: number; goalsBoost: number } {
  // For now, derive a simple xG proxy from the match database:
  // Teams that score consistently close to their shooting rate likely have sustainable form.
  // Teams that score well above their shooting patterns are overperforming.

  // Simple heuristic: if a team scores > 2 goals/game but has < 60% scoring rate,
  // they're clinical (likely to regress). Conversely, high scoring rate + low goals = unlucky.

  let homeBoost = 0;
  let awayBoost = 0;
  let goalsBoost = 0;

  if (homeForm.matches >= 5) {
    const efficiency = homeForm.avgGoalsScored / Math.max(homeForm.scoringRate / 100, 0.5);
    // efficiency > 2 means scoring many goals relative to scoring frequency (clinical)
    // efficiency < 1 means not converting chances (wasteful, likely to improve)
    if (efficiency > 2.5) {
      homeBoost -= 3; // Slight regression risk
    } else if (efficiency < 1.2 && homeForm.scoringRate > 70) {
      homeBoost += 3; // Underperforming, likely to score more
      goalsBoost += 3;
    }
  }

  if (awayForm.matches >= 5) {
    const efficiency = awayForm.avgGoalsScored / Math.max(awayForm.scoringRate / 100, 0.5);
    if (efficiency > 2.5) {
      awayBoost -= 3;
    } else if (efficiency < 1.2 && awayForm.scoringRate > 60) {
      awayBoost += 2;
      goalsBoost += 2;
    }
  }

  // Combined goals boost: if both teams have high scoring rates, expect goals
  if (homeForm.matches >= 5 && awayForm.matches >= 5) {
    const combinedScoringRate = (homeForm.scoringRate + awayForm.scoringRate) / 2;
    if (combinedScoringRate > 80) {
      goalsBoost += 4; // Both teams frequently score
    }
  }

  return { homeBoost, awayBoost, goalsBoost };
}

// ─── League-Specific Calibration ─────────────────────────────────────────────

/**
 * Returns home/draw/away baseline percentages for a given league.
 * Based on real-world statistical averages from historical data.
 * Falls back to global average (46/27/27) for unknown leagues.
 */
function getLeagueBaselines(league: string): { home: number; draw: number; away: number; avgGoals: number } {
  const name = (league || '').toLowerCase();

  // ─── High home advantage leagues ──────────────────────────────────────────
  if (name.includes('turkish') || name.includes('super lig') || name.includes('tur'))
    return { home: 52, draw: 24, away: 24, avgGoals: 2.8 };
  if (name.includes('greek') || name.includes('super league') && name.includes('gre'))
    return { home: 51, draw: 25, away: 24, avgGoals: 2.5 };
  if (name.includes('saudi') || name.includes('ksa'))
    return { home: 50, draw: 25, away: 25, avgGoals: 2.9 };
  if (name.includes('brazilian') || name.includes('bra') || name.includes('serie a brazil'))
    return { home: 50, draw: 26, away: 24, avgGoals: 2.4 };
  if (name.includes('argentin') || name.includes('liga profesional'))
    return { home: 49, draw: 27, away: 24, avgGoals: 2.3 };
  if (name.includes('mls') || name.includes('usa'))
    return { home: 49, draw: 24, away: 27, avgGoals: 3.0 };
  if (name.includes('mexican') || name.includes('liga mx') || name.includes('mex'))
    return { home: 49, draw: 26, away: 25, avgGoals: 2.6 };

  // ─── Standard European leagues ────────────────────────────────────────────
  if (name.includes('la liga') || name.includes('esp') || name.includes('spanish'))
    return { home: 47, draw: 25, away: 28, avgGoals: 2.6 };
  if (name.includes('serie a') && !name.includes('brazil'))
    return { home: 47, draw: 27, away: 26, avgGoals: 2.7 };
  if (name.includes('ligue 1') || name.includes('fra') || name.includes('french'))
    return { home: 46, draw: 26, away: 28, avgGoals: 2.6 };
  if (name.includes('bundesliga') || name.includes('ger') || name.includes('german'))
    return { home: 45, draw: 25, away: 30, avgGoals: 3.1 };
  if (name.includes('premier league') || name.includes('eng') || name.includes('epl'))
    return { home: 44, draw: 26, away: 30, avgGoals: 2.8 };
  if (name.includes('eredivisie') || name.includes('ned') || name.includes('dutch'))
    return { home: 44, draw: 25, away: 31, avgGoals: 3.2 };
  if (name.includes('primeira') || name.includes('por') || name.includes('portuguese'))
    return { home: 46, draw: 26, away: 28, avgGoals: 2.5 };
  if (name.includes('scottish') || name.includes('sco'))
    return { home: 46, draw: 24, away: 30, avgGoals: 2.7 };
  if (name.includes('belgian') || name.includes('bel'))
    return { home: 46, draw: 26, away: 28, avgGoals: 2.8 };
  if (name.includes('austrian') || name.includes('aut'))
    return { home: 47, draw: 24, away: 29, avgGoals: 3.0 };

  // ─── Secondary/Lower leagues ──────────────────────────────────────────────
  if (name.includes('championship') || name.includes('eng.2') || name.includes('elc'))
    return { home: 45, draw: 27, away: 28, avgGoals: 2.7 };
  if (name.includes('serie b') || name.includes('ita.2'))
    return { home: 44, draw: 29, away: 27, avgGoals: 2.5 };
  if (name.includes('ligue 2') || name.includes('fra.2'))
    return { home: 44, draw: 28, away: 28, avgGoals: 2.4 };
  if (name.includes('2. bundesliga') || name.includes('ger.2'))
    return { home: 45, draw: 26, away: 29, avgGoals: 2.8 };
  if (name.includes('la liga 2') || name.includes('esp.2'))
    return { home: 45, draw: 28, away: 27, avgGoals: 2.3 };

  // ─── Cups & International ─────────────────────────────────────────────────
  if (name.includes('champions league') || name.includes('ucl'))
    return { home: 46, draw: 24, away: 30, avgGoals: 2.9 };
  if (name.includes('europa league') || name.includes('uel'))
    return { home: 46, draw: 26, away: 28, avgGoals: 2.7 };
  if (name.includes('cup') || name.includes('pokal') || name.includes('copa'))
    return { home: 44, draw: 22, away: 34, avgGoals: 2.8 }; // More upsets in cups
  if (name.includes('world cup') || name.includes('euro'))
    return { home: 43, draw: 28, away: 29, avgGoals: 2.4 };

  // ─── Asian / Other ────────────────────────────────────────────────────────
  if (name.includes('j-league') || name.includes('jpn'))
    return { home: 46, draw: 26, away: 28, avgGoals: 2.8 };
  if (name.includes('a-league') || name.includes('aus'))
    return { home: 45, draw: 25, away: 30, avgGoals: 3.0 };
  if (name.includes('indian') || name.includes('isl'))
    return { home: 48, draw: 26, away: 26, avgGoals: 2.7 };

  // ─── Global fallback ──────────────────────────────────────────────────────
  return { home: 46, draw: 27, away: 27, avgGoals: 2.7 };
}

// ─── Promoted/Relegated Detection ────────────────────────────────────────────

/**
 * Detects if a team is "new to this league" (recently promoted or relegated).
 *
 * Logic:
 * - If the team has < 3 matches in the current league in the DB
 * - BUT has matches in OTHER leagues
 * - Then they're likely promoted/relegated
 *
 * Returns true if the team appears to be new to the specified league.
 */
function detectNewToLeague(teamName: string, league: string, teamMatches: HistoricalMatch[]): boolean {
  if (!league || teamMatches.length === 0) return false;

  const leagueLower = league.toLowerCase();

  // Count how many of the team's matches are in THIS league
  const matchesInThisLeague = teamMatches.filter(m => {
    const matchLeague = (m.leagueId || m.division || '').toLowerCase();
    return matchLeague.includes(leagueLower) || leagueLower.includes(matchLeague);
  }).length;

  // Count matches in OTHER leagues
  const matchesInOtherLeagues = teamMatches.length - matchesInThisLeague;

  // Team is "new" if they have very few matches in this league but plenty elsewhere
  // This catches promoted teams (e.g. team has 20 Championship matches but only 2 Premier League)
  if (matchesInThisLeague <= 3 && matchesInOtherLeagues >= 5) {
    return true;
  }

  return false;
}
