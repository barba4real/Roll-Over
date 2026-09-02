/**
 * TheSportsDB API client
 * Truly free — no key required (test key "3" works)
 * No rate limits, fast responses
 * https://www.thesportsdb.com/api.php
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://www.thesportsdb.com/api/v1/json/3';

// League IDs for major football leagues (expanded for maximum coverage)
export const SPORTSDB_LEAGUES = [
  // Tier 1
  { id: '4328', name: 'Premier League' },
  { id: '4335', name: 'La Liga' },
  { id: '4332', name: 'Serie A' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4334', name: 'Ligue 1' },
  { id: '4337', name: 'Eredivisie' },
  { id: '4344', name: 'Primeira Liga' },
  { id: '4480', name: 'Champions League' },
  // Tier 2
  { id: '4329', name: 'Championship' },
  { id: '4394', name: 'Italian Serie B' },
  { id: '4401', name: 'French Ligue 2' },
  { id: '4399', name: 'German 2. Bundesliga' },
  { id: '4330', name: 'Scottish Premiership' },
  { id: '4355', name: 'Belgian Pro League' },
  { id: '4346', name: 'MLS' },
  { id: '4351', name: 'Brazilian Serie A' },
  { id: '4406', name: 'Argentine Liga Profesional' },
  { id: '4350', name: 'J-League' },
  { id: '4356', name: 'A-League' },
  // Cups
  { id: '4480', name: 'Champions League' },
  { id: '4485', name: 'DFB-Pokal' },
  { id: '4484', name: 'Coupe de France' },
  { id: '4506', name: 'Coppa Italia' },
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

// ─── Team-Level Queries (for Match Analysis) ─────────────────────────────────

/**
 * Search for a team by name. Returns the first matching team object (or null).
 * Free API: searchteams.php?t={name}
 */
