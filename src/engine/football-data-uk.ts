/**
 * Football-Data.co.uk Historical Data Engine
 *
 * Data source: https://www.football-data.co.uk/
 * Provides historical match results in CSV format going back 20+ seasons.
 *
 * Coverage: Major European leagues (England, Germany, Spain, Italy, France,
 * Netherlands, Portugal, Scotland, Belgium, Turkey, Greece).
 *
 * Update frequency: Results are updated within 24 hours of matches completing.
 * Mid-season files grow as the season progresses.
 *
 * Limitations:
 * - CSV only (no JSON endpoint) — requires a text-capable fetch command.
 * - Some columns (shots, corners, cards) may be null for older seasons or
 *   lower-tier leagues where stats were not recorded.
 * - Team names are not standardized (e.g. "Man United" vs "Manchester Utd").
 *   Use the team-database normalizer before matching against other sources.
 * - Season files are identified by a compact code (e.g. "2526" for 2025-26).
 *
 * URL pattern:
 *   https://www.football-data.co.uk/mmz4281/{seasonCode}/{divCode}.csv
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HistoricalMatch {
  division: string;
  date: string;                  // DD/MM/YYYY as provided in the CSV
  time: string;
  homeTeam: string;
  awayTeam: string;
  ftHomeGoals: number;
  ftAwayGoals: number;
  ftResult: 'H' | 'D' | 'A';
  htHomeGoals: number | null;
  htAwayGoals: number | null;
  htResult: string | null;
  homeShots: number | null;
  awayShots: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  homeYellows: number | null;
  awayYellows: number | null;
  homeReds: number | null;
  awayReds: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  season: string;                // e.g. "2025-26"
  leagueId: string;              // league-registry ID e.g. "eng-premier-league"
}

// ─── League Mapping ──────────────────────────────────────────────────────────

export interface FootballDataUkLeague {
  leagueId: string;    // Matches league-registry ID
  divCode: string;     // Football-data.co.uk division code
  name: string;        // Human-readable name
}

/**
 * Maps league-registry IDs to football-data.co.uk division codes.
 * Only includes leagues available from this source.
 */
export const FOOTBALL_DATA_UK_LEAGUES: FootballDataUkLeague[] = [
  { leagueId: 'eng-premier-league', divCode: 'E0', name: 'Premier League' },
  { leagueId: 'eng-championship',   divCode: 'E1', name: 'Championship' },
  { leagueId: 'eng-league-one',     divCode: 'E2', name: 'League One' },
  // E3 = League Two (not in our registry currently, but supported by the source)
  { leagueId: 'sco-premiership',    divCode: 'SC0', name: 'Scottish Premiership' },
  { leagueId: 'ger-bundesliga',     divCode: 'D1', name: 'Bundesliga' },
  { leagueId: 'ger-2-bundesliga',   divCode: 'D2', name: '2. Bundesliga' },
  { leagueId: 'ita-serie-a',        divCode: 'I1', name: 'Serie A' },
  { leagueId: 'ita-serie-b',        divCode: 'I2', name: 'Serie B' },
  { leagueId: 'esp-la-liga',        divCode: 'SP1', name: 'La Liga' },
  { leagueId: 'esp-la-liga-2',      divCode: 'SP2', name: 'La Liga 2' },
  { leagueId: 'fra-ligue-1',        divCode: 'F1', name: 'Ligue 1' },
  { leagueId: 'fra-ligue-2',        divCode: 'F2', name: 'Ligue 2' },
  { leagueId: 'ned-eredivisie',     divCode: 'N1', name: 'Eredivisie' },
  { leagueId: 'bel-pro-league',     divCode: 'B1', name: 'Belgian Pro League' },
  { leagueId: 'por-primeira-liga',  divCode: 'P1', name: 'Primeira Liga' },
  { leagueId: 'tur-super-lig',      divCode: 'T1', name: 'Turkish Super Lig' },
  { leagueId: 'gre-super-league',   divCode: 'G1', name: 'Greek Super League' },
];

