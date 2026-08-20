import { v4 as uuidv4 } from 'uuid';
import { ParsedSelection, Slip, GroupingConfig } from './types';

/**
 * Default grouping configuration for rollover strategy
 */
export const DEFAULT_CONFIG: GroupingConfig = {
  targetOdds: 3.0,
  oddsRange: { min: 2.1, max: 3.9 },
  maxPicksPerSlip: 8,
  minPicksPerSlip: 2,
  safeOddsRange: { min: 1.20, max: 1.50 },
  maxHighRiskPerSlip: 1,
  noSameTeam: true,
  noSameKickoff: false,
  maxSlipsToGenerate: 50,
};

// ─── Shared constraint & quality logic (single source of truth) ──────────────

/**
 * Check if two selections conflict based on config constraints.
 */
function hasConflict(a: ParsedSelection, b: ParsedSelection, config: GroupingConfig): boolean {
  // ALWAYS prevent same match in a slip (non-negotiable)
  const aHome = a.homeTeam.toLowerCase();
  const aAway = a.awayTeam.toLowerCase();
  const bHome = b.homeTeam.toLowerCase();
  const bAway = b.awayTeam.toLowerCase();

  if (aHome === bHome && aAway === bAway) return true;

  // No same team in a slip (toggleable)
  if (config.noSameTeam) {
    if (aHome === bHome || aHome === bAway || aAway === bHome || aAway === bAway) return true;
  }

  // No same kickoff time
  if (config.noSameKickoff) {
    if (a.kickOffDateTime.getTime() === b.kickOffDateTime.getTime()) return true;
  }

  return false;
}

/**
 * Check if a selection conflicts with any selection in a group.
 */
function conflictsWithGroup(selection: ParsedSelection, group: ParsedSelection[], config: GroupingConfig): boolean {
  for (const s of group) {
    if (hasConflict(s, selection, config)) return true;
  }
  return false;
}

/**
 * Score a slip's quality (higher = safer).
 */
function calculateQuality(selections: ParsedSelection[], config: GroupingConfig): number {
  const safeCount = selections.filter(
    s => s.odds >= config.safeOddsRange.min && s.odds <= config.safeOddsRange.max
  ).length;
  const safeRatio = safeCount / selections.length;
  const safeScore = safeRatio * 80;

  // Minimization bonus: fewer picks = fewer failure points = safer
  // 2 picks: +15, 3 picks: +10, 4 picks: +5, 5+: +0
  const minimizationBonus = Math.max(0, 20 - (selections.length * 5));

  return Math.round(safeScore + minimizationBonus);
}

// ─── Main generation (synchronous, with iteration budget) ────────────────────

/** Hard iteration budget to prevent exponential blowup */
const MAX_ITERATIONS = 500_000;

/**
 * Generate valid slips from selections.
 * Uses depth-first backtracking with:
 * - Iteration budget (500k max) to prevent runaway computation
 * - Proper maxPicksPerSlip enforcement
 * - Odds-based pruning
 * - Early termination when enough slips found
 */
