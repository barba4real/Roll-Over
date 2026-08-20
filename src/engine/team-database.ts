/**
 * Team Database — Local Intelligence Layer
 *
 * A persistent, self-updating knowledge base for every team the system encounters.
 * Accumulates results from ALL sources:
 *   - API fetches (TheSportsDB past events, Football-Data.org, etc.)
 *   - Settled picks (your own staking history)
 *   - Pasted data (SportyBet bet lists with results)
 *   - Live result checks
 *
 * After 2 weeks of use, this becomes the PRIMARY data source for predictions.
 * The system builds its own statistical picture — independent of any API.
 *
 * Storage: localStorage (with planned SQLite migration path)
 * Max: ~500 teams with full history (typically covers all European top leagues)
 */

const TEAM_DB_KEY = 'rollover_team_database';
const TEAM_DB_VERSION = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeamRecord {
  name: string;                // Primary name
  aliases: string[];           // Alternate names (from different providers)
  league?: string;             // Primary league
  country?: string;

  // Match history (most recent first, max 50 per team)
  matches: MatchEntry[];

  // Computed stats (recalculated on update)
  stats: TeamComputedStats;

  // Meta
  firstSeen: string;           // ISO date
  lastUpdated: string;         // ISO date
  dataPoints: number;          // Total matches recorded
}

export interface MatchEntry {
  date: string;                // ISO date
  opponent: string;
  venue: 'home' | 'away';
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
  league?: string;
  source: 'api' | 'settled' | 'paste' | 'live'; // Where this data came from
  addedAt: string;             // When this entry was recorded
}

export interface TeamComputedStats {
  // Overall
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winPct: number;
  goalsFor: number;
  goalsAgainst: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;

  // Home specific
  homePlayed: number;
  homeWins: number;
  homeWinPct: number;
  homeAvgGoalsFor: number;
  homeAvgGoalsAgainst: number;

  // Away specific
  awayPlayed: number;
  awayWins: number;
  awayWinPct: number;
  awayAvgGoalsFor: number;
  awayAvgGoalsAgainst: number;

  // Patterns
  over25Pct: number;           // % of matches with 3+ total goals
  bttsPct: number;             // % where both teams scored
  cleanSheetPct: number;       // % where this team conceded 0
  failedToScorePct: number;    // % where this team scored 0

  // Form (last 5)
  form: ('W' | 'D' | 'L')[];
  homeForm: ('W' | 'D' | 'L')[];
  awayForm: ('W' | 'D' | 'L')[];

  // Streaks
  currentStreak: { type: 'W' | 'D' | 'L' | 'U'; count: number }; // U = unbeaten
  longestWinStreak: number;
  longestLossStreak: number;

  // Scoring patterns
  scoredFirstPct: number;      // % of matches where this team scored first (approximated)
  avgTotalGoals: number;       // Average total goals in their matches
}

// ─── Database Operations ─────────────────────────────────────────────────────

/**
 * Load the entire team database.
 */
