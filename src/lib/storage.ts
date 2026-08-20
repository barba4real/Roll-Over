import { StakedSlip } from '../App';
import { ParsedSelection, Slip } from '../engine/types';

const STORAGE_KEYS = {
  STAKED_SLIPS: 'rollover_staked_slips',
  HISTORY: 'rollover_history',
  CHAINS: 'rollover_chains',
  SETTINGS: 'rollover_settings',
  SELECTIONS: 'rollover_selections',
  GENERATED_SLIPS: 'rollover_generated_slips',
};

export interface AppSettings {
  dailySlipLimit: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  dailySlipLimit: 5,
};

// Settings
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function loadSettings(): AppSettings {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

// Selections persistence
export function saveSelections(selections: ParsedSelection[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SELECTIONS, JSON.stringify(selections));
  } catch (e) {
    console.error('Failed to save selections:', e);
  }
}

export function loadSelections(): ParsedSelection[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SELECTIONS);
    if (!data) return [];
    const parsed = JSON.parse(data);
    // Rehydrate Date objects
    return parsed.map((s: any) => ({
      ...s,
      kickOffDateTime: new Date(s.kickOffDateTime),
    }));
  } catch (e) {
    console.error('Failed to load selections:', e);
    return [];
  }
}

export function exportSelections(selections: ParsedSelection[]): string {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    type: 'selections',
    selections,
  };
  return JSON.stringify(data, null, 2);
}

export function importSelections(jsonString: string): { success: boolean; selections?: ParsedSelection[]; error?: string } {
  try {
    const data = JSON.parse(jsonString);
    if (!data.selections || !Array.isArray(data.selections)) {
      return { success: false, error: 'Invalid file: no selections array found.' };
    }
    const selections = data.selections.map((s: any) => ({
      ...s,
      kickOffDateTime: new Date(s.kickOffDateTime),
    }));
    return { success: true, selections };
  } catch (e) {
    return { success: false, error: 'Failed to parse selections file.' };
  }
}

// Export all data as a single JSON object
export function exportAllData(): string {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    stakedSlips: loadStakedSlips(),
    history: loadHistory(),
    chains: loadChains(),
    settings: loadSettings(),
    selections: loadSelections(),
  };
  return JSON.stringify(data, null, 2);
}

// Import data from JSON string
export function importAllData(jsonString: string): { success: boolean; error?: string } {
  try {
    const data = JSON.parse(jsonString);
    if (!data.version) {
      return { success: false, error: 'Invalid backup file: missing version.' };
    }
    if (data.stakedSlips) saveStakedSlips(data.stakedSlips);
    if (data.history) saveHistory(data.history);
    if (data.chains) saveChains(data.chains);
    if (data.settings) saveSettings(data.settings);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Failed to parse backup file.' };
  }
}

// Using localStorage for persistence.
// This works in Tauri's WebView and survives app restarts.
// For a single-user personal tool, this is simple and reliable.

export function saveStakedSlips(slips: StakedSlip[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.STAKED_SLIPS, JSON.stringify(slips));
  } catch (e) {
    console.error('Failed to save staked slips:', e);
  }
}

export function loadStakedSlips(): StakedSlip[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.STAKED_SLIPS);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load staked slips:', e);
    return [];
  }
}

export function saveHistory(history: StakedSlip[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

export function loadHistory(): StakedSlip[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load history:', e);
    return [];
  }
}

export function saveChains(chains: any[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CHAINS, JSON.stringify(chains));
  } catch (e) {
    console.error('Failed to save chains:', e);
  }
}

export function loadChains(): any[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CHAINS);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load chains:', e);
    return [];
  }
}

// Generated slips persistence
export function saveGeneratedSlips(slips: Slip[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.GENERATED_SLIPS, JSON.stringify(slips));
  } catch (e) {
    console.error('Failed to save generated slips:', e);
  }
}

export function loadGeneratedSlips(): Slip[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.GENERATED_SLIPS);
    if (!data) return [];
    const parsed = JSON.parse(data);
    // Rehydrate Date objects in selections
    return parsed.map((slip: any) => ({
      ...slip,
      selections: slip.selections.map((s: any) => ({
        ...s,
        kickOffDateTime: new Date(s.kickOffDateTime),
      })),
    }));
  } catch (e) {
    console.error('Failed to load generated slips:', e);
    return [];
  }
}

// ─── localStorage Size Management ───────────────────────────────────────────

/**
 * Get approximate total localStorage usage in bytes.
 */
export function getStorageUsage(): { usedBytes: number; usedMB: string; percentFull: number } {
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        totalBytes += key.length + (localStorage.getItem(key)?.length || 0);
      }
    }
  } catch { /* ignore */ }
  // localStorage limit is typically 5-10MB (5MB for most browsers)
  const limitBytes = 5 * 1024 * 1024;
  return {
    usedBytes: totalBytes * 2, // UTF-16 = 2 bytes per char
    usedMB: ((totalBytes * 2) / (1024 * 1024)).toFixed(2),
    percentFull: Math.round((totalBytes * 2 / limitBytes) * 100),
  };
}

/**
 * Evict old cache entries when storage pressure is high (>80% full).
 * Removes: score cache entries older than 6h, stats cache entries older than 12h.
 */
export function evictIfNeeded(): void {
  const { percentFull } = getStorageUsage();
  if (percentFull < 80) return;

  const now = Date.now();

  // Evict score cache (older than 6h)
  try {
    const scoreCache = JSON.parse(localStorage.getItem('rollover_score_cache') || '{}');
    const sixHoursAgo = now - 6 * 60 * 60 * 1000;
    let evicted = 0;
    for (const key of Object.keys(scoreCache)) {
      if (scoreCache[key].cachedAt < sixHoursAgo) {
        delete scoreCache[key];
        evicted++;
      }
    }
    if (evicted > 0) localStorage.setItem('rollover_score_cache', JSON.stringify(scoreCache));
  } catch { /* ignore */ }

  // Evict team stats cache (older than 12h)
  try {
    const statsCache = JSON.parse(localStorage.getItem('rollover_team_stats_cache') || '{}');
    const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
    let evicted = 0;
    for (const key of Object.keys(statsCache)) {
      if (statsCache[key].cachedAt < twelveHoursAgo) {
        delete statsCache[key];
        evicted++;
      }
    }
    if (evicted > 0) localStorage.setItem('rollover_team_stats_cache', JSON.stringify(statsCache));
  } catch { /* ignore */ }

  // Evict league events cache (older than 24h)
  try {
    const leagueCache = JSON.parse(localStorage.getItem('rollover_league_events_cache') || '{}');
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    let evicted = 0;
    for (const key of Object.keys(leagueCache)) {
      if (leagueCache[key].cachedAt < twentyFourHoursAgo) {
        delete leagueCache[key];
        evicted++;
      }
    }
    if (evicted > 0) localStorage.setItem('rollover_league_events_cache', JSON.stringify(leagueCache));
  } catch { /* ignore */ }
}
