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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sb_fixture_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      window TEXT,
      pulled_at INTEGER NOT NULL
    )
  `);
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
    const payload = JSON.stringify({
      fixtures: state.fixtures.map(serializeFixture),
      leagues: state.leagues,
    });
    await db.execute(
      `INSERT OR REPLACE INTO sb_fixture_cache (id, payload, window, pulled_at) VALUES (1, $1, $2, $3)`,
      [payload, state.window, state.pulledAt ?? Date.now()]
    );
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
  window?: TimeWindow;
  region?: 'ng' | 'gh' | 'ke' | 'ug' | 'tz' | 'zm';
  maxPages?: number;
  pageSize?: number;
  force?: boolean;
}): Promise<void> {
  const win = opts?.window ?? state.window ?? '';

  // Reuse fresh data unless forced or the window changed.
  if (!opts?.force && isFixtureDataFresh() && win === state.window && state.fixtures.length > 0) {
    return;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    setState({ loading: true, error: null, progress: 'Loading SportyBet fixtures…', window: win });
    try {
      const res = await fetchSportyBetFixtures({
        region: opts?.region ?? 'ng',
        maxPages: opts?.maxPages ?? 12,
        pageSize: opts?.pageSize ?? 30,
        window: win,
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

/** Clear the store + cached row (e.g. a manual "reset" action). */
export async function clearFixtureStore(): Promise<void> {
  setState({ fixtures: [], leagues: [], pulledAt: null, error: null, progress: '' });
  try {
    const db = await getDb();
    await db.execute(`DELETE FROM sb_fixture_cache WHERE id = 1`);
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
    if (!hydrated && state.fixtures.length === 0) {
      void hydrateFixtures();
    }
    const unsub = subscribeFixtures(setSnap);
    return unsub;
  }, []);
  return snap;
}
