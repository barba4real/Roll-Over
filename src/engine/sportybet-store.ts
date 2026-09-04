/**
 * Shared SportyBet fixture store.
 *
 * ONE pull feeds BOTH the Match Scout (dashboard) and the Markets tab. Instead
 * of each component calling fetchSportyBetFixtures independently, they read from
 * this singleton store. Whoever pulls first fills it; the other tab renders what
 * is already there. A pull anywhere notifies all subscribers.
 *
 * Persistence: the last pull is cached in SQLite (table sb_fixture_cache, created
 * lazily) so it survives app restarts and page navigation without re-pulling the
 * ~6k fixtures. localStorage is avoided here because that dataset can exceed the
 * ~5MB quota.
 *
 * NOTE: the Fouls tab deliberately does NOT use this store — it runs its own
 * dedicated fouls-only search (see FoulsStrategy). This module is distinct from
 * engine/fixture-store.ts (the older multi-provider merge/lock layer).
 */

import { useEffect, useState as useReactState } from 'react';
import { getDb } from '../lib/database';
import { fetchSportyBetFixtures, SbFixture, TimeWindow } from './sportybet';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SbStoreState {
  fixtures: SbFixture[];
  leagues: string[];
  window: TimeWindow;
  pulledAt: number | null; // epoch ms of last successful pull, null if never
  loading: boolean;
  progress: string;        // human-readable progress during a pull
  error: string | null;
}

type Listener = (state: SbStoreState) => void;

// ─── Module State ──────────────────────────────────────────────────────────

let state: SbStoreState = {
  fixtures: [],
  leagues: [],
  window: '',
  pulledAt: null,
  loading: false,
  progress: '',
  error: null,
};

const listeners = new Set<Listener>();
let hydrated = false;
let inFlight: Promise<void> | null = null;

// Freshness: consider a cached pull "stale" after this long.
const FRESH_MS = 12 * 60 * 60 * 1000; // 12h

// ─── Notify ──────────────────────────────────────────────────────────────

function emit() {
  const snapshot = state;
  for (const l of listeners) l(snapshot);
}

function setState(patch: Partial<SbStoreState>) {
  state = { ...state, ...patch };
  emit();
}

export function getFixtureState(): SbStoreState {
  return state;
}

export function subscribeFixtures(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

export function isFixtureDataFresh(): boolean {
  return state.pulledAt != null && Date.now() - state.pulledAt < FRESH_MS;
}

// ─── Persistence ─────────────────────────────────────────────────────────

async function ensureTable() {
  const db = await getDb();
  // Single-row snapshot of the last pull (fast whole-list restore for the UI).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sb_fixture_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      window TEXT,
      pulled_at INTEGER NOT NULL
    )
  `);
  // Durable, accumulating slate — one row per fixture across all pulls/windows.
  // This is the stable source the offline Python predictor reads (it does not
  // get wiped by the next pull the way the single-row snapshot does).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS upcoming_fixtures (
      event_id TEXT PRIMARY KEY,
      game_id TEXT,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      country TEXT,
      league_name TEXT,
      league TEXT,
      league_id TEXT,
      home_canonical TEXT,
      away_canonical TEXT,
      kickoff_ms INTEGER,
      date TEXT,
      time TEXT,
      has_preferred INTEGER DEFAULT 0,
      window TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_upcoming_kickoff ON upcoming_fixtures(kickoff_ms)`);
  // Backward-compat: add columns to a pre-existing table (ignore if present).
  // Must happen BEFORE any index that references them.
  try { await db.execute(`ALTER TABLE upcoming_fixtures ADD COLUMN league_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE upcoming_fixtures ADD COLUMN home_canonical TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE upcoming_fixtures ADD COLUMN away_canonical TEXT`); } catch {}
  try { await db.execute(`CREATE INDEX IF NOT EXISTS idx_upcoming_league_id ON upcoming_fixtures(league_id)`); } catch {}
}

/** Serialize a SbFixture for JSON storage (Date -> epoch ms). */
function serializeFixture(f: SbFixture): any {
  return { ...f, kickoff: f.kickoff instanceof Date ? f.kickoff.getTime() : f.kickoff };
}

/** Rebuild a SbFixture from stored JSON (epoch ms -> Date). */
function deserializeFixture(o: any): SbFixture {
  return { ...o, kickoff: new Date(o.kickoff) } as SbFixture;
}

