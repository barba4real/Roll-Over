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
