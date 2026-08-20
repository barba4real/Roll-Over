/**
 * Intelligence Engine — Self-Improving Scoring System
 *
 * After 200+ settled predictions, this module:
 * 1. Determines which scoring FACTORS actually predict wins (adaptive weights)
 * 2. Builds per-MARKET calibration curves (Home Win model ≠ Over 2.5 model)
 * 3. Outputs recalibrated weights that the scoring engine uses
 *
 * The system doesn't target a win rate — it DISCOVERS its win rate,
 * then adjusts to maximize it.
 *
 * Recalibration schedule:
 *   - Runs after every 50 new settled predictions
 *   - Stores results in localStorage
 *   - scoring.ts reads these weights instead of hardcoded defaults
 */

import { getSettledPredictions, PredictionSnapshot } from './prediction-log';
import { getTeamRecord } from './team-database';

const WEIGHTS_KEY = 'rollover_adaptive_weights';
const CALIBRATION_KEY = 'rollover_market_calibration';
const MIN_SAMPLES_RECALIBRATE = 50;
const MIN_SAMPLES_PER_MARKET = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdaptiveWeights {
  form: number;       // Default 1.0, adjusted ±0.5
  venue: number;
  scoring: number;
  position: number;
  h2h: number;
  momentum: number;
  version: number;    // Increments on each recalibration
  samplesUsed: number;
  recalibratedAt: string;
}

export interface MarketCalibrationCurve {
  marketType: string;
  // Mapping: predicted score bucket → actual win rate
  buckets: { minScore: number; maxScore: number; predicted: number; actual: number; count: number }[];
  // Adjustment factor: multiply raw score by this to get calibrated score
  adjustmentFactor: number;
  overconfident: boolean; // predicted > actual consistently
  samplesUsed: number;
  lastUpdated: string;
}

export interface LeagueCalibration {
  league: string;
  winRate: number;    // Your actual win rate in this league
  samples: number;
  offset: number;     // Points to add/subtract for this league (e.g., -5 for hard leagues)
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

export function getAdaptiveWeights(): AdaptiveWeights {
  try {
    const data = localStorage.getItem(WEIGHTS_KEY);
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return defaultWeights();
}

function saveAdaptiveWeights(weights: AdaptiveWeights): void {
  try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights)); } catch { /* ignore */ }
}

export function getMarketCalibrations(): Map<string, MarketCalibrationCurve> {
  try {
    const data = localStorage.getItem(CALIBRATION_KEY);
    if (data) return new Map(Object.entries(JSON.parse(data)));
  } catch { /* ignore */ }
  return new Map();
}

function saveMarketCalibrations(cals: Map<string, MarketCalibrationCurve>): void {
  try { localStorage.setItem(CALIBRATION_KEY, JSON.stringify(Object.fromEntries(cals))); } catch { /* ignore */ }
}

function defaultWeights(): AdaptiveWeights {
  return { form: 1.0, venue: 1.0, scoring: 1.0, position: 1.0, h2h: 1.0, momentum: 1.0, version: 0, samplesUsed: 0, recalibratedAt: '' };
}

// ─── Recalibration Engine ────────────────────────────────────────────────────

/**
 * Run full recalibration. Call periodically (e.g., every 50 new settled predictions).
 * Returns true if weights were actually updated.
 */
export function runRecalibration(): boolean {
  const settled = getSettledPredictions();
  if (settled.length < MIN_SAMPLES_RECALIBRATE) return false;

  const currentWeights = getAdaptiveWeights();
  // Only recalibrate if we have 50+ new samples since last time
  if (settled.length - currentWeights.samplesUsed < 50) return false;

  // Phase 1: Compute factor-outcome correlations
  const newWeights = computeAdaptiveWeights(settled);
  saveAdaptiveWeights(newWeights);

  // Phase 2: Build per-market calibration curves
  const calibrations = computeMarketCalibrations(settled);
  saveMarketCalibrations(calibrations);

  return true;
}

