/**
 * StatsBomb Open Data Engine
 *
 * Data source: https://github.com/statsbomb/open-data
 * Free, no key, no rate limit — static JSON files on GitHub.
 *
 * Provides:
 *   - Match results with scores
 *   - xG (expected goals) per shot — premium analytics data
 *   - Full event data: shots, passes, tackles per match
 *   - Lineups per match
 *
 * Coverage (verified):
 *   - La Liga: 2005-2021 (full seasons)
 *   - Champions League: 1999-2019 (select matches)
 *   - Premier League: 2015/16, 2003/04
 *   - Bundesliga: 2023/24
 *   - Ligue 1: 2015/16, 2021/22, 2022/23
 *   - Serie A: 2015/16
 *   - Various World Cups, Euros, Women's leagues
 *
 * Limitations:
 *   - Not live data — historical only
 *   - Coverage is selective (not every season for every league)
 *   - Large event files (~2MB per match) — fetch only when needed
 *
 * URL patterns:
 *   Competitions: /data/competitions.json
 *   Matches:      /data/matches/{competition_id}/{season_id}.json
 *   Events:       /data/events/{match_id}.json
 *   Lineups:      /data/lineups/{match_id}.json
 */

import { httpGetDirect } from '../lib/http';
import type { HistoricalMatch } from './football-data-uk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatsBombCompetition {
  competition_id: number;
  season_id: number;
  competition_name: string;
  season_name: string;
  country_name: string;
  competition_gender: string;
}

export interface StatsBombMatch {
  match_id: number;
  match_date: string;           // "YYYY-MM-DD"
  kick_off: string;             // "HH:MM:SS.000"
  home_team: { home_team_name: string; home_team_id: number };
  away_team: { away_team_name: string; away_team_id: number };
  home_score: number;
  away_score: number;
  competition: { competition_name: string; competition_id: number };
  season: { season_name: string; season_id: number };
}

export interface StatsBombShotEvent {
  player: { name: string; id: number };
  team: { name: string };
  shot: {
    statsbomb_xg: number;
    outcome: { name: string };   // "Goal", "Saved", "Off T", "Blocked", etc.
    type: { name: string };      // "Open Play", "Free Kick", "Penalty"
  };
  minute: number;
  second: number;
}

