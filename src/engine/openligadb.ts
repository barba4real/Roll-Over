/**
 * OpenLigaDB API client
 * Completely free, no key required, unlimited requests
 * Base URL: https://api.openligadb.de
 * Covers: Bundesliga, 2. Bundesliga, DFB-Pokal, Champions League, and more
 *
 * Endpoints:
 *   /getmatchdata/{league}/{season}/{matchday}
 *   /getmatchdata/{league}/{season}
 *   /getavailableleagues
 *   /getbltable/{league}/{season}
 *
 * League shortcuts: bl1 (Bundesliga), bl2 (2. Bundesliga), dfb (DFB-Pokal), cl (CL)
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://api.openligadb.de';

// Available leagues on OpenLigaDB
export const OPENLIGA_LEAGUES = [
  { shortcut: 'bl1', name: 'Bundesliga', country: 'Germany' },
  { shortcut: 'bl2', name: '2. Bundesliga', country: 'Germany' },
  { shortcut: 'bl3', name: '3. Liga', country: 'Germany' },
  { shortcut: 'dfb', name: 'DFB-Pokal', country: 'Germany' },
  { shortcut: 'ucl', name: 'Champions League', country: 'Europe' },
  { shortcut: 'uel', name: 'Europa League', country: 'Europe' },
];

async function apiFetch(endpoint: string): Promise<any> {
  const url = `${API_HOST}${endpoint}`;
  try {
    const result: any = await httpGet(url, { 'Accept': 'application/json' });
    return result;
  } catch (e) {
    console.error(`OpenLigaDB fetch failed: ${endpoint}`, e);
    return null;
  }
}

function getCurrentSeason(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get all matches for a league in the current season
 */
export async function getSeasonMatches(leagueShortcut: string): Promise<OpenLigaMatch[]> {
  const season = getCurrentSeason();
  const data = await apiFetch(`/getmatchdata/${leagueShortcut}/${season}`);
  if (!Array.isArray(data)) return [];
  return data.map(parseMatch).filter((m): m is OpenLigaMatch => m !== null);
}

/**
 * Get upcoming (not yet played) matches for a league
 */
export async function getUpcomingMatches(leagueShortcut: string, days: number = 7): Promise<OpenLigaMatch[]> {
  const allMatches = await getSeasonMatches(leagueShortcut);
  const now = Date.now();
  const cutoff = now + days * 24 * 60 * 60 * 1000;

  return allMatches.filter(m => {
    const kickOff = new Date(m.kickOff).getTime();
    return kickOff >= now && kickOff <= cutoff && !m.isFinished;
  });
}

/**
 * Get all upcoming matches across all OpenLigaDB leagues
 */
export async function getAllUpcomingEvents(days: number = 7): Promise<OpenLigaMatch[]> {
  const results = await Promise.allSettled(
    OPENLIGA_LEAGUES.map(league => getUpcomingMatches(league.shortcut, days))
  );

  const allMatches: OpenLigaMatch[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allMatches.push(...result.value);
    }
  }

  // Sort by kickoff
  allMatches.sort((a, b) => new Date(a.kickOff).getTime() - new Date(b.kickOff).getTime());
  return allMatches;
}

/**
 * Get league table (standings)
 */
export async function getStandings(leagueShortcut: string): Promise<OpenLigaStanding[]> {
  const season = getCurrentSeason();
  const data = await apiFetch(`/getbltable/${leagueShortcut}/${season}`);
  if (!Array.isArray(data)) return [];

  return data.map((entry: any, idx: number) => ({
    position: idx + 1,
    teamName: entry.teamName || entry.shortName || '',
    teamId: entry.teamInfoId || 0,
    points: entry.points || 0,
    played: entry.matches || 0,
    wins: entry.won || 0,
    draws: entry.draw || 0,
    losses: entry.lost || 0,
    goalsFor: entry.goals || 0,
    goalsAgainst: entry.opponentGoals || 0,
    goalDiff: entry.goalDiff || 0,
  }));
}

/**
 * Get recent results (last matchday) for a league
 */
