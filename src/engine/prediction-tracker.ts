/**
 * Prediction Tracker — Logs every prediction and auto-settles results.
 *
 * Tracks:
 *   - Every prediction made (market, pick, confidence, fixture, timestamp)
 *   - Actual results (auto-fetched from ESPN after kickoff)
 *   - Hit rate per market (Home, Away, Over 1.5, Over 2.5, BTTS)
 *   - Hit rate per league
 *   - Trends over time (weekly/monthly accuracy)
 *
 * Storage: SQLite via the existing rollover.db (new table: prediction_log)
 * Settlement: Checks ESPN CDN for finished matches, resolves pending predictions.
 */

import Database from '@tauri-apps/plugin-sql';
import { httpGetDirect } from '../lib/http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrackedPrediction {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickOff: string;           // ISO datetime
  market: string;            // '1X2', 'Over/Under', 'GG/NG'
  pick: string;              // 'Home', 'Over 1.5', 'Both Teams Score', etc.
  confidence: number;        // 0-100
  sources: string;           // 'ESPN+FD' etc.
  createdAt: string;         // When prediction was logged
  status: 'pending' | 'won' | 'lost' | 'void';
  settledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface AccuracyStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
  hitRate: number;            // 0-100
  byMarket: Record<string, { total: number; won: number; hitRate: number }>;
  byLeague: Record<string, { total: number; won: number; hitRate: number }>;
  byConfidenceRange: {
    high: { total: number; won: number; hitRate: number };    // 75%+
    medium: { total: number; won: number; hitRate: number };  // 55-74%
    low: { total: number; won: number; hitRate: number };     // <55%
  };
  recentTrend: number[];     // Last 10 days hit rates
}

// ─── Database ────────────────────────────────────────────────────────────────

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:rollover.db');
    // Ensure table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS prediction_log (
        id TEXT PRIMARY KEY,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        league TEXT,
        kick_off TEXT NOT NULL,
        market TEXT NOT NULL,
        pick TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        sources TEXT,
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        settled_at TEXT,
        home_score INTEGER,
        away_score INTEGER
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_pred_status ON prediction_log(status)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_pred_kickoff ON prediction_log(kick_off)`);
  }
  return db;
}

// ─── Logging Predictions ─────────────────────────────────────────────────────

/**
 * Log a prediction when Scout displays it.
 * Deduplicates by homeTeam + awayTeam + pick + kickOff date.
 */
export async function logPrediction(prediction: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickOff: string;
  market: string;
  pick: string;
  confidence: number;
  sources: string;
}): Promise<void> {
  const database = await getDb();
  const id = `${prediction.homeTeam}|${prediction.awayTeam}|${prediction.pick}|${prediction.kickOff?.split('T')[0]}`.toLowerCase().replace(/\s+/g, '-');

  try {
    await database.execute(
      `INSERT OR IGNORE INTO prediction_log (id, home_team, away_team, league, kick_off, market, pick, confidence, sources, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [id, prediction.homeTeam, prediction.awayTeam, prediction.league, prediction.kickOff,
       prediction.market, prediction.pick, prediction.confidence, prediction.sources, new Date().toISOString()]
    );
  } catch {}
}

/**
 * Log multiple predictions at once (batch from Scout results).
 */
export async function logPredictions(predictions: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickOff: string;
  market: string;
  pick: string;
  confidence: number;
  sources: string;
}[]): Promise<number> {
  let logged = 0;
  for (const p of predictions) {
    await logPrediction(p);
    logged++;
  }
  return logged;
}

// ─── Auto-Settlement ─────────────────────────────────────────────────────────

/**
 * Settle pending predictions by checking ESPN for finished match results.
 * Runs periodically (every 30 min) or on demand.
 */