export interface MatchXgSummary {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  date: string;
  homeXg: number;
  awayXg: number;
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';

// Map league-registry IDs to StatsBomb competition_id + season_id pairs
export const STATSBOMB_LEAGUES: { leagueId: string; competitionId: number; seasonIds: number[]; name: string }[] = [
  { leagueId: 'eng-premier-league', competitionId: 2, seasonIds: [27, 44], name: 'Premier League' },
  { leagueId: 'esp-la-liga', competitionId: 11, seasonIds: [90, 42, 4, 1, 2, 27, 26, 25, 24, 23, 22, 21, 41, 40, 39, 38, 37], name: 'La Liga' },
  { leagueId: 'ger-bundesliga', competitionId: 9, seasonIds: [281, 27], name: 'Bundesliga' },
  { leagueId: 'fra-ligue-1', competitionId: 7, seasonIds: [235, 108, 27], name: 'Ligue 1' },
  { leagueId: 'ita-serie-a', competitionId: 12, seasonIds: [27], name: 'Serie A' },
  { leagueId: 'uefa-champions-league', competitionId: 16, seasonIds: [4, 1, 2, 27, 26, 25, 24, 23, 22, 21, 41, 39, 37, 44], name: 'Champions League' },
];

// ─── Data Fetching ───────────────────────────────────────────────────────────

/**
 * Fetch the full competitions list from StatsBomb.
 */
export async function getCompetitions(): Promise<StatsBombCompetition[]> {
  try {
    const data = await httpGetDirect(`${BASE_URL}/competitions.json`, {});
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch all matches for a competition/season.
 */
export async function getMatches(competitionId: number, seasonId: number): Promise<StatsBombMatch[]> {
  try {
    const data = await httpGetDirect(`${BASE_URL}/matches/${competitionId}/${seasonId}.json`, {});
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch event data for a match (contains xG per shot).
 * WARNING: Large files (~1-3MB). Only fetch when specifically needed for xG analysis.
 */
export async function getMatchEvents(matchId: number): Promise<any[]> {
  try {
    const data = await httpGetDirect(`${BASE_URL}/events/${matchId}.json`, {});
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

/**
 * Extract xG summary from match events.
 * Returns total xG for each team + shot counts.
 */
export function extractXgFromEvents(events: any[], homeTeamName: string): MatchXgSummary | null {
  const shots = events.filter((e: any) => e.type?.name === 'Shot');
  if (shots.length === 0) return null;

  let homeXg = 0, awayXg = 0;
  let homeShots = 0, awayShots = 0;
  let homeSoT = 0, awaySoT = 0;

  for (const shot of shots) {
    const xg = shot.shot?.statsbomb_xg || 0;
    const isHome = shot.team?.name?.toLowerCase().includes(homeTeamName.toLowerCase()) ||
                   homeTeamName.toLowerCase().includes(shot.team?.name?.toLowerCase() || '');
    const onTarget = shot.shot?.outcome?.name === 'Goal' || shot.shot?.outcome?.name === 'Saved';

    if (isHome) {
      homeXg += xg;
      homeShots++;
      if (onTarget) homeSoT++;
    } else {
      awayXg += xg;
      awayShots++;
      if (onTarget) awaySoT++;
    }
  }

  return {
    matchId: 0,
    homeTeam: homeTeamName,
    awayTeam: '',
    date: '',
    homeXg: Math.round(homeXg * 100) / 100,
    awayXg: Math.round(awayXg * 100) / 100,
    homeGoals: 0,
    awayGoals: 0,
    homeShots,
    awayShots,
    homeShotsOnTarget: homeSoT,
    awayShotsOnTarget: awaySoT,
  };
}

// ─── Bulk Import (for Sync Data) ─────────────────────────────────────────────

/**
 * Fetch all StatsBomb matches for configured leagues and convert to HistoricalMatch format.
 * Does NOT fetch event-level data (too large for bulk). Only match results.
 *
 * Good for populating the local DB with results from La Liga 2005-2021,
 * Champions League, etc.
 */
export async function fetchAllResults(maxSeasonsPerLeague: number = 3): Promise<HistoricalMatch[]> {
  const allMatches: HistoricalMatch[] = [];

  for (const league of STATSBOMB_LEAGUES) {
    const seasonsToFetch = league.seasonIds.slice(0, maxSeasonsPerLeague);

    for (const seasonId of seasonsToFetch) {
      try {
        const matches = await getMatches(league.competitionId, seasonId);
        for (const m of matches) {
          allMatches.push({
            division: league.leagueId,
            date: formatDate(m.match_date),
            time: m.kick_off?.slice(0, 5) || '',
            homeTeam: m.home_team.home_team_name,
            awayTeam: m.away_team.away_team_name,
            ftHomeGoals: m.home_score,
            ftAwayGoals: m.away_score,
            ftResult: m.home_score > m.away_score ? 'H' :
                      m.home_score < m.away_score ? 'A' : 'D',
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
            season: m.season.season_name || '',
            leagueId: league.leagueId,
          });
        }
      } catch {
        // Skip failed seasons
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`[StatsBomb] Fetched ${allMatches.length} matches from ${STATSBOMB_LEAGUES.length} leagues`);
  return allMatches;
}

/**
 * Fetch xG data for a specific team's recent matches (on-demand for analysis).
 * Finds matches involving the team and extracts xG summaries.
 * Limited to matches where event data is available.
 */
export async function getTeamXgHistory(
  teamName: string,
  competitionId: number = 11,  // Default: La Liga (best coverage)
  seasonId: number = 90        // Default: 2020/21
): Promise<MatchXgSummary[]> {
  const matches = await getMatches(competitionId, seasonId);
  const teamMatches = matches.filter(m =>
    m.home_team.home_team_name.toLowerCase().includes(teamName.toLowerCase()) ||
    m.away_team.away_team_name.toLowerCase().includes(teamName.toLowerCase())
  ).slice(0, 5); // Limit to 5 (event files are large)

  const summaries: MatchXgSummary[] = [];
  for (const match of teamMatches) {
    try {
      const events = await getMatchEvents(match.match_id);
      const xg = extractXgFromEvents(events, match.home_team.home_team_name);
      if (xg) {
        xg.matchId = match.match_id;
        xg.homeTeam = match.home_team.home_team_name;
        xg.awayTeam = match.away_team.away_team_name;
        xg.date = match.match_date;
        xg.homeGoals = match.home_score;
        xg.awayGoals = match.away_score;
        summaries.push(xg);
      }
    } catch {
      // Skip failed event fetches
    }
  }

  return summaries;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert YYYY-MM-DD to DD/MM/YYYY (HistoricalMatch format).
 */
function formatDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Check if StatsBomb has data for a given league.
 */
export function isLeagueCovered(leagueId: string): boolean {
  return STATSBOMB_LEAGUES.some(l => l.leagueId === leagueId);
}

/**
 * Get StatsBomb config for a league.
 */
export function getLeagueConfig(leagueId: string) {
  return STATSBOMB_LEAGUES.find(l => l.leagueId === leagueId);
}
