/**
 * Auto Result-Checking & Settlement Engine
 *
 * Background polling of live results → auto-settle active slips.
 * Also feeds results into the team database for local intelligence.
 *
 * Flow:
 *   1. Every 5 minutes, fetch today's results (via sportscore.ts fallback chain)
 *   2. Match finished results against pending selections in active slips
 *   3. Auto-mark won/lost per pick
 *   4. Record results in team database
 *   5. Record outcomes in prediction log
 *
 * The user sees: picks auto-resolve with "Auto-settled" tag.
 * Manual override always available.
 */

import { getLiveMatches, findMatchResult, evaluatePickResult, LiveMatch } from './sportscore';
import { recordFromSettledPick } from './team-database';
import { recordOutcome } from './prediction-log';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutoSettleResult {
  slipId: string;
  selectionId: string;
  homeTeam: string;
  awayTeam: string;
  result: 'won' | 'lost';
  homeScore: number;
  awayScore: number;
  settledAt: string;
  source: string; // Which provider gave the result
}

export interface AutoSettleStatus {
  lastChecked: string | null;   // ISO timestamp
  lastMatchCount: number;       // How many live/finished matches were found
  pendingCount: number;         // How many picks are still pending
  autoSettledCount: number;     // Total picks auto-settled this session
  errors: string[];
}

// ─── State ───────────────────────────────────────────────────────────────────

let lastChecked: string | null = null;
let autoSettledCount = 0;
let lastErrors: string[] = [];

/**
 * Check for results and auto-settle pending picks.
 *
 * @param pendingSelections - All pending picks across active slips
 * @returns Array of settlements to apply
 */
export async function checkAndSettle(
  pendingSelections: Array<{
    slipId: string;
    selectionId: string;
    homeTeam: string;
    awayTeam: string;
    pick: string;
    pickCategory: string;
    marketType: string;
    kickOffDateTime: Date;
  }>
): Promise<AutoSettleResult[]> {
  lastErrors = [];
  const settlements: AutoSettleResult[] = [];

  // Only check picks whose kickoff was > 90 minutes ago (match likely finished)
  const now = Date.now();
  const checkable = pendingSelections.filter(s => {
    const elapsed = now - new Date(s.kickOffDateTime).getTime();
    return elapsed > 90 * 60 * 1000; // 90 minutes past kickoff
  });

  if (checkable.length === 0) {
    lastChecked = new Date().toISOString();
    return [];
  }

  // Fetch live/finished results
  let liveMatches: LiveMatch[] = [];
  try {
    liveMatches = await getLiveMatches();
  } catch (e: any) {
    lastErrors.push(`Failed to fetch results: ${e.message}`);
    return [];
  }

  lastChecked = new Date().toISOString();

  // Match each pending pick against results
  for (const sel of checkable) {
    const match = findMatchResult(liveMatches, sel.homeTeam, sel.awayTeam);
    if (!match || match.status !== 'finished') continue;
    if (match.homeScore === null || match.awayScore === null) continue;

    const result = evaluatePickResult(match, sel.pick, sel.pickCategory, sel.marketType);
    if (result === 'pending') continue; // Can't determine (complex market)

    settlements.push({
      slipId: sel.slipId,
      selectionId: sel.selectionId,
      homeTeam: sel.homeTeam,
      awayTeam: sel.awayTeam,
      result,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      settledAt: new Date().toISOString(),
      source: match.provider,
    });

    // Feed into team database (local intelligence grows)
    try {
      recordFromSettledPick(
        sel.homeTeam, sel.awayTeam,
        match.homeScore, match.awayScore,
        new Date(sel.kickOffDateTime).toISOString()
      );
    } catch { /* non-critical */ }

    // Feed into prediction log
    try {
      recordOutcome(sel.selectionId, result);
    } catch { /* non-critical */ }
  }

  autoSettledCount += settlements.length;
  return settlements;
}

/**
 * Get auto-settle status for UI display.
 */
export function getAutoSettleStatus(pendingCount: number): AutoSettleStatus {
  return {
    lastChecked,
    lastMatchCount: 0, // Will be populated during next check
    pendingCount,
    autoSettledCount,
    errors: lastErrors,
  };
}

/**
 * Reset session counter (e.g., on app start).
 */
export function resetAutoSettleSession(): void {
  autoSettledCount = 0;
  lastErrors = [];
  lastChecked = null;
}

/**
 * Determine if we should poll (has been > 5 minutes since last check
 * AND there are pending picks with kickoffs > 90min ago).
 */
export function shouldPoll(
  pendingSelections: Array<{ kickOffDateTime: Date }>,
  pollIntervalMs: number = 5 * 60 * 1000
): boolean {
  // Don't poll if no pending picks
  if (pendingSelections.length === 0) return false;

  // Don't poll if nothing has kicked off yet
  const now = Date.now();
  const hasStarted = pendingSelections.some(s =>
    now - new Date(s.kickOffDateTime).getTime() > 90 * 60 * 1000
  );
  if (!hasStarted) return false;

  // Don't poll if checked recently
  if (lastChecked) {
    const elapsed = now - new Date(lastChecked).getTime();
    if (elapsed < pollIntervalMs) return false;
  }

  return true;
}
