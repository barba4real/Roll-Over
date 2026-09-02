/**
 * AllSportDB API Client
 *
 * Data source: https://allsportdb.com
 * REST API with free tier: 10,000 calls/month, current + future events.
 *
 * Authentication: Bearer token in Authorization header.
 * Main endpoint: /calendar (event/competition discovery, not individual matches)
 *
 * Free tier limitations:
 * - 10 items per response (use page param for pagination)
 * - 30-day renewable key (auto-renew from their settings page)
 * - Current and future data only (no historical)
 *
 * Value for Roll-Over: Supplementary competition/event discovery.
 * Shows which leagues/competitions are active this week.
 * Does NOT provide individual match fixtures (use ESPN/TheSportsDB for that).
 *
 * API docs: https://api.allsportdb.com/v3/swagger/ui
 * OpenAPI spec: https://api.allsportdb.com/v3/swagger.json
 */

import { httpGetDirect } from '../lib/http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AllSportEvent {
  id: number;
  name: string;
  year: number | null;
  date: string;              // Human-readable date range
  dateFrom: string;          // ISO datetime
  dateTo: string;            // ISO datetime
  sport: string;
  sportId: number | null;
  competition: string;
  competitionId: number | null;
  continent: string;
  continentId: number | null;
  url: string | null;
  webUrl: string | null;
  logoUrl: string | null;
  locations: { name: string; country: string }[];
}

export interface AllSportCompetition {
  id: number;
  name: string;
  ageGroup: string | null;
  gender: string | null;
  continent: string | null;
  sport: string | null;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = 'https://api.allsportdb.com/v3';
const STORAGE_KEY = 'rollover_allsportdb_key';

/**
 * Get the stored AllSportDB API key (bearer token).
 */
export function getAllSportDbKey(): string | null {
  return localStorage.getItem(STORAGE_KEY) || null;
}

/**
 * Set the AllSportDB API key.
 */
export function setAllSportDbKey(key: string) {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ─── API Fetching ────────────────────────────────────────────────────────────

/**
 * Make a request to the AllSportDB API.
 * Uses Bearer token authentication.
 * Returns null if no key is configured or the request fails.
 */
async function apiFetch(endpoint: string, params: Record<string, string> = {}): Promise<any | null> {
  const key = getAllSportDbKey();
  if (!key) {
    console.warn('[AllSportDB] No API key configured');
    return null;
  }

  const queryParams = new URLSearchParams(params);
  const url = `${API_BASE}${endpoint}?${queryParams.toString()}`;

  try {
    const result = await httpGetDirect(url, {
      'Authorization': `Bearer ${key}`,
      'Accept': 'application/json',
    });
    return result;
  } catch (e: any) {
    console.error(`[AllSportDB] Request failed: ${e.message || e}`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get football events/competitions happening this week.
 * Uses the /calendar endpoint with sport=Football and week=0.
 */
export async function getThisWeekFootball(page: number = 1): Promise<AllSportEvent[]> {
  const data = await apiFetch('/calendar', {
    sport: 'Football',
    week: '0',
    page: page.toString(),
  });

  if (!data || !Array.isArray(data)) return [];
  return data.map(parseEvent).filter((e): e is AllSportEvent => e !== null);
}

/**
 * Get football events for next week.
 */
export async function getNextWeekFootball(page: number = 1): Promise<AllSportEvent[]> {
  const data = await apiFetch('/calendar', {
    sport: 'Football',
    week: '1',
    page: page.toString(),
  });

  if (!data || !Array.isArray(data)) return [];
  return data.map(parseEvent).filter((e): e is AllSportEvent => e !== null);
}

/**
 * Get football events for a date range.
 */
export async function getFootballByDateRange(
  dateFrom: string,
  dateTo: string,
  page: number = 1
): Promise<AllSportEvent[]> {
  const data = await apiFetch('/calendar', {
    sport: 'Football',
    dateFrom,
    dateTo,
    page: page.toString(),
  });

  if (!data || !Array.isArray(data)) return [];
  return data.map(parseEvent).filter((e): e is AllSportEvent => e !== null);
}

/**
 * Get list of football competitions.
 */
export async function getFootballCompetitions(page: number = 1): Promise<AllSportCompetition[]> {
  const data = await apiFetch('/competitions', {
    sport: 'Football',
    page: page.toString(),
  });

  if (!data || !Array.isArray(data)) return [];
  return data.map((raw: any) => ({
    id: raw.id || 0,
    name: raw.name || '',
    ageGroup: raw.ageGroup || null,
    gender: raw.gender || null,
    continent: raw.continent || null,
    sport: raw.sport || null,
  }));
}

/**
 * Get all active football events across multiple pages.
 * Fetches up to maxPages (default: 5 = ~50 events) to conserve quota.
 */
export async function getAllActiveFootball(maxPages: number = 5): Promise<AllSportEvent[]> {
  const allEvents: AllSportEvent[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const events = await getThisWeekFootball(page);
    if (events.length === 0) break;
    allEvents.push(...events);
    if (events.length < 10) break; // Less than page size = no more data
  }

  return allEvents;
}

/**
 * Test the API connection. Returns true if key is valid and API responds.
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const key = getAllSportDbKey();
  if (!key) return { ok: false, error: 'No API key configured' };

  const data = await apiFetch('/sports', { name: 'Football' });
  if (data === null) return { ok: false, error: 'Request failed — check your key' };
  return { ok: true };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseEvent(raw: any): AllSportEvent | null {
  if (!raw || !raw.name) return null;

  const locations: { name: string; country: string }[] = [];
  if (Array.isArray(raw.location)) {
    for (const loc of raw.location) {
      if (loc.name) {
        locations.push({ name: loc.locations?.[0]?.name || '', country: loc.name || '' });
      }
    }
  }

  return {
    id: raw.id || 0,
    name: raw.name || '',
    year: raw.year || null,
    date: raw.date || '',
    dateFrom: raw.dateFrom || '',
    dateTo: raw.dateTo || '',
    sport: raw.sport || 'Football',
    sportId: raw.sportId || null,
    competition: raw.competition || '',
    competitionId: raw.competitionId || null,
    continent: raw.continent || '',
    continentId: raw.continentId || null,
    url: raw.url || null,
    webUrl: raw.webUrl || null,
    logoUrl: raw.logoUrl || raw.logoSmallUrl || null,
    locations,
  };
}
