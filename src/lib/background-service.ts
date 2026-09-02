/**
 * Background Service — Persistent processing that runs at App level.
 *
 * This module handles all async background tasks that must persist
 * regardless of which page/tab the user is on. It runs once at app
 * start and never stops until the app closes.
 *
 * Responsibilities:
 * - Historical data DB loading + refresh
 * - Auto-scout (fixture pre-fetching)
 * - Prediction auto-settlement (check results every 30 min)
 * - Scout results persistence (available across page switches)
 *
 * Components just READ from this service's exported state.
 * They never own background processes themselves.
 */

// ─── Shared State (module-level, persists across all components) ─────────────

export interface BackgroundState {
  dbLoaded: boolean;
  dbSize: number;
  autoScoutFixtures: any[];
  autoScoutFetchedAt: number | null;
  lastSettlement: { settled: number; won: number; lost: number } | null;
  lastRefresh: string | null;
  isRunning: boolean;
  errors: string[];
}

const state: BackgroundState = {
  dbLoaded: false,
  dbSize: 0,
  autoScoutFixtures: [],
  autoScoutFetchedAt: null,
  lastSettlement: null,
  lastRefresh: null,
  isRunning: false,
  errors: [],
};

// Listeners for state changes (components subscribe to get updates)
type Listener = (state: BackgroundState) => void;
const listeners: Set<Listener> = new Set();

export function getBackgroundState(): BackgroundState {
  return { ...state };
}

export function subscribeToBackground(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  for (const listener of listeners) {
    try { listener({ ...state }); } catch {}
  }
}

// ─── Background Tasks ────────────────────────────────────────────────────────

let initialized = false;
let settlementInterval: ReturnType<typeof setInterval> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize all background services. Call ONCE from App.tsx useEffect.
 * Idempotent — safe to call multiple times (only runs once).
 */
