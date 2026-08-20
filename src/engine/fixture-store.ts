/**
 * Fixture Store — Multi-Provider Merge + Fixture Lock
 *
 * This is the FOUNDATION layer that all other features build on:
 * - Unified fixture format across all providers
 * - Multi-provider merge with intelligent deduplication
 * - Locked matches (persistent shortlist) that survive searches
 * - Feeds directly into Paste & Build as ParsedSelections
 *
 * Data flow:
 *   Football-Data.org ──┐
 *   TheSportsDB       ──┼──► Merge + Dedup ──► UnifiedFixture[] ──► Search Results
 *   KickoffAPI        ──┘                                          ──► Lock ──► Selections
 */

import { ParsedSelection } from './types';

// ─── Unified Fixture Type ────────────────────────────────────────────────────

export interface UnifiedFixture {
  id: string;                  // Composite key: `${homeTeam}-${awayTeam}-${date}`
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  kickOff: Date;
  league: string;
  leagueCode: string;
  // Data richness (which providers contributed)
  providers: string[];
  // Position data (from standings)
  homePosition?: number;
  awayPosition?: number;
  positionGap?: number;        // awayPos - homePos (positive = home higher)
  // Stats (from TheSportsDB past events or KickoffAPI)
  homeWinRate?: number;
  awayWinRate?: number;
  homeForm?: string;           // e.g. "WWDLW"
  awayForm?: string;
  over25Pct?: number;
  bttsPct?: number;
  homeAvgGoals?: number;
  awayAvgGoals?: number;
  // Suggested pick (from analysis)
  suggestedPick?: string;
  suggestedMarket?: string;
  estimatedOdds?: number;
  confidence?: number;
}

// ─── Locked Match ────────────────────────────────────────────────────────────

