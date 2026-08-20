/**
 * Stats Calculator
 * Computes team statistics from past match results.
 *
 * Data sources:
 * - PRIMARY: TheSportsDB eventspastleague.php (free, unlimited, last 15 per league)
 * - SECONDARY: KickoffAPI team-statistics (pre-computed, 100/day)
 * - FALLBACK: Football-Data.org team/matches (rate limited)
 *
 * Outputs: O2.5%, BTTS%, Win%, Clean Sheet%, Form string, Avg Goals
 * All stats cached 24h in localStorage.
 */

import { getLastEvents, SPORTSDB_LEAGUES } from './thesportsdb';
import { TeamData, MatchData, H2HData } from './scoring';
import { getTeamRecord, getLocalH2H, recordFromPastEvents } from './team-database';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeamStats {
  teamName: string;
  overallWinPct: number;
  homeWinPct: number;
  awayWinPct: number;
  over25Pct: number;
  bttsPct: number;
  cleanSheetPct: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  form: ('W' | 'D' | 'L')[];
  matchesAnalyzed: number;
}

export interface MatchStats {
  homeStats: TeamStats;
  awayStats: TeamStats;
  combinedOver25Pct: number;
  combinedBttsPct: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const STATS_CACHE_KEY = 'rollover_team_stats_cache';
const LEAGUE_CACHE_KEY = 'rollover_league_events_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

function getCache<T>(storageKey: string, cacheKey: string): T | null {
  try {
    const cache = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const entry: CacheEntry<T> = cache[cacheKey];
    if (entry && Date.now() - entry.cachedAt < CACHE_DURATION) {
      return entry.data;
    }
  } catch { /* ignore */ }
  return null;
}

function setCache<T>(storageKey: string, cacheKey: string, data: T): void {
  try {
    const cache = JSON.parse(localStorage.getItem(storageKey) || '{}');
    cache[cacheKey] = { data, cachedAt: Date.now() };
    // Prune if too large (keep max 200 entries)
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
      sorted.slice(0, keys.length - 200).forEach(k => delete cache[k]);
    }
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch { /* ignore */ }
}

// ─── Public Functions ────────────────────────────────────────────────────────

/**
 * Get cached team stats by team name. Returns null if not cached.
 */
export function getCachedTeamStats(teamName: string): TeamStats | null {
  return getCache<TeamStats>(STATS_CACHE_KEY, teamName.toLowerCase());
}

/**
 * Calculate stats for a team from a set of past match results.
 * Results should be from TheSportsDB eventspastleague format.
 */
export function calculateTeamStats(pastEvents: any[], teamName: string): TeamStats {
  const normalizedName = teamName.toLowerCase();

  // Find matches involving this team
  const relevant = pastEvents.filter(e => {
    const home = (e.strHomeTeam || '').toLowerCase();
    const away = (e.strAwayTeam || '').toLowerCase();
    return home.includes(normalizedName) || away.includes(normalizedName) ||
           normalizedName.includes(home) || normalizedName.includes(away);
  });

  if (relevant.length === 0) {
    return emptyStats(teamName);
  }

  let wins = 0, draws = 0, losses = 0;
  let homeWins = 0, homeMatches = 0;
  let awayWins = 0, awayMatches = 0;
  let over25 = 0, btts = 0, cleanSheets = 0;
  let goalsScored = 0, goalsConceded = 0;
  const form: ('W' | 'D' | 'L')[] = [];

  for (const event of relevant) {
    const homeTeam = (event.strHomeTeam || '').toLowerCase();
    const awayTeam = (event.strAwayTeam || '').toLowerCase();
    const homeScore = parseInt(event.intHomeScore) || 0;
    const awayScore = parseInt(event.intAwayScore) || 0;

    // Skip if scores aren't available (future/postponed)
    if (event.intHomeScore === null || event.intAwayScore === null) continue;

    const isHome = homeTeam.includes(normalizedName) || normalizedName.includes(homeTeam);
    const scored = isHome ? homeScore : awayScore;
    const conceded = isHome ? awayScore : homeScore;
    const totalGoals = homeScore + awayScore;

    goalsScored += scored;
    goalsConceded += conceded;

    // Win/Draw/Loss
    if (scored > conceded) {
      wins++;
      form.push('W');
      if (isHome) homeWins++;
      else awayWins++;
    } else if (scored === conceded) {
      draws++;
      form.push('D');
    } else {
      losses++;
      form.push('L');
    }

    // Venue tracking
    if (isHome) homeMatches++;
    else awayMatches++;

    // O2.5, BTTS, Clean Sheet
    if (totalGoals >= 3) over25++;
    if (homeScore > 0 && awayScore > 0) btts++;
    if (conceded === 0) cleanSheets++;
  }

  const total = wins + draws + losses || 1;
  const stats: TeamStats = {
    teamName,
    overallWinPct: Math.round((wins / total) * 100),
    homeWinPct: homeMatches > 0 ? Math.round((homeWins / homeMatches) * 100) : 50,
    awayWinPct: awayMatches > 0 ? Math.round((awayWins / awayMatches) * 100) : 30,
    over25Pct: Math.round((over25 / total) * 100),
    bttsPct: Math.round((btts / total) * 100),
    cleanSheetPct: Math.round((cleanSheets / total) * 100),
    avgGoalsScored: Math.round((goalsScored / total) * 10) / 10,
    avgGoalsConceded: Math.round((goalsConceded / total) * 10) / 10,
    form: form.slice(0, 5),
    matchesAnalyzed: total,
  };

  // Cache the result
  setCache(STATS_CACHE_KEY, teamName.toLowerCase(), stats);

  return stats;
}

/**
 * Fetch past events for a league from TheSportsDB and calculate stats for all teams.
 * Returns a Map of team name (lowercase) → TeamStats.
 */
export async function fetchLeagueStats(leagueId: string): Promise<Map<string, TeamStats>> {
  const statsMap = new Map<string, TeamStats>();

  // Check if we have cached league events
  const cachedEvents = getCache<any[]>(LEAGUE_CACHE_KEY, leagueId);
  let events: any[];

  if (cachedEvents) {
    events = cachedEvents;
  } else {
    events = await getLastEvents(leagueId);
    if (events.length > 0) {
      setCache(LEAGUE_CACHE_KEY, leagueId, events);
    }
  }

  if (events.length === 0) return statsMap;

  // AUTO-INGEST: Feed past events into team database (local intelligence grows)
  try {
    const leagueName = SPORTSDB_LEAGUES.find(l => l.id === leagueId)?.name;
    recordFromPastEvents(events, leagueName);
  } catch { /* non-critical, don't block stats calculation */ }

  // Extract all unique team names
  const teamNames = new Set<string>();
  for (const event of events) {
    if (event.strHomeTeam) teamNames.add(event.strHomeTeam);
    if (event.strAwayTeam) teamNames.add(event.strAwayTeam);
  }

  // Calculate stats for each team
  for (const name of teamNames) {
    const stats = calculateTeamStats(events, name);
    statsMap.set(name.toLowerCase(), stats);
  }

  return statsMap;
}

/**
 * Get match stats for a specific fixture (both teams).
 * Tries cache first, then falls back to league-wide fetch.
 */
export function getMatchStats(homeTeamName: string, awayTeamName: string): MatchStats | null {
  const homeStats = getCachedTeamStats(homeTeamName);
  const awayStats = getCachedTeamStats(awayTeamName);

  if (!homeStats || !awayStats) return null;

  return {
    homeStats,
    awayStats,
    combinedOver25Pct: Math.round((homeStats.over25Pct + awayStats.over25Pct) / 2),
    combinedBttsPct: Math.round((homeStats.bttsPct + awayStats.bttsPct) / 2),
  };
}

/**
 * Convert TeamStats to the TeamData format used by the scoring engine.
 */
export function teamStatsToTeamData(stats: TeamStats, position?: number): TeamData {
  return {
    position,
    form: stats.form.join(''),
    homeWinRate: stats.homeWinPct,
    awayWinRate: stats.awayWinPct,
    avgGoalsFor: stats.avgGoalsScored,
    avgGoalsAgainst: stats.avgGoalsConceded,
    over25Pct: stats.over25Pct,
    bttsPct: stats.bttsPct,
    cleanSheetPct: stats.cleanSheetPct,
  };
}

/**
 * Build MatchData for the scoring engine.
 * Priority: Local Team Database → Stats Cache → null
 * Also includes H2H from local database when available.
 */
export function buildMatchDataFromCache(homeTeamName: string, awayTeamName: string): MatchData | null {
  // TRY 1: Local team database (self-built intelligence)
  const homeRecord = getTeamRecord(homeTeamName);
  const awayRecord = getTeamRecord(awayTeamName);

  // TRY 2: Stats cache (from TheSportsDB past events)
  const homeStats = getCachedTeamStats(homeTeamName);
  const awayStats = getCachedTeamStats(awayTeamName);

  // Need at least some data for one team
  if (!homeRecord && !awayRecord && !homeStats && !awayStats) return null;

  // Build home team data: prefer local DB (richer, more recent), fallback to stats cache
  const homeTeamData: TeamData = homeRecord && homeRecord.dataPoints >= 3 ? {
    position: undefined, // Position comes from standings API, not local DB
    form: homeRecord.stats.homeForm.join('') || homeRecord.stats.form.join(''),
    homeWinRate: homeRecord.stats.homeWinPct,
    awayWinRate: homeRecord.stats.awayWinPct,
    avgGoalsFor: homeRecord.stats.homeAvgGoalsFor || homeRecord.stats.avgGoalsFor,
    avgGoalsAgainst: homeRecord.stats.homeAvgGoalsAgainst || homeRecord.stats.avgGoalsAgainst,
    over25Pct: homeRecord.stats.over25Pct,
    bttsPct: homeRecord.stats.bttsPct,
    cleanSheetPct: homeRecord.stats.cleanSheetPct,
  } : homeStats ? teamStatsToTeamData(homeStats) : {};

  const awayTeamData: TeamData = awayRecord && awayRecord.dataPoints >= 3 ? {
    position: undefined,
    form: awayRecord.stats.awayForm.join('') || awayRecord.stats.form.join(''),
    homeWinRate: awayRecord.stats.homeWinPct,
    awayWinRate: awayRecord.stats.awayWinPct,
    avgGoalsFor: awayRecord.stats.awayAvgGoalsFor || awayRecord.stats.avgGoalsFor,
    avgGoalsAgainst: awayRecord.stats.awayAvgGoalsAgainst || awayRecord.stats.avgGoalsAgainst,
    over25Pct: awayRecord.stats.over25Pct,
    bttsPct: awayRecord.stats.bttsPct,
    cleanSheetPct: awayRecord.stats.cleanSheetPct,
  } : awayStats ? teamStatsToTeamData(awayStats) : {};

  // Build H2H from local database
  let h2h: H2HData | undefined;
  const localH2H = getLocalH2H(homeTeamName, awayTeamName);
  if (localH2H && localH2H.total >= 2) {
    h2h = {
      total: localH2H.total,
      homeTeamWins: localH2H.team1Wins,
      awayTeamWins: localH2H.team2Wins,
      draws: localH2H.draws,
      avgGoals: localH2H.avgGoals,
      bttsPct: Math.round(
        (localH2H.lastMeetings.filter(m => m.goalsFor > 0 && m.goalsAgainst > 0).length / localH2H.total) * 100
      ),
    };
  }

  return { homeTeam: homeTeamData, awayTeam: awayTeamData, h2h };
}

/**
 * Fetch and cache stats for multiple leagues at once.
 * Useful for pre-loading data before scoring.
 */
export async function preloadLeagueStats(leagueIds: string[]): Promise<void> {
  // Fetch uncached leagues in parallel (TheSportsDB has no rate limit)
  const uncached = leagueIds.filter(id => !getCache<any[]>(LEAGUE_CACHE_KEY, id));
  await Promise.allSettled(uncached.map(id => fetchLeagueStats(id)));
}

/**
 * Get TheSportsDB league ID from team name by checking which league has this team cached.
 */
export function findLeagueForTeam(teamName: string): string | null {
  const normalizedName = teamName.toLowerCase();
  for (const league of SPORTSDB_LEAGUES) {
    const events = getCache<any[]>(LEAGUE_CACHE_KEY, league.id);
    if (events) {
      const found = events.some(e =>
        (e.strHomeTeam || '').toLowerCase().includes(normalizedName) ||
        (e.strAwayTeam || '').toLowerCase().includes(normalizedName)
      );
      if (found) return league.id;
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyStats(teamName: string): TeamStats {
  return {
    teamName,
    overallWinPct: 50,
    homeWinPct: 50,
    awayWinPct: 30,
    over25Pct: 50,
    bttsPct: 50,
    cleanSheetPct: 30,
    avgGoalsScored: 1.2,
    avgGoalsConceded: 1.2,
    form: [],
    matchesAnalyzed: 0,
  };
}
