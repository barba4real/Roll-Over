/**
 * Slip Optimizer — Cross-references pasted selections with scouted fixture data.
 *
 * When a user pastes a betting slip from a bookmaker, this engine:
 * 1. Looks up each selection in the historical DB + scout results
 * 2. Flags picks that have LOW confidence (data says they're risky)
 * 3. Suggests replacements from scout data (better picks for the same match)
 * 4. Scores the overall slip quality
 *
 * This turns the paste flow from "blindly stake what bookmaker suggests"
 * into "data-validated, optimized selections."
 */

import { predictMatch, type MatchPrediction, type PredictionPick } from './historical-stats';
import { isSameTeam, resolveTeamName } from './team-aliases';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PastedSelection {
  id: string;
  homeTeam: string;
  awayTeam: string;
  pick: string;
  market: string;
  odds: number;
  kickOff?: string;
  league?: string;
}

export interface OptimizedSelection {
  original: PastedSelection;
  prediction: MatchPrediction | null;
  confidence: number;           // 0-100, how confident our data is about this pick
  status: 'strong' | 'ok' | 'weak' | 'risky' | 'no-data';
  reasoning: string[];
  suggestedAlternative: SuggestedPick | null;  // Better pick for same match (if exists)
}

export interface SuggestedPick {
  pick: string;
  market: string;
  confidence: number;
  reasoning: string[];
  estimatedOdds: string;
}

export interface SlipOptimizationResult {
  selections: OptimizedSelection[];
  overallScore: number;          // 0-100
  strongPicks: number;
  weakPicks: number;
  riskyPicks: number;
  noDataPicks: number;
  suggestions: string[];         // Overall improvement suggestions
  estimatedHitRate: number;      // Estimated % of picks that will win
}

// ─── Main Optimization Function ──────────────────────────────────────────────

/**
 * Optimize a pasted slip by cross-referencing with historical data.
 */
export function optimizeSlip(selections: PastedSelection[]): SlipOptimizationResult {
  const optimized: OptimizedSelection[] = [];
  let strongPicks = 0, weakPicks = 0, riskyPicks = 0, noDataPicks = 0;

  for (const sel of selections) {
    const result = analyzeSelection(sel);
    optimized.push(result);

    switch (result.status) {
      case 'strong': strongPicks++; break;
      case 'weak': weakPicks++; break;
      case 'risky': riskyPicks++; break;
      case 'no-data': noDataPicks++; break;
    }
  }

  // Calculate overall slip score
  const totalConf = optimized.reduce((sum, o) => sum + o.confidence, 0);
  const avgConf = selections.length > 0 ? totalConf / selections.length : 0;
  const overallScore = Math.round(avgConf);

  // Estimated hit rate based on confidence distribution
  const estimatedHitRate = Math.round(
    optimized.filter(o => o.status !== 'no-data')
      .reduce((sum, o) => sum + (o.confidence / 100), 0) /
    Math.max(1, optimized.filter(o => o.status !== 'no-data').length) * 100
  );

  // Generate suggestions
  const suggestions: string[] = [];
  if (riskyPicks > 0) suggestions.push(`${riskyPicks} pick(s) have low confidence — consider removing or replacing`);
  if (weakPicks >= 2) suggestions.push(`Multiple weak picks detected. Slip has higher failure risk.`);
  if (noDataPicks > 0) suggestions.push(`${noDataPicks} pick(s) have no historical data — predictions are uncertain`);
  if (strongPicks >= 3 && riskyPicks === 0) suggestions.push(`Strong slip! All picks supported by data.`);
  if (avgConf < 50) suggestions.push(`Overall confidence is low (${Math.round(avgConf)}%). Consider a safer selection.`);

  const alternatives = optimized.filter(o => o.suggestedAlternative);
  if (alternatives.length > 0) {
    suggestions.push(`${alternatives.length} pick(s) have better alternatives available — expand to see suggestions`);
  }

  return {
    selections: optimized,
    overallScore,
    strongPicks,
    weakPicks,
    riskyPicks,
    noDataPicks,
    suggestions,
    estimatedHitRate,
  };
}

// ─── Per-Selection Analysis ──────────────────────────────────────────────────