export interface LockedMatch {
  id: string;                  // UUID
  homeTeam: string;
  awayTeam: string;
  kickOff: string;             // ISO date
  league: string;
  leagueCode: string;
  provider: string;            // Which provider this came from
  lockedAt: string;            // ISO date when locked
  suggestedPick?: string;
  suggestedMarket?: string;
  estimatedOdds?: number;
  confidence?: number;
  // Stats snapshot at lock time
  homeForm?: string;
  awayForm?: string;
  over25Pct?: number;
  bttsPct?: number;
  positionGap?: number;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const LOCKED_MATCHES_KEY = 'rollover_locked_matches';

export function loadLockedMatches(): LockedMatch[] {
  try {
    const data = localStorage.getItem(LOCKED_MATCHES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveLockedMatches(matches: LockedMatch[]): void {
  try {
    localStorage.setItem(LOCKED_MATCHES_KEY, JSON.stringify(matches));
  } catch (e) {
    console.error('Failed to save locked matches:', e);
  }
}

export function lockMatch(fixture: UnifiedFixture): LockedMatch {
  const locked: LockedMatch = {
    id: crypto.randomUUID(),
    homeTeam: fixture.homeTeam.name,
    awayTeam: fixture.awayTeam.name,
    kickOff: fixture.kickOff.toISOString(),
    league: fixture.league,
    leagueCode: fixture.leagueCode,
    provider: fixture.providers[0] || 'unknown',
    lockedAt: new Date().toISOString(),
    suggestedPick: fixture.suggestedPick,
    suggestedMarket: fixture.suggestedMarket,
    estimatedOdds: fixture.estimatedOdds,
    confidence: fixture.confidence,
    homeForm: fixture.homeForm,
    awayForm: fixture.awayForm,
    over25Pct: fixture.over25Pct,
    bttsPct: fixture.bttsPct,
    positionGap: fixture.positionGap,
  };

  const existing = loadLockedMatches();
  // Don't duplicate
  const key = matchKey(fixture.homeTeam.name, fixture.awayTeam.name);
  if (!existing.some(m => matchKey(m.homeTeam, m.awayTeam) === key)) {
    existing.push(locked);
    saveLockedMatches(existing);
  }
  return locked;
}

export function unlockMatch(lockedId: string): void {
  const existing = loadLockedMatches();
  saveLockedMatches(existing.filter(m => m.id !== lockedId));
}

export function clearLockedMatches(): void {
  saveLockedMatches([]);
}

export function isMatchLocked(homeTeam: string, awayTeam: string): boolean {
  const existing = loadLockedMatches();
  const key = matchKey(homeTeam, awayTeam);
  return existing.some(m => matchKey(m.homeTeam, m.awayTeam) === key);
}

// ─── Multi-Provider Merge ────────────────────────────────────────────────────

/**
 * Merge fixtures from multiple providers into a unified, deduplicated list.
 * Deduplication key: normalized home team + away team + date.
 * When two providers have the same match, merge their data (richer wins).
 */
export function mergeFixtures(
  providerResults: { provider: string; fixtures: ProviderFixture[] }[]
): UnifiedFixture[] {
  const merged = new Map<string, UnifiedFixture>();

  for (const { provider, fixtures } of providerResults) {
    for (const raw of fixtures) {
      const key = fixtureKey(raw.homeTeam, raw.awayTeam, raw.kickOff);
      const existing = merged.get(key);

      if (existing) {
        // Merge: add provider, fill in missing data
        if (!existing.providers.includes(provider)) {
          existing.providers.push(provider);
        }
        // Fill gaps with data from this provider
        if (!existing.homePosition && raw.homePosition) existing.homePosition = raw.homePosition;
        if (!existing.awayPosition && raw.awayPosition) existing.awayPosition = raw.awayPosition;
        if (!existing.homeForm && raw.homeForm) existing.homeForm = raw.homeForm;
        if (!existing.awayForm && raw.awayForm) existing.awayForm = raw.awayForm;
        if (!existing.over25Pct && raw.over25Pct) existing.over25Pct = raw.over25Pct;
        if (!existing.bttsPct && raw.bttsPct) existing.bttsPct = raw.bttsPct;
        if (!existing.homeWinRate && raw.homeWinRate) existing.homeWinRate = raw.homeWinRate;
        if (!existing.awayWinRate && raw.awayWinRate) existing.awayWinRate = raw.awayWinRate;
        if (!existing.homeAvgGoals && raw.homeAvgGoals) existing.homeAvgGoals = raw.homeAvgGoals;
        if (!existing.awayAvgGoals && raw.awayAvgGoals) existing.awayAvgGoals = raw.awayAvgGoals;
        // Use higher confidence suggestion
        if (raw.confidence && (!existing.confidence || raw.confidence > existing.confidence)) {
          existing.suggestedPick = raw.suggestedPick;
          existing.suggestedMarket = raw.suggestedMarket;
          existing.estimatedOdds = raw.estimatedOdds;
          existing.confidence = raw.confidence;
        }
      } else {
        // New fixture
        const posGap = (raw.homePosition && raw.awayPosition)
          ? raw.awayPosition - raw.homePosition : undefined;
        merged.set(key, {
          id: key,
          homeTeam: { id: raw.homeTeamId || 0, name: raw.homeTeam },
          awayTeam: { id: raw.awayTeamId || 0, name: raw.awayTeam },
          kickOff: new Date(raw.kickOff),
          league: raw.league,
          leagueCode: raw.leagueCode || '',
          providers: [provider],
          homePosition: raw.homePosition,
          awayPosition: raw.awayPosition,
          positionGap: posGap,
          homeWinRate: raw.homeWinRate,
          awayWinRate: raw.awayWinRate,
          homeForm: raw.homeForm,
          awayForm: raw.awayForm,
          over25Pct: raw.over25Pct,
          bttsPct: raw.bttsPct,
          homeAvgGoals: raw.homeAvgGoals,
          awayAvgGoals: raw.awayAvgGoals,
          suggestedPick: raw.suggestedPick,
          suggestedMarket: raw.suggestedMarket,
          estimatedOdds: raw.estimatedOdds,
          confidence: raw.confidence,
        });
      }
    }
  }

  // Sort by kickoff time
  return Array.from(merged.values()).sort(
    (a, b) => a.kickOff.getTime() - b.kickOff.getTime()
  );
}

// ─── Convert to Selections ───────────────────────────────────────────────────

/**
 * Convert locked matches to ParsedSelection[] for the Paste & Build master list.
 */
export function lockedToSelections(locked: LockedMatch[]): ParsedSelection[] {
  return locked
    .filter(m => m.suggestedPick && m.estimatedOdds && m.estimatedOdds > 0)
    .map(m => {
      const kickOff = new Date(m.kickOff);
      const day = kickOff.getDate().toString().padStart(2, '0');
      const month = (kickOff.getMonth() + 1).toString().padStart(2, '0');
      const hour = kickOff.getHours().toString().padStart(2, '0');
      const min = kickOff.getMinutes().toString().padStart(2, '0');

      const pickCategory = m.suggestedPick === 'Home' ? 'home' as const :
                           m.suggestedPick === 'Away' ? 'away' as const :
                           m.suggestedPick?.includes('Over') ? 'over' as const :
                           m.suggestedPick?.includes('Under') ? 'under' as const :
                           'other' as const;

      const marketType = m.suggestedMarket === '1X2' ? '1x2' as const :
                         m.suggestedMarket?.includes('Over') || m.suggestedMarket?.includes('Under') ? 'over_under' as const :
                         m.suggestedMarket === 'GG/NG' ? 'gg_ng' as const :
                         'other' as const;

      return {
        id: m.id,
        index: 0,
        date: `${day}/${month}`,
        time: `${hour}:${min}`,
        kickOffDateTime: kickOff,
        gameId: null,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        status: 'not_started' as const,
        score: null,
        pick: m.suggestedPick || 'Home',
        pickCategory,
        odds: m.estimatedOdds || 1.5,
        market: m.suggestedMarket || '1X2',
        marketType,
        marketVariant: null,
        result: null,
        resultMessage: null,
        isSettled: false,
        isVoid: false,
        isSuspended: false,
        isEligibleForGrouping: true,
      };
    });
}

// ─── Provider-agnostic fixture input ─────────────────────────────────────────

export interface ProviderFixture {
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: number;
  awayTeamId?: number;
  kickOff: string | Date;       // ISO or Date
  league: string;
  leagueCode?: string;
  homePosition?: number;
  awayPosition?: number;
  homeWinRate?: number;
  awayWinRate?: number;
  homeForm?: string;
  awayForm?: string;
  over25Pct?: number;
  bttsPct?: number;
  homeAvgGoals?: number;
  awayAvgGoals?: number;
  suggestedPick?: string;
  suggestedMarket?: string;
  estimatedOdds?: number;
  confidence?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchKey(homeTeam: string, awayTeam: string): string {
  return `${homeTeam.toLowerCase().trim()}|${awayTeam.toLowerCase().trim()}`;
}

function fixtureKey(homeTeam: string, awayTeam: string, kickOff: string | Date): string {
  const date = new Date(kickOff).toISOString().split('T')[0];
  return `${homeTeam.toLowerCase().trim()}|${awayTeam.toLowerCase().trim()}|${date}`;
}

/**
 * Normalize a team name for matching across providers.
 * Handles: "Man City" vs "Manchester City", "Inter Milan" vs "Inter" etc.
 */
export function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\bfc\b/g, '')
    .replace(/\bsc\b/g, '')
    .replace(/\bcf\b/g, '')
    .replace(/\bafc\b/g, '')
    .replace(/\bunited\b/g, 'utd')
    .replace(/\bcity\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy match two team names (for cross-provider dedup).
 */
export function teamsMatch(name1: string, name2: string): boolean {
  const n1 = normalizeTeamName(name1);
  const n2 = normalizeTeamName(name2);
  if (n1 === n2) return true;
  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;
  // First significant word matches
  const words1 = n1.split(' ').filter(w => w.length > 3);
  const words2 = n2.split(' ').filter(w => w.length > 3);
  if (words1.length > 0 && words2.length > 0 && words1[0] === words2[0]) return true;
  return false;
}
