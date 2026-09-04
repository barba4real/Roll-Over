/**
 * Score Providers — a single, extensible registry of score sources.
 *
 * Design principle (per the user's model): fixtures come from SportyBet, but
 * SCORES/RESULTS come from other providers — and the user picks ONE provider at
 * a time from a dropdown, then clicks to fetch. No silent grouping of providers,
 * no auto-poll. This module exposes each provider individually so the UI can
 * offer a clean picker and call exactly the chosen source.
 *
 * Two distinct concepts:
 *   - LIVESCORE  → the running score of an in-progress fixture.
 *   - PASTSCORE  → the finished result of a completed fixture.
 *
 * To add a provider later: append one entry to SCORE_PROVIDERS with a
 * fetchFinished() and/or fetchLive() that returns ScoreRecord[]. Nothing else
 * needs editing — the picker and per-fixture buttons are registry-driven.
 */

import { fetchDayFixtures } from './flashscore';
import { getTodayResults as getEspnResults } from './espn';

// A normalized score row from any provider.
export interface ScoreRecord {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  htHome?: number;
  htAway?: number;
  status: 'live' | 'finished' | 'other';
  matchId?: string;        // provider-specific id (e.g. Flashscore matchId for HT lookup)
  provider: string;
}

export interface ScoreProvider {
  id: string;                    // stable key
  label: string;                 // shown in the picker
  supportsLive: boolean;
  supportsPast: boolean;
  /** Finished results across a set of day offsets (0=today, -1=yesterday, 1=tomorrow…). */
  fetchFinished?: (dayOffsets: number[]) => Promise<ScoreRecord[]>;
  /** Currently in-progress matches. */
  fetchLive?: () => Promise<ScoreRecord[]>;
}

// ─── Flashscore ──────────────────────────────────────────────────────────────
// The most complete free source we have. fetchDayFixtures(offset) returns both
// finished (isFinished + score "H-A") and in-play fixtures.

const flashscore: ScoreProvider = {
  id: 'flashscore',
  label: 'Flashscore',
  supportsLive: true,
  supportsPast: true,
  async fetchFinished(dayOffsets) {
    const out: ScoreRecord[] = [];
    for (const off of dayOffsets) {
      try {
        const fixtures = await fetchDayFixtures(off);
        for (const f of fixtures) {
          if (f.isFinished && f.score) {
            const [h, a] = f.score.split('-').map((n) => parseInt(n.trim(), 10));
            out.push({
              homeTeam: f.homeTeam,
              awayTeam: f.awayTeam,
              homeScore: isNaN(h) ? null : h,
              awayScore: isNaN(a) ? null : a,
              status: 'finished',
              matchId: f.matchId,
              provider: 'Flashscore',
            });
          }
        }
      } catch { /* skip day */ }
    }
    return out;
  },
  async fetchLive() {
    const out: ScoreRecord[] = [];
    try {
      const fixtures = await fetchDayFixtures(0);
      for (const f of fixtures as any[]) {
        // A fixture with a score but not finished is in-play.
        if (!f.isFinished && f.score) {
          const [h, a] = String(f.score).split('-').map((n: string) => parseInt(n.trim(), 10));
          out.push({
            homeTeam: f.homeTeam,
            awayTeam: f.awayTeam,
            homeScore: isNaN(h) ? null : h,
            awayScore: isNaN(a) ? null : a,
            status: 'live',
            matchId: f.matchId,
            provider: 'Flashscore',
          });
        }
      }
    } catch { /* ignore */ }
    return out;
  },
};

// ─── ESPN ────────────────────────────────────────────────────────────────────
// No key, tier-1 leagues. getTodayResults returns events with status in|post.

const espn: ScoreProvider = {
  id: 'espn',
  label: 'ESPN',
  supportsLive: true,
  supportsPast: true,
  async fetchFinished() {
    const out: ScoreRecord[] = [];
    try {
      const events = await getEspnResults();
      for (const e of events) {
        if (e.status === 'post') {
          out.push({
            homeTeam: e.homeTeam,
            awayTeam: e.awayTeam,
            homeScore: e.homeScore ?? null,
            awayScore: e.awayScore ?? null,
            status: 'finished',
            provider: 'ESPN',
          });
        }
      }
    } catch { /* ignore */ }
    return out;
  },
  async fetchLive() {
    const out: ScoreRecord[] = [];
    try {
      const events = await getEspnResults();
      for (const e of events) {
        if (e.status === 'in') {
          out.push({
            homeTeam: e.homeTeam,
            awayTeam: e.awayTeam,
            homeScore: e.homeScore ?? null,
            awayScore: e.awayScore ?? null,
            status: 'live',
            provider: 'ESPN',
          });
        }
      }
    } catch { /* ignore */ }
    return out;
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const SCORE_PROVIDERS: ScoreProvider[] = [flashscore, espn];

export function getScoreProvider(id: string): ScoreProvider | undefined {
  return SCORE_PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_SCORE_PROVIDER = 'flashscore';
