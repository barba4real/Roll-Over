/**
 * Match Database — Cache-First, Fetch-On-Demand Architecture.
 *
 * The DB is the PRIMARY display source. When a team's data is stale or
 * missing, APIs are automatically queried and results saved for future use.
 *
 * Freshness model:
 *   - Team data < 24 hours old → serve from DB (no API call)
 *   - Team data > 24 hours old → serve from DB + fetch fresh in background
 *   - Team data missing → fetch from APIs immediately, save to DB
 *
 * On app start, loads all DB data into memory for fast predictions.
 * Background refresh runs silently for active leagues.
 */

import Database from '@tauri-apps/plugin-sql';
import type { HistoricalMatch } from '../engine/football-data-uk';
import { loadMatches, getDatabaseSize, clearDatabase } from '../engine/historical-stats';

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:rollover.db');
    // Migration: add fouls columns if they don't exist
    try {
      await db.execute(`ALTER TABLE historical_matches ADD COLUMN home_fouls INTEGER`);
    } catch {} // Column already exists
    try {
      await db.execute(`ALTER TABLE historical_matches ADD COLUMN away_fouls INTEGER`);
    } catch {} // Column already exists
  }
  return db;
}

// ─── Freshness Tracking ──────────────────────────────────────────────────────

// In-memory cache of when each team was last refreshed
const teamRefreshCache: Record<string, number> = {};
const FRESHNESS_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a team's data is fresh (less than 24 hours old).
 */
export function isTeamFresh(teamName: string): boolean {
  const key = teamName.toLowerCase();
  const lastRefresh = teamRefreshCache[key];
  if (!lastRefresh) return false;
  return Date.now() - lastRefresh < FRESHNESS_TTL;
}

/**
 * Mark a team's data as freshly updated.
 */
export function markTeamFresh(teamName: string) {
  teamRefreshCache[teamName.toLowerCase()] = Date.now();
}

/**
 * Check if a team has ANY data in the DB.
 */
export async function teamHasData(teamName: string): Promise<boolean> {
  const database = await getDb();
  const name = teamName.toLowerCase();
  const rows = await database.select<[{ count: number }]>(
    `SELECT COUNT(*) as count FROM historical_matches 
     WHERE LOWER(home_team) LIKE $1 OR LOWER(away_team) LIKE $1`,
    [`%${name}%`]
  );
  return (rows?.[0]?.count || 0) > 0;
}

/**
 * Get the most recent match date for a team in the DB.
 * Returns null if no data exists.
 */
export async function getTeamLastMatchDate(teamName: string): Promise<string | null> {
  const database = await getDb();
  const name = teamName.toLowerCase();
  const rows = await database.select<[{ date: string }]>(
    `SELECT date FROM historical_matches 
     WHERE LOWER(home_team) LIKE $1 OR LOWER(away_team) LIKE $1 
     ORDER BY date DESC LIMIT 1`,
    [`%${name}%`]
  );
  return rows?.[0]?.date || null;
}

// ─── Write Operations ────────────────────────────────────────────────────────

/**
 * Save historical matches to SQLite.
 * Uses INSERT OR IGNORE to skip duplicates.
 * Also updates the in-memory engine with new data.
 * Returns the number of new matches inserted.
 */
