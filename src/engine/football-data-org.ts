/**
 * Football-Data.org API client
 * Free plan: 10 requests/minute, unlimited daily, 12 competitions
 * https://www.football-data.org/documentation/api
 * 
 * Uses Tauri Rust backend for HTTP to avoid truncation issues
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://api.football-data.org/v4';

let apiKey: string | null = null;

export function setFootballDataKey(key: string) {
  apiKey = key;
}

export function getFootballDataKey(): string | null {
  return apiKey;
}

async function apiFetch(endpoint: string): Promise<any> {
  if (!apiKey) throw new Error('Football-Data.org API key not set');

  const url = `${API_HOST}${endpoint}`;
  const headers: Record<string, string> = {
    'X-Auth-Token': apiKey,
    'Accept': 'application/json',
  };

  const result = await httpGet(url, headers);
  return result;
}

// Rate limiter: wait between requests
let lastRequestTime = 0;
async function rateLimitedFetch(endpoint: string): Promise<any> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  // Football-Data.org allows 10 requests/minute = 1 every 6 seconds
  if (timeSinceLastRequest < 6200) {
    await new Promise(resolve => setTimeout(resolve, 6200 - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return apiFetch(endpoint);
}

// Available competitions on free plan
export const FREE_COMPETITIONS = [
  { code: 'PL', name: 'Premier League' },
  { code: 'BL1', name: 'Bundesliga' },
  { code: 'SA', name: 'Serie A' },
  { code: 'PD', name: 'La Liga' },
  { code: 'FL1', name: 'Ligue 1' },
  { code: 'DED', name: 'Eredivisie' },
  { code: 'PPL', name: 'Primeira Liga' },
  { code: 'CL', name: 'Champions League' },
  { code: 'EC', name: 'European Championship' },
  { code: 'WC', name: 'World Cup' },
  { code: 'ELC', name: 'Championship' },
  { code: 'BSA', name: 'Serie A Brazil' },
];

/**
 * Get upcoming matches for a competition
 */
export async function getMatches(competitionCode: string, dateFrom?: string, dateTo?: string): Promise<any> {
  let endpoint = `/competitions/${competitionCode}/matches?status=SCHEDULED&limit=20`;
  if (dateFrom) endpoint += `&dateFrom=${dateFrom}`;
  if (dateTo) endpoint += `&dateTo=${dateTo}`;
  return rateLimitedFetch(endpoint);
}

/**
 * Get all scheduled matches across selected competitions for date range
 */
export async function getAllUpcomingMatches(days: number = 3, leagueCodes?: string[]): Promise<any[]> {
  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0];
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + days);
  const dateTo = endDate.toISOString().split('T')[0];

  const allMatches: any[] = [];
  const competitions = leagueCodes
    ? FREE_COMPETITIONS.filter(c => leagueCodes.includes(c.code))
    : FREE_COMPETITIONS;

  let firstError: string | null = null;

  for (const comp of competitions) {
    try {
      const data = await getMatches(comp.code, dateFrom, dateTo);
      if (data.matches) {
        allMatches.push(...data.matches.map((m: any) => ({
          ...m,
          competitionName: comp.name,
          competitionCode: comp.code,
        })));
      }
    } catch (e: any) {
      if (!firstError) firstError = `${comp.name}: ${e.message}`;
    }
  }

  if (allMatches.length === 0 && firstError) {
    throw new Error(`API failed — ${firstError}`);
  }

  return allMatches;
}

/**
 * Get standings for a competition (useful for position gap analysis)
 */
export async function getStandings(competitionCode: string): Promise<any> {
  return rateLimitedFetch(`/competitions/${competitionCode}/standings`);
}

/**
 * Get team's recent matches (form analysis)
 */
export async function getTeamMatches(teamId: number, limit: number = 10): Promise<any> {
  return rateLimitedFetch(`/teams/${teamId}/matches?status=FINISHED&limit=${limit}`);
}

/**
 * Get head-to-head for two teams
 */
export async function getH2H(matchId: number): Promise<any> {
  return rateLimitedFetch(`/matches/${matchId}/head2head?limit=5`);
}

// ─── Maximized Endpoints (using full free tier) ──────────────────────────────

/**
 * Get top scorers for a competition.
 * Free API: /competitions/{code}/scorers?limit=20
 */