/**
 * Compute adaptive weights by measuring which factors correlate with wins.
 * Uses simple logistic-style correlation: for each factor, how much higher
 * are the factor points in winning picks vs losing picks?
 */
function computeAdaptiveWeights(settled: PredictionSnapshot[]): AdaptiveWeights {
  // Factor importance = (avg factor points in WINS) / (avg factor points in ALL)
  // If a factor contributes more to winning picks, its weight goes up.
  const factorSums: Record<string, { winTotal: number; winCount: number; allTotal: number; allCount: number }> = {};

  const factorNames = ['Form', 'Venue', 'Scoring', 'Position', 'H2H', 'Momentum'];
  for (const name of factorNames) {
    factorSums[name] = { winTotal: 0, winCount: 0, allTotal: 0, allCount: 0 };
  }

  for (const pred of settled) {
    if (pred.outcome === 'void') continue;
    const isWin = pred.outcome === 'won';

    for (const factor of pred.factors || []) {
      const key = factorNames.find(f => factor.name.toLowerCase().includes(f.toLowerCase()));
      if (!key) continue;

      const normalized = factor.maxPoints > 0 ? factor.points / factor.maxPoints : 0;
      factorSums[key].allTotal += normalized;
      factorSums[key].allCount++;
      if (isWin) {
        factorSums[key].winTotal += normalized;
        factorSums[key].winCount++;
      }
    }
  }

  // Calculate weight multipliers
  const weights: Record<string, number> = {};
  for (const [name, sums] of Object.entries(factorSums)) {
    if (sums.allCount < 20 || sums.winCount < 10) {
      weights[name] = 1.0; // Not enough data, keep default
      continue;
    }
    const avgAll = sums.allTotal / sums.allCount;
    const avgWin = sums.winTotal / sums.winCount;

    // If wins have higher factor points, boost the weight
    // Clamp between 0.5 and 1.5 (never more than ±50% adjustment)
    const ratio = avgAll > 0 ? avgWin / avgAll : 1.0;
    weights[name] = Math.min(1.5, Math.max(0.5, ratio));
  }

  return {
    form: weights['Form'] || 1.0,
    venue: weights['Venue'] || 1.0,
    scoring: weights['Scoring'] || 1.0,
    position: weights['Position'] || 1.0,
    h2h: weights['H2H'] || 1.0,
    momentum: weights['Momentum'] || 1.0,
    version: (getAdaptiveWeights().version || 0) + 1,
    samplesUsed: settled.length,
    recalibratedAt: new Date().toISOString(),
  };
}

/**
 * Build calibration curves per market type.
 * For each market, groups predictions into score buckets and compares
 * predicted confidence vs actual win rate.
 */
function computeMarketCalibrations(settled: PredictionSnapshot[]): Map<string, MarketCalibrationCurve> {
  const byMarket: Record<string, PredictionSnapshot[]> = {};

  for (const pred of settled) {
    if (pred.outcome === 'void') continue;
    const market = pred.marketType || 'other';
    if (!byMarket[market]) byMarket[market] = [];
    byMarket[market].push(pred);
  }

  const calibrations = new Map<string, MarketCalibrationCurve>();

  for (const [market, preds] of Object.entries(byMarket)) {
    if (preds.length < MIN_SAMPLES_PER_MARKET) continue;

    // Create score buckets: 0-40, 40-55, 55-65, 65-75, 75-100
    const bucketDefs = [
      { min: 0, max: 40 }, { min: 40, max: 55 }, { min: 55, max: 65 },
      { min: 65, max: 75 }, { min: 75, max: 100 },
    ];

    const buckets = bucketDefs.map(({ min, max }) => {
      const inBucket = preds.filter(p => p.score >= min && p.score < max);
      const wins = inBucket.filter(p => p.outcome === 'won').length;
      return {
        minScore: min,
        maxScore: max,
        predicted: inBucket.length > 0 ? Math.round(inBucket.reduce((s, p) => s + p.score, 0) / inBucket.length) : 0,
        actual: inBucket.length > 0 ? Math.round((wins / inBucket.length) * 100) : 0,
        count: inBucket.length,
      };
    }).filter(b => b.count > 0);

    // Overall adjustment: predicted average vs actual average
    const totalPredicted = preds.reduce((s, p) => s + p.score, 0) / preds.length;
    const totalActual = (preds.filter(p => p.outcome === 'won').length / preds.length) * 100;
    const adjustmentFactor = totalPredicted > 0 ? totalActual / totalPredicted : 1.0;

    calibrations.set(market, {
      marketType: market,
      buckets,
      adjustmentFactor: Math.min(1.5, Math.max(0.5, adjustmentFactor)),
      overconfident: totalPredicted > totalActual + 5,
      samplesUsed: preds.length,
      lastUpdated: new Date().toISOString(),
    });
  }

  return calibrations;
}

