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
import { ConfirmedFixture } from './sportybet';

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