function analyzeSelection(sel: PastedSelection): OptimizedSelection {
  // Run prediction for this fixture
  const prediction = predictMatch(sel.homeTeam, sel.awayTeam, sel.league || '');

  if (prediction.dataQuality === 'insufficient') {
    return {
      original: sel,
      prediction,
      confidence: 40,
      status: 'no-data',
      reasoning: ['No historical data available for these teams'],
      suggestedAlternative: null,
    };
  }

  // Find how confident we are about the specific pick
  const pickConfidence = getPickConfidence(sel.pick, sel.market, prediction);

  // Determine status
  let status: OptimizedSelection['status'];
  if (pickConfidence >= 65) status = 'strong';
  else if (pickConfidence >= 55) status = 'ok';
  else if (pickConfidence >= 45) status = 'weak';
  else status = 'risky';

  // Build reasoning
  const reasoning: string[] = [];
  if (prediction.homeForm) {
    reasoning.push(`Home form: ${prediction.homeForm.formString.slice(0, 5)} (${prediction.homeForm.winRate}% win rate)`);
  }
  if (prediction.awayForm) {
    reasoning.push(`Away form: ${prediction.awayForm.formString.slice(0, 5)} (${prediction.awayForm.winRate}% win rate)`);
  }
  if (prediction.h2h && prediction.h2h.totalMatches > 0) {
    reasoning.push(`H2H: ${prediction.h2h.homeWins}W-${prediction.h2h.draws}D-${prediction.h2h.awayWins}L (${prediction.h2h.totalMatches} meetings)`);
  }

  // Find if there's a better pick for this match
  const suggestedAlternative = findBetterPick(sel, prediction);

  return {
    original: sel,
    prediction,
    confidence: pickConfidence,
    status,
    reasoning,
    suggestedAlternative,
  };
}

/**
 * Get confidence for a specific pick based on prediction data.
 */
function getPickConfidence(pick: string, market: string, prediction: MatchPrediction): number {
  const p = pick.toLowerCase();

  if (p === 'home' || p === '1') return prediction.homeWinConfidence;
  if (p === 'away' || p === '2') return prediction.awayWinConfidence;
  if (p === 'draw' || p === 'x') return prediction.drawConfidence;
  if (p.includes('over 1.5') || p.includes('o1.5')) return prediction.over15Confidence;
  if (p.includes('over 2.5') || p.includes('o2.5')) return prediction.over25Confidence;
  if (p.includes('under 2.5') || p.includes('u2.5')) return 100 - prediction.over25Confidence;
  if (p.includes('btts') || p.includes('both teams') || p.includes('gg')) return prediction.bttsConfidence;

  // For picks we don't recognize, use average confidence
  return Math.round((prediction.homeWinConfidence + prediction.over15Confidence) / 2);
}

/**
 * Find a better alternative pick for the same match.
 * Only suggests if there's a significantly better option (10%+ more confident).
 */
function findBetterPick(sel: PastedSelection, prediction: MatchPrediction): SuggestedPick | null {
  const currentConf = getPickConfidence(sel.pick, sel.market, prediction);

  // Find the best pick from predictions that's significantly better
  for (const pick of prediction.picks) {
    if (pick.confidence > currentConf + 10) {
      // Don't suggest the same pick
      if (pick.pick.toLowerCase() === sel.pick.toLowerCase()) continue;

      return {
        pick: pick.pick,
        market: pick.market,
        confidence: pick.confidence,
        reasoning: pick.reasoning,
        estimatedOdds: pick.confidence >= 75 ? '1.20-1.45' :
                       pick.confidence >= 65 ? '1.35-1.65' : '1.50-1.85',
      };
    }
  }

  return null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Quick quality check for a single selection (used during paste flow).
 */
export function quickCheck(homeTeam: string, awayTeam: string, pick: string, market: string): {
  confidence: number;
  status: 'strong' | 'ok' | 'weak' | 'risky' | 'no-data';
} {
  const prediction = predictMatch(homeTeam, awayTeam, '');
  if (prediction.dataQuality === 'insufficient') return { confidence: 40, status: 'no-data' };

  const conf = getPickConfidence(pick, market, prediction);
  const status = conf >= 65 ? 'strong' : conf >= 55 ? 'ok' : conf >= 45 ? 'weak' : 'risky';
  return { confidence: conf, status };
}
