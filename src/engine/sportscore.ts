/**
 * SportScore / Live Score Client
 * Used for: live match results, kick-off tracking, auto-settlement
 *
 * Strategy: Uses Football-Data.org (if key available) or ESPN (no key) for live results.
 * SportScore itself requires RapidAPI subscription, so we use free alternatives
 * for the same functionality (live scores + finished results).
 *
 * Fallback chain for live results:
 *   1. Football-Data.org /matches?date=today (if key set)
 *   2. ESPN scoreboard (no key, always available)
 *   3. OpenLigaDB recent results (no key, German leagues)
 */

import { httpGet } from '../lib/http';
import { getFootballDataKey } from './football-data-org';
import { getTodayResults as getEspnResults } from './espn';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LiveMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  status: 'scheduled' | 'in_play' | 'halftime' | 'finished' | 'postponed' | 'cancelled';
  minute?: number;
  homeScore: number | null;
  awayScore: number | null;
  kickOff: string; // ISO date
  league?: string;
  provider: string; // Which source provided this result
}

export interface MatchResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'finished';
  finishedAt: string;
}

// ─── Live Results Cache ──────────────────────────────────────────────────────

const LIVE_CACHE_KEY = 'rollover_live_results_cache';
const LIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface LiveCacheEntry {
  matches: LiveMatch[];
  cachedAt: number;
}

function getCachedLiveResults(): LiveMatch[] | null {
  try {
    const data = localStorage.getItem(LIVE_CACHE_KEY);
    if (!data) return null;
    const entry: LiveCacheEntry = JSON.parse(data);
    if (Date.now() - entry.cachedAt < LIVE_CACHE_TTL) {
      return entry.matches;
    }
  } catch { /* ignore */ }
  return null;
}

function setCachedLiveResults(matches: LiveMatch[]): void {
  try {
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ matches, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

// ─── API Functions ───────────────────────────────────────────────────────────

/**
 * Get today's live and recently finished matches.
 * Uses fallback chain: Football-Data.org → ESPN → cached results.
 */
export async function getLiveMatches(): Promise<LiveMatch[]> {
  // Check cache first
  const cached = getCachedLiveResults();
  if (cached) return cached;

  const allMatches: LiveMatch[] = [];

  // Try Football-Data.org first (if key available)
  const fdKey = getFootballDataKey();
  if (fdKey) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const url = `https://api.football-data.org/v4/matches?date=${today}`;
      const headers = { 'X-Auth-Token': fdKey, 'Accept': 'application/json' };
      const result: any = await httpGet(url, headers);

      if (result?.matches) {
        for (const m of result.matches) {
          allMatches.push({
            id: m.id?.toString() || '',
            homeTeam: m.homeTeam?.name || m.homeTeam?.shortName || '',
            awayTeam: m.awayTeam?.name || m.awayTeam?.shortName || '',
            status: mapFDStatus(m.status),
            minute: m.minute || undefined,
            homeScore: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
            awayScore: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
            kickOff: m.utcDate || '',
            league: m.competition?.name,
            provider: 'Football-Data.org',
          });
        }
      }
    } catch (e) {
      console.error('Football-Data.org live results failed:', e);
    }
  }

  // Also try ESPN (no key needed, always available)
  try {
    const espnResults = await getEspnResults();
    for (const e of espnResults) {
      // Don't duplicate matches already from Football-Data.org
      const alreadyHave = allMatches.some(m =>
        m.homeTeam.toLowerCase().includes(e.homeTeam.toLowerCase().slice(0, 6)) &&
        m.awayTeam.toLowerCase().includes(e.awayTeam.toLowerCase().slice(0, 6))
      );
      if (!alreadyHave) {
        allMatches.push({
          id: e.id?.toString() || '',
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          status: e.status === 'post' ? 'finished' : e.status === 'in' ? 'in_play' : 'scheduled',
          homeScore: e.homeScore ?? null,
          awayScore: e.awayScore ?? null,
          kickOff: e.kickOff || '',
          league: e.leagueName,
          provider: 'ESPN',
        });
      }
    }
  } catch (e) {
    console.error('ESPN live results failed:', e);
  }

  if (allMatches.length > 0) {
    setCachedLiveResults(allMatches);
  }

  return allMatches;
}