export async function settlePendingPredictions(): Promise<{ settled: number; won: number; lost: number }> {
  const database = await getDb();
  let settled = 0, won = 0, lost = 0;

  // Get pending predictions with kickoff in the past
  const pending = await database.select<any[]>(
    `SELECT * FROM prediction_log WHERE status = 'pending' AND kick_off < $1`,
    [new Date().toISOString()]
  );

  if (!pending || pending.length === 0) return { settled: 0, won: 0, lost: 0 };

  // Group by date to minimize ESPN requests
  const byDate = new Map<string, any[]>();
  for (const p of pending) {
    const date = p.kick_off?.split('T')[0] || '';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(p);
  }

  // Fetch results from ESPN for each date
  for (const [date, predictions] of byDate) {
    const espnDate = date.replace(/-/g, '');
    try {
      // Fetch scoreboard for this date (all leagues)
      const url = `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&dates=${espnDate}`;
      const data: any = await httpGetDirect(url, {});
      const events = data?.content?.sbData?.events || [];

      for (const pred of predictions) {
        // Find matching event
        const match = events.find((e: any) => {
          const comp = e.competitions?.[0];
          if (!comp) return false;
          const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
          const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
          if (!home || !away) return false;
          const eName = `${home.team?.displayName || ''} ${away.team?.displayName || ''}`.toLowerCase();
          return eName.includes(pred.home_team.toLowerCase().slice(0, 6)) &&
                 eName.includes(pred.away_team.toLowerCase().slice(0, 6));
        });

        if (!match) continue;
        const comp = match.competitions?.[0];
        if (!comp || match.status?.type?.state !== 'post') continue;

        const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
        const homeScore = parseInt(home?.score || '0');
        const awayScore = parseInt(away?.score || '0');

        // Determine if prediction was correct
        const result = evaluatePick(pred.pick, pred.market, homeScore, awayScore);

        await database.execute(
          `UPDATE prediction_log SET status = $1, settled_at = $2, home_score = $3, away_score = $4 WHERE id = $5`,
          [result, new Date().toISOString(), homeScore, awayScore, pred.id]
        );

        // Auto-save match result to historical DB (grows the prediction engine's data)
        try {
          const { saveOnDemandResults } = await import('../lib/match-database');
          await saveOnDemandResults([{
            division: pred.league || '',
            date: pred.kick_off?.split('T')[0] || '',
            time: pred.kick_off?.split('T')[1]?.slice(0, 5) || '',
            homeTeam: pred.home_team,
            awayTeam: pred.away_team,
            ftHomeGoals: homeScore,
            ftAwayGoals: awayScore,
            ftResult: homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D',
            htHomeGoals: null, htAwayGoals: null, htResult: null,
            homeShots: null, awayShots: null, homeShotsOnTarget: null, awayShotsOnTarget: null,
            homeCorners: null, awayCorners: null, homeYellows: null, awayYellows: null,
            homeReds: null, awayReds: null,
            homeFouls: null, awayFouls: null,
            season: new Date().getFullYear().toString(),
            leagueId: pred.league || '',
          }], 'auto-settlement');
        } catch {}

        settled++;
        if (result === 'won') won++;
        else if (result === 'lost') lost++;
      }
    } catch {
      // Skip dates that fail
    }
  }

  return { settled, won, lost };
}

/**
 * Evaluate if a pick was correct given the final score.
 */