// ─── URL Builders ────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.football-data.co.uk/mmz4281';

/**
 * Converts a starting year to the compact season code used by football-data.co.uk.
 * Example: 2025 -> "2526", 2024 -> "2425", 2023 -> "2324"
 */
export function getSeasonCode(startYear: number): string {
  const start = String(startYear).slice(-2);
  const end = String(startYear + 1).slice(-2);
  return `${start}${end}`;
}

/**
 * Converts a season code back to a human-readable season string.
 * Example: "2526" -> "2025-26", "2425" -> "2024-25"
 */
export function seasonCodeToDisplay(code: string): string {
  const startShort = code.slice(0, 2);
  const endShort = code.slice(2, 4);
  const century = parseInt(startShort, 10) > 90 ? '19' : '20';
  return `${century}${startShort}-${endShort}`;
}

/**
 * Builds the full CSV download URL for a given division and season.
 */
export function buildCsvUrl(divCode: string, seasonCode: string): string {
  return `${BASE_URL}/${seasonCode}/${divCode}.csv`;
}

// ─── CSV Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a single CSV row into a HistoricalMatch object.
 * Expects the row split by comma and a corresponding headers array.
 * Returns null if the row is missing essential fields.
 */
export function parseCsvRow(
  row: string,
  headers: string[],
  season: string,
  leagueId: string
): HistoricalMatch | null {
  const values = splitCsvLine(row);
  if (values.length < headers.length * 0.5) return null;

  const get = (col: string): string => {
    const idx = headers.indexOf(col);
    return idx >= 0 && idx < values.length ? values[idx].trim() : '';
  };

  const getNum = (col: string): number | null => {
    const v = get(col);
    if (v === '' || v === 'NA') return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };

  const homeTeam = get('HomeTeam');
  const awayTeam = get('AwayTeam');
  const ftResult = get('FTR') as 'H' | 'D' | 'A';
  const ftHomeGoals = getNum('FTHG');
  const ftAwayGoals = getNum('FTAG');

  // Essential fields must be present
  if (!homeTeam || !awayTeam || !ftResult || ftHomeGoals === null || ftAwayGoals === null) {
    return null;
  }

  return {
    division: get('Div') || leagueId,
    date: get('Date'),
    time: get('Time'),
    homeTeam,
    awayTeam,
    ftHomeGoals,
    ftAwayGoals,
    ftResult,
    htHomeGoals: getNum('HTHG'),
    htAwayGoals: getNum('HTAG'),
    htResult: get('HTR') || null,
    homeShots: getNum('HS'),
    awayShots: getNum('AS'),
    homeShotsOnTarget: getNum('HST'),
    awayShotsOnTarget: getNum('AST'),
    homeCorners: getNum('HC'),
    awayCorners: getNum('AC'),
    homeYellows: getNum('HY'),
    awayYellows: getNum('AY'),
    homeReds: getNum('HR'),
    awayReds: getNum('AR'),
    homeFouls: getNum('HF'),
    awayFouls: getNum('AF'),
    season,
    leagueId,
  };
}

/**
 * Splits a CSV line respecting quoted fields (some team names contain commas).
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parses a complete CSV file string into an array of HistoricalMatch objects.
 * The first row is treated as a header row.
 * Blank rows and rows that fail to parse are silently skipped.
 */
export function parseCsv(
  csvText: string,
  season: string,
  leagueId: string
): HistoricalMatch[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
  const matches: HistoricalMatch[] = [];

  for (let i = 1; i < lines.length; i++) {
    const match = parseCsvRow(lines[i], headers, season, leagueId);
    if (match) matches.push(match);
  }

  return matches;
}

// ─── Season Utilities ────────────────────────────────────────────────────────

