/**
 * 11v11.com Integration — Historical Match Records (best-effort HTML crawl)
 *
 * Data source: https://www.11v11.com  (Association of Football Statisticians)
 * Server-rendered HTML, no key. Deep English + international history (since 1872).
 *
 * Used as a fallback source when the local DB has no results for a team/match.
 * Team match record page: /teams/{team-slug}/tab/matches/
 *   Rows look like: "12 August 2025  Arsenal 2-1 Chelsea  Premier League"
 *
 * We return HistoricalMatch[] (the shared DB shape) so results feed straight
 * into the local database for form + H2H computation.
 */

import { httpGetHtml } from '../lib/http';
import type { HistoricalMatch } from './football-data-uk';

const BASE = 'https://www.11v11.com';

/** Convert a team name to 11v11's URL slug: "Manchester United" → "manchester-united". */
function toSlug(team: string): string {
  return team
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Fetch a team's recent match results from 11v11.
 * Returns HistoricalMatch[] (scored, finished matches only).
 */
export async function fetch11v11TeamResults(teamName: string): Promise<HistoricalMatch[]> {
  const slug = toSlug(teamName);
  const url = `${BASE}/teams/${slug}/tab/matches/`;
  try {
    const res = await httpGetHtml(url, { 'Accept': 'text/html' });
    if (!res.text || res.text.length < 500) return [];
    return parse11v11Matches(res.text);
  } catch (e) {
    console.warn(`[11v11] fetch failed for ${teamName}:`, e);
    return [];
  }
}

/**
 * Parse 11v11 match rows. The match list renders as table rows / links:
 *   <a href="/matches/....">Home 2-1 Away</a> with a date and competition nearby.
 * We use a tolerant regex that captures "Team A  N-N  Team B" plus a preceding date.
 */
function parse11v11Matches(html: string): HistoricalMatch[] {
  const matches: HistoricalMatch[] = [];

  // Rows commonly appear as: <td>DD Month YYYY</td> ... <a>Home N-N Away</a>
  // Capture date + "Home score-score Away". Score like "2-1" or "2 - 1".
  const rowRegex = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})[\s\S]{0,200}?([A-Z][A-Za-z0-9.'&\- ]{1,40}?)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Z][A-Za-z0-9.'&\- ]{1,40}?)(?=<|\s{2,}|,)/g;

  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = rowRegex.exec(html)) !== null && count < 60) {
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
      division: '11v11',
      date,
      time: '',
      homeTeam: home,
      awayTeam: away,
      ftHomeGoals: hg,
      ftAwayGoals: ag,
      ftResult: hg > ag ? 'H' : hg < ag ? 'A' : 'D',
      htHomeGoals: null,
      htAwayGoals: null,
      htResult: null,
      homeShots: null, awayShots: null,
      homeShotsOnTarget: null, awayShotsOnTarget: null,
      homeCorners: null, awayCorners: null,
      homeYellows: null, awayYellows: null,
      homeReds: null, awayReds: null,
      homeFouls: null, awayFouls: null,
      season: seasonFromDate(date),
      leagueId: '11v11',
    });
    count++;
  }

  return matches;
}

function cleanTeam(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** "12 August 2025" → "12/08/2025". Returns '' if unparseable. */
function normaliseDate(raw: string): string {
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return '';
  const day = m[1].padStart(2, '0');
  const mon = months[m[2].toLowerCase()];
  if (!mon) return '';
  return `${day}/${mon}/${m[3]}`;
}

/** Season string from DD/MM/YYYY (Aug-May span). */
function seasonFromDate(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3) return '';
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(year)) return '';
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${(startYear + 1).toString().slice(2)}`;
}
