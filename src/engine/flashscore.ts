/**
 * Flashscore.mobi Integration — Fixture Discovery + H2H + Standings
 *
 * Data source: https://www.flashscore.mobi
 * Public mobile page, no API key needed, no rate limit concerns.
 *
 * Coverage: 365+ leagues, 1000+ fixtures daily, fastest result updates.
 *
 * Endpoints:
 *   Fixtures:  /?d={offset}  (0=today, 1=tomorrow, -1=yesterday)
 *   H2H:      /match/{id}/?t=h2h
 *   Standings: /standings/{leagueId}/{seasonId}/
 *   Stats:     /match/{id}/?t=stats
 *
 * HTML parsing — simple, stable structure:
 *   <h4>COUNTRY: League Name</h4>
 *   <span>HH:MM</span>Home - Away <a href="/match/{id}/">score</a>
 */

import { httpGetHtml } from '../lib/http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlashscoreFixture {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  time: string;           // "HH:MM" or "FT" for finished
  country: string;
  league: string;
  score: string | null;   // "2-1" or null if not started
  isFinished: boolean;
  date: string;           // Date the fixtures were fetched for
}

export interface FlashscoreH2HData {
  homeTeam: string;
  awayTeam: string;
  homeLastMatches: FlashscoreResult[];
  awayLastMatches: FlashscoreResult[];
  headToHead: FlashscoreResult[];
}

export interface FlashscoreResult {
  date: string;           // "DD.MM.YYYY"
  homeTeam: string;
  awayTeam: string;
  score: string;          // "2-1"
  homeGoals: number;
  awayGoals: number;
}

export interface FlashscoreStanding {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals: string;          // "25:12"
  points: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

// Primary + mirror hosts. All run the same lightweight mobile engine, so the
// SAME parser works on each. We try them in order until one returns real data —
// resilience if the primary is down or blocked from the user's region.
const MIRRORS = [
  'https://www.flashscore.mobi',
  'https://www.flashscore.com.ng',
  'https://m.flashscore.com.au',
];

// The mirror that last succeeded — tried first next time (sticky).
let preferredMirror = MIRRORS[0];

/**
 * Fetch an HTML page across the mirror list, returning the first non-empty body.
 * Updates the sticky preferred mirror on success.
 */
async function fetchWithMirrors(pathAndQuery: string): Promise<string | null> {
  // Try preferred first, then the rest
  const ordered = [preferredMirror, ...MIRRORS.filter(m => m !== preferredMirror)];
  for (const host of ordered) {
    try {
      const res = await httpGetHtml(`${host}${pathAndQuery}`, { 'Accept': 'text/html' });
      if (res.text && res.text.length > 1000) {
        preferredMirror = host;
        return res.text;
      }
    } catch {
      // try next mirror
    }
  }
  return null;
}

// ─── Fixture Discovery ───────────────────────────────────────────────────────

/**
 * Fetch all fixtures for a given day offset.
 * @param dayOffset 0=today, 1=tomorrow, -1=yesterday, etc.
 */
export async function fetchDayFixtures(dayOffset: number = 0): Promise<FlashscoreFixture[]> {
  try {
    const html = await fetchWithMirrors(`/?d=${dayOffset}&s=1`);
    if (!html) return [];
    return parseDayFixtures(html, dayOffset);
  } catch (e) {
    console.warn(`[Flashscore] Failed to fetch day ${dayOffset}:`, e);
    return [];
  }
}

/**
 * Fetch fixtures for multiple days (e.g. next 7 days).
 */
export async function fetchMultipleDays(days: number = 7): Promise<FlashscoreFixture[]> {
  const allFixtures: FlashscoreFixture[] = [];

  for (let d = 0; d < days; d++) {
    const fixtures = await fetchDayFixtures(d);
    allFixtures.push(...fixtures);
    // Small delay between requests
    if (d < days - 1) await sleep(300);
  }

  return allFixtures;
}

/**
 * Parse the HTML fixtures page into structured data.
 */
function parseDayFixtures(html: string, dayOffset: number): FlashscoreFixture[] {
  const fixtures: FlashscoreFixture[] = [];
  let currentCountry = '';
  let currentLeague = '';

  // Calculate the actual date for this offset
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayOffset);
  const dateStr = targetDate.toISOString().split('T')[0];

