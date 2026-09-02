import { v4 as uuidv4 } from 'uuid';
import { ParsedSelection, Slip, GroupingConfig } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ROLL-OVER SLIP BUILDER — confidence-driven accumulator engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The product's core. Takes parsed selections + confidence scores and builds
 *  accumulator slips that hit a target combined odds while MAXIMISING the real
 *  probability the whole slip wins.
 *
 *  Key ideas:
 *   - Every pick has a "win probability" derived from bookmaker odds AND our
 *     confidence score (blended). A slip's win prob = product of its picks.
 *   - Quality = a blend of slip win probability, average confidence, and how
 *     "safe" (favourites-only) the slip is. Higher quality = better slip.
 *   - Selection uses BEAM SEARCH: at each step we keep the N most promising
 *     partial slips, expand them, and keep the best. Far better than random
 *     shuffle or naive greedy — it actually finds the strongest combinations.
 *   - Multi-slip generation spreads picks across slips so a 100-slip day gets
 *     diverse, non-repeating slips (configurable repeat allowance).
 */

export const DEFAULT_CONFIG: GroupingConfig = {
  targetOdds: 3.0,
  oddsRange: { min: 2.7, max: 3.3 }, // Tighter default; auto-recomputed by UI
  maxPicksPerSlip: 4,
  minPicksPerSlip: 2,
  safeOddsRange: { min: 1.20, max: 1.60 },
  maxHighRiskPerSlip: 1,
  noSameTeam: true,
  noSameKickoff: true, // Default ON — no two same-kickoff picks in one slip
  spreadAcrossDates: false,
  maxPicksPerDay: 0,
  maxRepeatAcrossSlips: 1,
  maxSlipsToGenerate: 50,
  futureOnly: true, // By default only build with fixtures that haven't kicked off
  coverageMode: true, // Exhaust the whole pool before any fixture repeats
};

/**
 * Filter to fixtures eligible for grouping.
 * Always drops settled/void picks. When futureOnly is on (default), also drops
 * any fixture whose kick-off time is in the past — a small grace buffer allows
 * for clock skew but a game that started 5+ minutes ago is excluded.
 */
export function getEligible(selections: ParsedSelection[], config: GroupingConfig): ParsedSelection[] {
  const now = Date.now();
  const GRACE_MS = 5 * 60 * 1000; // 5-minute grace for clock skew / just-listed games

  const winFrom = config.kickoffFrom ? new Date(config.kickoffFrom).getTime() : null;
  const winTo = config.kickoffTo ? new Date(config.kickoffTo).getTime() : null;

  return selections.filter(s => {
    if (!s.isEligibleForGrouping) return false;
    const kickoff = new Date(s.kickOffDateTime).getTime();

    if (config.futureOnly && !isNaN(kickoff)) {
      if (kickoff <= now - GRACE_MS) return false; // already started/finished
    }

    // Kickoff-window filter (tiered rollover): only fixtures within [from, to]
    if (!isNaN(kickoff)) {
      if (winFrom !== null && kickoff < winFrom) return false;
      if (winTo !== null && kickoff > winTo) return false;
    }

    return true;
  });
}

/**
 * Coverage report: given the generated slips and the eligible pool, report how
 * many distinct fixtures were used and which were never used at all.
 */