export async function saveMatches(matches: HistoricalMatch[], source: string): Promise<number> {
  if (matches.length === 0) return 0;

  const database = await getDb();
  let inserted = 0;

  const BATCH_SIZE = 50;
  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const batch = matches.slice(i, i + BATCH_SIZE);
    for (const m of batch) {
      try {
        const result = await database.execute(
          `INSERT OR IGNORE INTO historical_matches
           (home_team, away_team, date, time, season, league_id, division,
            ft_home_goals, ft_away_goals, ft_result,
            ht_home_goals, ht_away_goals, ht_result,
            home_shots, away_shots, home_shots_on_target, away_shots_on_target,
            home_corners, away_corners, home_yellows, away_yellows,
            home_reds, away_reds, home_fouls, away_fouls, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
          [
            m.homeTeam, m.awayTeam, m.date, m.time, m.season, m.leagueId, m.division,
            m.ftHomeGoals, m.ftAwayGoals, m.ftResult,
            m.htHomeGoals, m.htAwayGoals, m.htResult,
            m.homeShots, m.awayShots, m.homeShotsOnTarget, m.awayShotsOnTarget,
            m.homeCorners, m.awayCorners, m.homeYellows, m.awayYellows,
            m.homeReds, m.awayReds, m.homeFouls || null, m.awayFouls || null, source,
          ]
        );
        if (result.rowsAffected > 0) inserted++;
      } catch {}
    }
  }

  // Also load new matches into in-memory engine immediately
  if (inserted > 0) {
    loadMatches(matches);
    // Mark involved teams as fresh
    const teams = new Set<string>();
    for (const m of matches) {
      teams.add(m.homeTeam);
      teams.add(m.awayTeam);
    }
    for (const team of teams) markTeamFresh(team);
  }

  // Log sync
  try {
    await database.execute(
      `INSERT INTO data_sync_log (source, matches_imported, synced_at, status)
       VALUES ($1, $2, $3, $4)`,
      [source, inserted, new Date().toISOString(), 'success']
    );
  } catch {}

  return inserted;
}

/**
 * Save matches fetched on-demand (from TheSportsDB, etc.) into the DB.
 * Lightweight version — doesn't log as a full sync, just persists new data.
 */
export async function saveOnDemandResults(matches: HistoricalMatch[], source: string): Promise<number> {
  if (matches.length === 0) return 0;
  const database = await getDb();
  let inserted = 0;

  for (const m of matches) {
    try {
      const result = await database.execute(
        `INSERT OR IGNORE INTO historical_matches
         (home_team, away_team, date, time, season, league_id, division,
          ft_home_goals, ft_away_goals, ft_result,
          ht_home_goals, ht_away_goals, ht_result,
          home_shots, away_shots, home_shots_on_target, away_shots_on_target,
          home_corners, away_corners, home_yellows, away_yellows,
          home_reds, away_reds, home_fouls, away_fouls, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          m.homeTeam, m.awayTeam, m.date, m.time, m.season || '', m.leagueId || '', m.division || '',
          m.ftHomeGoals, m.ftAwayGoals, m.ftResult,
          m.htHomeGoals, m.htAwayGoals, m.htResult,
          m.homeShots, m.awayShots, m.homeShotsOnTarget, m.awayShotsOnTarget,
          m.homeCorners, m.awayCorners, m.homeYellows, m.awayYellows,
          m.homeReds, m.awayReds, m.homeFouls || null, m.awayFouls || null, source,
        ]
      );
      if (result.rowsAffected > 0) inserted++;
    } catch {}
  }

  // Load into memory immediately
  if (inserted > 0) loadMatches(matches);

  return inserted;
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Load all matches from SQLite into the in-memory stats engine.
 * Call this on app startup to hydrate the prediction engine.
 */
export async function loadMatchesFromDb(): Promise<number> {
  const database = await getDb();

  const rows = await database.select<any[]>(
    `SELECT * FROM historical_matches ORDER BY date DESC`
  );

  if (!rows || rows.length === 0) return 0;

  const matches: HistoricalMatch[] = rows.map(row => ({
    division: row.division || row.league_id,
    date: row.date,
    time: row.time || '',
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    ftHomeGoals: row.ft_home_goals,
    ftAwayGoals: row.ft_away_goals,
    ftResult: row.ft_result as 'H' | 'D' | 'A',
    htHomeGoals: row.ht_home_goals,
    htAwayGoals: row.ht_away_goals,
    htResult: row.ht_result,
    homeShots: row.home_shots,
    awayShots: row.away_shots,
    homeShotsOnTarget: row.home_shots_on_target,
    awayShotsOnTarget: row.away_shots_on_target,
    homeCorners: row.home_corners,
    awayCorners: row.away_corners,
    homeYellows: row.home_yellows,
    awayYellows: row.away_yellows,
    homeReds: row.home_reds,
    awayReds: row.away_reds,
    homeFouls: row.home_fouls || null,
    awayFouls: row.away_fouls || null,
    season: row.season,
    leagueId: row.league_id,
  }));

  // Mark all teams as fresh (we just loaded their data)
  const teams = new Set<string>();
  for (const m of matches) {
    teams.add(m.homeTeam);
    teams.add(m.awayTeam);
  }
  for (const team of teams) markTeamFresh(team);

  loadMatches(matches);
  // Purge any pre-existing malformed/duplicate rows (same-team, date-format dupes)
  const { cleanDatabase } = await import('../engine/historical-stats');
  cleanDatabase();
  return matches.length;
}

/**
 * Get matches for a specific team from DB (for display).
 */
export async function getTeamMatches(teamName: string, limit: number = 20): Promise<HistoricalMatch[]> {
  const database = await getDb();
  const name = `%${teamName.toLowerCase()}%`;
  const rows = await database.select<any[]>(
    `SELECT * FROM historical_matches 
     WHERE LOWER(home_team) LIKE $1 OR LOWER(away_team) LIKE $1 
     ORDER BY date DESC LIMIT $2`,
    [name, limit]
  );

  if (!rows) return [];
  return rows.map(row => ({
    division: row.division || row.league_id,
    date: row.date,
    time: row.time || '',
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    ftHomeGoals: row.ft_home_goals,
    ftAwayGoals: row.ft_away_goals,
    ftResult: row.ft_result as 'H' | 'D' | 'A',
    htHomeGoals: row.ht_home_goals,
    htAwayGoals: row.ht_away_goals,
    htResult: row.ht_result,
    homeShots: row.home_shots,
    awayShots: row.away_shots,
    homeShotsOnTarget: row.home_shots_on_target,
    awayShotsOnTarget: row.away_shots_on_target,
    homeCorners: row.home_corners,
    awayCorners: row.away_corners,
    homeYellows: row.home_yellows,
    awayYellows: row.away_yellows,
    homeReds: row.home_reds,
    awayReds: row.away_reds,
    homeFouls: row.home_fouls || null,
    awayFouls: row.away_fouls || null,
    season: row.season,
    leagueId: row.league_id,
  }));
}

export async function getMatchCount(): Promise<number> {
  const database = await getDb();
  const result = await database.select<[{ count: number }]>(
    `SELECT COUNT(*) as count FROM historical_matches`
  );
  return result?.[0]?.count || 0;
}

export async function getMatchCountByLeague(): Promise<Record<string, number>> {
  const database = await getDb();
  const rows = await database.select<{ league_id: string; count: number }[]>(
    `SELECT league_id, COUNT(*) as count FROM historical_matches GROUP BY league_id ORDER BY count DESC`
  );
  const result: Record<string, number> = {};
  for (const row of rows || []) result[row.league_id] = row.count;
  return result;
}

export async function getLastSync(): Promise<{ source: string; synced_at: string; matches_imported: number } | null> {
  const database = await getDb();
  const rows = await database.select<any[]>(
    `SELECT source, synced_at, matches_imported FROM data_sync_log ORDER BY synced_at DESC LIMIT 1`
  );
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

export async function needsRefresh(): Promise<boolean> {
  const lastSync = await getLastSync();
  if (!lastSync) return true;
  const syncAge = Date.now() - new Date(lastSync.synced_at).getTime();
  return syncAge > 7 * 24 * 60 * 60 * 1000;
}

/**
 * Update a match record with enrichment data (HT scores, shots, corners, cards).
 * Uses home_team + away_team + date to find the match.
 */
export async function updateMatchEnrichment(
  homeTeam: string,
  awayTeam: string,
  date: string,
  enrichment: {
    htHomeGoals?: number | null;
    htAwayGoals?: number | null;
    homeShots?: number | null;
    awayShots?: number | null;
    homeShotsOnTarget?: number | null;
    awayShotsOnTarget?: number | null;
    homeCorners?: number | null;
    awayCorners?: number | null;
    homeYellows?: number | null;
    awayYellows?: number | null;
    homeReds?: number | null;
    awayReds?: number | null;
    homeFouls?: number | null;
    awayFouls?: number | null;
  }
): Promise<boolean> {
  const database = await getDb();
  try {
    const result = await database.execute(
      `UPDATE historical_matches SET
        ht_home_goals = COALESCE($1, ht_home_goals),
        ht_away_goals = COALESCE($2, ht_away_goals),
        ht_result = CASE
          WHEN $1 IS NOT NULL AND $2 IS NOT NULL THEN
            CASE WHEN $1 > $2 THEN 'H' WHEN $1 < $2 THEN 'A' ELSE 'D' END
          ELSE ht_result END,
        home_shots = COALESCE($3, home_shots),
        away_shots = COALESCE($4, away_shots),
        home_shots_on_target = COALESCE($5, home_shots_on_target),
        away_shots_on_target = COALESCE($6, away_shots_on_target),
        home_corners = COALESCE($7, home_corners),
        away_corners = COALESCE($8, away_corners),
        home_yellows = COALESCE($9, home_yellows),
        away_yellows = COALESCE($10, away_yellows),
        home_reds = COALESCE($11, home_reds),
        away_reds = COALESCE($12, away_reds),
        home_fouls = COALESCE($13, home_fouls),
        away_fouls = COALESCE($14, away_fouls)
       WHERE home_team = $15 AND away_team = $16 AND date = $17`,
      [
        enrichment.htHomeGoals ?? null,
        enrichment.htAwayGoals ?? null,
        enrichment.homeShots ?? null,
        enrichment.awayShots ?? null,
        enrichment.homeShotsOnTarget ?? null,
        enrichment.awayShotsOnTarget ?? null,
        enrichment.homeCorners ?? null,
        enrichment.awayCorners ?? null,
        enrichment.homeYellows ?? null,
        enrichment.awayYellows ?? null,
        enrichment.homeReds ?? null,
        enrichment.awayReds ?? null,
        enrichment.homeFouls ?? null,
        enrichment.awayFouls ?? null,
        homeTeam, awayTeam, date,
      ]
    );
    return (result.rowsAffected || 0) > 0;
  } catch {
    return false;
  }
}

export async function clearAllData(): Promise<void> {
  const database = await getDb();
  await database.execute(`DELETE FROM historical_matches`);
  await database.execute(`DELETE FROM data_sync_log`);
  clearDatabase();
}

// ─── Full Sync (Manual / First Run) ─────────────────────────────────────────

/**
 * Full data sync: fetches from all historical sources and saves to DB.
 */
export async function syncHistoricalData(
  onProgress?: (message: string) => void
): Promise<{ totalMatches: number; newMatches: number; sources: string[] }> {
  const { fetchAllResults: fetchOpenFootball, getRecentSeasons } = await import('../engine/openfootball');
  const { fetchAllResults: fetchFootballDataUk } = await import('../engine/football-data-uk');

  const sources: string[] = [];
  let totalNew = 0;

  onProgress?.('Fetching current season data from OpenFootball...');
  try {
    const seasons = getRecentSeasons(3);
    const ofMatches = await fetchOpenFootball(seasons);
    if (ofMatches.length > 0) {
      const saved = await saveMatches(ofMatches, 'openfootball');
      totalNew += saved;
      sources.push(`OpenFootball: ${saved} new`);
      onProgress?.(`OpenFootball: ${ofMatches.length} fetched, ${saved} new`);
    }
  } catch (e: any) {
    onProgress?.(`OpenFootball failed: ${e.message}`);
  }

  onProgress?.('Fetching historical data from football-data.co.uk...');
  try {
    const fdMatches = await fetchFootballDataUk(3);
    if (fdMatches.length > 0) {
      const saved = await saveMatches(fdMatches, 'football-data-uk');
      totalNew += saved;
      sources.push(`Football-Data.co.uk: ${saved} new`);
      onProgress?.(`Football-Data.co.uk: ${fdMatches.length} fetched, ${saved} new`);
    }
  } catch (e: any) {
    onProgress?.(`Football-Data.co.uk failed: ${e.message}`);
  }

  // 3. StatsBomb Open Data (match results with xG context, select leagues)
  onProgress?.('Fetching StatsBomb data (La Liga, UCL, Bundesliga)...');
  try {
    const { fetchAllResults: fetchStatsBomb } = await import('../engine/statsbomb');
    const sbMatches = await fetchStatsBomb(2); // 2 seasons per league
    if (sbMatches.length > 0) {
      const saved = await saveMatches(sbMatches, 'statsbomb');
      totalNew += saved;
      sources.push(`StatsBomb: ${saved} new`);
      onProgress?.(`StatsBomb: ${sbMatches.length} fetched, ${saved} new`);
    }
  } catch (e: any) {
    onProgress?.(`StatsBomb failed: ${e.message}`);
  }

  onProgress?.('Loading prediction engine...');
  clearDatabase();
  const totalLoaded = await loadMatchesFromDb();
  onProgress?.(`Prediction engine ready: ${totalLoaded} matches loaded`);

  return { totalMatches: totalLoaded, newMatches: totalNew, sources };
}

// ─── Background Auto-Refresh ─────────────────────────────────────────────────

let backgroundRefreshRunning = false;

/**
 * Silent background refresh — runs on app start.
 * Fetches latest results from OpenFootball (fast, small) to keep DB current.
 * Non-blocking, doesn't affect UI.
 */
export async function backgroundRefresh(): Promise<void> {
  if (backgroundRefreshRunning) return;
  backgroundRefreshRunning = true;

  try {
    const lastSync = await getLastSync();
    const syncAge = lastSync ? Date.now() - new Date(lastSync.synced_at).getTime() : Infinity;

    // Only refresh if last sync was > 12 hours ago
    if (syncAge < 12 * 60 * 60 * 1000) {
      backgroundRefreshRunning = false;
      return;
    }

    // Quick refresh from OpenFootball only (fast, ~16 JSON files)
    const { fetchAllResults: fetchOpenFootball, getRecentSeasons } = await import('../engine/openfootball');
    const seasons = getRecentSeasons(1); // Current season only
    const matches = await fetchOpenFootball(seasons);
    if (matches.length > 0) {
      await saveMatches(matches, 'openfootball-bg');
    }

    console.log(`[BackgroundRefresh] Updated with ${matches.length} matches from OpenFootball`);
  } catch (e) {
    console.warn('[BackgroundRefresh] Failed:', e);
  } finally {
    backgroundRefreshRunning = false;
  }
}