  // Match league headers: <h4>COUNTRY: League Name</h4> or <h4>COUNTRY: League <a...>Standings</a></h4>
  const leagueRegex = /<h4>([^<]+?)(?:\s*<a[^>]*>[^<]*<\/a>)?<\/h4>/g;
  // Match fixtures: <span>HH:MM</span>Home - Away <a href="/match/ID/"...>score</a> or <span>FT</span>...
  const fixtureRegex = /<span>(\d{2}:\d{2}|FT|AET|Pen\.|Postp\.|Canc\.)<\/span>([^<]+)<a\s+href="\/match\/([^/]+)\/?[^"]*"[^>]*>(?:<b>)?([^<]*)(?:<\/b>)?<\/a>/g;

  // Split by league headers
  const parts = html.split(/<h4>/);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Extract league from the header
    const headerEnd = part.indexOf('</h4>');
    if (headerEnd === -1) continue;
    const headerText = part.substring(0, headerEnd).replace(/<[^>]+>/g, '').trim();

    const colonIdx = headerText.indexOf(':');
    if (colonIdx > 0) {
      currentCountry = headerText.substring(0, colonIdx).trim();
      currentLeague = headerText.substring(colonIdx + 1).trim();
    } else {
      currentCountry = '';
      currentLeague = headerText;
    }

    // Extract fixtures from the rest of this section
    const sectionContent = part.substring(headerEnd + 5);
    let match;
    fixtureRegex.lastIndex = 0;

    while ((match = fixtureRegex.exec(sectionContent)) !== null) {
      const timeOrStatus = match[1];
      const teamsRaw = match[2].trim();
      const matchId = match[3];
      const scoreRaw = match[4].trim().replace(/&nbsp;/g, '').replace(/-/, '-').trim();

      // Parse teams: "Home Team - Away Team" (with <!-- --> comments removed)
      const teamsParsed = teamsRaw.replace(/<!--.*?-->/g, '').trim();
      const teamsSplit = teamsParsed.split(/\s+-\s+/);
      if (teamsSplit.length < 2) continue;

      const homeTeam = teamsSplit[0].trim();
      const awayTeam = teamsSplit.slice(1).join(' - ').trim();

      const score = scoreRaw && scoreRaw.includes('-') ? scoreRaw.split('(')[0].trim() : null;
      const isFinished = timeOrStatus === 'FT' || timeOrStatus === 'AET' || timeOrStatus.startsWith('Pen') ||
        score !== null; // Flashscore only shows scores for completed matches

      fixtures.push({
        matchId,
        homeTeam,
        awayTeam,
        time: timeOrStatus,
        country: currentCountry,
        league: currentLeague,
        score,
        isFinished,
        date: dateStr,
      });
    }
  }

  return fixtures;
}

// ─── H2H Data ────────────────────────────────────────────────────────────────

/**
 * Fetch H2H data for a specific match (last 5 each team + head-to-head).
 */
export async function fetchMatchH2H(matchId: string): Promise<FlashscoreH2HData | null> {
  try {
    const html = await fetchWithMirrors(`/match/${matchId}/?t=h2h`);
    if (!html || html.length < 500) return null;
    return parseH2HPage(html);
  } catch (e) {
    console.warn(`[Flashscore] H2H fetch failed for ${matchId}:`, e);
    return null;
  }
}

/**
 * Parse the H2H page HTML.
 */
function parseH2HPage(html: string): FlashscoreH2HData | null {
  // Find team names from <h4>Last matches: TeamName</h4>
  const teamHeaders = [...html.matchAll(/<h4>Last matches:\s*([^<]+)<\/h4>/g)];
  const h2hHeader = html.match(/<h4>Head-to-head matches<\/h4>/);

  const homeTeam = teamHeaders[0]?.groups?.[0] || teamHeaders[0]?.[1]?.trim() || '';
  const awayTeam = teamHeaders[1]?.groups?.[0] || teamHeaders[1]?.[1]?.trim() || '';

  // Parse results from <table class="h2h"> sections
  const tables = html.split('<table class="h2h">');

  const homeLastMatches = tables.length > 1 ? parseResultsTable(tables[1]) : [];
  const awayLastMatches = tables.length > 2 ? parseResultsTable(tables[2]) : [];
  const headToHead = tables.length > 3 ? parseResultsTable(tables[3]) : [];

  if (!homeTeam && !awayTeam) return null;

  return { homeTeam, awayTeam, homeLastMatches, awayLastMatches, headToHead };
}

/**
 * Parse a single H2H results table.
 */
