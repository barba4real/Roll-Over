/**
 * ESPN API client (unofficial, public endpoints)
 * No key needed. No documented rate limits.
 *
 * Working Domains (verified):
 *   - cdn.espn.com              → Scoreboard, game packages (xhr=1)
 *   - sports.core.api.espn.com  → Events, odds, standings, athletes (v2/v3)
 *   - site.web.api.espn.com     → Standings, search, athlete profiles
 *
 * BLOCKED (403 from this region):
 *   - site.api.espn.com         → NOT USED
 *
 * Endpoint patterns:
 *   CDN Scoreboard:  https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league={slug}&dates=YYYYMMDD
 *   Core Events:     https://sports.core.api.espn.com/v2/sports/soccer/leagues/{slug}/events
 *   Core Odds:       https://sports.core.api.espn.com/v2/sports/soccer/leagues/{slug}/events/{id}/competitions/{id}/odds
 *   Standings:       https://site.web.api.espn.com/apis/v2/sports/soccer/{slug}/standings
 */

import { httpGet, httpGetDirect } from '../lib/http';

// ─── Domains ─────────────────────────────────────────────────────────────────

const CDN_HOST = 'https://cdn.espn.com/core/soccer';
const CORE_API = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
const WEB_API = 'https://site.web.api.espn.com/apis/v2/sports/soccer';

// ─── League Registry ─────────────────────────────────────────────────────────

export interface EspnLeague {
  slug: string;
  name: string;
  region: string;
  tier: 1 | 2 | 3; // 1=top leagues (always fetch), 2=secondary, 3=cups/international
}

export const ESPN_LEAGUES: EspnLeague[] = [
  // ─── Tier 1: Major Leagues (always fetch) ──────────────────────────────────
  { slug: 'eng.1', name: 'Premier League', region: 'England', tier: 1 },
  { slug: 'esp.1', name: 'La Liga', region: 'Spain', tier: 1 },
  { slug: 'ger.1', name: 'Bundesliga', region: 'Germany', tier: 1 },
  { slug: 'ita.1', name: 'Serie A', region: 'Italy', tier: 1 },
  { slug: 'fra.1', name: 'Ligue 1', region: 'France', tier: 1 },
  { slug: 'ned.1', name: 'Eredivisie', region: 'Netherlands', tier: 1 },
  { slug: 'por.1', name: 'Primeira Liga', region: 'Portugal', tier: 1 },
  { slug: 'usa.1', name: 'MLS', region: 'USA', tier: 1 },

  // ─── Tier 2: Secondary Leagues ─────────────────────────────────────────────
  { slug: 'eng.2', name: 'Championship', region: 'England', tier: 2 },
  { slug: 'esp.2', name: 'La Liga 2', region: 'Spain', tier: 2 },
  { slug: 'ger.2', name: '2. Bundesliga', region: 'Germany', tier: 2 },
  { slug: 'ita.2', name: 'Serie B', region: 'Italy', tier: 2 },
  { slug: 'fra.2', name: 'Ligue 2', region: 'France', tier: 2 },
  { slug: 'sco.1', name: 'Scottish Premiership', region: 'Scotland', tier: 2 },
  { slug: 'bel.1', name: 'Belgian Pro League', region: 'Belgium', tier: 2 },
  { slug: 'tur.1', name: 'Turkish Super Lig', region: 'Turkey', tier: 2 },
  { slug: 'gre.1', name: 'Greek Super League', region: 'Greece', tier: 2 },
  { slug: 'aut.1', name: 'Austrian Bundesliga', region: 'Austria', tier: 2 },
  { slug: 'den.1', name: 'Danish Superliga', region: 'Denmark', tier: 2 },
  { slug: 'nor.1', name: 'Norwegian Eliteserien', region: 'Norway', tier: 2 },
  { slug: 'swe.1', name: 'Swedish Allsvenskan', region: 'Sweden', tier: 2 },
  { slug: 'rus.1', name: 'Russian Premier League', region: 'Russia', tier: 2 },
  { slug: 'ksa.1', name: 'Saudi Pro League', region: 'Saudi Arabia', tier: 2 },
  { slug: 'jpn.1', name: 'J.League', region: 'Japan', tier: 2 },
  { slug: 'aus.1', name: 'A-League Men', region: 'Australia', tier: 2 },
  { slug: 'arg.1', name: 'Liga Profesional', region: 'Argentina', tier: 2 },
  { slug: 'bra.1', name: 'Serie A', region: 'Brazil', tier: 2 },
  { slug: 'mex.1', name: 'Liga MX', region: 'Mexico', tier: 2 },
  { slug: 'col.1', name: 'Primera A', region: 'Colombia', tier: 2 },
  { slug: 'rsa.1', name: 'SA Premiership', region: 'South Africa', tier: 2 },
  { slug: 'ind.1', name: 'Indian Super League', region: 'India', tier: 2 },
  { slug: 'chn.1', name: 'Chinese Super League', region: 'China', tier: 2 },

  // ─── Tier 3: Cups & International ─────────────────────────────────────────
  { slug: 'uefa.champions', name: 'Champions League', region: 'Europe', tier: 3 },
  { slug: 'uefa.europa', name: 'Europa League', region: 'Europe', tier: 3 },
  { slug: 'uefa.europa.conf', name: 'Conference League', region: 'Europe', tier: 3 },
  { slug: 'conmebol.libertadores', name: 'Copa Libertadores', region: 'South America', tier: 3 },
  { slug: 'conmebol.sudamericana', name: 'Copa Sudamericana', region: 'South America', tier: 3 },
  { slug: 'concacaf.champions', name: 'Concacaf Champions Cup', region: 'North America', tier: 3 },
  { slug: 'afc.champions', name: 'AFC Champions League', region: 'Asia', tier: 3 },
  { slug: 'caf.champions', name: 'CAF Champions League', region: 'Africa', tier: 3 },
  { slug: 'eng.fa', name: 'FA Cup', region: 'England', tier: 3 },
  { slug: 'eng.league_cup', name: 'Carabao Cup', region: 'England', tier: 3 },
  { slug: 'esp.copa_del_rey', name: 'Copa del Rey', region: 'Spain', tier: 3 },
  { slug: 'ger.dfb_pokal', name: 'DFB-Pokal', region: 'Germany', tier: 3 },
  { slug: 'ita.coppa_italia', name: 'Coppa Italia', region: 'Italy', tier: 3 },
  { slug: 'fra.coupe_de_france', name: 'Coupe de France', region: 'France', tier: 3 },
  { slug: 'fifa.world', name: 'FIFA World Cup', region: 'International', tier: 3 },
  { slug: 'uefa.euro', name: 'UEFA Euro', region: 'Europe', tier: 3 },
  { slug: 'conmebol.america', name: 'Copa America', region: 'South America', tier: 3 },
  { slug: 'caf.nations', name: 'Africa Cup of Nations', region: 'Africa', tier: 3 },
  { slug: 'concacaf.gold', name: 'Concacaf Gold Cup', region: 'North America', tier: 3 },
  { slug: 'fifa.worldq.uefa', name: 'WCQ - UEFA', region: 'Europe', tier: 3 },
  { slug: 'fifa.worldq.caf', name: 'WCQ - CAF', region: 'Africa', tier: 3 },
  { slug: 'fifa.worldq.afc', name: 'WCQ - AFC', region: 'Asia', tier: 3 },
  { slug: 'fifa.worldq.concacaf', name: 'WCQ - Concacaf', region: 'North America', tier: 3 },
  { slug: 'fifa.worldq.conmebol', name: 'WCQ - CONMEBOL', region: 'South America', tier: 3 },
  { slug: 'uefa.nations', name: 'UEFA Nations League', region: 'Europe', tier: 3 },
  { slug: 'usa.nwsl', name: 'NWSL', region: 'USA', tier: 3 },
];

