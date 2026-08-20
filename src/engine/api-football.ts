/**
 * API-Football v3 client
 * Host: v3.football.api-sports.io
 * Free plan: 100 requests/day, 10/min
 * Key stored in localStorage for persistence.
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://v3.football.api-sports.io';

let apiKey: string | null = null;

export function setApiKey(key: string) {
  apiKey = key;
  localStorage.setItem('rollover_api_football_key', key);
}

export function getApiKey(): string | null {
  if (!apiKey) {
    apiKey = localStorage.getItem('rollover_api_football_key');
  }
  return apiKey;
}

/**
 * European football seasons span two calendar years (Aug 2025 - May 2026).
 * The "season" parameter is the START year.
 * If we're in Jan-Jul, current season started last year.
 * If we're in Aug-Dec, current season started this year.
 */
function getCurrentSeason(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

async function apiFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const key = getApiKey();
  if (!key) throw new Error('API-Football key not set. Get free key at api-football.com');

  const url = new URL(`${API_HOST}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    'x-apisports-key': key,
    'Accept': 'application/json',
  };

  const result: any = await httpGet(url.toString(), headers);

  // API-Football wraps errors in the response object
  if (result?.errors && Object.keys(result.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(result.errors)}`);
  }

  return result?.response || [];
}

// Top leagues we care about (IDs from api-football)
export const TOP_LEAGUES = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 94, name: 'Primeira Liga', country: 'Portugal' },
  { id: 88, name: 'Eredivisie', country: 'Netherlands' },
  { id: 203, name: 'Super Lig', country: 'Turkey' },
  { id: 2, name: 'Champions League', country: 'Europe' },
  { id: 3, name: 'Europa League', country: 'Europe' },
];

/**
 * Get upcoming fixtures for a date range
 */
export async function getFixtures(date: string, leagueId?: number): Promise<any[]> {
  const params: Record<string, string> = { date, season: getCurrentSeason().toString() };
  if (leagueId) params.league = leagueId.toString();
  params.status = 'NS'; // Not Started only
  return apiFetch('/fixtures', params);
}

/**
 * Get fixtures for multiple days
 */
export async function getFixturesForDays(days: number = 3, leagueIds: number[] = TOP_LEAGUES.map(l => l.id)): Promise<any[]> {
  const allFixtures: any[] = [];
  const today = new Date();
  const season = getCurrentSeason().toString();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    for (const leagueId of leagueIds) {
      try {
        const fixtures = await apiFetch('/fixtures', {
          date: dateStr,
          league: leagueId.toString(),
          season,
          status: 'NS',
        });
        allFixtures.push(...fixtures);
      } catch (e) {
        console.error(`API-Football: Failed league ${leagueId} on ${dateStr}:`, e);
      }
    }
  }

  return allFixtures;
}

/**
 * Get team statistics for a specific league and season
 */
export async function getTeamStats(teamId: number, leagueId: number, season?: number): Promise<any> {
  const s = season || getCurrentSeason();
  return apiFetch('/teams/statistics', {
    team: teamId.toString(),
    league: leagueId.toString(),
    season: s.toString(),
  });
}

/**
 * Get head-to-head between two teams
 */
export async function getH2H(team1Id: number, team2Id: number, last: number = 5): Promise<any[]> {
  return apiFetch('/fixtures/headtohead', {
    h2h: `${team1Id}-${team2Id}`,
    last: last.toString(),
  });
}

/**
 * Get API-Football's own predictions for a fixture
 */
export async function getPrediction(fixtureId: number): Promise<any> {
  const result = await apiFetch('/predictions', { fixture: fixtureId.toString() });
  return result.length > 0 ? result[0] : null;
}

/**
 * Get current standings for a league
 */
export async function getStandings(leagueId: number, season?: number): Promise<any> {
  const s = season || getCurrentSeason();
  return apiFetch('/standings', {
    league: leagueId.toString(),
    season: s.toString(),
  });
}