async function persist() {
  try {
    await ensureTable();
    const db = await getDb();
    const now = state.pulledAt ?? Date.now();

    // 1) Single-row snapshot (fast whole-list restore for the UI).
    const payload = JSON.stringify({
      fixtures: state.fixtures.map(serializeFixture),
      leagues: state.leagues,
    });
    await db.execute(
      `INSERT OR REPLACE INTO sb_fixture_cache (id, payload, window, pulled_at) VALUES (1, $1, $2, $3)`,
      [payload, state.window, now]
    );

    // 2) Durable accumulating slate — upsert one row per fixture. INSERT OR
    //    IGNORE preserves first_seen; the UPDATE refreshes volatile fields so a
    //    fixture's kickoff/market flag stays current without losing its history.
    for (const f of state.fixtures) {
      const kickoffMs = f.kickoff instanceof Date ? f.kickoff.getTime() : Number(f.kickoff) || null;
      await db.execute(
        `INSERT OR IGNORE INTO upcoming_fixtures
           (event_id, game_id, home_team, away_team, country, league_name, league, league_id,
            home_canonical, away_canonical,
            kickoff_ms, date, time, has_preferred, window, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
        [
          f.eventId, f.gameId, f.homeTeam, f.awayTeam, f.country, f.leagueName, f.league, f.leagueId ?? null,
          f.homeCanonical ?? null, f.awayCanonical ?? null,
          kickoffMs, f.date, f.time, f.hasPreferred ? 1 : 0, state.window, now,
        ]
      );
      await db.execute(
        `UPDATE upcoming_fixtures
           SET kickoff_ms = $2, has_preferred = $3, window = $4, last_seen = $5,
               date = $6, time = $7, league = $8, league_name = $9, league_id = $10,
               home_canonical = $11, away_canonical = $12
         WHERE event_id = $1`,
        [f.eventId, kickoffMs, f.hasPreferred ? 1 : 0, state.window, now, f.date, f.time, f.league, f.leagueName, f.leagueId ?? null, f.homeCanonical ?? null, f.awayCanonical ?? null]
      );
    }

    // 3) Prune fixtures that kicked off more than 2 days ago — keeps the durable
    //    slate to genuinely upcoming/recent games without unbounded growth.
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await db.execute(`DELETE FROM upcoming_fixtures WHERE kickoff_ms IS NOT NULL AND kickoff_ms < $1`, [cutoff]);
  } catch {
    // Persistence is best-effort; the in-memory store still works this session.
  }
}

/**
 * Load the last cached pull from SQLite into the store. Idempotent — only runs
 * once per session. Call this on mount of Scout/Markets so a restart shows the
 * previous pull instantly without hitting the network.
 */
export async function hydrateFixtures(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    await ensureTable();
    const db = await getDb();
    const rows = await db.select<any[]>(`SELECT payload, window, pulled_at FROM sb_fixture_cache WHERE id = 1`);
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].payload);
      setState({
        fixtures: (parsed.fixtures || []).map(deserializeFixture),
        leagues: parsed.leagues || [],
        window: (rows[0].window || '') as TimeWindow,
        pulledAt: Number(rows[0].pulled_at) || null,
      });
    }
  } catch {
    // No cache yet or DB unavailable — leave the empty initial state.
  }
}

// ─── Pull ────────────────────────────────────────────────────────────────

/**
 * Pull fixtures from SportyBet and populate the shared store. Both Scout and
 * Markets call this; if a pull is already in flight the same promise is reused,
 * so a double-click or two tabs mounting at once won't double-fetch.
 */
export async function pullFixtures(opts?: {
  region?: 'ng' | 'gh' | 'ke' | 'ug' | 'tz' | 'zm';
  maxPages?: number;
  pageSize?: number;
  force?: boolean;
}): Promise<void> {
  // The store ALWAYS holds the full "all upcoming" slate (window ''). Time-window
  // filtering (Next 3h/6h/Today/…) is done in-memory by the UI over this cached
  // slate — NEVER by re-pulling. So switching windows is instant and offline.
  if (!opts?.force && isFixtureDataFresh() && state.fixtures.length > 0) {
    return; // fresh cache — no network needed
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    setState({ loading: true, error: null, progress: 'Loading SportyBet fixtures…', window: '' });
    try {
      const res = await fetchSportyBetFixtures({
        region: opts?.region ?? 'ng',
        // Default high so we EXHAUST the SportyBet feed — the pager stops on the
        // first empty page (see fetchSportyBetFixtures), so no showcased league
        // is dropped by an arbitrary depth cap. Callers may override to go shallow.
        maxPages: opts?.maxPages ?? 200,
        pageSize: opts?.pageSize ?? 30,
        window: '', // ALWAYS pull the full slate; UI filters windows locally
        onProgress: (m) => setState({ progress: m }),
      });
      setState({
        fixtures: res.fixtures,
        leagues: res.leagues,
        pulledAt: Date.now(),
        loading: false,
        progress: '',
      });
      await persist();
    } catch (e: any) {
      setState({ loading: false, error: e?.message || 'Failed to load fixtures', progress: '' });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Load-time sync: hydrate the cached slate from SQLite immediately (so the UI
 * shows fixtures instantly from local storage), then, if the cache is stale or
 * empty, refresh from the network in the BACKGROUND without blocking the UI.
 * Call this once when the app / a fixture tab first mounts.
 */
export async function syncFixturesOnLoad(): Promise<void> {
  await hydrateFixtures();                 // instant: show whatever is in local storage
  if (!isFixtureDataFresh() || state.fixtures.length === 0) {
    void pullFixtures();                   // background refresh; UI already usable
  }
}

/** Clear the store + cached row (e.g. a manual "reset" action). */
export async function clearFixtureStore(): Promise<void> {
  setState({ fixtures: [], leagues: [], pulledAt: null, error: null, progress: '' });
  try {
    const db = await getDb();
    await db.execute(`DELETE FROM sb_fixture_cache WHERE id = 1`);
    await db.execute(`DELETE FROM upcoming_fixtures`);
  } catch {}
}

// ─── React binding ─────────────────────────────────────────────────────────

/**
 * React hook: subscribe a component to the shared fixture store and hydrate the
 * cache on first mount. Returns the live store state; re-renders on any pull.
 */
export function useFixtureStore(): SbStoreState {
  const [snap, setSnap] = useReactState<SbStoreState>(getFixtureState);
  useEffect(() => {
    // Load from local storage first, then background-refresh if stale/empty.
    void syncFixturesOnLoad();
    const unsub = subscribeFixtures(setSnap);
    return unsub;
  }, []);
  return snap;
}