// ─── Public Helpers ──────────────────────────────────────────────────────────

/**
 * Get the calibrated score for a market type.
 * Adjusts raw score based on historical accuracy for that market.
 */
export function getCalibratedScore(rawScore: number, marketType: string): number {
  const calibrations = getMarketCalibrations();
  const curve = calibrations.get(marketType);
  if (!curve || curve.samplesUsed < MIN_SAMPLES_PER_MARKET) return rawScore;

  // Apply adjustment factor
  const adjusted = Math.round(rawScore * curve.adjustmentFactor);
  return Math.min(100, Math.max(0, adjusted));
}

/**
 * Get league-specific calibration offsets from settled predictions.
 */
export function getLeagueCalibrations(): LeagueCalibration[] {
  const settled = getSettledPredictions();
  const byLeague: Record<string, { wins: number; total: number }> = {};

  for (const pred of settled) {
    if (pred.outcome === 'void' || !pred.inputs?.homePosition) continue;
    // Use league from prediction if available (approximated from inputs)
    const league = pred.league || 'Unknown';
    if (!byLeague[league]) byLeague[league] = { wins: 0, total: 0 };
    byLeague[league].total++;
    if (pred.outcome === 'won') byLeague[league].wins++;
  }

  const overallRate = settled.filter(p => p.outcome === 'won').length / Math.max(settled.length, 1) * 100;

  return Object.entries(byLeague)
    .filter(([, v]) => v.total >= 10)
    .map(([league, v]) => {
      const winRate = Math.round((v.wins / v.total) * 100);
      // Offset: positive = you do better here than average, negative = worse
      const offset = Math.round((winRate - overallRate) * 0.3); // Damped: 30% of raw diff
      return { league, winRate, samples: v.total, offset: Math.min(8, Math.max(-8, offset)) };
    })
    .sort((a, b) => b.winRate - a.winRate);
}

/**
 * Check if recalibration is due (50+ new predictions since last calibration).
 */
export function isRecalibrationDue(): boolean {
  const settled = getSettledPredictions();
  const weights = getAdaptiveWeights();
  return settled.length - weights.samplesUsed >= 50;
}

/**
 * Get human-readable recalibration status.
 */
export function getRecalibrationStatus(): string {
  const weights = getAdaptiveWeights();
  const settled = getSettledPredictions();

  if (weights.version === 0) {
    return `Collecting data (${settled.length}/${MIN_SAMPLES_RECALIBRATE} picks needed for first calibration)`;
  }

  const sinceLastCal = settled.length - weights.samplesUsed;
  if (sinceLastCal >= 50) {
    return `Recalibration ready (${sinceLastCal} new picks since v${weights.version})`;
  }

  return `Model v${weights.version} (${sinceLastCal}/50 until next recalibration)`;
}

