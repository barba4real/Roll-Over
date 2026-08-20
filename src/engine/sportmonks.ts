/**
 * Sportmonks Football API v3 client
 * Free plan: Danish Superliga + Scottish Premiership
 * Features: xG, predictions, live scores, lineups, stats
 * Base URL: https://api.sportmonks.com/v3/football
 * Auth: API token as query param or header
 *
 * https://docs.sportmonks.com/football
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://api.sportmonks.com/v3/football';

let apiToken: string | null = null;

export function setSportmonksToken(token: string) {
  apiToken = token;
  localStorage.setItem('rollover_sportmonks_token', token);
}

export function getSportmonksToken(): string | null {
  if (!apiToken) {
    apiToken = localStorage.getItem('rollover_sportmonks_token');
  }
  return apiToken;
}

// Free plan leagues (Danish Superliga + Scottish Premiership)
export const SPORTMONKS_LEAGUES = [
  { id: 271, name: 'Danish Superliga', country: 'Denmark' },
  { id: 501, name: 'Scottish Premiership', country: 'Scotland' },
];

async function apiFetch(endpoint: string, params?: Record<string, string>): Promise<any> {
  const token = getSportmonksToken();
  if (!token) throw new Error('Sportmonks token not set. Get free token at sportmonks.com');

  let url = `${API_HOST}${endpoint}?api_token=${token}`;
  if (params) {
    Object.entries(params).forEach(([k, v]) => { url += `&${k}=${v}`; });
  }

  const result: any = await httpGet(url, { 'Accept': 'application/json' });

  if (result?.message && !result?.data) {
    throw new Error(`Sportmonks: ${result.message}`);
  }

  return result?.data || result;
}

/**
 * Get upcoming fixtures for free-tier leagues
 */
export async function getUpcomingFixtures(leagueId?: number, days: number = 7): Promise<SportmonksFixture[]> {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + days);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = endDate.toISOString().split('T')[0];

  const params: Record<string, string> = {
    'filters[between]': `${dateFrom},${dateTo}`,
    include: 'participants',
  };
  if (leagueId) params['filters[league_id]'] = leagueId.toString();

  try {
    const data = await apiFetch('/fixtures', params);
    if (!Array.isArray(data)) return [];

    return data.map((f: any) => {
      const participants = f.participants || [];
      const home = participants.find((p: any) => p.meta?.location === 'home');
      const away = participants.find((p: any) => p.meta?.location === 'away');

      return {
        id: f.id,
        homeTeam: home?.name || '',
        awayTeam: away?.name || '',
        homeTeamId: home?.id || 0,
        awayTeamId: away?.id || 0,
        kickOff: f.starting_at || '',
        league: SPORTMONKS_LEAGUES.find(l => l.id === f.league_id)?.name || '',
        leagueId: f.league_id,
        status: f.state?.short || 'NS',
      };
    }).filter(f => f.homeTeam && f.awayTeam);
  } catch (e) {
    console.error('Sportmonks fixtures failed:', e);
    return [];
  }
}

/**
 * Get all fixtures for free-plan leagues
 */
export async function getAllUpcomingEvents(days: number = 7): Promise<SportmonksFixture[]> {
  const results = await Promise.allSettled(
    SPORTMONKS_LEAGUES.map(league => getUpcomingFixtures(league.id, days))
  );

  const allFixtures: SportmonksFixture[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allFixtures.push(...result.value);
    }
  }
  return allFixtures;
}

/**
 * Get predictions for a fixture (xG-based)
 */
export async function getPredictions(fixtureId: number): Promise<SportmonksPrediction | null> {
  try {
    const data = await apiFetch(`/predictions/probabilities/fixtures/${fixtureId}`);
    if (!data || !Array.isArray(data) || data.length === 0) return null;

    const predictions = data[0]?.predictions || data;
    return {
      fixtureId,
      homeWinProb: findProb(predictions, 'home'),
      drawProb: findProb(predictions, 'draw'),
      awayWinProb: findProb(predictions, 'away'),
      over25Prob: findProb(predictions, 'over_2_5'),
      bttsProb: findProb(predictions, 'btts'),
    };
  } catch {
    return null;
  }
}

function findProb(predictions: any[], type: string): number {
  if (!Array.isArray(predictions)) return 0;
  const pred = predictions.find((p: any) =>
    p.type_id?.toString().includes(type) || p.type?.toLowerCase().includes(type)
  );
  return pred?.probability || pred?.value || 0;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SportmonksFixture {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number;
  awayTeamId: number;
  kickOff: string;
  league: string;
  leagueId: number;
  status: string;
}

export interface SportmonksPrediction {
  fixtureId: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over25Prob: number;
  bttsProb: number;
}