export async function initBackgroundServices(): Promise<void> {
  if (initialized) return;
  initialized = true;
  state.isRunning = true;
  notifyListeners();

  // 1. Load historical DB into memory
  try {
    const { loadMatchesFromDb, backgroundRefresh } = await import('./match-database');
    const count = await loadMatchesFromDb();
    state.dbLoaded = true;
    state.dbSize = count;
    notifyListeners();

    // Silent refresh if stale
    backgroundRefresh().then(() => {
      state.lastRefresh = new Date().toISOString();
      notifyListeners();
    }).catch(() => {});
  } catch (e: any) {
    state.errors.push(`DB load failed: ${e.message}`);
  }

  // 2. Start prediction auto-settlement (every 30 min)
  try {
    const { startAutoSettlement, settlePendingPredictions } = await import('../engine/prediction-tracker');
    // Run immediately
    settlePendingPredictions().then(result => {
      state.lastSettlement = result;
      notifyListeners();
    }).catch(() => {});
    // Then every 30 min
    settlementInterval = setInterval(async () => {
      try {
        const result = await settlePendingPredictions();
        state.lastSettlement = result;
        notifyListeners();
      } catch {}
    }, 30 * 60 * 1000);
  } catch (e: any) {
    state.errors.push(`Settlement init failed: ${e.message}`);
  }

  // 3. Auto-scout Tier 1 fixtures (background)
  try {
    const { getAllScheduledFixtures } = await import('../engine/espn');
    const { LEAGUE_REGISTRY } = await import('../engine/league-registry');
    const tier1Slugs = LEAGUE_REGISTRY.filter(l => l.tier === 1 && l.espnSlug).map(l => l.espnSlug!);
    const fixtures = await getAllScheduledFixtures(tier1Slugs);
    state.autoScoutFixtures = fixtures;
    state.autoScoutFetchedAt = Date.now();
    notifyListeners();
  } catch (e: any) {
    state.errors.push(`Auto-scout failed: ${e.message}`);
  }

  // 4. Periodic DB refresh (every 6 hours)
  refreshInterval = setInterval(async () => {
    try {
      const { backgroundRefresh } = await import('./match-database');
      await backgroundRefresh();
      state.lastRefresh = new Date().toISOString();
      notifyListeners();
    } catch {}
  }, 6 * 60 * 60 * 1000);

  // 5. Re-scout fixtures every 2 hours
  setInterval(async () => {
    try {
      const { getAllScheduledFixtures } = await import('../engine/espn');
      const { LEAGUE_REGISTRY } = await import('../engine/league-registry');
      const tier1Slugs = LEAGUE_REGISTRY.filter(l => l.tier === 1 && l.espnSlug).map(l => l.espnSlug!);
      const fixtures = await getAllScheduledFixtures(tier1Slugs);
      state.autoScoutFixtures = fixtures;
      state.autoScoutFetchedAt = Date.now();
      notifyListeners();
    } catch {}
  }, 2 * 60 * 60 * 1000);

  // 6. Flashscore auto-result settlement (every hour — fetch finished matches, save to DB)
  const flashscoreSettlement = async () => {
    try {
      const { fetchYesterdayResults, fetchTodayFinished, convertToHistoricalMatches } = await import('../engine/flashscore');
      const { saveOnDemandResults } = await import('./match-database');

      // Fetch yesterday's completed matches
      const yesterdayResults = await fetchYesterdayResults();
      if (yesterdayResults.length > 0) {
        const matches = convertToHistoricalMatches(yesterdayResults);
        const saved = await saveOnDemandResults(matches, 'flashscore-auto');
        if (saved > 0) console.log(`[Flashscore] Auto-saved ${saved} results from yesterday`);
      }

      // Fetch today's completed matches
      const todayResults = await fetchTodayFinished();
      if (todayResults.length > 0) {
        const matches = convertToHistoricalMatches(todayResults);
        const saved = await saveOnDemandResults(matches, 'flashscore-auto');
        if (saved > 0) console.log(`[Flashscore] Auto-saved ${saved} results from today`);
      }
    } catch (e) {
      console.warn('[Flashscore] Auto-settlement failed:', e);
    }
  };

  // Run Flashscore settlement immediately, then every hour
  flashscoreSettlement();
  setInterval(flashscoreSettlement, 60 * 60 * 1000);

  // 7. Match enrichment — after settlement, enrich recent matches with HT/cards/corners
  const enrichRecentMatches = async () => {
    try {
      const { fetchTodayFinished, fetchYesterdayResults } = await import('../engine/flashscore');
      const { fetchMatchEnrichment, getCachedEnrichment } = await import('../engine/match-enrichment');
      const { updateMatchEnrichment } = await import('./match-database');

      // Get today's + yesterday's finished matches (they have matchIds)
      const todayFinished = await fetchTodayFinished();
      const yesterdayFinished = await fetchYesterdayResults();
      const allFinished = [...todayFinished, ...yesterdayFinished];

      // Enrich up to 10 matches per cycle (avoid rate limiting)
      let enriched = 0;
      for (const fixture of allFinished) {
        if (enriched >= 10) break;
        if (!fixture.matchId) continue;
        // Skip if already cached
        if (getCachedEnrichment(fixture.matchId)) continue;

        const data = await fetchMatchEnrichment(fixture.matchId);
        if (data) {
          // Update DB with enrichment data
          await updateMatchEnrichment(fixture.homeTeam, fixture.awayTeam, fixture.date, {
            htHomeGoals: data.htScore?.[0] ?? null,
            htAwayGoals: data.htScore?.[1] ?? null,
            homeShots: data.stats.shots?.[0] ?? null,
            awayShots: data.stats.shots?.[1] ?? null,
            homeShotsOnTarget: data.stats.shotsOnTarget?.[0] ?? null,
            awayShotsOnTarget: data.stats.shotsOnTarget?.[1] ?? null,
            homeCorners: data.stats.corners?.[0] ?? null,
            awayCorners: data.stats.corners?.[1] ?? null,
            homeYellows: data.cards.filter(c => c.team === 'home' && c.type === 'yellow').length || null,
            awayYellows: data.cards.filter(c => c.team === 'away' && c.type === 'yellow').length || null,
            homeReds: data.cards.filter(c => c.team === 'home' && c.type === 'red').length || null,
            awayReds: data.cards.filter(c => c.team === 'away' && c.type === 'red').length || null,
            homeFouls: data.stats.fouls?.[0] ?? null,
            awayFouls: data.stats.fouls?.[1] ?? null,
          });
          enriched++;
        }
        // Delay between requests
        await new Promise(r => setTimeout(r, 800));
      }
      if (enriched > 0) console.log(`[Enrichment] Enriched ${enriched} matches with HT/stats/cards`);
    } catch (e) {
      console.warn('[Enrichment] Failed:', e);
    }
  };

  // Run enrichment 2 minutes after settlement (let settlement finish first), then every 2 hours
  setTimeout(enrichRecentMatches, 2 * 60 * 1000);
  setInterval(enrichRecentMatches, 2 * 60 * 60 * 1000);

  console.log('[BackgroundService] All services initialized');
}

/**
 * Stop all background services (for cleanup on app close).
 */
export function stopBackgroundServices() {
  if (settlementInterval) clearInterval(settlementInterval);
  if (refreshInterval) clearInterval(refreshInterval);
  state.isRunning = false;
  initialized = false;
  notifyListeners();
}

/**
 * Get pre-fetched auto-scout fixtures (available immediately without waiting).
 */
export function getAutoScoutFixtures(): any[] {
  return state.autoScoutFixtures;
}

/**
 * Check if the background service has pre-fetched fixtures.
 */
export function hasAutoScoutData(): boolean {
  return state.autoScoutFixtures.length > 0 && state.autoScoutFetchedAt !== null;
}