export async function searchTeam(name: string): Promise<any | null> {
  try {
    const data = await apiFetch(`searchteams.php?t=${encodeURIComponent(name)}`);
    if (data?.teams && data.teams.length > 0) return data.teams[0];
    // Try shorter name if full name fails
    const shortName = name.replace(/\s+(FC|AFC|SC|CF)$/i, '').trim();
    if (shortName !== name) {
      const data2 = await apiFetch(`searchteams.php?t=${encodeURIComponent(shortName)}`);
      if (data2?.teams && data2.teams.length > 0) return data2.teams[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get last 5 events for a team by team ID.
 * Free API: eventslast.php?id={teamId}
 */
export async function getTeamLastEvents(teamId: string): Promise<any[]> {
  try {
    const data = await apiFetch(`eventslast.php?id=${teamId}`);
    return data?.results || [];
  } catch {
    return [];
  }
}

/**
 * Get next 5 upcoming events for a team by team ID.
 * Free API: eventsnext.php?id={teamId}
 */
export async function getTeamNextEvents(teamId: string): Promise<any[]> {
  try {
    const data = await apiFetch(`eventsnext.php?id=${teamId}`);
    return data?.events || [];
  } catch {
    return [];
  }
}

/**
 * Lookup a team by ID (full details).
 * Free API: lookupteam.php?id={teamId}
 */
export async function lookupTeam(teamId: string): Promise<any | null> {
  try {
    const data = await apiFetch(`lookupteam.php?id=${teamId}`);
    return data?.teams?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get team last events by searching for the team name first.
 * Convenience function that combines search + events lookup.
 * Returns parsed match results ready for form analysis.
 */
export async function getTeamRecentResults(teamName: string): Promise<{
  teamId: string | null;
  results: { date: string; home: string; away: string; homeScore: number; awayScore: number; league: string }[];
}> {
  const team = await searchTeam(teamName);
  if (!team?.idTeam) return { teamId: null, results: [] };

  const events = await getTeamLastEvents(team.idTeam);
  const results = events
    .filter((e: any) => e.intHomeScore !== null && e.intAwayScore !== null)
    .map((e: any) => ({
      date: e.dateEvent || '',
      home: e.strHomeTeam || '',
      away: e.strAwayTeam || '',
      homeScore: parseInt(e.intHomeScore) || 0,
      awayScore: parseInt(e.intAwayScore) || 0,
      league: e.strLeague || '',
    }));

  return { teamId: team.idTeam, results };
}

// ─── Full Season Results (Past League Events) ────────────────────────────────

/**
 * Get ALL past events for a league in the current season.
 * Returns up to 15 most recent completed matches.
 * Free API: eventspastleague.php?id={leagueId}
 */
export async function getLeaguePastResults(leagueId: string): Promise<any[]> {
  try {
    const data = await apiFetch(`eventspastleague.php?id=${leagueId}`);
    return data?.events || [];
  } catch {
    return [];
  }
}

/**
 * Get past results for ALL configured leagues.
 * Useful for keeping the local DB current with recent results.
 */
export async function getAllLeaguePastResults(): Promise<any[]> {
  const results = await Promise.allSettled(
    SPORTSDB_LEAGUES.map(async (league) => {
      const events = await getLeaguePastResults(league.id);
      return events.map(e => ({
        ...e,
        leagueName: league.name,
        leagueId: league.id,
      }));
    })
  );

  const allEvents: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') allEvents.push(...result.value);
  }
  return allEvents;
}

// ─── League Table / Standings ────────────────────────────────────────────────

/**
 * Get league standings/table for a specific league and season.
 * Free API: lookuptable.php?l={leagueId}&s={season}
 * Season format: "2025-2026"
 */
export async function getLeagueTable(leagueId: string, season?: string): Promise<any[]> {
  const s = season || getCurrentSeason();
  try {
    const data = await apiFetch(`lookuptable.php?l=${leagueId}&s=${s}`);
    return data?.table || [];
  } catch {
    return [];
  }
}

/**
 * Get current season string for TheSportsDB format (e.g. "2025-2026")
 */
function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

// ─── Event Details ───────────────────────────────────────────────────────────

/**
 * Lookup full event details by event ID.
 * Returns detailed match info: scores, venue, attendance, stats, etc.
 * Free API: lookupevent.php?id={eventId}
 */
export async function lookupEvent(eventId: string): Promise<any | null> {
  try {
    const data = await apiFetch(`lookupevent.php?id=${eventId}`);
    return data?.events?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get events on a specific date for a league.
 * Free API: eventsday.php?d=YYYY-MM-DD&l={leagueId} (may require premium)
 * Fallback: use eventspastleague or eventsnextleague
 */
export async function getEventsOnDate(date: string, leagueId?: string): Promise<any[]> {
  try {
    let url = `eventsday.php?d=${date}`;
    if (leagueId) url += `&l=${leagueId}`;
    const data = await apiFetch(url);
    return data?.events || [];
  } catch {
    return [];
  }
}

// ─── Season Lookup ───────────────────────────────────────────────────────────

/**
 * Get all seasons for a league.
 * Free API: search_all_seasons.php?id={leagueId}
 */
export async function getLeagueSeasons(leagueId: string): Promise<string[]> {
  try {
    const data = await apiFetch(`search_all_seasons.php?id=${leagueId}`);
    if (!data?.seasons) return [];
    return data.seasons.map((s: any) => s.strSeason);
  } catch {
    return [];
  }
}

// ─── Round/Matchday Events ───────────────────────────────────────────────────

/**
 * Get events for a specific round/matchday.
 * Free API: eventsround.php?id={leagueId}&r={round}&s={season}
 */
export async function getEventsByRound(leagueId: string, round: number, season?: string): Promise<any[]> {
  const s = season || getCurrentSeason();
  try {
    const data = await apiFetch(`eventsround.php?id=${leagueId}&r=${round}&s=${s}`);
    return data?.events || [];
  } catch {
    return [];
  }
}

// ─── Bulk Data Fetch for DB Population ───────────────────────────────────────

/**
 * Fetch recent results from ALL leagues and convert to HistoricalMatch format.
 * Combines past events from all 24 configured leagues.
 * Used by the data sync system to keep the local DB current.
 */
export async function fetchAllRecentResults(): Promise<import('./football-data-uk').HistoricalMatch[]> {
  const allEvents = await getAllLeaguePastResults();
  const matches: import('./football-data-uk').HistoricalMatch[] = [];

  for (const e of allEvents) {
    const homeScore = parseInt(e.intHomeScore);
    const awayScore = parseInt(e.intAwayScore);
    if (isNaN(homeScore) || isNaN(awayScore)) continue;

    matches.push({
      division: e.leagueId || '',
      date: e.dateEvent || '',
      time: e.strTime || '',
      homeTeam: e.strHomeTeam || '',
      awayTeam: e.strAwayTeam || '',
      ftHomeGoals: homeScore,
      ftAwayGoals: awayScore,
      ftResult: homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D',
      htHomeGoals: null,
      htAwayGoals: null,
      htResult: null,
      homeShots: null,
      awayShots: null,
      homeShotsOnTarget: null,
      awayShotsOnTarget: null,
      homeCorners: null,
      awayCorners: null,
      homeYellows: parseInt(e.intHomeYellowCards) || null,
      awayYellows: parseInt(e.intAwayYellowCards) || null,
      homeReds: parseInt(e.intHomeRedCards) || null,
      awayReds: parseInt(e.intAwayRedCards) || null,
      homeFouls: null,
      awayFouls: null,
      season: e.strSeason || getCurrentSeason(),
      leagueId: e.leagueName || '',
    });
  }

  return matches;
}
