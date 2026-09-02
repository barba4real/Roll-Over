/**
 * OpenFootball (football.json) Engine
 *
 * Data source: https://github.com/openfootball/football.json
 * Served via GitHub raw content (JSON format, no API key required).
 *
 * Coverage: Major European leagues, some international competitions.
 * Provides match results including half-time and full-time scores.
 *
 * Update frequency: Community-maintained, typically updated within a few days
 * of match completion. May lag behind during busy fixture weeks.
 *
 * Limitations:
 * - No detailed match stats (shots, corners, cards) — only scores.
 * - Team names use full official names (e.g. "Manchester United FC") which
 *   differ from other sources. Use the team-database normalizer for matching.
 * - Not all seasons are available for all leagues. Coverage is best for
 *   top European leagues from 2014-15 onward.
 * - Rate limiting: GitHub raw CDN has generous limits but aggressive bulk
 *   fetching should be throttled.
 *
 * URL pattern:
 *   https://raw.githubusercontent.com/openfootball/football.json/master/{season}/{leagueCode}.json
 */

import { httpGetDirect } from '../lib/http';
import type { HistoricalMatch } from './football-data-uk';

// ─── League Mapping ──────────────────────────────────────────────────────────

export interface OpenFootballLeague {
  leagueId: string;      // Matches league-registry ID
  code: string;          // OpenFootball league code (e.g. "en.1")
  name: string;          // Human-readable name
}

/**
 * Maps league-registry IDs to openfootball league codes.
 * Only includes leagues available from this source.
 */
export const OPENFOOTBALL_LEAGUES: OpenFootballLeague[] = [
  { leagueId: 'eng-premier-league', code: 'en.1', name: 'Premier League' },
  { leagueId: 'eng-championship',   code: 'en.2', name: 'Championship' },
  { leagueId: 'ger-bundesliga',     code: 'de.1', name: 'Bundesliga' },
  { leagueId: 'esp-la-liga',        code: 'es.1', name: 'La Liga' },
  { leagueId: 'ita-serie-a',        code: 'it.1', name: 'Serie A' },
  { leagueId: 'fra-ligue-1',        code: 'fr.1', name: 'Ligue 1' },
  { leagueId: 'ned-eredivisie',     code: 'nl.1', name: 'Eredivisie' },
  { leagueId: 'por-primeira-liga',  code: 'pt.1', name: 'Primeira Liga' },
  { leagueId: 'sco-premiership',    code: 'sco.1', name: 'Scottish Premiership' },
  { leagueId: 'bel-pro-league',     code: 'be.1', name: 'Belgian Pro League' },
  { leagueId: 'tur-super-lig',      code: 'tr.1', name: 'Turkish Super Lig' },
  { leagueId: 'gre-super-league',   code: 'gr.1', name: 'Greek Super League' },
  { leagueId: 'aut-bundesliga',     code: 'at.1', name: 'Austrian Bundesliga' },
  { leagueId: 'mex-liga-mx',        code: 'mx.1', name: 'Liga MX' },
  { leagueId: 'aus-a-league',       code: 'au.1', name: 'A-League' },
  { leagueId: 'uefa-champions-league', code: 'uefa.cl', name: 'Champions League' },
];

// ─── URL Builder ─────────────────────────────────────────────────────────────

const BASE_URL = 'https://raw.githubusercontent.com/openfootball/football.json/master';

/**
 * Builds the JSON download URL for a given league and season.
 * Season format: "2024-25", "2023-24", etc.
 */
export function buildJsonUrl(leagueCode: string, season: string): string {
  return `${BASE_URL}/${season}/${leagueCode}.json`;
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

/**
 * Raw match shape from the openfootball JSON files.
 */
interface OpenFootballRawMatch {
  round: string;
  date: string;          // "YYYY-MM-DD"
  time?: string;         // "HH:MM" (may be absent)
  team1: string;
  team2: string;
  score?: {
    ht?: string;         // "1 0" (space-separated)
    ft?: string;         // "2 1"
  };
}

/**
 * Raw league response shape from the openfootball JSON files.
 */
interface OpenFootballResponse {
  name: string;
  matches: OpenFootballRawMatch[];
}

/**
 * Parses a score string like "2 1" into [home, away] goals.
 * Returns [null, null] if the score is missing or malformed.
 */
function parseScore(score: string | undefined): [number | null, number | null] {
  if (!score) return [null, null];
  const parts = score.trim().split(/\s+/);
  if (parts.length !== 2) return [null, null];
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away)) return [null, null];
  return [home, away];
}

/**
 * Converts an openfootball date string (YYYY-MM-DD) to DD/MM/YYYY format
 * to match the HistoricalMatch interface convention.
 */