export function coverageReport(
  eligible: ParsedSelection[],
  slips: Slip[]
): { totalFixtures: number; usedFixtures: number; unused: ParsedSelection[]; maxRepeat: number } {
  const fixtureKey = (s: ParsedSelection) => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`;
  const usage = new Map<string, number>();
  for (const slip of slips) {
    for (const s of slip.selections) {
      const k = fixtureKey(s);
      usage.set(k, (usage.get(k) || 0) + 1);
    }
  }
  // Unique eligible fixtures
  const seen = new Map<string, ParsedSelection>();
  for (const s of eligible) {
    const k = fixtureKey(s);
    if (!seen.has(k)) seen.set(k, s);
  }
  const unused: ParsedSelection[] = [];
  for (const [k, sel] of seen) {
    if (!usage.has(k)) unused.push(sel);
  }
  const maxRepeat = usage.size > 0 ? Math.max(...usage.values()) : 0;
  return {
    totalFixtures: seen.size,
    usedFixtures: usage.size,
    unused,
    maxRepeat,
  };
}

/** How many pasted selections are excluded purely because they already started. */
export function countPastFixtures(selections: ParsedSelection[]): number {
  const now = Date.now();
  const GRACE_MS = 5 * 60 * 1000;
  return selections.filter(s => {
    if (!s.isEligibleForGrouping) return false;
    const kickoff = new Date(s.kickOffDateTime).getTime();
    return !isNaN(kickoff) && kickoff <= now - GRACE_MS;
  }).length;
}

// ─── Probability model ───────────────────────────────────────────────────────

/**
 * Convert decimal odds → bookmaker implied probability (0-1).
 * Bookmaker odds include a margin ("overround"), so implied prob is slightly
 * inflated. We keep it raw here; the blend below de-emphasises it.
 */
export function impliedProbability(odds: number): number {
  if (odds <= 1) return 0.99;
  return 1 / odds;
}

/**
 * Blend bookmaker implied probability with our confidence score into a single
 * estimated true win probability for one pick (0-1).
 *
 *  - Bookmaker odds are the market's collective judgement — heavily weighted.
 *  - Our confidence score (0-100) is a tilt: high confidence nudges the
 *    probability up, low confidence nudges it down, but never overrides the
 *    market wildly.
 *  - When we have no confidence data (score ~50), we fall back almost entirely
 *    to the bookmaker's implied probability.
 */
export function estimateWinProbability(odds: number, confidenceScore: number | undefined): number {
  const implied = impliedProbability(odds);

  if (confidenceScore === undefined) return implied;

  // Confidence tilt: center at 50. +/-50 maps to a +/-15% relative adjustment.
  const tilt = (confidenceScore - 50) / 50; // -1 .. +1
  const adjustment = tilt * 0.15; // max ±15% relative shift

  // 75% market, 25% our tilt-adjusted view
  const ourView = Math.min(0.97, Math.max(0.03, implied * (1 + adjustment)));
  const blended = implied * 0.75 + ourView * 0.25;

  return Math.min(0.97, Math.max(0.03, blended));
}

/** Product of per-pick win probabilities = probability the whole slip wins. */
export function slipWinProbability(
  selections: ParsedSelection[],
  scores?: Map<string, number>
): number {
  return selections.reduce((p, s) => {
    const conf = scores?.get(s.id);
    return p * estimateWinProbability(s.odds, conf);
  }, 1);
}

// ─── Constraints (single source of truth) ────────────────────────────────────

function hasConflict(a: ParsedSelection, b: ParsedSelection, config: GroupingConfig): boolean {
  const aHome = a.homeTeam.toLowerCase();
  const aAway = a.awayTeam.toLowerCase();
  const bHome = b.homeTeam.toLowerCase();
  const bAway = b.awayTeam.toLowerCase();

  // HARD RULE: the same fixture (same two teams meeting) can NEVER appear twice
  // in one slip — even with different picks/markets. If you pasted "Arsenal Home"
  // and "Arsenal Over 1.5" from the same match, at most ONE of them lands in any
  // given slip. Non-negotiable, ignores all settings.
  if (aHome === bHome && aAway === bAway) return true;
  // Also catch reversed listing of the same two teams (rare, but safe)
  if (aHome === bAway && aAway === bHome) return true;

  // "No same team on same date in slip" — blocks a team appearing twice when both
  // picks are on the SAME date. Same team on different dates is allowed.
  if (config.noSameTeam && a.date === b.date) {
    if (aHome === bHome || aHome === bAway || aAway === bHome || aAway === bAway) return true;
  }

  // "No same kick-off time in slip" — when ON, two picks kicking off at the exact
  // same moment can't share a slip (track them sequentially, no blind legs).
  // When OFF, same-kickoff picks ARE allowed to combine.
  if (config.noSameKickoff) {
    if (a.kickOffDateTime.getTime() === b.kickOffDateTime.getTime()) return true;
  }

  return false;
}

function conflictsWithGroup(sel: ParsedSelection, group: ParsedSelection[], config: GroupingConfig): boolean {
  for (const s of group) {
    if (hasConflict(s, sel, config)) return true;
  }
  if (config.maxPicksPerDay > 0) {
    const sameDay = group.filter(s => s.date === sel.date).length;
    if (sameDay >= config.maxPicksPerDay) return true;
  }
  return false;
}

// ─── Quality scoring ─────────────────────────────────────────────────────────

/**
 * Quality score (0-100). Blends three signals:
 *   1. Slip win probability (55%) — the real chance it lands. This is what matters.
 *   2. Average pick confidence (25%) — how well-analysed the picks are.
 *   3. Safety ratio (20%) — how many picks sit in the safe odds band.
 * A minimization nudge favours fewer picks when other things are equal.
 */
export function calculateQuality(
  selections: ParsedSelection[],
  config: GroupingConfig,
  scores?: Map<string, number>
): number {
  if (selections.length === 0) return 0;

  // 1. Win probability component (0-1 → 0-55)
  const winProb = slipWinProbability(selections, scores);
  const winComponent = winProb * 55;

  // 2. Average confidence component (0-100 → 0-25)
  let confComponent = 12.5; // neutral default if no scores
  if (scores) {
    const confs = selections.map(s => scores.get(s.id) ?? 50);
    const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
    confComponent = (avgConf / 100) * 25;
  }

  // 3. Safety component (0-1 → 0-20)
  const safeCount = selections.filter(
    s => s.odds >= config.safeOddsRange.min && s.odds <= config.safeOddsRange.max
  ).length;
  const safeComponent = (safeCount / selections.length) * 20;

  // Minimization nudge: -2 per pick beyond the minimum
  const minimizationPenalty = Math.max(0, (selections.length - config.minPicksPerSlip) * 2);

  const raw = winComponent + confComponent + safeComponent - minimizationPenalty;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function countHighRisk(selections: ParsedSelection[], config: GroupingConfig): number {
  return selections.filter(
    s => s.odds < config.safeOddsRange.min || s.odds > config.safeOddsRange.max
  ).length;
}

function buildSlip(selections: ParsedSelection[], config: GroupingConfig, scores?: Map<string, number>): Slip {
  const accOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  return {
    id: uuidv4(),
    selections: [...selections],
    accumulatedOdds: Math.round(accOdds * 100) / 100,
    qualityScore: calculateQuality(selections, config, scores),
    hasHighRiskPick: countHighRisk(selections, config) > 0,
    selectionCount: selections.length,
  };
}

// ─── Beam search: find the best single slip near the target ──────────────────

interface PartialSlip {
  picks: ParsedSelection[];
  odds: number;
  logProb: number; // sum of log(win prob) — additive, avoids underflow
}

/**
 * Beam search over the eligible pool to find high-quality slips whose combined
 * odds land inside [oddsRange.min, oddsRange.max].
 *
 * Returns valid slips found, sorted by quality (best first). Deterministic.
 */
function beamSearch(
  eligible: ParsedSelection[],
  config: GroupingConfig,
  scores: Map<string, number> | undefined,
  beamWidth: number,
  maxResults: number
): ParsedSelection[][] {
  const scored = hasMeaningfulScores(eligible, scores);

  // Pool ordering:
  //  - With real confidence data: order by win probability (best picks first).
  //  - Without (pasted/researched picks): PRESERVE the user's input order.
  //    We don't second-guess picks the user already researched — filters and
  //    target odds are all that matter.
  const pool = scored
    ? [...eligible].sort((a, b) => {
        const pa = estimateWinProbability(a.odds, scores?.get(a.id));
        const pb = estimateWinProbability(b.odds, scores?.get(b.id));
        return pb - pa;
      })
    : [...eligible].sort((a, b) => a.index - b.index); // keep paste order

  const results: ParsedSelection[][] = [];
  const seen = new Set<string>();

  // Beam of partial slips; seed with empty
  let beam: PartialSlip[] = [{ picks: [], odds: 1, logProb: 0 }];

  for (let depth = 0; depth < config.maxPicksPerSlip; depth++) {
    const next: PartialSlip[] = [];

    for (const partial of beam) {
      // Try extending this partial with each candidate that comes AFTER its last pick
      const lastIdx = partial.picks.length > 0
        ? pool.indexOf(partial.picks[partial.picks.length - 1])
        : -1;

      for (let i = lastIdx + 1; i < pool.length; i++) {
        const cand = pool[i];
        const newOdds = partial.odds * cand.odds;

        // Prune: overshooting the max odds is pointless (odds only grow)
        if (newOdds > config.oddsRange.max) continue;
        if (conflictsWithGroup(cand, partial.picks, config)) continue;

        const p = estimateWinProbability(cand.odds, scores?.get(cand.id));
        const extended: PartialSlip = {
          picks: [...partial.picks, cand],
          odds: newOdds,
          logProb: partial.logProb + Math.log(p),
        };
        next.push(extended);

        // If this partial is a valid slip, record it
        if (
          extended.picks.length >= config.minPicksPerSlip &&
          newOdds >= config.oddsRange.min &&
          newOdds <= config.oddsRange.max
        ) {
          if (config.spreadAcrossDates) {
            const uniqueDates = new Set(extended.picks.map(s => s.date));
            if (uniqueDates.size < 2) continue;
          }
          const key = extended.picks.map(s => s.id).sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            results.push(extended.picks);
          }
        }
      }
    }

    if (next.length === 0) break;

    if (scored) {
      // Keep the beamWidth most promising partials (highest total win prob)
      next.sort((a, b) => b.logProb - a.logProb);
    } else {
      // Filters-only: keep partials that are best positioned to reach the target.
      // Rank by distance from the target odds (closer = more promising), so combos
      // actually progressing toward the window survive the beam cut — not just the
      // first ones inserted. Ties keep paste order (via stable-ish first-index).
      next.sort((a, b) => {
        const da = Math.abs(a.odds - config.targetOdds);
        const db = Math.abs(b.odds - config.targetOdds);
        return da - db;
      });
    }
    beam = next.slice(0, beamWidth);
  }

  if (scored) {
    // Rank found slips by quality (win prob + confidence + safety)
    results.sort((a, b) =>
      calculateQuality(b, config, scores) - calculateQuality(a, config, scores)
    );
  } else {
    // Unscored: rank only by how close the combined odds are to the target,
    // then prefer fewer picks. Neutral to which specific picks are chosen.
    results.sort((a, b) => {
      const oddsA = a.reduce((acc, s) => acc * s.odds, 1);
      const oddsB = b.reduce((acc, s) => acc * s.odds, 1);
      const distA = Math.abs(oddsA - config.targetOdds);
      const distB = Math.abs(oddsB - config.targetOdds);
      if (Math.abs(distA - distB) > 0.001) return distA - distB;
      return a.length - b.length; // fewer picks as tiebreaker
    });
  }

  return results.slice(0, maxResults);
}

/**
 * Do we have real confidence data worth ranking by?
 * True only if a meaningful share of picks carry a non-neutral score.
 * Pasted/researched picks with no API stats return false → filters-only mode.
 */
function hasMeaningfulScores(
  selections: ParsedSelection[],
  scores: Map<string, number> | undefined
): boolean {
  if (!scores || scores.size === 0) return false;
  let meaningful = 0;
  for (const s of selections) {
    const v = scores.get(s.id);
    // A score is "meaningful" if it deviates from the neutral 50 baseline
    if (v !== undefined && Math.abs(v - 50) >= 8) meaningful++;
  }
  // Need at least a third of picks to carry real signal
  return meaningful >= Math.max(2, Math.ceil(selections.length / 3));
}

// ─── Public: synchronous generation ──────────────────────────────────────────

export function generateSlips(
  selections: ParsedSelection[],
  config: GroupingConfig = DEFAULT_CONFIG,
  scores?: Map<string, number>
): Slip[] {
  const eligible = getEligible(selections, config);
  if (eligible.length < config.minPicksPerSlip) return [];

  const found = beamSearch(eligible, config, scores, 200, config.maxSlipsToGenerate);
  return found.map(picks => buildSlip(picks, config, scores));
}

// ─── Public: async multi-slip generation (used by the UI) ────────────────────

/**
 * Generate a set of slips for the day using COVERAGE-DRIVEN distribution.
 *
 * Core principle (the rollover risk-spreading rule):
 *   Every eligible fixture is used ONCE before any fixture is used a second time.
 *   With 100 fixtures and 5-pick slips, that means the first 20 slips together
 *   cover all 100 fixtures with zero repeats. A single losing fixture can only
 *   kill ONE slip until the entire pool has been exhausted. Only the 21st slip
 *   onward starts reusing fixtures — and it reuses the LEAST-used ones first.
 *
 * How it works:
 *   1. Beam search produces a large ranked candidate pool of valid slips.
 *   2. We pick slips greedily, but the "cost" of a candidate is the total current
 *      usage of its fixtures. We always take the lowest-cost valid slip next, so
 *      unused fixtures are consumed before any repeat. Ties break on odds-closeness.
 *   3. This naturally exhausts the pool round by round: round 1 uses each fixture
 *      once, round 2 begins only when round 1 can't form another zero-usage slip.
 *
 * When coverageMode is off, falls back to the legacy repeat-allowance behaviour.
 */
export async function generateSlipsAsync(
  selections: ParsedSelection[],
  config: GroupingConfig = DEFAULT_CONFIG,
  onProgress?: (found: number) => void,
  scores?: Map<string, number>
): Promise<Slip[]> {
  const eligible = getEligible(selections, config);
  if (eligible.length < config.minPicksPerSlip) return [];

  await new Promise(r => setTimeout(r, 0));

  // Large candidate pool — need many options so coverage selection has room
  const candidatePool = beamSearch(
    eligible,
    config,
    scores,
    400,
    Math.max(config.maxSlipsToGenerate * 8, 200)
  );

  if (candidatePool.length === 0) return [];

  onProgress?.(0);
  await new Promise(r => setTimeout(r, 0));

  const scored = hasMeaningfulScores(eligible, scores);

  const chosen: ParsedSelection[][] = [];
  const chosenKeys = new Set<string>();
  const usage = new Map<string, number>(); // fixture-key → times used across chosen slips

  // Use fixture identity (teams), NOT selection id, so different picks on the SAME
  // match count as the same fixture for coverage purposes.
  const fixtureKey = (s: ParsedSelection) => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`;

  function slipCost(picks: ParsedSelection[]): number {
    // Total current usage of this slip's fixtures. Lower = uses fresher fixtures.
    return picks.reduce((sum, s) => sum + (usage.get(fixtureKey(s)) || 0), 0);
  }
  function slipMaxUsage(picks: ParsedSelection[]): number {
    return Math.max(...picks.map(s => usage.get(fixtureKey(s)) || 0));
  }

  if (config.coverageMode) {
    // Coverage-driven greedy selection
    while (chosen.length < config.maxSlipsToGenerate) {
      // Among unused candidate slips, find the one with the lowest fixture usage.
      // This guarantees unused fixtures are consumed before any repeat.
      let best: ParsedSelection[] | null = null;
      let bestCost = Infinity;
      let bestMax = Infinity;
      let bestOddsDist = Infinity;

      for (const picks of candidatePool) {
        const key = picks.map(s => s.id).sort().join('|');
        if (chosenKeys.has(key)) continue;

        const cost = slipCost(picks);
        const maxU = slipMaxUsage(picks);
        const odds = picks.reduce((acc, s) => acc * s.odds, 1);
        const oddsDist = Math.abs(odds - config.targetOdds);

        // Prefer: lowest max-usage (keeps repeats even), then lowest total cost,
        // then closest to target odds. This makes the least-used fixtures champion
        // the next set exactly as required.
        if (
          maxU < bestMax ||
          (maxU === bestMax && cost < bestCost) ||
          (maxU === bestMax && cost === bestCost && oddsDist < bestOddsDist)
        ) {
          best = picks;
          bestMax = maxU;
          bestCost = cost;
          bestOddsDist = oddsDist;
        }
      }

      if (!best) break; // pool exhausted

      const key = best.map(s => s.id).sort().join('|');
      chosen.push(best);
      chosenKeys.add(key);
      for (const s of best) {
        const fk = fixtureKey(s);
        usage.set(fk, (usage.get(fk) || 0) + 1);
      }

      if (chosen.length % 10 === 0) {
        onProgress?.(chosen.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } else {
    // Legacy: manual repeat allowance, relaxes progressively
    for (let allowance = config.maxRepeatAcrossSlips; allowance <= config.maxSlipsToGenerate; allowance++) {
      for (const picks of candidatePool) {
        if (chosen.length >= config.maxSlipsToGenerate) break;
        const key = picks.map(s => s.id).sort().join('|');
        if (chosenKeys.has(key)) continue;
        const wouldExceed = picks.some(s => (usage.get(fixtureKey(s)) || 0) >= allowance);
        if (wouldExceed) continue;
        chosen.push(picks);
        chosenKeys.add(key);
        for (const s of picks) usage.set(fixtureKey(s), (usage.get(fixtureKey(s)) || 0) + 1);
      }
      onProgress?.(chosen.length);
      await new Promise(r => setTimeout(r, 0));
      if (chosen.length >= config.maxSlipsToGenerate) break;
      if (chosen.length >= candidatePool.length) break;
    }
  }

  onProgress?.(chosen.length);

  const slips = chosen.map(picks => buildSlip(picks, config, scores));

  // Final display order: keep coverage "rounds" intact by NOT resorting when in
  // coverage mode (chosen order already reflects the round-by-round spread).
  // In confidence mode, surface best quality first.
  if (!config.coverageMode) {
    if (scored) {
      slips.sort((a, b) => b.qualityScore - a.qualityScore);
    } else {
      slips.sort((a, b) => {
        const distA = Math.abs(a.accumulatedOdds - config.targetOdds);
        const distB = Math.abs(b.accumulatedOdds - config.targetOdds);
        if (Math.abs(distA - distB) > 0.001) return distA - distB;
        return a.selectionCount - b.selectionCount;
      });
    }
  }

  return slips;
}

// ─── Public: diverse slips for parallel chains ───────────────────────────────

/**
 * Generate `count` slips with NO shared fixtures across them (fully diverse).
 * Used for running multiple independent chains the same day.
 */
export function generateDiverseSlips(
  selections: ParsedSelection[],
  count: number,
  config: GroupingConfig = DEFAULT_CONFIG,
  scores?: Map<string, number>
): Slip[] {
  const eligible = getEligible(selections, config);
  if (eligible.length < config.minPicksPerSlip) return [];

  const pool = beamSearch(eligible, config, scores, 300, count * 10);

  const selected: ParsedSelection[][] = [];
  const usedMatches = new Set<string>();

  for (const picks of pool) {
    if (selected.length >= count) break;
    const keys = picks.map(s => `${s.homeTeam.toLowerCase()}-${s.awayTeam.toLowerCase()}`);
    if (keys.some(k => usedMatches.has(k))) continue;
    selected.push(picks);
    keys.forEach(k => usedMatches.add(k));
  }

  return selected.map(picks => buildSlip(picks, config, scores));
}

// ─── Public: one-click best slip ─────────────────────────────────────────────

/**
 * Build the single best slip at a target odds level, using confidence scores.
 * This is what the "Best 3-Odds Slip" buttons and Ctrl+1/2/3 call.
 */
export function suggestBestSlip(
  selections: ParsedSelection[],
  scores: Map<string, number>,
  targetOdds: number = 3.0,
  minConfidence: number = 0,
  config: GroupingConfig = DEFAULT_CONFIG
): Slip | null {
  const oddsMin = targetOdds * 0.85;
  const oddsMax = targetOdds * 1.15;

  const cfg: GroupingConfig = {
    ...config,
    targetOdds,
    oddsRange: { min: oddsMin, max: oddsMax },
    // Allow enough picks to reach the target with safe odds
    minPicksPerSlip: 2,
    maxPicksPerSlip: Math.min(12, Math.max(3, Math.ceil(Math.log(oddsMax) / Math.log(1.25)))),
    maxSlipsToGenerate: 1,
  };

  // Base eligible pool respects futureOnly (drops started fixtures)
  const eligiblePool = getEligible(selections, cfg);

  // First pass: only picks meeting the confidence floor
  const confident = eligiblePool.filter(
    s => (scores.get(s.id) ?? 50) >= minConfidence
  );

  let found = beamSearch(confident, cfg, scores, 250, 1);

  // Relaxed fallback: ignore the confidence floor, widen the odds window
  if (found.length === 0) {
    const relaxedCfg: GroupingConfig = {
      ...cfg,
      oddsRange: { min: targetOdds * 0.7, max: targetOdds * 1.3 },
    };
    found = beamSearch(eligiblePool, relaxedCfg, scores, 250, 1);
  }

  if (found.length === 0) return null;
  return buildSlip(found[0], cfg, scores);
}
