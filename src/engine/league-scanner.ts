/**
 * League Scanner — Auto-detect which leagues have upcoming fixtures.
 *
 * Probes ESPN CDN for each league to check if there are events in the
 * selected date range. Results are cached per session to avoid repeated
 * requests on every UI interaction.
 *
 * Strategy:
 * - Fetch ESPN CDN scoreboard for each league (no date = today/upcoming)
 * - If events exist → league is active
 * - If no events → league is inactive (off-season, no games this period)
 * - Probe in batches of 4 to avoid overwhelming CDN
 * - Cache results for 2 hours (session-level)
 *
 * This powers the "active leagues" indicator in Match Scout.
 */

import { httpGetDirect } from '../lib/http';
import { LEAGUE_REGISTRY, LeagueEntry } from './league-registry';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LeagueScanResult {
  leagueId: string;
  active: boolean;
  eventCount: number;
  scannedAt: number;  // timestamp
}

export interface ScanSummary {
  totalScanned: number;
  activeCount: number;
  inactiveCount: number;
  failedCount: number;
  results: Record<string, LeagueScanResult>;
  scannedAt: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_KEY = 'rollover_league_scan_cache';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

let scanCache: ScanSummary | null = null;

function loadCache(): ScanSummary | null {
  if (scanCache && Date.now() - scanCache.scannedAt < CACHE_TTL) {
    return scanCache;
  }
  try {
    const stored = sessionStorage.getItem(CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ScanSummary;
      if (Date.now() - parsed.scannedAt < CACHE_TTL) {
        scanCache = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

function saveCache(summary: ScanSummary) {
  scanCache = summary;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(summary));
  } catch {}
}

/**
 * Get cached scan results if still fresh.
 */
export function getCachedScan(): ScanSummary | null {
  return loadCache();
}

/**
 * Clear the scan cache (force re-scan next time).
 */
export function clearScanCache() {
  scanCache = null;
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

const CDN_HOST = 'https://cdn.espn.com/core/soccer';
const CONCURRENCY = 4;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Probe a single league on ESPN CDN to check for events.
 * Returns the number of events found (0 = inactive).
 */
async function probeLeague(espnSlug: string): Promise<number> {
  const url = `${CDN_HOST}/scoreboard?xhr=1&league=${espnSlug}`;
  try {
    const result: any = await httpGetDirect(url, {});
    const events = result?.content?.sbData?.events;
    if (Array.isArray(events)) return events.length;
    // Fallback structure checks
    if (result?.events && Array.isArray(result.events)) return result.events.length;
    // Response received but no events array — means the league exists but no games today
    return 0;
  } catch {
    // Request failed — could be network issue or league not supported
    return -1; // -1 = failed
  }
}

/**
 * Scan all leagues with ESPN slugs to detect which have active fixtures.
 * Processes in batches for performance. Returns a full summary.
 *
 * @param onProgress - Optional callback for progress updates
 * @param leagueIds - Optional subset of league IDs to scan (defaults to all with ESPN slugs)
 */
export async function scanActiveLeagues(
  onProgress?: (scanned: number, total: number) => void,
  leagueIds?: string[]
): Promise<ScanSummary> {
  // Check cache first
  const cached = loadCache();
  if (cached) return cached;

  // Filter to leagues with ESPN slugs
  const leaguesToScan = leagueIds
    ? LEAGUE_REGISTRY.filter(l => leagueIds.includes(l.id) && l.espnSlug)
    : LEAGUE_REGISTRY.filter(l => l.espnSlug);

  const results: Record<string, LeagueScanResult> = {};
  let activeCount = 0;
  let inactiveCount = 0;
  let failedCount = 0;
  let scanned = 0;

  // Process in batches
  for (let i = 0; i < leaguesToScan.length; i += CONCURRENCY) {
    const batch = leaguesToScan.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map(async (league) => {
        const count = await probeLeague(league.espnSlug!);
        return { league, count };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { league, count } = result.value;
        const active = count > 0;
        const failed = count === -1;

        results[league.id] = {
          leagueId: league.id,
          active: active || failed, // Treat failed as "maybe active" (don't hide)
          eventCount: Math.max(0, count),
          scannedAt: Date.now(),
        };

        if (failed) failedCount++;
        else if (active) activeCount++;
        else inactiveCount++;
      }
      scanned++;
    }

    onProgress?.(scanned, leaguesToScan.length);

    // Small delay between batches
    if (i + CONCURRENCY < leaguesToScan.length) {
      await sleep(200);
    }
  }

  // Leagues without ESPN slugs — mark as "unknown" (treat as active)
  const noEspnLeagues = leagueIds
    ? LEAGUE_REGISTRY.filter(l => leagueIds.includes(l.id) && !l.espnSlug)
    : LEAGUE_REGISTRY.filter(l => !l.espnSlug);

  for (const league of noEspnLeagues) {
    results[league.id] = {
      leagueId: league.id,
      active: true, // Can't verify, assume active
      eventCount: -1,
      scannedAt: Date.now(),
    };
  }

  const summary: ScanSummary = {
    totalScanned: leaguesToScan.length,
    activeCount,
    inactiveCount,
    failedCount,
    results,
    scannedAt: Date.now(),
  };

  saveCache(summary);
  return summary;
}

/**
 * Quick check: is a specific league active?
 * Uses cache if available, otherwise returns true (assume active).
 */
export function isLeagueActive(leagueId: string): boolean {
  const cached = loadCache();
  if (!cached) return true; // No scan done yet — assume all active
  return cached.results[leagueId]?.active ?? true;
}

/**
 * Get list of active league IDs from the last scan.
 * Returns all league IDs if no scan has been done.
 */
export function getActiveLeagueIds(): string[] {
  const cached = loadCache();
  if (!cached) return LEAGUE_REGISTRY.map(l => l.id);
  return Object.entries(cached.results)
    .filter(([, r]) => r.active)
    .map(([id]) => id);
}

/**
 * Get list of inactive league IDs from the last scan.
 */
export function getInactiveLeagueIds(): string[] {
  const cached = loadCache();
  if (!cached) return [];
  return Object.entries(cached.results)
    .filter(([, r]) => !r.active)
    .map(([id]) => id);
}
