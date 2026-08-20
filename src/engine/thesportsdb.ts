/**
 * TheSportsDB API client
 * Truly free — no key required (test key "3" works)
 * No rate limits, fast responses
 * https://www.thesportsdb.com/api.php
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://www.thesportsdb.com/api/v1/json/3';

// League IDs for major football leagues
export const SPORTSDB_LEAGUES = [
  { id: '4328', name: 'Premier League' },
  { id: '4335', name: 'La Liga' },
  { id: '4332', name: 'Serie A' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4334', name: 'Ligue 1' },
  { id: '4337', name: 'Eredivisie' },
  { id: '4344', name: 'Primeira Liga' },
  { id: '4480', name: 'Champions League' },
  { id: '4329', name: 'Championship' },
];

async function apiFetch(endpoint: string): Promise<any> {
  const url = `${API_HOST}/${endpoint}`;
  const result: any = await httpGet(url, {});
  return result;
}

/**
 * Get next 15 upcoming events for a league
 */
export async function getNextEvents(leagueId: string): Promise<any[]> {
  const data = await apiFetch(`eventsnextleague.php?id=${leagueId}`);
  return data?.events || [];
}

/**
 * Get last 15 results for a league (for form analysis)
 */
export async function getLastEvents(leagueId: string): Promise<any[]> {
  const data = await apiFetch(`eventspastleague.php?id=${leagueId}`);
  return data?.events || [];
}

/**
 * Get all upcoming events across selected leagues
 */
export async function getAllUpcomingEvents(leagueIds?: string[]): Promise<any[]> {
  const leagues = leagueIds
    ? SPORTSDB_LEAGUES.filter(l => leagueIds.includes(l.id))
    : SPORTSDB_LEAGUES;

  // Fetch all leagues in parallel (no rate limit on TheSportsDB)
  const results = await Promise.allSettled(
    leagues.map(async (league) => {
      const events = await getNextEvents(league.id);
      return events.map(e => ({
        ...e,
        leagueName: league.name,
        leagueId: league.id,
      }));
    })
  );

  const allEvents: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  return allEvents;
}