// ─── Error Tracking ──────────────────────────────────────────────────────────

export interface EspnDiagnostics {
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  cdnEndpointWorking: boolean;
  coreApiWorking: boolean;
  totalRequests: number;
  totalFailures: number;
}

const diagnostics: EspnDiagnostics = {
  lastAttempt: null,
  lastSuccess: null,
  lastError: null,
  consecutiveFailures: 0,
  cdnEndpointWorking: true,
  coreApiWorking: true,
  totalRequests: 0,
  totalFailures: 0,
};

export function getEspnDiagnostics(): EspnDiagnostics {
  return { ...diagnostics };
}

export function resetEspnDiagnostics(): void {
  diagnostics.lastAttempt = null;
  diagnostics.lastSuccess = null;
  diagnostics.lastError = null;
  diagnostics.consecutiveFailures = 0;
  diagnostics.cdnEndpointWorking = true;
  diagnostics.coreApiWorking = true;
  diagnostics.totalRequests = 0;
  diagnostics.totalFailures = 0;
}

// ─── Retry & Fetch Logic ─────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry + exponential backoff.
 * Uses direct requests (bypasses proxy) since ESPN CDN works without proxy.
 * Returns null on complete failure (after all retries exhausted).
 */
async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<any | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Use direct request with NO custom headers — ESPN CDN works best with defaults.
      // The Rust client already sets User-Agent. Extra headers can trigger CDN bot detection.
      const result = await httpGetDirect(url, {});

      // Check if response indicates an error
      if (result?.error && !result?.events && !result?.content) {
        console.warn(`[ESPN] Server error from ${url}: ${result.error}`);
        return null;
      }

      return result;
    } catch (e: any) {
      const errMsg = e?.message || e?.toString() || 'Unknown error';
      const isLastAttempt = attempt === retries - 1;

      // Don't retry on 4xx client errors (except 429 rate limit)
      if (errMsg.includes('HTTP_4') && !errMsg.includes('HTTP_429')) {
        console.warn(`[ESPN] Client error (no retry): ${errMsg}`);
        return null;
      }

      if (!isLastAttempt) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[ESPN] Attempt ${attempt + 1}/${retries} failed: ${errMsg}. Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error(`[ESPN] All ${retries} attempts failed for ${url}: ${errMsg}`);
      }
    }
  }
  return null;
}

