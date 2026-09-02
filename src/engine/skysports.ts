/**
 * Sky Sports Integration — Fixture Discovery
 *
 * Data source: https://www.skysports.com/football/fixtures
 * Public page, server-rendered HTML, no API key needed.
 *
 * Coverage: major leagues worldwide (Premier League, La Liga, Serie A,
 * Bundesliga, Ligue 1, Champions League, EFL, J-League, women's football, etc.)
 *
 * The fixtures page renders each match as accessible text:
 *   "Burton Albion vs AFC Wimbledon. Kick-off at 7:45pm"
 * grouped under league headings. We parse that structure directly.
 */

import { httpGetHtml } from '../lib/http';

export interface SkySportsFixture {
  homeTeam: string;
  awayTeam: string;
  kickOffText: string;    // "7:45pm"
  kickOffDate: Date | null;
  league: string;
  date: string;           // YYYY-MM-DD (the day the page represents)
}

const FIXTURES_URL = 'https://www.skysports.com/football/fixtures';
const RESULTS_URL = 'https://www.skysports.com/football/results';

/**
 * Fetch today's (and near-term) fixtures from Sky Sports.
 */
export async function fetchSkySportsFixtures(): Promise<SkySportsFixture[]> {
  try {
    const res = await httpGetHtml(FIXTURES_URL, { 'Accept': 'text/html' });
    if (!res.text || res.text.length < 500) return [];
    return parseFixtures(res.text);
  } catch (e) {
    console.warn('[SkySports] fixtures fetch failed:', e);
    return [];
  }
}

/**
 * Fetch recent results (finished matches with scores) from Sky Sports.
 */
export async function fetchSkySportsResults(): Promise<SkySportsFixture[]> {
  try {
    const res = await httpGetHtml(RESULTS_URL, { 'Accept': 'text/html' });
    if (!res.text || res.text.length < 500) return [];
    return parseFixtures(res.text);
  } catch (e) {
    console.warn('[SkySports] results fetch failed:', e);
    return [];
  }
}

/**
 * Parse the Sky Sports fixtures/results HTML.
 *
 * Strategy: the page exposes each match as a sentence in an accessible label:
 *   "Home Team vs Away Team. Kick-off at 7:45pm"
 * League names appear as headings (fixtures-header / competition titles) before
 * their group of matches. We track the most recent heading as the current league.
 */
function parseFixtures(html: string): SkySportsFixture[] {
  const fixtures: SkySportsFixture[] = [];
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  // Strip tags but keep a marker for league headings so we can attribute matches.
  // Sky uses <h5 class="fixres__header...">League</h5> style headings; we detect
  // heading text by scanning for known heading class fragments, but to stay robust
  // we take a simpler approach: walk the raw HTML, capturing:
  //   (a) league headings — text inside elements whose class hints at a competition
  //   (b) match sentences — "X vs Y. Kick-off at TIME"

  // First, collect all league heading candidates with their positions
  const headingRegex = /<(?:h[1-6]|span|div)[^>]*class="[^"]*(?:fixres__header|swap-text__target|header|matches__title|competition[^"]*)[^"]*"[^>]*>([^<]{2,60})<\/(?:h[1-6]|span|div)>/gi;

  // Match sentences: "Home vs Away. Kick-off at 7:45pm" (also handles "Kick off")
  const matchRegex = /([A-Z][A-Za-z0-9.'&\- ]{1,45}?)\s+vs\s+([A-Z][A-Za-z0-9.'&\- ]{1,45}?)\.\s*Kick[- ]?off at\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi;

  // Build an index of heading positions
  const headings: { pos: number; text: string }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRegex.exec(html)) !== null) {
    const text = hm[1].replace(/&amp;/g, '&').trim();
    if (text && !/^\d+$/.test(text)) {
      headings.push({ pos: hm.index, text });
    }
  }

  function leagueAt(pos: number): string {
    // The nearest heading that appears BEFORE this match position
    let league = '';
    for (const h of headings) {
      if (h.pos < pos) league = h.text;
      else break;
    }
    return league;
  }

  let mm: RegExpExecArray | null;
  matchRegex.lastIndex = 0;
  while ((mm = matchRegex.exec(html)) !== null) {
    const homeTeam = cleanTeam(mm[1]);
    const awayTeam = cleanTeam(mm[2]);
    const kickOffText = mm[3].trim();

    if (!homeTeam || !awayTeam || homeTeam.toLowerCase() === awayTeam.toLowerCase()) continue;

    fixtures.push({
      homeTeam,
      awayTeam,
      kickOffText,
      kickOffDate: parseKickoff(today, kickOffText),
      league: leagueAt(mm.index) || 'Football',
      date: dateStr,
    });
  }

  // Deduplicate by home|away|kickoff
  const seen = new Set<string>();
  return fixtures.filter(f => {
    const key = `${f.homeTeam.toLowerCase()}|${f.awayTeam.toLowerCase()}|${f.kickOffText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanTeam(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert "7:45pm" (relative to a date) into a Date. Best-effort — Sky's fixtures
 * page is "today", so we anchor to the provided day.
 */
function parseKickoff(day: Date, timeText: string): Date | null {
  const m = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const d = new Date(day);
  d.setHours(hour, min, 0, 0);
  return d;
}