export function generateSlips(
  selections: ParsedSelection[],
  config: GroupingConfig = DEFAULT_CONFIG
): Slip[] {
  const eligible = selections.filter(s => s.isEligibleForGrouping);

  if (eligible.length < config.minPicksPerSlip) {
    return [];
  }

  const slips: Slip[] = [];
  const sorted = [...eligible].sort((a, b) => a.odds - b.odds);
  let iterations = 0;

  function buildCombinations(
    startIdx: number,
    currentGroup: ParsedSelection[],
    currentOdds: number
  ): void {
    // Budget guard — prevents exponential blowup
    if (++iterations > MAX_ITERATIONS) return;
    if (slips.length >= config.maxSlipsToGenerate) return;
    if (currentOdds > config.oddsRange.max) return;

    // Check if current group forms a valid slip
    if (currentGroup.length >= config.minPicksPerSlip) {
      if (currentOdds >= config.oddsRange.min && currentOdds <= config.oddsRange.max) {
        const highRiskCount = currentGroup.filter(
          s => s.odds < config.safeOddsRange.min || s.odds > config.safeOddsRange.max
        ).length;
        slips.push({
          id: uuidv4(),
          selections: [...currentGroup],
          accumulatedOdds: Math.round(currentOdds * 100) / 100,
          qualityScore: calculateQuality(currentGroup, config),
          hasHighRiskPick: highRiskCount > 0,
          selectionCount: currentGroup.length,
        });
        // Don't return — keep looking for larger valid combos
      }
    }

    // Respect maxPicksPerSlip strictly
    if (currentGroup.length >= config.maxPicksPerSlip) return;

    for (let i = startIdx; i < sorted.length; i++) {
      if (iterations > MAX_ITERATIONS) return;
      if (slips.length >= config.maxSlipsToGenerate) return;

      const candidate = sorted[i];

      // Odds pruning: if the cheapest remaining pick would exceed max, stop
      const newOdds = currentOdds * candidate.odds;
      if (newOdds > config.oddsRange.max) continue;

      // Constraint check
      if (conflictsWithGroup(candidate, currentGroup, config)) continue;

      currentGroup.push(candidate);
      buildCombinations(i + 1, currentGroup, newOdds);
      currentGroup.pop();
    }
  }

  buildCombinations(0, [], 1.0);

  // Sort by quality score (highest first), then fewer picks as tie-breaker (minimization)
  slips.sort((a, b) => {
    const qualityDiff = b.qualityScore - a.qualityScore;
    if (qualityDiff !== 0) return qualityDiff;
    return a.selectionCount - b.selectionCount; // Fewer picks preferred
  });

  return slips;
}

// ─── Async generation (for UI with progress) ─────────────────────────────────

/**
 * Async version that yields control every N iterations.
 * Prevents UI freezing with large selection pools (30+ picks).
 */
export async function generateSlipsAsync(
  selections: ParsedSelection[],
  config: GroupingConfig = DEFAULT_CONFIG,
  onProgress?: (found: number) => void
): Promise<Slip[]> {
  const eligible = selections.filter(s => s.isEligibleForGrouping);

  if (eligible.length < config.minPicksPerSlip) {
    return [];
  }

  const slips: Slip[] = [];
  const sorted = [...eligible].sort((a, b) => a.odds - b.odds);
  let iterations = 0;
  const YIELD_EVERY = 5000;

  async function buildCombinations(
    startIdx: number,
    currentGroup: ParsedSelection[],
    currentOdds: number
  ): Promise<void> {
    if (++iterations > MAX_ITERATIONS) return;
    if (slips.length >= config.maxSlipsToGenerate) return;
    if (currentOdds > config.oddsRange.max) return;

    // Yield to event loop periodically
    if (iterations % YIELD_EVERY === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (onProgress) onProgress(slips.length);
    }

    if (currentGroup.length >= config.minPicksPerSlip) {
      if (currentOdds >= config.oddsRange.min && currentOdds <= config.oddsRange.max) {
        const highRiskCount = currentGroup.filter(
          s => s.odds < config.safeOddsRange.min || s.odds > config.safeOddsRange.max
        ).length;
        slips.push({
          id: uuidv4(),
          selections: [...currentGroup],
          accumulatedOdds: Math.round(currentOdds * 100) / 100,
          qualityScore: calculateQuality(currentGroup, config),
          hasHighRiskPick: highRiskCount > 0,
          selectionCount: currentGroup.length,
        });
      }
    }

    if (currentGroup.length >= config.maxPicksPerSlip) return;

    for (let i = startIdx; i < sorted.length; i++) {
      if (iterations > MAX_ITERATIONS) return;
      if (slips.length >= config.maxSlipsToGenerate) return;

      const candidate = sorted[i];
      const newOdds = currentOdds * candidate.odds;
      if (newOdds > config.oddsRange.max) continue;
      if (conflictsWithGroup(candidate, currentGroup, config)) continue;

      currentGroup.push(candidate);
      await buildCombinations(i + 1, currentGroup, newOdds);
      currentGroup.pop();
    }
  }

  await buildCombinations(0, [], 1.0);
  // Sort by quality (highest first), fewer picks as tie-breaker (minimization)
  slips.sort((a, b) => {
    const qualityDiff = b.qualityScore - a.qualityScore;
    if (qualityDiff !== 0) return qualityDiff;
    return a.selectionCount - b.selectionCount;
  });
  return slips;
}

// ─── Diverse generation (for parallel chains) ────────────────────────────────

/**
 * Generate slips ensuring no duplicate matches across a set of slips.
 */