/**
 * Returns season codes for the last N seasons (default: 5).
 * Seasons run August–May, so the "current" season depends on the month.
 * Before August, the current season started last year; from August onward, this year.
 */
export function getAvailableSeasons(count: number = 5): string[] {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 7 = August
  const year = now.getFullYear();
  const currentStartYear = month >= 7 ? year : year - 1;

  const seasons: string[] = [];
  for (let i = 0; i < count; i++) {
    seasons.push(getSeasonCode(currentStartYear - i));
  }
  return seasons;
}

/**
 * Returns all CSV URLs to download for the configured leagues and seasons.
 * Default: last 3 seasons for all mapped leagues.
 */
export function getAllCsvUrls(seasons: number = 3): { url: string; divCode: string; seasonCode: string; leagueId: string; season: string }[] {
  const seasonCodes = getAvailableSeasons(seasons);
  const urls: { url: string; divCode: string; seasonCode: string; leagueId: string; season: string }[] = [];

  for (const league of FOOTBALL_DATA_UK_LEAGUES) {
    for (const code of seasonCodes) {
      urls.push({
        url: buildCsvUrl(league.divCode, code),
        divCode: league.divCode,
        seasonCode: code,
        leagueId: league.leagueId,
        season: seasonCodeToDisplay(code),
      });
    }
  }

  return urls;
}

/**
 * Finds the league mapping entry for a given league-registry ID.
 * Returns undefined if this source does not cover the league.
 */
export function getLeagueMapping(leagueId: string): FootballDataUkLeague | undefined {
  return FOOTBALL_DATA_UK_LEAGUES.find(l => l.leagueId === leagueId);
}

/**
 * Checks if a league is covered by this data source.
 */
export function isLeagueCovered(leagueId: string): boolean {
  return FOOTBALL_DATA_UK_LEAGUES.some(l => l.leagueId === leagueId);
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

import { httpGetText } from '../lib/http';

/**
 * Fetches and parses results for a single league and season from football-data.co.uk.
 * Downloads the CSV file and parses it into HistoricalMatch objects.
 * Returns an empty array if the file doesn't exist (404) or is empty.
 */
export async function fetchLeagueResults(
  divCode: string,
  seasonCode: string,
  leagueId: string
): Promise<HistoricalMatch[]> {
  const url = buildCsvUrl(divCode, seasonCode);
  const season = seasonCodeToDisplay(seasonCode);

  try {
    const response = await httpGetText(url, {});
    if (!response.text || response.text.length < 100) {
      console.warn(`[FootballDataUK] Empty or too short response for ${divCode}/${seasonCode}`);
      return [];
    }
    return parseCsv(response.text, season, leagueId);
  } catch (e: any) {
    // 404 is expected for future seasons or leagues not yet available
    console.warn(`[FootballDataUK] Failed to fetch ${divCode}/${seasonCode}: ${e.message || e}`);
    return [];
  }
}

/**
 * Fetches results for all configured leagues across the given number of seasons.
 * Downloads sequentially to avoid overwhelming the server.
 * Returns a flat array of all matches found.
 *
 * Default: last 3 seasons for all 17 leagues = ~51 CSV downloads.
 * Each CSV is ~5-200KB depending on the league and season progress.
 */
export async function fetchAllResults(seasons: number = 3): Promise<HistoricalMatch[]> {
  const urls = getAllCsvUrls(seasons);
  const allMatches: HistoricalMatch[] = [];
  let fetched = 0;

  for (const entry of urls) {
    try {
      const matches = await fetchLeagueResults(entry.divCode, entry.seasonCode, entry.leagueId);
      allMatches.push(...matches);
      fetched++;
      // Small delay between requests to be respectful
      if (fetched % 5 === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch {
      // Skip failures, continue with next
    }
  }

  console.log(`[FootballDataUK] Fetched ${allMatches.length} matches from ${fetched}/${urls.length} files`);
  return allMatches;
}