/**
 * Check if a specific match has finished and get the result.
 * Matches by team names (fuzzy).
 */
export function findMatchResult(
  liveMatches: LiveMatch[],
  homeTeam: string,
  awayTeam: string
): LiveMatch | null {
  const homeNorm = homeTeam.toLowerCase();
  const awayNorm = awayTeam.toLowerCase();

  return liveMatches.find(m => {
    const mHome = m.homeTeam.toLowerCase();
    const mAway = m.awayTeam.toLowerCase();
    return (mHome.includes(homeNorm) || homeNorm.includes(mHome)) &&
           (mAway.includes(awayNorm) || awayNorm.includes(mAway));
  }) || null;
}

/**
 * Determine if a pick won based on the match result.
 */
export function evaluatePickResult(
  match: LiveMatch,
  pick: string,
  pickCategory: string,
  marketType: string
): 'won' | 'lost' | 'pending' {
  if (match.status !== 'finished' || match.homeScore === null || match.awayScore === null) {
    return 'pending';
  }

  const homeScore = match.homeScore;
  const awayScore = match.awayScore;
  const totalGoals = homeScore + awayScore;

  switch (pickCategory) {
    case 'home':
      if (marketType === '1x2') return homeScore > awayScore ? 'won' : 'lost';
      if (marketType === 'double_chance') return homeScore >= awayScore ? 'won' : 'lost';
      break;
    case 'away':
      if (marketType === '1x2') return awayScore > homeScore ? 'won' : 'lost';
      if (marketType === 'double_chance') return awayScore >= homeScore ? 'won' : 'lost';
      break;
    case 'draw':
      return homeScore === awayScore ? 'won' : 'lost';
    case 'home_or_draw':
      return homeScore >= awayScore ? 'won' : 'lost';
    case 'draw_or_away':
      return awayScore >= homeScore ? 'won' : 'lost';
    case 'home_or_away':
      return homeScore !== awayScore ? 'won' : 'lost';
    case 'over': {
      const threshold = parseFloat(pick.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals > threshold ? 'won' : 'lost';
    }
    case 'under': {
      const threshold = parseFloat(pick.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals < threshold ? 'won' : 'lost';
    }
    case 'yes':
      if (marketType === 'gg_ng') return (homeScore > 0 && awayScore > 0) ? 'won' : 'lost';
      break;
    case 'no':
      if (marketType === 'gg_ng') return (homeScore === 0 || awayScore === 0) ? 'won' : 'lost';
      break;
  }

  return 'pending'; // Can't determine (complex market)
}

/**
 * Auto-settle pending picks against live results.
 */
export function autoSettleFromLive(
  pendingSelections: Array<{ id: string; homeTeam: string; awayTeam: string; pick: string; pickCategory: string; marketType: string }>,
  liveMatches: LiveMatch[]
): Array<{ id: string; result: 'won' | 'lost' }> {
  const settled: Array<{ id: string; result: 'won' | 'lost' }> = [];

  for (const sel of pendingSelections) {
    const match = findMatchResult(liveMatches, sel.homeTeam, sel.awayTeam);
    if (!match || match.status !== 'finished') continue;

    const result = evaluatePickResult(match, sel.pick, sel.pickCategory, sel.marketType);
    if (result !== 'pending') {
      settled.push({ id: sel.id, result });
    }
  }

  return settled;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapFDStatus(apiStatus: string): LiveMatch['status'] {
  switch (apiStatus) {
    case 'SCHEDULED': case 'TIMED': return 'scheduled';
    case 'IN_PLAY': case 'LIVE': return 'in_play';
    case 'PAUSED': case 'HALFTIME': return 'halftime';
    case 'FINISHED': return 'finished';
    case 'POSTPONED': return 'postponed';
    case 'CANCELLED': case 'SUSPENDED': return 'cancelled';
    default: return 'scheduled';
  }
}
