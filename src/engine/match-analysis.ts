/**
 * Match Analysis Data Layer — Cache-First, Fetch-On-Demand
 *
 * Architecture:
 *   1. Check local DB for team data (instant, primary source)
 *   2. If data is FRESH (<24h) → serve directly, no API calls
 *   3. If data is STALE (>24h) → serve from DB immediately + fetch fresh in background
 *   4. If data is MISSING → fetch from APIs, save to DB, then display
 *
 * Sources queried on-demand (only when needed):
 *   - TheSportsDB: team last 5 results (free, no key)
 *   - Football-Data.org: team matches, standings (if key available)
 *   - ESPN Web API: standings (free)
 *
 * Every API result is persisted to SQLite so it never needs fetching twice.
 */

import {
  calculateForm,
  calculateH2H,
  predictMatch,
  getAllMatches,
  loadMatches,
  type TeamForm,
  type H2HRecord,
  type MatchPrediction,
} from './historical-stats';
import type { HistoricalMatch } from './football-data-uk';
import { httpGetDirect, httpGet } from '../lib/http';
import { findLeague } from './league-registry';
import { getTeamRecentResults } from './thesportsdb';
import {
  isTeamFresh,
  markTeamFresh,
  saveOnDemandResults,
  teamHasData,
} from '../lib/match-database';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MatchAnalysisData {
  homeTeam: string;
  awayTeam: string;
  league: string;
  leagueId: string;
  prediction: MatchPrediction;
  homeForm: FormData;
  awayForm: FormData;
  h2h: H2HData;
  standings: StandingsData | null;
  dataSources: string[];
}

export interface FormData {
  team: string;
  stats: TeamForm;
  matches: FormMatchRow[];
  source: string;
}

export interface FormMatchRow {
  date: string;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
  league: string;
  isHome: boolean;
}

export interface H2HData {
  record: H2HRecord;
  meetings: H2HMeetingRow[];
  source: string;
}

export interface H2HMeetingRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: 'H' | 'D' | 'A';
  league: string;
}

export interface StandingsData {
  leagueName: string;
  table: StandingsRow[];
  homePosition: number | null;
  awayPosition: number | null;
  source: string;
}

export interface StandingsRow {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string[];
  isHome: boolean;
  isAway: boolean;
}

// ─── Main Analysis Function ──────────────────────────────────────────────────

/**
 * Build full analysis for a fixture using cache-first strategy.
 *
 * Flow per team:
 *   1. Is team data fresh? → use DB directly
 *   2. Is team data stale? → use DB + fetch fresh in background (save for next time)
 *   3. Is team data missing? → fetch from APIs now, save, then build analysis
 */