function convertDateFormat(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Determines the full-time result code from goals.
 */
function determineResult(homeGoals: number, awayGoals: number): 'H' | 'D' | 'A' {
  if (homeGoals > awayGoals) return 'H';
  if (homeGoals < awayGoals) return 'A';
  return 'D';
}

/**
 * Parses a single openfootball match object into a HistoricalMatch.
 * Returns null if the match has no full-time score (i.e., not yet played).
 */
export function parseOpenFootballMatch(
  match: OpenFootballRawMatch,
  leagueId: string,
  season: string
): HistoricalMatch | null {
  const [ftHome, ftAway] = parseScore(match.score?.ft);

  // Skip matches without a final score (not yet played)
  if (ftHome === null || ftAway === null) return null;

  const [htHome, htAway] = parseScore(match.score?.ht);

  let htResult: string | null = null;
  if (htHome !== null && htAway !== null) {
    htResult = determineResult(htHome, htAway);
  }

  return {
    division: leagueId,
    date: convertDateFormat(match.date),
    time: match.time || '',
    homeTeam: match.team1,
    awayTeam: match.team2,
    ftHomeGoals: ftHome,
    ftAwayGoals: ftAway,
    ftResult: determineResult(ftHome, ftAway),
    htHomeGoals: htHome,
    htAwayGoals: htAway,
    htResult,
    // OpenFootball does not provide match stats
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
    season,
    leagueId,
  };
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

/**
 * Fetches and parses results for a single league and season.
 * Uses httpGetDirect since the endpoint returns JSON.
 * Returns an empty array if the request fails (league/season not available).
 */
export async function fetchLeagueResults(
  leagueCode: string,
  season: string,
  leagueId: string
): Promise<HistoricalMatch[]> {
  const url = buildJsonUrl(leagueCode, season);

  try {
    const data = await httpGetDirect(url) as OpenFootballResponse;

    if (!data || !Array.isArray(data.matches)) {
      console.warn(`[OpenFootball] Unexpected response for ${leagueCode}/${season}`);
      return [];
    }

    const matches: HistoricalMatch[] = [];
    for (const raw of data.matches) {
      const parsed = parseOpenFootballMatch(raw, leagueId, season);
      if (parsed) matches.push(parsed);
    }

    return matches;
  } catch (e: any) {
    // 404 is expected for seasons/leagues not yet available
    console.warn(`[OpenFootball] Failed to fetch ${leagueCode}/${season}: ${e.message || e}`);
    return [];
  }
}

/**
 * Fetches results for all configured leagues across the given seasons.
 * Requests are made sequentially to avoid overwhelming the GitHub CDN.
 * Returns a flat array of all matches found.
 *
 * Default seasons: current and previous two seasons.
 */
export async function fetchAllResults(
  seasons?: string[]
): Promise<HistoricalMatch[]> {
  const targetSeasons = seasons || getAvailableSeasons();
  const allMatches: HistoricalMatch[] = [];

  for (const league of OPENFOOTBALL_LEAGUES) {
    for (const season of targetSeasons) {
      const matches = await fetchLeagueResults(league.code, season, league.leagueId);
      allMatches.push(...matches);
    }
  }

  return allMatches;
}

// ─── Season Utilities ────────────────────────────────────────────────────────

/**
 * Returns known available seasons for openfootball.
 * Seasons follow the format "YYYY-YY" (e.g. "2024-25").
 * Generates from 2014-15 to the current season.
 */
export function getAvailableSeasons(): string[] {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 7 = August
  const year = now.getFullYear();
  const currentStartYear = month >= 7 ? year : year - 1;

  const seasons: string[] = [];
  const earliest = 2014; // OpenFootball has reliable data from 2014-15

  for (let y = currentStartYear; y >= earliest; y--) {
    const endShort = String(y + 1).slice(-2);
    seasons.push(`${y}-${endShort}`);
  }

  return seasons;
}

/**
 * Returns the most recent N seasons (default: 3).
 */
export function getRecentSeasons(count: number = 3): string[] {
  return getAvailableSeasons().slice(0, count);
}

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

/**
 * Finds the openfootball league entry for a given league-registry ID.
 * Returns undefined if this source does not cover the league.
 */
export function getLeagueMapping(leagueId: string): OpenFootballLeague | undefined {
  return OPENFOOTBALL_LEAGUES.find(l => l.leagueId === leagueId);
}

/**
 * Checks if a league is covered by this data source.
 */
export function isLeagueCovered(leagueId: string): boolean {
  return OPENFOOTBALL_LEAGUES.some(l => l.leagueId === leagueId);
}