// ─── Date Helpers ────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

// ─── CDN Scoreboard ──────────────────────────────────────────────────────────

/**
 * Fetch scoreboard from cdn.espn.com (the only reliable scoreboard endpoint).
 * Response structure: { content: { sbData: { events: [...] } } }
 */
async function fetchCdnScoreboard(leagueSlug: string, dateStr?: string): Promise<any[]> {
  diagnostics.lastAttempt = new Date().toISOString();
  diagnostics.totalRequests++;

  let url = `${CDN_HOST}/scoreboard?xhr=1&league=${leagueSlug}`;
  if (dateStr) url += `&dates=${dateStr}`;

  const result = await fetchWithRetry(url, MAX_RETRIES);

  if (result) {
    // CDN nests data at content.sbData.events
    const events = result?.content?.sbData?.events
      || result?.events
      || result?.sports?.[0]?.leagues?.[0]?.events;

    if (events && Array.isArray(events)) {
      diagnostics.cdnEndpointWorking = true;
      diagnostics.lastSuccess = new Date().toISOString();
      diagnostics.consecutiveFailures = 0;
      return events;
    }

    // Valid response but no events array — empty game day
    if (result?.content?.sbData) {
      diagnostics.cdnEndpointWorking = true;
      diagnostics.lastSuccess = new Date().toISOString();
      diagnostics.consecutiveFailures = 0;
      return [];
    }
  }

  // CDN failed
  diagnostics.cdnEndpointWorking = false;
  diagnostics.consecutiveFailures++;
  diagnostics.totalFailures++;
  diagnostics.lastError = `CDN scoreboard failed for ${leagueSlug} (date: ${dateStr || 'today'})`;
  console.error(`[ESPN] ${diagnostics.lastError}`);
  return [];
}

// ─── Core API Helpers ────────────────────────────────────────────────────────

/**
 * Fetch events list from sports.core.api.espn.com (backup for scoreboard data).
 * This returns paginated $ref links, not full event objects — heavier but more detailed.
 */
async function fetchCoreEvents(leagueSlug: string, limit: number = 50): Promise<any | null> {
  const url = `${CORE_API}/${leagueSlug}/events?limit=${limit}`;
  const result = await fetchWithRetry(url, 2);
  if (result) {
    diagnostics.coreApiWorking = true;
  }
  return result;
}

/**
 * Fetch standings from site.web.api.espn.com
 */
export async function getStandings(leagueSlug: string): Promise<any | null> {
  const url = `${WEB_API}/${leagueSlug}/standings`;
  return fetchWithRetry(url, 2);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get scoreboard (fixtures/results) for a specific league and date.
 */
export async function getScoreboard(leagueSlug: string, date?: Date): Promise<any[]> {
  const dateStr = date ? formatDate(date) : undefined;
  return fetchCdnScoreboard(leagueSlug, dateStr);
}

/**
 * Parse a CDN event into our common format.
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
    venue: event.competitions?.[0]?.venue?.fullName || null,
  };
}

/**
 * Get all upcoming events across selected leagues for a date range.
 * Concurrency-limited to avoid overwhelming CDN.
 */
export async function getAllUpcomingEvents(leagueSlugs?: string[], days: number = 7): Promise<any[]> {
  const leagues = leagueSlugs
    ? ESPN_LEAGUES.filter(l => leagueSlugs.includes(l.slug))
    : ESPN_LEAGUES.filter(l => l.tier === 1); // Default: Tier 1 only for speed

  const today = new Date();
  const dates: Date[] = [];
  for (let i = 0; i < Math.min(days, 14); i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  const CONCURRENCY = 6;
  const allEvents: any[] = [];
  const tasks = leagues.flatMap(league =>
    dates.map(date => ({ league, date }))
  );

  // Process in batches
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ league, date }) => {
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

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allEvents.push(...result.value);
      }
    }

    // Small delay between batches
    if (i + CONCURRENCY < tasks.length) {
      await sleep(50);
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
 * Get live/finished results for today (for auto-settlement).
 */
export async function getTodayResults(leagueSlugs?: string[]): Promise<any[]> {
  const leagues = leagueSlugs
    ? ESPN_LEAGUES.filter(l => leagueSlugs.includes(l.slug))
    : ESPN_LEAGUES.filter(l => l.tier === 1);

  const today = new Date();
  const results = await Promise.allSettled(
    leagues.map(async (league) => {
      try {
        const events = await getScoreboard(league.slug, today);
        return events
          .map(e => parseEvent(e, league.name, league.slug))
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .filter(e => e.status === 'post' || e.status === 'in');
      } catch {
        return [];
      }
    })
  );

  const allEvents: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') allEvents.push(...result.value);
  }
  return allEvents;
}

