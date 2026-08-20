/**
 * ESPN API client (unofficial, public endpoints)
 * No key needed. No documented rate limits.
 * Endpoint: site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard
 *
 * Notes:
 * - Date format: YYYYMMDD (no dashes)
 * - Returns events for the specified date
 * - If no date specified, returns today's/upcoming events
 * - Response structure: { events: [{ id, date, competitions: [{ competitors }] }] }
 */

import { httpGet } from '../lib/http';

const ESPN_DIRECT = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

/**
 * Get the ESPN API base URL.
 * Uses Cloudflare Worker proxy if configured (bypasses geo-restrictions).
 * Falls back to direct ESPN URL.
 */
function getApiHost(): string {
  const proxyUrl = localStorage.getItem('rollover_espn_proxy_url');
  if (proxyUrl) return proxyUrl.replace(/\/$/, ''); // Remove trailing slash
  return ESPN_DIRECT;
}

// ESPN league slugs — these are the path segments after /soccer/
export const ESPN_LEAGUES = [
  { slug: 'eng.1', name: 'Premier League' },
  { slug: 'esp.1', name: 'La Liga' },
  { slug: 'ger.1', name: 'Bundesliga' },
  { slug: 'ita.1', name: 'Serie A' },
  { slug: 'fra.1', name: 'Ligue 1' },
  { slug: 'ned.1', name: 'Eredivisie' },
  { slug: 'por.1', name: 'Primeira Liga' },
  { slug: 'uefa.champions', name: 'Champions League' },
  { slug: 'eng.2', name: 'Championship' },
];

async function apiFetch(endpoint: string): Promise<any> {
  const url = `${getApiHost()}/${endpoint}`;
  try {
    const result: any = await httpGet(url, { 'Accept': 'application/json' });
    return result;
  } catch (e) {
    console.error(`ESPN fetch failed: ${url}`, e);
    return null;
  }
}

/**
 * Format date as YYYYMMDD for ESPN API
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Get scoreboard (fixtures/results) for a specific league and date
 */
export async function getScoreboard(leagueSlug: string, date?: Date): Promise<any[]> {
  let endpoint = `${leagueSlug}/scoreboard`;
  if (date) endpoint += `?dates=${formatDate(date)}`;
  const data = await apiFetch(endpoint);
  return data?.events || [];
}

/**
 * Parse an ESPN event into our common format
 */
function parseEvent(event: any, leagueName: string, leagueSlug: string): any | null {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const competitors = competition.competitors || [];
  const home = competitors.find((c: any) => c.homeAway === 'home');
  const away = competitors.find((c: any) => c.homeAway === 'away');

  if (!home || !away) return null;

  return {
    id: event.id || event.uid,
    homeTeam: home.team?.displayName || home.team?.shortDisplayName || home.team?.name || '',
    awayTeam: away.team?.displayName || away.team?.shortDisplayName || away.team?.name || '',
    kickOff: event.date || '',
    leagueName,
    leagueSlug,
    status: event.status?.type?.state || 'pre', // pre, in, post
    homeScore: home.score ? parseInt(home.score) : null,
    awayScore: away.score ? parseInt(away.score) : null,
  };
}

/**
 * Get all upcoming events across selected leagues for a date range.
 * Fetches in parallel per league (no rate limit on ESPN).
 */
export async function getAllUpcomingEvents(leagueSlugs?: string[], days: number = 7): Promise<any[]> {
  const leagues = leagueSlugs
    ? ESPN_LEAGUES.filter(l => leagueSlugs.includes(l.slug))
    : ESPN_LEAGUES;

  const today = new Date();
  const dates: Date[] = [];
  for (let i = 0; i < Math.min(days, 14); i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  // Fetch all leagues × dates in parallel
  const fetches = leagues.flatMap(league =>
    dates.map(async (date) => {
      try {
        const events = await getScoreboard(league.slug, date);
        return events
          .map(e => parseEvent(e, league.name, league.slug))
          .filter((e): e is NonNullable<typeof e> => e !== null);
      } catch {
        return [];
      }
    })
  );

  const results = await Promise.allSettled(fetches);
  const allEvents: any[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  // Deduplicate by homeTeam + awayTeam + date
  const seen = new Set<string>();
  return allEvents.filter(e => {
    const key = `${e.homeTeam.toLowerCase()}|${e.awayTeam.toLowerCase()}|${e.kickOff?.split('T')[0]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Get live/finished results for today (for auto-settlement)
 */
export async function getTodayResults(leagueSlugs?: string[]): Promise<any[]> {
  const leagues = leagueSlugs
    ? ESPN_LEAGUES.filter(l => leagueSlugs.includes(l.slug))
    : ESPN_LEAGUES;

  const today = new Date();
  const fetches = leagues.map(async (league) => {
    try {
      const events = await getScoreboard(league.slug, today);
      return events
        .map(e => parseEvent(e, league.name, league.slug))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .filter(e => e.status === 'post' || e.status === 'in'); // Finished or live
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(fetches);
  const allEvents: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') allEvents.push(...result.value);
  }
  return allEvents;
}