// ─── Never-Bet Auto-Detection (#7) ──────────────────────────────────────────

export interface NeverBetPattern {
  pattern: string;         // e.g., "BTTS + Ligue 1" or "Away + Serie A"
  losses: number;
  total: number;
  lossRate: number;        // 0-100
  severity: 'block' | 'warn';
}

/**
 * Scan prediction history for consistently losing patterns.
 * A "never bet" pattern = 60%+ loss rate with 5+ samples.
 */
export function detectNeverBetPatterns(): NeverBetPattern[] {
  const settled = getSettledPredictions();
  if (settled.length < 30) return [];

  // Build pattern keys: marketType + league, pickCategory + league, team + marketType
  const patterns: Record<string, { wins: number; losses: number }> = {};

  for (const pred of settled) {
    if (pred.outcome === 'void') continue;
    const won = pred.outcome === 'won';
    const league = pred.league || 'Unknown';

    const keys = [
      `${pred.marketType} in ${league}`,
      `${pred.pickCategory} in ${league}`,
      `${pred.marketType} + ${pred.pickCategory}`,
    ];

    for (const key of keys) {
      if (!patterns[key]) patterns[key] = { wins: 0, losses: 0 };
      if (won) patterns[key].wins++;
      else patterns[key].losses++;
    }
  }

  // Find dangerous patterns
  const neverBets: NeverBetPattern[] = [];
  for (const [pattern, data] of Object.entries(patterns)) {
    const total = data.wins + data.losses;
    if (total < 5) continue;
    const lossRate = Math.round((data.losses / total) * 100);
    if (lossRate >= 70) {
      neverBets.push({ pattern, losses: data.losses, total, lossRate, severity: 'block' });
    } else if (lossRate >= 60) {
      neverBets.push({ pattern, losses: data.losses, total, lossRate, severity: 'warn' });
    }
  }

  return neverBets.sort((a, b) => b.lossRate - a.lossRate);
}

/**
 * Check if a specific pick matches any never-bet pattern.
 */
export function checkNeverBet(
  marketType: string,
  pickCategory: string,
  league?: string
): NeverBetPattern | null {
  const patterns = detectNeverBetPatterns();
  const keys = [
    `${marketType} in ${league || 'Unknown'}`,
    `${pickCategory} in ${league || 'Unknown'}`,
    `${marketType} + ${pickCategory}`,
  ];

  for (const key of keys) {
    const match = patterns.find(p => p.pattern === key);
    if (match) return match;
  }
  return null;
}

// ─── Fixture Congestion Detection (#8) ───────────────────────────────────────

/**
 * Detect if a team has fixture congestion (played recently → fatigue risk).
 * Checks the team database for matches within the last 7 days.
 * Returns a penalty score (0 = no congestion, up to -10 for severe).
 */
export function getFixtureCongestionPenalty(teamName: string): { penalty: number; detail: string } {
  const record = getTeamRecord(teamName);
  if (!record || record.matches.length < 2) return { penalty: 0, detail: 'No congestion data' };

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  const recentMatches = record.matches.filter((m: any) => {
    const matchDate = new Date(m.date).getTime();
    return matchDate >= sevenDaysAgo && matchDate <= now;
  });

  const veryRecentMatches = record.matches.filter((m: any) => {
    const matchDate = new Date(m.date).getTime();
    return matchDate >= threeDaysAgo && matchDate <= now;
  });

  if (veryRecentMatches.length >= 2) {
    return { penalty: -10, detail: `${teamName}: 2+ matches in last 3 days — severe fatigue risk` };
  }
  if (recentMatches.length >= 3) {
    return { penalty: -7, detail: `${teamName}: 3+ matches in last 7 days — congestion` };
  }
  if (recentMatches.length >= 2) {
    return { penalty: -3, detail: `${teamName}: 2 matches in last 7 days — mild congestion` };
  }

  return { penalty: 0, detail: 'No congestion' };
}
