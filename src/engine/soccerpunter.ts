/**
 * SoccerPunter.com Integration — Team Results + H2H (best-effort HTML crawl)
 *
 * Data source: https://www.soccerpunter.com
 * Server-rendered HTML, no key. Global league coverage. Some deeper data is
 * behind login, but team result rows and H2H summaries render in raw HTML.
 *
 * Used as a supplementary fallback when the local DB lacks a team/match.
 * Returns HistoricalMatch[] (shared DB shape) from a team's recent results.
 *
 * Team results page pattern (best-effort — the site uses team IDs, so we try a
 * search-by-name path and parse whatever result rows are present):
 *   /team/{slug}  or  /search results linking to a team page
 */

import { httpGetHtml } from '../lib/http';
import type { HistoricalMatch } from './football-data-uk';

const BASE = 'https://www.soccerpunter.com';

function toSlug(team: string): string {
  return team
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Fetch a team's recent results from SoccerPunter (best-effort).
 * Tries a couple of likely URL shapes; returns whatever parses.
 */
export async function fetchSoccerPunterResults(teamName: string): Promise<HistoricalMatch[]> {
  const slug = toSlug(teamName);
  const candidates = [
    `${BASE}/teams/${slug}`,
    `${BASE}/team/${slug}`,
  ];

  for (const url of candidates) {
    try {
      const res = await httpGetHtml(url, { 'Accept': 'text/html' });
      if (res.text && res.text.length > 800) {
        const parsed = parseSoccerPunter(res.text);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * Parse SoccerPunter result rows. Matches render as:
 *   "DD/MM/YYYY  Home  N - N  Away  Competition"
 * We capture date + "Home N-N Away" tolerantly.
 */
function parseSoccerPunter(html: string): HistoricalMatch[] {
  const matches: HistoricalMatch[] = [];

  // Date formats seen: "12/08/2025" or "2025-08-12"
  const rowRegex = /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})[\s\S]{0,180}?([A-Z][A-Za-z0-9.'&\- ]{1,40}?)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Z][A-Za-z0-9.'&\- ]{1,40}?)(?=<|\s{2,}|,)/g;

  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = rowRegex.exec(html)) !== null && count < 50) {
    const dateRaw = m[1].trim();
    const home = cleanTeam(m[2]);
    const hg = parseInt(m[3], 10);
    const ag = parseInt(m[4], 10);
    const away = cleanTeam(m[5]);

    if (!home || !away || home.toLowerCase() === away.toLowerCase()) continue;
    if (isNaN(hg) || isNaN(ag)) continue;

    const date = normaliseDate(dateRaw);
    if (!date) continue;

    matches.push({
      division: 'soccerpunter',
      date,
      time: '',
      homeTeam: home,
      awayTeam: away,
      ftHomeGoals: hg,
      ftAwayGoals: ag,
      ftResult: hg > ag ? 'H' : hg < ag ? 'A' : 'D',
      htHomeGoals: null, htAwayGoals: null, htResult: null,
      homeShots: null, awayShots: null,
      homeShotsOnTarget: null, awayShotsOnTarget: null,
      homeCorners: null, awayCorners: null,
      homeYellows: null, awayYellows: null,
      homeReds: null, awayReds: null,
      homeFouls: null, awayFouls: null,
      season: seasonFromDate(date),
      leagueId: 'soccerpunter',
    });
    count++;
  }

  return matches;
}

function cleanTeam(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Normalise "DD/MM/YYYY" or "YYYY-MM-DD" → "DD/MM/YYYY". */
function normaliseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, mo, d] = raw.split('-');
    return `${d}/${mo}/${y}`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [d, mo, y] = raw.split('/');
    return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
  }
  return '';
}

function seasonFromDate(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3) return '';
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(year)) return '';
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${(startYear + 1).toString().slice(2)}`;
}