function parseResultsTable(tableHtml: string): FlashscoreResult[] {
  const results: FlashscoreResult[] = [];
  // Pattern: <span>DD.MM.YYYY</span><span>Home<!-- --> - <!-- -->Away</span><a...><b>Score</b></a>
  const rowRegex = /<span>(\d{2}\.\d{2}\.\d{4})<\/span><span>([^<]+(?:<!--[^>]*-->[^<]*)*)<\/span><a[^>]*><b>([^<]+)<\/b><\/a>/g;

  let match;
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const date = match[1];
    const teamsRaw = match[2].replace(/<!--.*?-->/g, '').trim();
    const scoreRaw = match[3].trim();

    const teamsSplit = teamsRaw.split(/\s+-\s+/);
    if (teamsSplit.length < 2) continue;

    const homeTeam = teamsSplit[0].trim();
    const awayTeam = teamsSplit.slice(1).join(' - ').trim();

    // Parse score "2-1" or "1-1 (Pen: 5-4)"
    const scoreParts = scoreRaw.split('(')[0].trim().split('-');
    const homeGoals = parseInt(scoreParts[0]) || 0;
    const awayGoals = parseInt(scoreParts[1]) || 0;

    results.push({ date, homeTeam, awayTeam, score: scoreRaw, homeGoals, awayGoals });
  }

  return results;
}

// ─── Standings ───────────────────────────────────────────────────────────────

/**
 * Fetch league standings.
 * @param leagueId Flashscore league ID (from standings link)
 * @param seasonId Flashscore season ID
 */
export async function fetchStandings(leagueId: string, seasonId: string): Promise<FlashscoreStanding[]> {
  const url = `${preferredMirror}/standings/${leagueId}/${seasonId}/`;

  try {
    const response = await httpGetHtml(url, { 'Accept': 'text/html' });
    if (!response.text || response.text.length < 500) return [];
    return parseStandingsPage(response.text);
  } catch (e) {
    console.warn(`[Flashscore] Standings fetch failed:`, e);
    return [];
  }
}

/**
 * Parse standings HTML table.
 */
function parseStandingsPage(html: string): FlashscoreStanding[] {
  const standings: FlashscoreStanding[] = [];
  // Match table rows: <td>1.</td><td class="left">Team</td><td>MP</td><td>W</td><td>D</td><td>L</td><td>G</td><td>Pts</td>
  const rowRegex = /<tr>\s*<td[^>]*>\s*(\d+)\.\s*<\/td>\s*<td[^>]*>\s*(?:<[^>]*>)*([^<]+)(?:<[^>]*>)*\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>\s*<td[^>]*>\s*<b>(\d+)<\/b>\s*<\/td>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    standings.push({
      position: parseInt(match[1]),
      team: match[2].trim(),
      played: parseInt(match[3]),
      won: parseInt(match[4]),
      drawn: parseInt(match[5]),
      lost: parseInt(match[6]),
      goals: match[7].trim(),
      points: parseInt(match[8]),
    });
  }

  return standings;
}

// ─── Result Settlement ───────────────────────────────────────────────────────

/**
 * Fetch yesterday's finished results for DB auto-update.
 * Returns only finished matches with scores.
 */
export async function fetchYesterdayResults(): Promise<FlashscoreFixture[]> {
  const fixtures = await fetchDayFixtures(-1);
  return fixtures.filter(f => f.isFinished && f.score);
}

/**
 * Fetch today's finished results (for live settlement).
 */
export async function fetchTodayFinished(): Promise<FlashscoreFixture[]> {
  const fixtures = await fetchDayFixtures(0);
  return fixtures.filter(f => f.isFinished && f.score);
}

/**
 * Convert Flashscore results to HistoricalMatch format for DB storage.
 */
export function convertToHistoricalMatches(fixtures: FlashscoreFixture[]): import('./football-data-uk').HistoricalMatch[] {
  const matches: import('./football-data-uk').HistoricalMatch[] = [];

  for (const f of fixtures) {
    if (!f.score || !f.isFinished) continue;
    const scoreParts = f.score.split('-');
    if (scoreParts.length !== 2) continue;

    const homeGoals = parseInt(scoreParts[0].trim());
    const awayGoals = parseInt(scoreParts[1].trim());
    if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

    matches.push({
      division: `${f.country}: ${f.league}`,
      date: f.date,
      time: f.time !== 'FT' ? f.time : '',
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      ftHomeGoals: homeGoals,
      ftAwayGoals: awayGoals,
      ftResult: homeGoals > awayGoals ? 'H' : homeGoals < awayGoals ? 'A' : 'D',
      htHomeGoals: null,
      htAwayGoals: null,
      htResult: null,
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
      season: new Date().getFullYear().toString(),
      leagueId: `${f.country}: ${f.league}`,
    });
  }

  return matches;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get fixture count summary for a day.
 */
export async function getDaySummary(dayOffset: number = 0): Promise<{ leagues: number; fixtures: number }> {
  const fixtures = await fetchDayFixtures(dayOffset);
  const leagues = new Set(fixtures.map(f => `${f.country}: ${f.league}`));
  return { leagues: leagues.size, fixtures: fixtures.length };
}
