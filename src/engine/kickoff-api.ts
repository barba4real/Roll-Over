/**
 * KickoffAPI client
 * Free plan: 100 requests/day, all endpoints accessible
 * https://docs.kickoffapi.com/
 *
 * Provides: team stats, H2H, fixtures, standings, predictions
 * Uses Tauri Rust backend for HTTP (CORS bypass)
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://api.kickoffapi.com/api/v1';

let apiKey: string | null = null;

export function setKickoffApiKey(key: string) {
  apiKey = key;
  localStorage.setItem('rollover_kickoff_api_key', key);
}

export function getKickoffApiKey(): string | null {
  if (!apiKey) {
    apiKey = localStorage.getItem('rollover_kickoff_api_key');
  }
  return apiKey;
}

// Track daily usage (reset at midnight UTC)
const USAGE_KEY = 'rollover_kickoff_usage';
interface UsageTracker {
  date: string; // YYYY-MM-DD
  count: number;
}

function getUsage(): UsageTracker {
  try {
    const data = localStorage.getItem(USAGE_KEY);
    if (data) {
      const usage = JSON.parse(data);
      const today = new Date().toISOString().split('T')[0];
      if (usage.date === today) return usage;
    }
  } catch { /* ignore */ }
  return { date: new Date().toISOString().split('T')[0], count: 0 };
}