function evaluatePick(pick: string, market: string, homeScore: number, awayScore: number): 'won' | 'lost' {
  const totalGoals = homeScore + awayScore;
  const pickLower = pick.toLowerCase();

  if (pickLower === 'home') return homeScore > awayScore ? 'won' : 'lost';
  if (pickLower === 'away') return awayScore > homeScore ? 'won' : 'lost';
  if (pickLower === 'draw') return homeScore === awayScore ? 'won' : 'lost';
  if (pickLower === 'over 1.5') return totalGoals >= 2 ? 'won' : 'lost';
  if (pickLower === 'over 2.5') return totalGoals >= 3 ? 'won' : 'lost';
  if (pickLower === 'under 2.5') return totalGoals < 3 ? 'won' : 'lost';
  if (pickLower === 'both teams score' || pickLower === 'btts') return (homeScore > 0 && awayScore > 0) ? 'won' : 'lost';

  return 'lost'; // Unknown pick type
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Get full accuracy statistics.
 */
export async function getAccuracyStats(): Promise<AccuracyStats> {
  const database = await getDb();

  const all = await database.select<any[]>(`SELECT * FROM prediction_log WHERE status != 'pending'`);
  const pending = await database.select<[{ count: number }]>(`SELECT COUNT(*) as count FROM prediction_log WHERE status = 'pending'`);

  const settled = all || [];
  const total = settled.length;
  const wonCount = settled.filter(p => p.status === 'won').length;
  const lostCount = settled.filter(p => p.status === 'lost').length;

  // By market
  const byMarket: Record<string, { total: number; won: number; hitRate: number }> = {};
  for (const p of settled) {
    const key = p.pick || p.market || 'Unknown';
    if (!byMarket[key]) byMarket[key] = { total: 0, won: 0, hitRate: 0 };
    byMarket[key].total++;
    if (p.status === 'won') byMarket[key].won++;
  }
  for (const key of Object.keys(byMarket)) {
    byMarket[key].hitRate = byMarket[key].total > 0 ? Math.round((byMarket[key].won / byMarket[key].total) * 100) : 0;
  }

  // By league
  const byLeague: Record<string, { total: number; won: number; hitRate: number }> = {};
  for (const p of settled) {
    const key = p.league || 'Unknown';
    if (!byLeague[key]) byLeague[key] = { total: 0, won: 0, hitRate: 0 };
    byLeague[key].total++;
    if (p.status === 'won') byLeague[key].won++;
  }
  for (const key of Object.keys(byLeague)) {
    byLeague[key].hitRate = byLeague[key].total > 0 ? Math.round((byLeague[key].won / byLeague[key].total) * 100) : 0;
  }

  // By confidence range
  const high = settled.filter(p => p.confidence >= 75);
  const medium = settled.filter(p => p.confidence >= 55 && p.confidence < 75);
  const low = settled.filter(p => p.confidence < 55);

  const byConfidenceRange = {
    high: { total: high.length, won: high.filter(p => p.status === 'won').length, hitRate: high.length > 0 ? Math.round((high.filter(p => p.status === 'won').length / high.length) * 100) : 0 },
    medium: { total: medium.length, won: medium.filter(p => p.status === 'won').length, hitRate: medium.length > 0 ? Math.round((medium.filter(p => p.status === 'won').length / medium.length) * 100) : 0 },
    low: { total: low.length, won: low.filter(p => p.status === 'won').length, hitRate: low.length > 0 ? Math.round((low.filter(p => p.status === 'won').length / low.length) * 100) : 0 },
  };

  // Recent trend (last 10 days)
  const recentTrend: number[] = [];
  for (let i = 0; i < 10; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayPreds = settled.filter(p => p.kick_off?.startsWith(dateStr));
    if (dayPreds.length > 0) {
      recentTrend.push(Math.round((dayPreds.filter(p => p.status === 'won').length / dayPreds.length) * 100));
    } else {
      recentTrend.push(-1); // No data
    }
  }

  return {
    total,
    won: wonCount,
    lost: lostCount,
    pending: pending?.[0]?.count || 0,
    hitRate: total > 0 ? Math.round((wonCount / total) * 100) : 0,
    byMarket,
    byLeague,
    byConfidenceRange,
    recentTrend,
  };
}

/**
 * Get recent predictions (for display).
 */
export async function getRecentPredictions(limit: number = 50): Promise<TrackedPrediction[]> {
  const database = await getDb();
  const rows = await database.select<any[]>(
    `SELECT * FROM prediction_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  if (!rows) return [];
  return rows.map(r => ({
    id: r.id,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    league: r.league,
    kickOff: r.kick_off,
    market: r.market,
    pick: r.pick,
    confidence: r.confidence,
    sources: r.sources,
    createdAt: r.created_at,
    status: r.status,
    settledAt: r.settled_at,
    homeScore: r.home_score,
    awayScore: r.away_score,
  }));
}

/**
 * Get count of predictions by status.
 */
export async function getPredictionCounts(): Promise<{ pending: number; won: number; lost: number; total: number }> {
  const database = await getDb();
  const rows = await database.select<any[]>(
    `SELECT status, COUNT(*) as count FROM prediction_log GROUP BY status`
  );
  const counts = { pending: 0, won: 0, lost: 0, total: 0 };
  for (const r of rows || []) {
    if (r.status === 'pending') counts.pending = r.count;
    else if (r.status === 'won') counts.won = r.count;
    else if (r.status === 'lost') counts.lost = r.count;
    counts.total += r.count;
  }
  return counts;
}

// ─── Auto-Settlement Scheduler ───────────────────────────────────────────────

let settlementInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start auto-settlement (runs every 30 minutes).
 */
export function startAutoSettlement() {
  if (settlementInterval) return;
  // Run immediately
  settlePendingPredictions().catch(console.warn);
  // Then every 30 minutes
  settlementInterval = setInterval(() => {
    settlePendingPredictions().catch(console.warn);
  }, 30 * 60 * 1000);
}

/**
 * Stop auto-settlement.
 */
export function stopAutoSettlement() {
  if (settlementInterval) {
    clearInterval(settlementInterval);
    settlementInterval = null;
  }
}