export async function getLastResults(leagueShortcut: string): Promise<OpenLigaMatch[]> {
  const season = getCurrentSeason();
  const data = await apiFetch(`/getmatchdata/${leagueShortcut}/${season}`);
  if (!Array.isArray(data)) return [];

  // Filter to finished matches, take last 15
  return data
    .map(parseMatch)
    .filter((m): m is OpenLigaMatch => m !== null && m.isFinished)
    .slice(-15);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenLigaMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number;
  awayTeamId: number;
  kickOff: string; // ISO date
  league: string;
  leagueShortcut: string;
  matchday: number;
  isFinished: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface OpenLigaStanding {
  position: number;
  teamName: string;
  teamId: number;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseMatch(raw: any): OpenLigaMatch | null {
  const team1 = raw.team1;
  const team2 = raw.team2;
  if (!team1 || !team2) return null;

  // Get final result (last entry in matchResults array)
  const results = raw.matchResults || [];
  const finalResult = results.find((r: any) => r.resultTypeID === 2) || results[results.length - 1];

  return {
    id: raw.matchID || 0,
    homeTeam: team1.teamName || team1.shortName || '',
    awayTeam: team2.teamName || team2.shortName || '',
    homeTeamId: team1.teamId || 0,
    awayTeamId: team2.teamId || 0,
    kickOff: raw.matchDateTimeUTC || raw.matchDateTime || '',
    league: raw.leagueName || OPENLIGA_LEAGUES.find(l => l.shortcut === raw.leagueShortcut)?.name || '',
    leagueShortcut: raw.leagueShortcut || '',
    matchday: raw.group?.groupOrderID || 0,
    isFinished: raw.matchIsFinished || false,
    homeScore: finalResult?.pointsTeam1 ?? null,
    awayScore: finalResult?.pointsTeam2 ?? null,
  };
}

// ─── Maximized Endpoints ─────────────────────────────────────────────────────

/**
 * Get ALL finished matches for a league season as HistoricalMatch format.
 * Includes goals scored info. Used for bulk DB population.
 */
export async function fetchSeasonResults(leagueShortcut: string, season?: number): Promise<import('./football-data-uk').HistoricalMatch[]> {
  const s = season || getCurrentSeason();
  const data = await apiFetch(`/getmatchdata/${leagueShortcut}/${s}`);
  if (!Array.isArray(data)) return [];

  const matches: import('./football-data-uk').HistoricalMatch[] = [];
  for (const raw of data) {
    if (!raw.matchIsFinished) continue;
    const team1 = raw.team1;
    const team2 = raw.team2;
    if (!team1 || !team2) continue;

    const results = raw.matchResults || [];
    const finalResult = results.find((r: any) => r.resultTypeID === 2) || results[results.length - 1];
    const htResult = results.find((r: any) => r.resultTypeID === 1);

    const homeGoals = finalResult?.pointsTeam1;
    const awayGoals = finalResult?.pointsTeam2;
    if (homeGoals == null || awayGoals == null) continue;

    matches.push({
      division: leagueShortcut,
      date: raw.matchDateTimeUTC?.split('T')[0] || '',
      time: raw.matchDateTimeUTC?.split('T')[1]?.slice(0, 5) || '',
      homeTeam: team1.teamName || team1.shortName || '',
      awayTeam: team2.teamName || team2.shortName || '',
      ftHomeGoals: homeGoals,
      ftAwayGoals: awayGoals,
      ftResult: homeGoals > awayGoals ? 'H' : homeGoals < awayGoals ? 'A' : 'D',
      htHomeGoals: htResult?.pointsTeam1 ?? null,
      htAwayGoals: htResult?.pointsTeam2 ?? null,
      htResult: htResult ? (htResult.pointsTeam1 > htResult.pointsTeam2 ? 'H' : htResult.pointsTeam1 < htResult.pointsTeam2 ? 'A' : 'D') : null,
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
      season: `${s}-${s + 1}`,
      leagueId: OPENLIGA_LEAGUES.find(l => l.shortcut === leagueShortcut)?.name || leagueShortcut,
    });
  }

  return matches;
}

/**
 * Get all finished results from ALL OpenLigaDB leagues for DB population.
 */
export async function fetchAllResults(seasons: number = 1): Promise<import('./football-data-uk').HistoricalMatch[]> {
  const currentSeason = getCurrentSeason();
  const allMatches: import('./football-data-uk').HistoricalMatch[] = [];

  for (let i = 0; i < seasons; i++) {
    const s = currentSeason - i;
    for (const league of OPENLIGA_LEAGUES) {
      try {
        const matches = await fetchSeasonResults(league.shortcut, s);
        allMatches.push(...matches);
      } catch {}
    }
  }

  return allMatches;
}

/**
 * Get goal scorers for a specific match.
 * OpenLigaDB: /getgoals/{matchId}
 */
export async function getMatchGoals(matchId: number): Promise<OpenLigaGoal[]> {
  const data = await apiFetch(`/getgoals/${matchId}`);
  if (!Array.isArray(data)) return [];

  return data.map((g: any) => ({
    scorer: g.goalGetterName || '',
    minute: g.matchMinute || 0,
    homeScore: g.scoreTeam1 || 0,
    awayScore: g.scoreTeam2 || 0,
    isPenalty: g.isPenalty || false,
    isOwnGoal: g.isOwnGoal || false,
  }));
}

/**
 * Get matches for a specific matchday.
 * OpenLigaDB: /getmatchdata/{league}/{season}/{matchday}
 */
export async function getMatchday(leagueShortcut: string, matchday: number, season?: number): Promise<OpenLigaMatch[]> {
  const s = season || getCurrentSeason();
  const data = await apiFetch(`/getmatchdata/${leagueShortcut}/${s}/${matchday}`);
  if (!Array.isArray(data)) return [];
  return data.map(parseMatch).filter((m): m is OpenLigaMatch => m !== null);
}

/**
 * Get the current matchday number for a league.
 * OpenLigaDB: /getcurrentgroup/{league}
 */
export async function getCurrentMatchday(leagueShortcut: string): Promise<number> {
  const data = await apiFetch(`/getcurrentgroup/${leagueShortcut}`);
  return data?.groupOrderID || 1;
}

/**
 * Get head-to-head between two teams by filtering season matches.
 * OpenLigaDB doesn't have a direct H2H endpoint, so we filter from full season data.
 */
export async function getH2H(team1: string, team2: string, leagueShortcut: string = 'bl1', seasonsBack: number = 3): Promise<OpenLigaMatch[]> {
  const currentSeason = getCurrentSeason();
  const h2hMatches: OpenLigaMatch[] = [];

  for (let i = 0; i < seasonsBack; i++) {
    const s = currentSeason - i;
    const data = await apiFetch(`/getmatchdata/${leagueShortcut}/${s}`);
    if (!Array.isArray(data)) continue;

    for (const raw of data) {
      if (!raw.matchIsFinished) continue;
      const t1 = (raw.team1?.teamName || '').toLowerCase();
      const t2 = (raw.team2?.teamName || '').toLowerCase();
      const q1 = team1.toLowerCase();
      const q2 = team2.toLowerCase();

      if ((t1.includes(q1) || q1.includes(t1)) && (t2.includes(q2) || q2.includes(t2)) ||
          (t1.includes(q2) || q2.includes(t1)) && (t2.includes(q1) || q1.includes(t2))) {
        const parsed = parseMatch(raw);
        if (parsed) h2hMatches.push(parsed);
      }
    }
  }

  return h2hMatches;
}

/**
 * Get available leagues list from the API.
 */
export async function getAvailableLeagues(): Promise<any[]> {
  const data = await apiFetch('/getavailableleagues');
  if (!Array.isArray(data)) return [];
  return data;
}

// ─── Types (additions) ───────────────────────────────────────────────────────

export interface OpenLigaGoal {
  scorer: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  isPenalty: boolean;
  isOwnGoal: boolean;
}