export async function getTopScorers(competitionCode: string, limit: number = 20): Promise<any[]> {
  try {
    const data = await rateLimitedFetch(`/competitions/${competitionCode}/scorers?limit=${limit}`);
    return data?.scorers || [];
  } catch {
    return [];
  }
}

/**
 * Get ALL finished matches for a competition (full season results).
 * Useful for populating historical DB with complete season data.
 * Free API: /competitions/{code}/matches?status=FINISHED
 */
export async function getFinishedMatches(competitionCode: string, season?: string): Promise<any[]> {
  try {
    let endpoint = `/competitions/${competitionCode}/matches?status=FINISHED&limit=500`;
    if (season) endpoint += `&season=${season}`;
    const data = await rateLimitedFetch(endpoint);
    return data?.matches || [];
  } catch {
    return [];
  }
}

/**
 * Get all finished matches for ALL free competitions (bulk data fetch).
 * Returns HistoricalMatch format for DB import.
 * Rate-limited: ~12 requests total (one per competition).
 */
export async function fetchAllSeasonResults(season?: string): Promise<import('./football-data-uk').HistoricalMatch[]> {
  const matches: import('./football-data-uk').HistoricalMatch[] = [];

  for (const comp of FREE_COMPETITIONS) {
    try {
      const raw = await getFinishedMatches(comp.code, season);
      for (const m of raw) {
        const homeScore = m.score?.fullTime?.home;
        const awayScore = m.score?.fullTime?.away;
        if (homeScore == null || awayScore == null) continue;

        matches.push({
          division: comp.code,
          date: m.utcDate?.split('T')[0] || '',
          time: m.utcDate?.split('T')[1]?.slice(0, 5) || '',
          homeTeam: m.homeTeam?.name || m.homeTeam?.shortName || '',
          awayTeam: m.awayTeam?.name || m.awayTeam?.shortName || '',
          ftHomeGoals: homeScore,
          ftAwayGoals: awayScore,
          ftResult: homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D',
          htHomeGoals: m.score?.halfTime?.home ?? null,
          htAwayGoals: m.score?.halfTime?.away ?? null,
          htResult: null,
          homeShots: null,
          awayShots: null,
          homeShotsOnTarget: null,
          awayShotsOnTarget: null,
          homeCorners: null,
          awayCorners: null,
          homeYellows: null,
          awayYellows: null,
          homeReds: null,
            awayReds: null,
            homeFouls: null,
            awayFouls: null,
          season: m.season?.startDate?.slice(0, 4) || '',
          leagueId: comp.code,
        });
      }
    } catch {
      // Skip failed competitions, continue
    }
  }

  return matches;
}

/**
 * Get head-to-head between two teams by their IDs.
 * Free API: /teams/{id}/matches — then filter by opponent.
 * More reliable than match-based H2H for getting historical meetings.
 */
export async function getTeamH2H(teamId: number, opponentId: number, limit: number = 10): Promise<any[]> {
  try {
    const data = await rateLimitedFetch(`/teams/${teamId}/matches?status=FINISHED&limit=50`);
    if (!data?.matches) return [];
    // Filter to matches against the specific opponent
    return data.matches.filter((m: any) =>
      m.homeTeam?.id === opponentId || m.awayTeam?.id === opponentId
    ).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get competition details (teams list, current season info).
 * Free API: /competitions/{code}/teams
 */
export async function getCompetitionTeams(competitionCode: string): Promise<any[]> {
  try {
    const data = await rateLimitedFetch(`/competitions/${competitionCode}/teams`);
    return data?.teams || [];
  } catch {
    return [];
  }
}

/**
 * Get a single team's details including squad.
 * Free API: /teams/{id}
 */
export async function getTeamDetails(teamId: number): Promise<any | null> {
  try {
    return await rateLimitedFetch(`/teams/${teamId}`);
  } catch {
    return null;
  }
}

/**
 * Get all matches for a specific date range across all free competitions.
 * Useful for getting results for settlement.
 */
export async function getMatchesByDateRange(dateFrom: string, dateTo: string, status: string = 'FINISHED'): Promise<any[]> {
  const allMatches: any[] = [];
  for (const comp of FREE_COMPETITIONS) {
    try {
      const data = await rateLimitedFetch(
        `/competitions/${comp.code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=${status}`
      );
      if (data?.matches) {
        allMatches.push(...data.matches.map((m: any) => ({
          ...m,
          competitionName: comp.name,
          competitionCode: comp.code,
        })));
      }
    } catch {
      // Skip, continue
    }
  }
  return allMatches;
}