function incrementUsage(): void {
  const usage = getUsage();
  usage.count++;
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

export function getRemainingQuota(): number {
  return Math.max(0, 100 - getUsage().count);
}

async function apiFetch(endpoint: string, params?: Record<string, string | number>): Promise<any> {
  const key = getKickoffApiKey();
  if (!key) throw new Error('KickoffAPI key not set. Get a free key at kickoffapi.com');

  if (getRemainingQuota() <= 0) {
    throw new Error('KickoffAPI daily limit reached (100/day). Resets at midnight UTC.');
  }

  let url = `${API_HOST}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => searchParams.set(k, String(v)));
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    'x-api-key': key,
    'Accept': 'application/json',
  };

  const result = await httpGet(url, headers);
  incrementUsage();
  return result;
}

// Rate limiter: 1 request per second to be safe
let lastRequestTime = 0;
async function rateLimitedFetch(endpoint: string, params?: Record<string, string | number>): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise(r => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
  return apiFetch(endpoint, params);
}

// ─── League ID mapping ───────────────────────────────────────────────────────

export const KICKOFF_LEAGUES: Record<string, number> = {
  'PL': 39,    // Premier League
  'BL1': 78,   // Bundesliga
  'SA': 135,   // Serie A
  'PD': 140,   // La Liga
  'FL1': 61,   // Ligue 1
  'DED': 88,   // Eredivisie
  'PPL': 94,   // Primeira Liga
  'CL': 2,     // Champions League
  'ELC': 40,   // Championship
  'BSA': 71,   // Serie A Brazil
};

// Current season year
function getCurrentSeason(): number {
  const now = new Date();
  // Football seasons span two calendar years. If we're past July, it's the new season.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

// ─── Public API methods ──────────────────────────────────────────────────────

/**
 * Get team season statistics (goals, form, wins, etc.)
 * Cost: 1 request
 */
export async function getTeamStats(teamId: number, leagueId: number): Promise<KickoffTeamStats | null> {
  try {
    const season = getCurrentSeason();
    const data = await rateLimitedFetch('/team-statistics', {
      team: teamId,
      league: leagueId,
      season,
    });
    if (data?.response?.[0]) {
      return parseTeamStats(data.response[0]);
    }
    return null;
  } catch (e) {
    console.error('KickoffAPI team-statistics failed:', e);
    return null;
  }
}

/**
 * Get head-to-head between two teams
 * Cost: 1 request
 */
export async function getHeadToHead(team1Id: number, team2Id: number): Promise<KickoffH2HResult | null> {
  try {
    const data = await rateLimitedFetch('/headtohead', {
      h2h: `${team1Id}-${team2Id}`,
    });
    if (data?.response) {
      return parseH2H(data.response, team1Id, team2Id);
    }
    return null;
  } catch (e) {
    console.error('KickoffAPI headtohead failed:', e);
    return null;
  }
}

/**
 * Get league standings (form strings, positions, W/D/L records)
 * Cost: 1 request
 */
export async function getLeagueStandings(leagueId: number): Promise<KickoffStanding[] | null> {
  try {
    const season = getCurrentSeason();
    const data = await rateLimitedFetch('/standings', {
      league: leagueId,
      season,
    });
    if (data?.response) {
      return data.response.map((entry: any) => ({
        rank: entry.rank,
        teamId: entry.team?.id,
        teamName: entry.team?.name,
        points: entry.points,
        form: entry.form || '',
        played: entry.all?.played || 0,
        wins: entry.all?.win || 0,
        draws: entry.all?.draw || 0,
        losses: entry.all?.lose || 0,
        goalsFor: entry.all?.goals?.for || 0,
        goalsAgainst: entry.all?.goals?.against || 0,
      }));
    }
    return null;
  } catch (e) {
    console.error('KickoffAPI standings failed:', e);
    return null;
  }
}

/**
 * Get fixture prediction (AI-based)
 * Cost: 1 request
 */
export async function getPrediction(fixtureId: number): Promise<KickoffPrediction | null> {
  try {
    const data = await rateLimitedFetch('/predictions', {
      fixture: fixtureId,
    });
    if (data?.response?.[0]) {
      const pred = data.response[0];
      return {
        winnerId: pred.winner?.id || null,
        winnerName: pred.winner?.name || null,
        winOrDraw: pred.winOrDraw || false,
        underOver: pred.underOver || null,
        advice: pred.advice || null,
        homePercent: parseInt(pred.percent?.home || '0'),
        drawPercent: parseInt(pred.percent?.draw || '0'),
        awayPercent: parseInt(pred.percent?.away || '0'),
      };
    }
    return null;
  } catch (e) {
    console.error('KickoffAPI predictions failed:', e);
    return null;
  }
}

/**
 * Get upcoming fixtures for a league
 * Cost: 1 request
 */
export async function getUpcomingFixtures(leagueId: number, days: number = 7): Promise<KickoffFixture[]> {
  try {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    const data = await rateLimitedFetch('/fixtures', {
      league: leagueId,
      season: getCurrentSeason(),
      from: today.toISOString().split('T')[0],
      to: endDate.toISOString().split('T')[0],
    });

    if (data?.response) {
      return data.response.map((f: any) => ({
        id: f.id,
        date: f.date,
        homeTeam: { id: f.homeTeam?.id || 0, name: f.homeTeam?.name || '', goals: f.homeTeam?.goals },
        awayTeam: { id: f.awayTeam?.id || 0, name: f.awayTeam?.name || '', goals: f.awayTeam?.goals },
        statusShort: f.statusShort || 'NS',
      }));
    }
    return [];
  } catch (e) {
    console.error('KickoffAPI fixtures failed:', e);
    return [];
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KickoffTeamStats {
  played: { home: number; away: number; total: number };
  wins: { home: number; away: number; total: number };
  draws: { home: number; away: number; total: number };
  losses: { home: number; away: number; total: number };
  goalsFor: { home: number; away: number; total: number };
  goalsAgainst: { home: number; away: number; total: number };
  cleanSheets: { home: number; away: number; total: number };
  form: string; // e.g., "WWDLW"
  homeWinRate: number;
  awayWinRate: number;
  overallWinRate: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  over25Pct: number;  // Matches with 3+ goals percentage
  bttsPct: number;    // Both teams scored percentage
}

export interface KickoffH2HResult {
  total: number;
  team1Wins: number;
  team2Wins: number;
  draws: number;
  matches: {
    date: string;
    homeTeam: string;
    awayTeam: string;
    homeGoals: number;
    awayGoals: number;
  }[];
  avgGoals: number;
  bttsPct: number;
}

export interface KickoffStanding {
  rank: number;
  teamId: number;
  teamName: string;
  points: number;
  form: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface KickoffPrediction {
  winnerId: number | null;
  winnerName: string | null;
  winOrDraw: boolean;
  underOver: string | null;
  advice: string | null;
  homePercent: number;
  drawPercent: number;
  awayPercent: number;
}

export interface KickoffFixture {
  id: number;
  date: string;
  homeTeam: { id: number; name: string; goals: number | null };
  awayTeam: { id: number; name: string; goals: number | null };
  statusShort: string;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseTeamStats(raw: any): KickoffTeamStats {
  const fixtures = raw.fixtures || {};
  const goals = raw.goals || {};

  const playedHome = fixtures.played?.home || 0;
  const playedAway = fixtures.played?.away || 0;
  const playedTotal = fixtures.played?.total || (playedHome + playedAway);

  const winsHome = fixtures.wins?.home || 0;
  const winsAway = fixtures.wins?.away || 0;
  const winsTotal = fixtures.wins?.total || (winsHome + winsAway);

  const drawsHome = fixtures.draws?.home || 0;
  const drawsAway = fixtures.draws?.away || 0;
  const drawsTotal = fixtures.draws?.total || (drawsHome + drawsAway);

  const lossesHome = fixtures.loses?.home || 0;
  const lossesAway = fixtures.loses?.away || 0;
  const lossesTotal = fixtures.loses?.total || (lossesHome + lossesAway);

  const goalsForHome = goals.for?.total?.home || 0;
  const goalsForAway = goals.for?.total?.away || 0;
  const goalsForTotal = goals.for?.total?.total || (goalsForHome + goalsForAway);

  const goalsAgainstHome = goals.against?.total?.home || 0;
  const goalsAgainstAway = goals.against?.total?.away || 0;
  const goalsAgainstTotal = goals.against?.total?.total || (goalsAgainstHome + goalsAgainstAway);

  const cleanSheetsHome = raw.clean_sheet?.home || 0;
  const cleanSheetsAway = raw.clean_sheet?.away || 0;
  const cleanSheetsTotal = raw.clean_sheet?.total || (cleanSheetsHome + cleanSheetsAway);

  // Calculate derived stats
  const safeDiv = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;
  const avgGoalsFor = playedTotal > 0 ? Math.round((goalsForTotal / playedTotal) * 10) / 10 : 0;
  const avgGoalsAgainst = playedTotal > 0 ? Math.round((goalsAgainstTotal / playedTotal) * 10) / 10 : 0;

  // Estimate O2.5% from average goals (approximation without per-match data)
  const avgTotalGoals = avgGoalsFor + avgGoalsAgainst;
  const over25Pct = avgTotalGoals >= 3.5 ? 80 : avgTotalGoals >= 2.8 ? 65 : avgTotalGoals >= 2.2 ? 50 : 35;

  // Estimate BTTS% from scoring and conceding rates
  const scoringRate = playedTotal > 0 ? (playedTotal - (raw.failed_to_score?.total || 0)) / playedTotal : 0.7;
  const concedingRate = playedTotal > 0 ? (playedTotal - cleanSheetsTotal) / playedTotal : 0.6;
  const bttsPct = Math.round(scoringRate * concedingRate * 100);

  return {
    played: { home: playedHome, away: playedAway, total: playedTotal },
    wins: { home: winsHome, away: winsAway, total: winsTotal },
    draws: { home: drawsHome, away: drawsAway, total: drawsTotal },
    losses: { home: lossesHome, away: lossesAway, total: lossesTotal },
    goalsFor: { home: goalsForHome, away: goalsForAway, total: goalsForTotal },
    goalsAgainst: { home: goalsAgainstHome, away: goalsAgainstAway, total: goalsAgainstTotal },
    cleanSheets: { home: cleanSheetsHome, away: cleanSheetsAway, total: cleanSheetsTotal },
    form: raw.form || '',
    homeWinRate: safeDiv(winsHome, playedHome),
    awayWinRate: safeDiv(winsAway, playedAway),
    overallWinRate: safeDiv(winsTotal, playedTotal),
    avgGoalsFor,
    avgGoalsAgainst,
    over25Pct,
    bttsPct,
  };
}

function parseH2H(matches: any[], team1Id: number, team2Id: number): KickoffH2HResult {
  let team1Wins = 0;
  let team2Wins = 0;
  let draws = 0;
  let totalGoals = 0;
  let bttsCount = 0;

  const parsed = matches.slice(0, 10).map((m: any) => {
    const homeGoals = m.goals?.home ?? m.homeTeam?.goals ?? 0;
    const awayGoals = m.goals?.away ?? m.awayTeam?.goals ?? 0;
    const homeId = m.teams?.home?.id ?? m.homeTeam?.id;
    const awayId = m.teams?.away?.id ?? m.awayTeam?.id;

    totalGoals += homeGoals + awayGoals;
    if (homeGoals > 0 && awayGoals > 0) bttsCount++;

    if (homeGoals > awayGoals) {
      if (homeId === team1Id) team1Wins++;
      else team2Wins++;
    } else if (awayGoals > homeGoals) {
      if (awayId === team1Id) team1Wins++;
      else team2Wins++;
    } else {
      draws++;
    }

    return {
      date: m.date || m.fixture?.date || '',
      homeTeam: m.teams?.home?.name || m.homeTeam?.name || '',
      awayTeam: m.teams?.away?.name || m.awayTeam?.name || '',
      homeGoals,
      awayGoals,
    };
  });

  const total = parsed.length || 1;
  return {
    total: parsed.length,
    team1Wins,
    team2Wins,
    draws,
    matches: parsed,
    avgGoals: Math.round((totalGoals / total) * 10) / 10,
    bttsPct: Math.round((bttsCount / total) * 100),
  };
}