export async function getMatchAnalysis(
  homeTeam: string,
  awayTeam: string,
  league: string,
  leagueId?: string
): Promise<MatchAnalysisData> {
  const resolvedLeagueId = leagueId || guessLeagueId(league);
  const dataSources: string[] = [];

  // ─── Step 1: Ensure we have data for both teams ──────────────────────────
  // Fetch on-demand if stale or missing (parallel for both teams)
  await Promise.allSettled([
    ensureTeamData(homeTeam, dataSources),
    ensureTeamData(awayTeam, dataSources),
  ]);

  // ─── Step 2: Build analysis from local data (now guaranteed to be populated) ─
  const homeForm = getLocalFormData(homeTeam, true);
  const awayForm = getLocalFormData(awayTeam, false);
  let h2h = getLocalH2HData(homeTeam, awayTeam);

  // If local DB has no H2H, try Flashscore for enrichment
  if (h2h.meetings.length === 0) {
    try {
      const { fetchMatchH2H } = await import('./flashscore');
      // We need a matchId — check if one was stored in sessionStorage from Scout
      const cachedFixtures = sessionStorage.getItem('rollover_fs_matchids');
      let matchId: string | null = null;
      if (cachedFixtures) {
        const parsed = JSON.parse(cachedFixtures);
        // Find match by team names
        const homeL = homeTeam.toLowerCase();
        const awayL = awayTeam.toLowerCase();
        matchId = parsed[`${homeL}|${awayL}`] || parsed[`${awayL}|${homeL}`] || null;
      }
      if (matchId) {
        const fsH2H = await fetchMatchH2H(matchId);
        if (fsH2H && fsH2H.headToHead.length > 0) {
          h2h = {
            record: {
              homeTeam, awayTeam,
              totalMatches: fsH2H.headToHead.length,
              homeWins: fsH2H.headToHead.filter(m => m.homeGoals > m.awayGoals).length,
              draws: fsH2H.headToHead.filter(m => m.homeGoals === m.awayGoals).length,
              awayWins: fsH2H.headToHead.filter(m => m.homeGoals < m.awayGoals).length,
              homeGoals: fsH2H.headToHead.reduce((s, m) => s + m.homeGoals, 0),
              awayGoals: fsH2H.headToHead.reduce((s, m) => s + m.awayGoals, 0),
              avgTotalGoals: Math.round((fsH2H.headToHead.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0) / fsH2H.headToHead.length) * 100) / 100,
              bttsRate: Math.round((fsH2H.headToHead.filter(m => m.homeGoals > 0 && m.awayGoals > 0).length / fsH2H.headToHead.length) * 100),
              over25Rate: Math.round((fsH2H.headToHead.filter(m => m.homeGoals + m.awayGoals >= 3).length / fsH2H.headToHead.length) * 100),
              lastMeetings: fsH2H.headToHead.map(m => ({ date: m.date, homeGoals: m.homeGoals, awayGoals: m.awayGoals, result: (m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D') as 'H'|'D'|'A' })),
            },
            meetings: fsH2H.headToHead.map(m => ({
              date: m.date, homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals,
              result: (m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D') as 'H'|'D'|'A',
              league: '',
            })),
            source: 'Flashscore',
          };
          dataSources.push('Flashscore (H2H)');
        }
      }
    } catch {}
  }

  if (homeForm.matches.length > 0) dataSources.push(`Home: ${homeForm.matches.length} matches`);
  if (awayForm.matches.length > 0) dataSources.push(`Away: ${awayForm.matches.length} matches`);
  if (h2h.meetings.length > 0 && !dataSources.some(s => s.includes('H2H'))) dataSources.push(`H2H: ${h2h.meetings.length} meetings`);

  // ─── Step 3: Standings (always live from ESPN/Football-Data.org) ──────────
  let standings: StandingsData | null = null;
  if (resolvedLeagueId) {
    standings = await fetchStandings(resolvedLeagueId, homeTeam, awayTeam);
    if (standings) dataSources.push(`Standings: ${standings.source}`);

    // Fallback to Football-Data.org
    if (!standings) {
      standings = await fetchFootballDataStandings(resolvedLeagueId, homeTeam, awayTeam);
      if (standings) dataSources.push(`Standings: ${standings.source}`);
    }
  }

  // ─── Step 4: Prediction (runs against all collected data) ────────────────
  const prediction = predictMatch(homeTeam, awayTeam, league);

  return {
    homeTeam,
    awayTeam,
    league,
    leagueId: resolvedLeagueId || '',
    prediction,
    homeForm,
    awayForm,
    h2h,
    standings,
    dataSources,
  };
}

// ─── On-Demand Team Data Fetching ────────────────────────────────────────────

/**
 * Ensure we have fresh data for a team.
 * If fresh → do nothing.
 * If stale/missing → fetch from TheSportsDB, save to DB + memory.
 */
async function ensureTeamData(team: string, sources: string[]): Promise<void> {
  // Already fresh? Skip API call entirely.
  if (isTeamFresh(team)) return;

  // Check if we have ANY data at all
  const hasData = await teamHasData(team);

  // Fetch fresh results from TheSportsDB (free, always available)
  try {
    const { teamId, results } = await getTeamRecentResults(team);
    if (results.length > 0) {
      // Convert to HistoricalMatch format and save to DB
      const matches: HistoricalMatch[] = results.map(r => ({
        division: r.league || '',
        date: r.date,
        time: '',
        homeTeam: r.home,
        awayTeam: r.away,
        ftHomeGoals: r.homeScore,
        ftAwayGoals: r.awayScore,
        ftResult: r.homeScore > r.awayScore ? 'H' as const :
                  r.homeScore < r.awayScore ? 'A' as const : 'D' as const,
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
        season: getCurrentSeason(),
        leagueId: '',
      }));

      // Save to DB (persists for future) + load into memory (immediate use)
      const saved = await saveOnDemandResults(matches, 'thesportsdb-ondemand');
      if (saved > 0) sources.push(`TheSportsDB: ${saved} new for ${team}`);
      markTeamFresh(team);
    } else if (hasData) {
      // TheSportsDB didn't return results but we have DB data — mark as fresh anyway
      markTeamFresh(team);
    }
  } catch (e) {
    // TheSportsDB failed — if we have DB data, use it (mark fresh to avoid retry spam)
    if (hasData) markTeamFresh(team);
    console.warn(`[MatchAnalysis] Failed to fetch fresh data for ${team}:`, e);
  }
}

// ─── Local DB Queries ────────────────────────────────────────────────────────

function getLocalFormData(team: string, isHome: boolean): FormData {
  const allMatches = getAllMatches();
  const normalizedTeam = team.toLowerCase();

  const teamMatches = allMatches
    .filter(m => {
      const field = isHome ? m.homeTeam : m.awayTeam;
      return field.toLowerCase().includes(normalizedTeam) || normalizedTeam.includes(field.toLowerCase());
    })
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, 20);

  const stats = calculateForm(team, teamMatches, isHome);

  const matches: FormMatchRow[] = teamMatches.map(m => {
    const gf = isHome ? m.ftHomeGoals : m.ftAwayGoals;
    const ga = isHome ? m.ftAwayGoals : m.ftHomeGoals;
    return {
      date: m.date,
      opponent: isHome ? m.awayTeam : m.homeTeam,
      goalsFor: gf,
      goalsAgainst: ga,
      result: gf > ga ? 'W' : gf === ga ? 'D' : 'L',
      league: m.leagueId || m.division || '',
      isHome,
    };
  });

  return { team, stats, matches, source: teamMatches.length > 0 ? 'Local DB' : 'None' };
}

function getLocalH2HData(homeTeam: string, awayTeam: string): H2HData {
  const allMatches = getAllMatches();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  const h2hMatches = allMatches
    .filter(m => {
      const mHome = m.homeTeam.toLowerCase();
      const mAway = m.awayTeam.toLowerCase();
      return (
        (mHome.includes(home) || home.includes(mHome)) && (mAway.includes(away) || away.includes(mAway)) ||
        (mHome.includes(away) || away.includes(mHome)) && (mAway.includes(home) || home.includes(mAway))
      );
    })
    .sort((a, b) => compareDates(b.date, a.date))
    .slice(0, 10);

  const record = calculateH2H(homeTeam, awayTeam, h2hMatches);

  const meetings: H2HMeetingRow[] = h2hMatches.map(m => ({
    date: m.date,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeGoals: m.ftHomeGoals,
    awayGoals: m.ftAwayGoals,
    result: m.ftResult,
    league: m.leagueId || m.division || '',
  }));

  return { record, meetings, source: h2hMatches.length > 0 ? 'Local DB' : 'None' };
}

// ─── ESPN Standings ──────────────────────────────────────────────────────────

const WEB_API = 'https://site.web.api.espn.com/apis/v2/sports/soccer';

async function fetchStandings(
  leagueId: string,
  homeTeam: string,
  awayTeam: string
): Promise<StandingsData | null> {
  const league = findLeague({ id: leagueId });
  if (!league?.espnSlug) return null;

  try {
    const url = `${WEB_API}/${league.espnSlug}/standings`;
    const data: any = await httpGetDirect(url, {});
    if (!data?.children && !data?.standings) return null;

    const groups = data.children || [data];
    const table: StandingsRow[] = [];

    for (const group of groups) {
      const entries = group.standings?.entries || group.entries || [];
      for (const entry of entries) {
        const teamName = entry.team?.displayName || entry.team?.name || '';
        const stats = entry.stats || [];
        const getStat = (name: string): number => {
          const s = stats.find((st: any) => st.name === name || st.abbreviation === name);
          return s?.value != null ? (typeof s.value === 'number' ? s.value : parseInt(s.displayValue || '0')) : 0;
        };

        table.push({
          position: table.length + 1,
          team: teamName,
          played: getStat('gamesPlayed') || getStat('GP'),
          won: getStat('wins') || getStat('W'),
          drawn: getStat('ties') || getStat('D'),
          lost: getStat('losses') || getStat('L'),
          goalsFor: getStat('pointsFor') || getStat('GF'),
          goalsAgainst: getStat('pointsAgainst') || getStat('GA'),
          goalDifference: getStat('pointDifferential') || getStat('GD'),
          points: getStat('points') || getStat('P'),
          form: [],
          isHome: fuzzyMatch(teamName, homeTeam),
          isAway: fuzzyMatch(teamName, awayTeam),
        });
      }
    }

    table.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
    table.forEach((row, i) => row.position = i + 1);

    if (table.length === 0) return null;

    return {
      leagueName: league.name,
      table,
      homePosition: table.find(r => r.isHome)?.position || null,
      awayPosition: table.find(r => r.isAway)?.position || null,
      source: 'ESPN',
    };
  } catch {
    return null;
  }
}

// ─── Football-Data.org Standings (fallback) ──────────────────────────────────

async function fetchFootballDataStandings(
  leagueId: string,
  homeTeam: string,
  awayTeam: string
): Promise<StandingsData | null> {
  const key = localStorage.getItem('rollover_footballdata_key');
  if (!key) return null;

  const league = findLeague({ id: leagueId });
  if (!league?.footballDataCode) return null;

  try {
    const url = `https://api.football-data.org/v4/competitions/${league.footballDataCode}/standings`;
    const data: any = await httpGet(url, { 'X-Auth-Token': key, 'Accept': 'application/json' });
    if (!data?.standings) return null;

    const table: StandingsRow[] = [];
    for (const group of data.standings) {
      if (group.type !== 'TOTAL') continue;
      for (const entry of group.table || []) {
        const teamName = entry.team?.name || entry.team?.shortName || '';
        table.push({
          position: entry.position || table.length + 1,
          team: teamName,
          played: entry.playedGames || 0,
          won: entry.won || 0,
          drawn: entry.draw || 0,
          lost: entry.lost || 0,
          goalsFor: entry.goalsFor || 0,
          goalsAgainst: entry.goalsAgainst || 0,
          goalDifference: entry.goalDifference || 0,
          points: entry.points || 0,
          form: (entry.form || '').split(',').filter(Boolean),
          isHome: fuzzyMatch(teamName, homeTeam),
          isAway: fuzzyMatch(teamName, awayTeam),
        });
      }
    }

    if (table.length === 0) return null;

    return {
      leagueName: league.name,
      table,
      homePosition: table.find(r => r.isHome)?.position || null,
      awayPosition: table.find(r => r.isAway)?.position || null,
      source: 'Football-Data.org',
    };
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compareDates(a: string, b: string): number {
  const parseDate = (d: string): number => {
    if (d.includes('/')) {
      const parts = d.split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        return new Date(parseInt(year.length === 2 ? `20${year}` : year), parseInt(month) - 1, parseInt(day)).getTime();
      }
    }
    return new Date(d).getTime() || 0;
  };
  return parseDate(a) - parseDate(b);
}

function fuzzyMatch(name1: string, name2: string): boolean {
  const a = name1.toLowerCase().replace(/\s+(fc|afc|sc|cf)$/i, '').trim();
  const b = name2.toLowerCase().replace(/\s+(fc|afc|sc|cf)$/i, '').trim();
  return a.includes(b) || b.includes(a);
}

function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

function guessLeagueId(leagueName: string): string | null {
  if (!leagueName) return null;
  const name = leagueName.toLowerCase();
  const guesses: Record<string, string> = {
    'premier league': 'eng-premier-league',
    'la liga': 'esp-la-liga',
    'bundesliga': 'ger-bundesliga',
    'serie a': 'ita-serie-a',
    'ligue 1': 'fra-ligue-1',
    'eredivisie': 'ned-eredivisie',
    'primeira liga': 'por-primeira-liga',
    'championship': 'eng-championship',
    'champions league': 'uefa-champions-league',
    'europa league': 'uefa-europa-league',
    'scottish premiership': 'sco-premiership',
    'mls': 'usa-mls',
    'liga mx': 'mex-liga-mx',
    'belgian pro league': 'bel-pro-league',
    'super lig': 'tur-super-lig',
    'j-league': 'jpn-j-league',
    'a-league': 'aus-a-league',
    'liga profesional': 'arg-liga-profesional',
    'serie a brazil': 'bra-serie-a',
  };
  for (const [key, id] of Object.entries(guesses)) {
    if (name.includes(key)) return id;
  }
  return null;
}