export function generateDiverseSlips(
  selections: ParsedSelection[],
  count: number,
  config: GroupingConfig = DEFAULT_CONFIG
): Slip[] {
  const allSlips = generateSlips(selections, {
    ...config,
    maxSlipsToGenerate: count * 10,
  });

  if (allSlips.length <= count) return allSlips;

  const selected: Slip[] = [];
  const usedMatches = new Set<string>();

  for (const slip of allSlips) {
    if (selected.length >= count) break;
    const matchKeys = slip.selections.map(s => `${s.homeTeam.toLowerCase()}-${s.awayTeam.toLowerCase()}`);
    const hasOverlap = matchKeys.some(k => usedMatches.has(k));

    if (!hasOverlap) {
      selected.push(slip);
      matchKeys.forEach(k => usedMatches.add(k));
    }
  }

  // Fill remaining with best quality if can't get non-overlapping
  if (selected.length < count) {
    for (const slip of allSlips) {
      if (selected.length >= count) break;
      if (!selected.includes(slip)) {
        selected.push(slip);
      }
    }
  }

  return selected;
}

// ─── Suggest Best Slip (greedy, score-based) ─────────────────────────────────

/**
 * One-click safest slip from scored picks using greedy algorithm.
 */
export function suggestBestSlip(
  selections: ParsedSelection[],
  scores: Map<string, number>,
  targetOdds: number = 3.0,
  minConfidence: number = 45,
  config: GroupingConfig = DEFAULT_CONFIG
): Slip | null {
  const eligible = selections.filter(s =>
    s.isEligibleForGrouping && (scores.get(s.id) || 0) >= minConfidence
  );

  if (eligible.length < 2) return null;

  const sorted = [...eligible].sort((a, b) =>
    (scores.get(b.id) || 0) - (scores.get(a.id) || 0)
  );

  const oddsMin = targetOdds * 0.7;
  const oddsMax = targetOdds * 1.3;

  const picked: ParsedSelection[] = [];
  let currentOdds = 1.0;

  for (const sel of sorted) {
    if (currentOdds * sel.odds > oddsMax) continue;
    if (conflictsWithGroup(sel, picked, config)) continue;

    picked.push(sel);
    currentOdds *= sel.odds;

    if (currentOdds >= oddsMin && picked.length >= config.minPicksPerSlip) {
      break;
    }
  }

  // If strict pass failed, try relaxed (all eligible, no minConfidence)
  if (picked.length < config.minPicksPerSlip || currentOdds < oddsMin) {
    return suggestBestSlipRelaxed(selections, scores, targetOdds, config);
  }

  return {
    id: uuidv4(),
    selections: picked,
    accumulatedOdds: Math.round(currentOdds * 100) / 100,
    qualityScore: calculateQuality(picked, config),
    hasHighRiskPick: picked.some(s => s.odds > config.safeOddsRange.max),
    selectionCount: picked.length,
  };
}

function suggestBestSlipRelaxed(
  selections: ParsedSelection[],
  scores: Map<string, number>,
  targetOdds: number,
  config: GroupingConfig
): Slip | null {
  const eligible = selections.filter(s => s.isEligibleForGrouping);
  if (eligible.length < 2) return null;

  const sorted = [...eligible].sort((a, b) =>
    (scores.get(b.id) || 0) - (scores.get(a.id) || 0)
  );

  const oddsMin = targetOdds * 0.7;
  const oddsMax = targetOdds * 1.3;

  const picked: ParsedSelection[] = [];
  let currentOdds = 1.0;

  for (const sel of sorted) {
    if (currentOdds * sel.odds > oddsMax) continue;
    if (conflictsWithGroup(sel, picked, config)) continue;

    picked.push(sel);
    currentOdds *= sel.odds;

    if (currentOdds >= oddsMin && picked.length >= config.minPicksPerSlip) {
      break;
    }
  }

  if (picked.length < config.minPicksPerSlip || currentOdds < oddsMin) {
    return null;
  }

  return {
    id: uuidv4(),
    selections: picked,
    accumulatedOdds: Math.round(currentOdds * 100) / 100,
    qualityScore: calculateQuality(picked, config),
    hasHighRiskPick: picked.some(s => s.odds > config.safeOddsRange.max),
    selectionCount: picked.length,
  };
}