export function loadTeamDatabase(): Map<string, TeamRecord> {
  try {
    const data = localStorage.getItem(TEAM_DB_KEY);
    if (!data) return new Map();
    const parsed = JSON.parse(data);
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

/**
 * Save the entire team database.
 */
function saveTeamDatabase(db: Map<string, TeamRecord>): void {
  try {
    const obj = Object.fromEntries(db);
    localStorage.setItem(TEAM_DB_KEY, JSON.stringify(obj));
  } catch (e) {
    console.error('Failed to save team database:', e);
  }
}

/**
 * Get a team record by name (fuzzy match against aliases).
 */
export function getTeamRecord(teamName: string): TeamRecord | null {
  const db = loadTeamDatabase();
  const key = normalizeKey(teamName);

  // Direct match
  if (db.has(key)) return db.get(key)!;

  // Search aliases
  for (const [, record] of db) {
    if (record.aliases.some(a => normalizeKey(a) === key)) return record;
  }

  // Fuzzy: first significant word match
  const targetWord = key.split(' ').find(w => w.length > 3) || key;
  for (const [k, record] of db) {
    if (k.includes(targetWord) || record.aliases.some(a => normalizeKey(a).includes(targetWord))) {
      return record;
    }
  }

  return null;
}

/**
 * Record a match result for a team. Auto-creates team if not exists.
 * Deduplicates by date + opponent + venue.
 */
export function recordMatchResult(
  teamName: string,
  entry: Omit<MatchEntry, 'addedAt'>,
  league?: string,
  country?: string
): void {
  const db = loadTeamDatabase();
  recordMatchResultBatched(db, teamName, entry, league, country);
  saveTeamDatabase(db);
}

/**
 * Batch version — modifies db in-memory without saving (caller saves once at end)
 */
function recordMatchResultBatched(
  db: Map<string, any>,
  teamName: string,
  entry: Omit<MatchEntry, 'addedAt'>,
  league?: string,
  country?: string
): void {
  const key = normalizeKey(teamName);

  let record = db.get(key);
  if (!record) {
    record = createEmptyRecord(teamName, league, country);
  }

  // Add alias if this is a new name variant
  if (!record.aliases.includes(teamName) && record.name !== teamName) {
    record.aliases.push(teamName);
  }

  // Dedup: don't add same match twice
  const dedupKey = `${entry.date.split('T')[0]}|${normalizeKey(entry.opponent)}|${entry.venue}`;
  const exists = record.matches.some((m: any) =>
    `${m.date.split('T')[0]}|${normalizeKey(m.opponent)}|${m.venue}` === dedupKey
  );

  if (!exists) {
    record.matches.unshift({ ...entry, addedAt: new Date().toISOString() });
    // Keep max 50 most recent matches
    if (record.matches.length > 50) record.matches.length = 50;
  }

  // Update metadata
  record.lastUpdated = new Date().toISOString();
  record.dataPoints = record.matches.length;
  if (league) record.league = league;
  if (country) record.country = country;

  // Recompute stats
  record.stats = computeStats(record.matches);

  db.set(key, record);
}

/**
 * Batch record results from API past events (TheSportsDB format).
 * Processes both teams in each match.
 */
export function recordFromPastEvents(events: any[], league?: string): void {
  // Load database ONCE, batch all modifications, save ONCE
  const db = loadTeamDatabase();

  for (const event of events) {
    const homeTeam = event.strHomeTeam || event.homeTeam || '';
    const awayTeam = event.strAwayTeam || event.awayTeam || '';
    const homeScore = parseInt(event.intHomeScore);
    const awayScore = parseInt(event.intAwayScore);
    const date = event.dateEvent || event.strTimestamp || '';

    if (!homeTeam || !awayTeam || isNaN(homeScore) || isNaN(awayScore)) continue;

    const homeResult: 'W' | 'D' | 'L' = homeScore > awayScore ? 'W' : homeScore === awayScore ? 'D' : 'L';
    const awayResult: 'W' | 'D' | 'L' = awayScore > homeScore ? 'W' : awayScore === homeScore ? 'D' : 'L';

    recordMatchResultBatched(db, homeTeam, {
      date,
      opponent: awayTeam,
      venue: 'home',
      goalsFor: homeScore,
      goalsAgainst: awayScore,
      result: homeResult,
      league,
      source: 'api',
    }, league);

    recordMatchResultBatched(db, awayTeam, {
      date,
      opponent: homeTeam,
      venue: 'away',
      goalsFor: awayScore,
      goalsAgainst: homeScore,
      result: awayResult,
      league,
      source: 'api',
    }, league);
  }

  // Save ONCE after all modifications
  saveTeamDatabase(db);
}

/**
 * Record a settled pick result (from your own staking history).
 */
export function recordFromSettledPick(
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  kickOffDate: string,
  league?: string
): void {
  const homeResult: 'W' | 'D' | 'L' = homeScore > awayScore ? 'W' : homeScore === awayScore ? 'D' : 'L';
  const awayResult: 'W' | 'D' | 'L' = awayScore > homeScore ? 'W' : awayScore === homeScore ? 'D' : 'L';

  recordMatchResult(homeTeam, {
    date: kickOffDate, opponent: awayTeam, venue: 'home',
    goalsFor: homeScore, goalsAgainst: awayScore, result: homeResult, league, source: 'settled',
  }, league);

  recordMatchResult(awayTeam, {
    date: kickOffDate, opponent: homeTeam, venue: 'away',
    goalsFor: awayScore, goalsAgainst: homeScore, result: awayResult, league, source: 'settled',
  }, league);
}

/**
 * Get H2H record between two teams from the local database.
 */
export function getLocalH2H(team1: string, team2: string): LocalH2H | null {
  const record1 = getTeamRecord(team1);
  if (!record1) return null;

  const opponent = normalizeKey(team2);
  const h2hMatches = record1.matches.filter(m =>
    normalizeKey(m.opponent) === opponent ||
    normalizeKey(m.opponent).includes(opponent.split(' ')[0]) ||
    opponent.includes(normalizeKey(m.opponent).split(' ')[0])
  );

  if (h2hMatches.length === 0) return null;

  let team1Wins = 0, team2Wins = 0, draws = 0, totalGoals = 0;
  for (const m of h2hMatches) {
    if (m.result === 'W') team1Wins++;
    else if (m.result === 'L') team2Wins++;
    else draws++;
    totalGoals += m.goalsFor + m.goalsAgainst;
  }

  return {
    total: h2hMatches.length,
    team1Wins,
    team2Wins,
    draws,
    avgGoals: Math.round((totalGoals / h2hMatches.length) * 10) / 10,
    lastMeetings: h2hMatches.slice(0, 5).map(m => ({
      date: m.date,
      goalsFor: m.goalsFor,
      goalsAgainst: m.goalsAgainst,
      venue: m.venue,
      result: m.result,
    })),
  };
}

/**
 * Generate a prediction for a match using ONLY local data.
 * No API needed. Returns null if insufficient data.
 */
export function predictFromLocal(
  homeTeam: string,
  awayTeam: string
): LocalPrediction | null {
  const homeRecord = getTeamRecord(homeTeam);
  const awayRecord = getTeamRecord(awayTeam);

  if (!homeRecord || !awayRecord) return null;
  if (homeRecord.dataPoints < 3 || awayRecord.dataPoints < 3) return null;

  const hs = homeRecord.stats;
  const as = awayRecord.stats;

  // Home win probability (simplified Poisson-inspired)
  const homeStrength = (hs.homeWinPct / 100) * 0.4 + (hs.winPct / 100) * 0.3 + (1 - as.awayWinPct / 100) * 0.3;
  const awayStrength = (as.awayWinPct / 100) * 0.4 + (as.winPct / 100) * 0.3 + (1 - hs.homeWinPct / 100) * 0.3;

  // Expected goals
  const homeExpGoals = (hs.homeAvgGoalsFor + as.awayAvgGoalsAgainst) / 2;
  const awayExpGoals = (as.awayAvgGoalsFor + hs.homeAvgGoalsAgainst) / 2;
  const totalExpGoals = homeExpGoals + awayExpGoals;

  // Over 2.5 probability
  const over25Prob = Math.min(95, Math.max(20,
    Math.round((hs.over25Pct + as.over25Pct) / 2 * 0.7 + (totalExpGoals > 2.5 ? 30 : 0))
  ));

  // BTTS probability
  const bttsProb = Math.min(90, Math.max(15,
    Math.round((hs.bttsPct + as.bttsPct) / 2 * 0.7 + (homeExpGoals > 0.8 && awayExpGoals > 0.8 ? 20 : 0))
  ));

  return {
    homeTeam,
    awayTeam,
    homeWinProb: Math.round(homeStrength * 100),
    drawProb: Math.round((1 - homeStrength - awayStrength) * 100),
    awayWinProb: Math.round(awayStrength * 100),
    over25Prob,
    bttsProb,
    homeExpGoals: Math.round(homeExpGoals * 10) / 10,
    awayExpGoals: Math.round(awayExpGoals * 10) / 10,
    confidenceLevel: Math.min(homeRecord.dataPoints, awayRecord.dataPoints) >= 10 ? 'high' :
                     Math.min(homeRecord.dataPoints, awayRecord.dataPoints) >= 5 ? 'medium' : 'low',
    basedOnMatches: Math.min(homeRecord.dataPoints, awayRecord.dataPoints),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get database statistics (for display/health check).
 */
export function getDatabaseStats(): { teams: number; totalMatches: number; oldestEntry: string | null; newestEntry: string | null } {
  const db = loadTeamDatabase();
  let totalMatches = 0;
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const [, record] of db) {
    totalMatches += record.dataPoints;
    if (record.firstSeen && (!oldest || record.firstSeen < oldest)) oldest = record.firstSeen;
    if (record.lastUpdated && (!newest || record.lastUpdated > newest)) newest = record.lastUpdated;
  }

  return { teams: db.size, totalMatches, oldestEntry: oldest, newestEntry: newest };
}

/**
 * Export the database as JSON (for backup).
 */
export function exportTeamDatabase(): string {
  const db = loadTeamDatabase();
  return JSON.stringify({
    version: TEAM_DB_VERSION,
    exportedAt: new Date().toISOString(),
    teams: Object.fromEntries(db),
  }, null, 2);
}

/**
 * Import database from JSON (merge with existing).
 */
export function importTeamDatabase(json: string): { imported: number; errors: number } {
  try {
    const data = JSON.parse(json);
    const teams = data.teams || {};
    const db = loadTeamDatabase();
    let imported = 0, errors = 0;

    for (const [key, record] of Object.entries(teams) as [string, any][]) {
      if (!record.name || !record.matches) { errors++; continue; }
      const existing = db.get(key);
      if (existing) {
        // Merge matches (dedup)
        for (const match of record.matches) {
          const dedupKey = `${match.date?.split('T')[0]}|${normalizeKey(match.opponent)}|${match.venue}`;
          const exists = existing.matches.some((m: MatchEntry) =>
            `${m.date.split('T')[0]}|${normalizeKey(m.opponent)}|${m.venue}` === dedupKey
          );
          if (!exists) {
            existing.matches.push(match);
            imported++;
          }
        }
        existing.matches.sort((a: MatchEntry, b: MatchEntry) => b.date.localeCompare(a.date));
        if (existing.matches.length > 50) existing.matches.length = 50;
        existing.stats = computeStats(existing.matches);
        existing.dataPoints = existing.matches.length;
        existing.lastUpdated = new Date().toISOString();
      } else {
        db.set(key, record as TeamRecord);
        imported += (record as any).matches?.length || 0;
      }
    }

    saveTeamDatabase(db);
    return { imported, errors };
  } catch {
    return { imported: 0, errors: 1 };
  }
}

// ─── Types (additional) ──────────────────────────────────────────────────────

export interface LocalH2H {
  total: number;
  team1Wins: number;
  team2Wins: number;
  draws: number;
  avgGoals: number;
  lastMeetings: { date: string; goalsFor: number; goalsAgainst: number; venue: 'home' | 'away'; result: 'W' | 'D' | 'L' }[];
}

export interface LocalPrediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;         // 0-100
  drawProb: number;            // 0-100
  awayWinProb: number;         // 0-100
  over25Prob: number;          // 0-100
  bttsProb: number;            // 0-100
  homeExpGoals: number;
  awayExpGoals: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  basedOnMatches: number;      // How many data points
  generatedAt: string;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/\bfc\b|\bsc\b|\bcf\b|\bafc\b/g, '').replace(/\s+/g, ' ').trim();
}

function createEmptyRecord(name: string, league?: string, country?: string): TeamRecord {
  return {
    name,
    aliases: [],
    league,
    country,
    matches: [],
    stats: emptyStats(),
    firstSeen: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    dataPoints: 0,
  };
}

function emptyStats(): TeamComputedStats {
  return {
    played: 0, wins: 0, draws: 0, losses: 0, winPct: 0,
    goalsFor: 0, goalsAgainst: 0, avgGoalsFor: 0, avgGoalsAgainst: 0,
    homePlayed: 0, homeWins: 0, homeWinPct: 0, homeAvgGoalsFor: 0, homeAvgGoalsAgainst: 0,
    awayPlayed: 0, awayWins: 0, awayWinPct: 0, awayAvgGoalsFor: 0, awayAvgGoalsAgainst: 0,
    over25Pct: 0, bttsPct: 0, cleanSheetPct: 0, failedToScorePct: 0,
    form: [], homeForm: [], awayForm: [],
    currentStreak: { type: 'U', count: 0 },
    longestWinStreak: 0, longestLossStreak: 0,
    scoredFirstPct: 0, avgTotalGoals: 0,
  };
}

function computeStats(matches: MatchEntry[]): TeamComputedStats {
  if (matches.length === 0) return emptyStats();

  // Time-decay: recent matches weight more. Exponential decay with half-life of 30 days.
  const now = Date.now();
  const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  function getWeight(match: MatchEntry): number {
    const matchDate = new Date(match.date).getTime();
    if (isNaN(matchDate)) return 0.5; // Unknown date gets half weight
    const ageMs = now - matchDate;
    return Math.pow(0.5, ageMs / HALF_LIFE_MS); // 1.0 for today, 0.5 for 30 days ago, 0.25 for 60 days
  }

  let wins = 0, draws = 0, losses = 0;
  let goalsFor = 0, goalsAgainst = 0;
  let homeGames = 0, homeWins = 0, homeGF = 0, homeGA = 0;
  let awayGames = 0, awayWins = 0, awayGF = 0, awayGA = 0;
  let over25 = 0, btts = 0, cleanSheets = 0, failedToScore = 0;
  let totalWeight = 0;

  const form: ('W' | 'D' | 'L')[] = [];
  const homeForm: ('W' | 'D' | 'L')[] = [];
  const awayForm: ('W' | 'D' | 'L')[] = [];

  // Streak tracking
  let currentStreakType: 'W' | 'D' | 'L' | 'U' = matches[0]?.result || 'U';
  let currentStreakCount = 0;
  let longestWin = 0, longestLoss = 0, tempWin = 0, tempLoss = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const w = getWeight(m); // Time-decay weight
    totalWeight += w;
    const totalGoals = m.goalsFor + m.goalsAgainst;

    goalsFor += m.goalsFor * w;
    goalsAgainst += m.goalsAgainst * w;

    if (m.result === 'W') wins += w;
    else if (m.result === 'D') draws += w;
    else losses += w;

    if (m.venue === 'home') {
      homeGames += w; homeGF += m.goalsFor * w; homeGA += m.goalsAgainst * w;
      if (m.result === 'W') homeWins += w;
      if (homeForm.length < 5) homeForm.push(m.result);
    } else {
      awayGames += w; awayGF += m.goalsFor * w; awayGA += m.goalsAgainst * w;
      if (m.result === 'W') awayWins += w;
      if (awayForm.length < 5) awayForm.push(m.result);
    }

    if (totalGoals >= 3) over25 += w;
    if (m.goalsFor > 0 && m.goalsAgainst > 0) btts += w;
    if (m.goalsAgainst === 0) cleanSheets += w;
    if (m.goalsFor === 0) failedToScore += w;

    if (form.length < 5) form.push(m.result);

    // Streak calculation
    if (i === 0) { currentStreakType = m.result; currentStreakCount = 1; }
    else if (m.result === currentStreakType) currentStreakCount++;

    if (m.result === 'W') { tempWin++; tempLoss = 0; longestWin = Math.max(longestWin, tempWin); }
    else if (m.result === 'L') { tempLoss++; tempWin = 0; longestLoss = Math.max(longestLoss, tempLoss); }
    else { tempWin = 0; tempLoss = 0; }
  }

  const total = totalWeight || 1; // Use weighted total for percentages
  const rawTotal = matches.length; // Raw count for non-percentage fields
  const safeDiv = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;

  return {
    played: rawTotal,
    wins: Math.round(wins), draws: Math.round(draws), losses: Math.round(losses),
    winPct: safeDiv(wins, total),
    goalsFor, goalsAgainst,
    avgGoalsFor: Math.round((goalsFor / total) * 10) / 10,
    avgGoalsAgainst: Math.round((goalsAgainst / total) * 10) / 10,
    homePlayed: matches.filter(m => m.venue === 'home').length,
    homeWins: Math.round(homeWins),
    homeWinPct: safeDiv(homeWins, homeGames),
    homeAvgGoalsFor: homeGames > 0 ? Math.round((homeGF / homeGames) * 10) / 10 : 0,
    homeAvgGoalsAgainst: homeGames > 0 ? Math.round((homeGA / homeGames) * 10) / 10 : 0,
    awayPlayed: matches.filter(m => m.venue === 'away').length,
    awayWins: Math.round(awayWins),
    awayWinPct: safeDiv(awayWins, awayGames),
    awayAvgGoalsFor: awayGames > 0 ? Math.round((awayGF / awayGames) * 10) / 10 : 0,
    awayAvgGoalsAgainst: awayGames > 0 ? Math.round((awayGA / awayGames) * 10) / 10 : 0,
    over25Pct: safeDiv(over25, total),
    bttsPct: safeDiv(btts, total),
    cleanSheetPct: safeDiv(cleanSheets, total),
    failedToScorePct: safeDiv(failedToScore, total),
    form, homeForm, awayForm,
    currentStreak: { type: currentStreakType, count: currentStreakCount },
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    scoredFirstPct: safeDiv(total - failedToScore, total), // Approximation
    avgTotalGoals: Math.round(((goalsFor + goalsAgainst) / total) * 10) / 10,
  };
}
