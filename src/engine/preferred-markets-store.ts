/**
 * preferred_markets — a durable SQLite table of the CONFIRMED preferred markets
 * (with live lines/odds) the Preferred tab found per fixture.
 *
 * Purpose: expose the confirmed markets + odds to the read-only Python predictor
 * for OPTIONAL value comparison (model probability vs. SportyBet implied odds).
 * It is NOT a modeling input — the predictor still learns from history and gets
 * fixtures from upcoming_fixtures. This table is the odds side of a value check.
 *
 * One row per (event_id, market_key, line). Rewritten for an event each time the
 * Preferred tab re-confirms it; rows past kickoff are pruned.
 */

import { getDb } from '../lib/database';
import { ConfirmedFixture, fetchFixtureMarkets, sectionForKey as sectionForKeyFn, SbFixture } from './sportybet';
import { getFixtureState } from './sportybet-store';

async function ensureTable() {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS preferred_markets (
      event_id TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      league TEXT,
      kickoff_ms INTEGER,
      section TEXT,
      market_key TEXT NOT NULL,
      market_label TEXT NOT NULL,
      line TEXT NOT NULL,
      odds REAL,
      locked INTEGER DEFAULT 0,
      confirmed_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, market_key, line)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_preferred_event ON preferred_markets(event_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_preferred_kickoff ON preferred_markets(kickoff_ms)`);
}

/**
 * Persist the confirmed preferred markets for a set of fixtures. For each event
 * we delete its prior rows then insert the freshly-confirmed ones, so odds stay
 * current without leaving stale lines behind. Best-effort — the UI works even if
 * persistence fails.
 */
export async function savePreferredMarkets(fixtures: ConfirmedFixture[], sectionForKey: (k: any) => string): Promise<void> {
  if (fixtures.length === 0) return;
  try {
    await ensureTable();
    const db = await getDb();
    const now = Date.now();
    for (const fx of fixtures) {
      const kickoffMs = fx.kickoff instanceof Date ? fx.kickoff.getTime() : Number(fx.kickoff) || null;
      await db.execute(`DELETE FROM preferred_markets WHERE event_id = $1`, [fx.eventId]);
      for (const row of fx.markets) {
        await db.execute(
          `INSERT OR REPLACE INTO preferred_markets
             (event_id, home_team, away_team, league, kickoff_ms, section,
              market_key, market_label, line, odds, locked, confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            fx.eventId, fx.homeTeam, fx.awayTeam, fx.league, kickoffMs,
            sectionForKey(row.key), row.key, row.marketLabel, row.line,
            row.odds || null, row.locked ? 1 : 0, now,
          ]
        );
      }
    }
    // Prune markets for fixtures that kicked off more than 2 days ago.
    const cutoff = now - 2 * 24 * 60 * 60 * 1000;
    await db.execute(`DELETE FROM preferred_markets WHERE kickoff_ms IS NOT NULL AND kickoff_ms < $1`, [cutoff]);
  } catch {
    // best-effort
  }
}

// ─── Full-slate pricing (owner-triggered, cancelable) ───────────────────────

/** Reconstruct minimal SbFixtures from the persisted upcoming_fixtures table. */
async function loadUpcomingFromDb(): Promise<SbFixture[]> {
  try {
    const db = await getDb();
    const rows = await db.select<any[]>(
      `SELECT event_id, game_id, home_team, away_team, country, league_name, league,
              league_id, kickoff_ms, date, time, has_preferred
       FROM upcoming_fixtures
       WHERE kickoff_ms IS NULL OR kickoff_ms >= $1`,
      [Date.now() - 6 * 60 * 60 * 1000], // include just-started/recent too
    );
    return rows.map((r): SbFixture => ({
      eventId: r.event_id,
      gameId: r.game_id || r.event_id,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      country: r.country || '',
      leagueName: r.league_name || '',
      league: r.league || '',
      leagueId: r.league_id ?? null,
      homeCanonical: r.home_team,
      awayCanonical: r.away_team,
      kickoff: new Date(Number(r.kickoff_ms) || Date.now()),
      date: r.date || '',
      time: r.time || '',
      hasPreferred: !!r.has_preferred,
    }));
  } catch {
    return [];
  }
}

let priceAborted = false;
/** Cancel an in-progress full-slate pricing run. */
export function cancelPricing() { priceAborted = true; }

/**
 * Price the FULL upcoming slate into preferred_markets — one per-event call per
 * fixture (heavy). Prioritizes fixtures with a resolved league_id (the clean
 * tracked leagues), then soonest kickoff, so real odds arrive fast even if the
 * owner stops early. Writes incrementally (each fixture persisted as confirmed),
 * reports progress, and is cancelable via cancelPricing().
 *
 * Returns the number of fixtures priced.
 */
export async function priceAllUpcoming(opts?: {
  region?: 'ng' | 'gh' | 'ke' | 'ug' | 'tz' | 'zm';
  fallback?: SbFixture[];   // e.g. the currently-scanned Preferred fixtures
  onProgress?: (msg: string, done: number, total: number) => void;
}): Promise<number> {
  priceAborted = false;
  const region = opts?.region ?? 'ng';

  // Source the slate robustly:
  //   1) in-memory shared store (a Markets/Scout pull this session), else
  //   2) the persisted upcoming_fixtures table (survives restarts / other tabs), else
  //   3) a caller-provided fallback (the currently-scanned Preferred fixtures).
  let slate: SbFixture[] = getFixtureState().fixtures;
  if (slate.length === 0) {
    slate = await loadUpcomingFromDb();
  }
  if (slate.length === 0 && opts?.fallback && opts.fallback.length > 0) {
    slate = opts.fallback;
  }

  // Prioritize: tracked leagues (leagueId set) first, then soonest kickoff.
  slate = [...slate].sort((a, b) => {
    const al = a.leagueId ? 0 : 1, bl = b.leagueId ? 0 : 1;
    if (al !== bl) return al - bl;
    return a.kickoff.getTime() - b.kickoff.getTime();
  });

  const total = slate.length;
  if (total === 0) {
    opts?.onProgress?.('No fixtures to price — pull fixtures in Markets first, or scan Preferred.', 0, 0);
    return 0;
  }
  let done = 0, priced = 0;
  for (const fx of slate) {
    if (priceAborted) break;
    done++;
    opts?.onProgress?.(`Pricing ${done}/${total} — ${priced} with markets…`, done, total);
    let pf;
    try {
      pf = await fetchFixtureMarkets(fx, { region });
    } catch {
      continue;
    }
    if (!pf.markets || pf.markets.length === 0) continue;
    // Reuse the single-fixture writer (delete+reinsert for this event).
    const confirmed: ConfirmedFixture = {
      eventId: fx.eventId, gameId: fx.gameId, homeTeam: fx.homeTeam, awayTeam: fx.awayTeam,
      league: fx.league, leagueName: fx.leagueName, kickoff: fx.kickoff, date: fx.date,
      time: fx.time, markets: pf.markets, anyOpen: pf.markets.some(r => !r.locked),
    };
    await savePreferredMarkets([confirmed], sectionForKeyFn);
    priced++;
  }
  opts?.onProgress?.(`Done — priced ${priced} of ${total} fixture(s).`, done, total);
  return priced;
}