/**
 * Get leagues by tier — useful for UI league selection.
 */
export function getLeaguesByTier(tier?: 1 | 2 | 3): EspnLeague[] {
  if (tier) return ESPN_LEAGUES.filter(l => l.tier === tier);
  return [...ESPN_LEAGUES];
}

/**
 * Search leagues by name/slug/region.
 */
export function searchLeagues(query: string): EspnLeague[] {
  const q = query.toLowerCase();
  return ESPN_LEAGUES.filter(l =>
    l.name.toLowerCase().includes(q) ||
    l.slug.toLowerCase().includes(q) ||
    l.region.toLowerCase().includes(q)
  );
}

/**
 * Quick connectivity check — tests CDN and Core API.
 */
export async function testEspnConnection(): Promise<{
  reachable: boolean;
  cdnOk: boolean;
  coreApiOk: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  let cdnOk = false;
  let coreApiOk = false;
  let error: string | undefined;

  // Test CDN
  try {
    const result = await fetchWithRetry(`${CDN_HOST}/scoreboard?xhr=1&league=eng.1`, 1);
    cdnOk = !!(result?.content?.sbData || result?.events);
  } catch (e: any) {
    error = e?.message || 'CDN endpoint unreachable';
  }

  // Test Core API
  try {
    const result = await fetchWithRetry(`${CORE_API}/eng.1/events?limit=1`, 1);
    coreApiOk = !!(result?.items || result?.count !== undefined);
  } catch (e: any) {
    if (!error) error = e?.message || 'Core API unreachable';
  }

  return {
    reachable: cdnOk || coreApiOk,
    cdnOk,
    coreApiOk,
    latencyMs: Date.now() - start,
    error: (!cdnOk && !coreApiOk) ? (error || 'All ESPN endpoints unreachable') : undefined,
  };
}

// ─── Schedule Endpoint (returns full fixture list, not just 1 per day) ────────

const CDN_SCHEDULE = 'https://cdn.espn.com/core/soccer/schedule';

/**
 * Fetch the full schedule for a league using ESPN CDN schedule endpoint.
 * This returns ALL upcoming fixtures (multiple per day) unlike the scoreboard
 * which only returns 1 per day for smaller leagues.
 *
 * URL: https://cdn.espn.com/core/soccer/schedule?xhr=1&league={slug}
 * Response: { content: { schedule: { "YYYYMMDD": { games: [...] } } } }
 */
export async function getLeagueSchedule(leagueSlug: string): Promise<any[]> {
  const url = `${CDN_SCHEDULE}?xhr=1&league=${leagueSlug}`;

  try {
    const result: any = await httpGetDirect(url, {});
    const schedule = result?.content?.schedule;
    if (!schedule) return [];

    const allGames: any[] = [];
    const dates = Object.keys(schedule);

    for (const date of dates) {
      const games = schedule[date]?.games || [];
      for (const game of games) {
        const competition = game.competitions?.[0];
        if (!competition) continue;

        const competitors = competition.competitors || [];
        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        // Find league name from our ESPN_LEAGUES
        const leagueInfo = ESPN_LEAGUES.find(l => l.slug === leagueSlug);

        allGames.push({
          id: game.id || game.uid,
          homeTeam: home.team?.displayName || home.team?.shortDisplayName || home.team?.name || '',
          awayTeam: away.team?.displayName || away.team?.shortDisplayName || away.team?.name || '',
          kickOff: game.date || '',
          leagueName: leagueInfo?.name || game.league?.abbreviation || '',
          leagueSlug,
          status: game.status?.type?.state || 'pre',
        });
      }
    }

    return allGames;
  } catch (e) {
    console.warn(`[ESPN] Schedule fetch failed for ${leagueSlug}:`, e);
    return [];
  }
}

/**
 * Fetch full schedules for multiple leagues in parallel.
 * Uses the schedule endpoint which returns all fixtures (not just 1 per day).
 * Much faster than scoreboard (1 request per league, not per league×day).
 */
export async function getAllScheduledFixtures(leagueSlugs: string[]): Promise<any[]> {
  const results = await Promise.allSettled(
    leagueSlugs.map(slug => getLeagueSchedule(slug))
  );

  const allFixtures: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allFixtures.push(...result.value);
    }
  }

  return allFixtures;
}
