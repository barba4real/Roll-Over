/**
 * Calibration Module
 *
 * "The system discovers its win rate, doesn't target a number."
 *
 * This module combines prediction log data and paper trading data
 * to provide a unified view of system performance. Tracks:
 *   - Pick accuracy (per market, per confidence bracket)
 *   - Slip accuracy (accumulator win rate)
 *   - Chain survival (how far chains typically go)
 *
 * Starts recording from prediction #1. No minimum threshold to display.
 * The system observes its own performance and surfaces the truth.
 */

import { getCalibrationData, getCalibrationByMarket, getSettledPredictions, CalibrationBucket } from './prediction-log';
import { getPaperStats, PaperStats } from './paper-trading';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SystemCalibration {
  // Overall
  totalPredictions: number;
  settledPredictions: number;
  overallPickAccuracy: number; // 0-100

  // Calibration: predicted vs actual by score bucket
  calibrationBuckets: CalibrationBucket[];
  isCalibrated: boolean;        // predicted ≈ actual (within 10%)
  calibrationGap: number;       // avg(predicted - actual), positive = overconfident

  // By market type
  marketAccuracy: Record<string, { predicted: number; actual: number; count: number }>;
  bestMarket: string | null;    // Highest actual win rate
  worstMarket: string | null;   // Lowest actual win rate

  // Slip level (from paper trading or real staking)
  slipAccuracy: number;         // 0-100
  totalSlips: number;

  // Chain level
  avgChainLength: number;
  maxChainLength: number;

  // Confidence brackets: where does the system shine?
  sweetSpot: { bracket: string; accuracy: number } | null;

  // Meta
  dataPoints: number;           // Total settled data points
  recordingSince: string | null; // First prediction timestamp
  lastUpdated: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get full system calibration report.
 * Combines prediction log + paper trading + real history.
 */
export function getSystemCalibration(realHistory?: any[]): SystemCalibration {
  const settled = getSettledPredictions();
  const calibrationBuckets = getCalibrationData();
  const marketAccuracy = getCalibrationByMarket();
  const paperStats = getPaperStats();

  // Overall pick accuracy from prediction log
  const wonPicks = settled.filter(p => p.outcome === 'won').length;
  const lostPicks = settled.filter(p => p.outcome === 'lost').length;
  const totalSettled = wonPicks + lostPicks;
  const overallPickAccuracy = totalSettled > 0 ? Math.round((wonPicks / totalSettled) * 100) : 0;

  // Calibration gap
  let calibrationGap = 0;
  let totalBucketWeight = 0;
  for (const bucket of calibrationBuckets) {
    calibrationGap += (bucket.predicted - bucket.actual) * bucket.count;
    totalBucketWeight += bucket.count;
  }
  calibrationGap = totalBucketWeight > 0 ? Math.round(calibrationGap / totalBucketWeight) : 0;
  const isCalibrated = Math.abs(calibrationGap) <= 10;

  // Best/worst market
  const marketEntries = Object.entries(marketAccuracy);
  let bestMarket: string | null = null;
  let worstMarket: string | null = null;
  if (marketEntries.length > 0) {
    const sorted = marketEntries.sort((a, b) => b[1].actual - a[1].actual);
    bestMarket = sorted[0]?.[0] || null;
    worstMarket = sorted[sorted.length - 1]?.[0] || null;
  }

  // Slip accuracy (combine paper + real)
  let slipAccuracy = paperStats.slipAccuracy;
  let totalSlips = paperStats.totalSlips;
  if (realHistory && realHistory.length > 0) {
    const realWon = realHistory.filter((h: any) => h.result === 'won').length;
    const realTotal = realHistory.filter((h: any) => h.result !== 'pending').length;
    if (realTotal > 0) {
      // Weighted average of paper and real
      const realAccuracy = Math.round((realWon / realTotal) * 100);
      slipAccuracy = Math.round((slipAccuracy * totalSlips + realAccuracy * realTotal) / (totalSlips + realTotal));
      totalSlips += realTotal;
    }
  }

  // Sweet spot: which confidence bracket has highest actual win rate?
  let sweetSpot: { bracket: string; accuracy: number } | null = null;
  for (const bucket of calibrationBuckets) {
    if (bucket.count >= 5 && (!sweetSpot || bucket.actual > sweetSpot.accuracy)) {
      sweetSpot = { bracket: bucket.bucket, accuracy: bucket.actual };
    }
  }

  // First prediction timestamp
  const recordingSince = settled.length > 0
    ? settled.reduce((earliest, p) => p.timestamp < earliest ? p.timestamp : earliest, settled[0].timestamp)
    : null;

  return {
    totalPredictions: settled.length + (getSettledPredictions().length - settled.length),
    settledPredictions: totalSettled,
    overallPickAccuracy,
    calibrationBuckets,
    isCalibrated,
    calibrationGap,
    marketAccuracy,
    bestMarket,
    worstMarket,
    slipAccuracy,
    totalSlips,
    avgChainLength: paperStats.avgChainLength,
    maxChainLength: paperStats.maxChainLength,
    sweetSpot,
    dataPoints: totalSettled,
    recordingSince,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get a brief calibration summary for display (1-line).
 */
export function getCalibrationSummary(realHistory?: any[]): string {
  const cal = getSystemCalibration(realHistory);

  if (cal.dataPoints === 0) {
    return 'No data yet — predictions will be tracked from your first pick.';
  }

  if (cal.dataPoints < 10) {
    return `Recording... ${cal.dataPoints} picks settled (${cal.overallPickAccuracy}% hit rate). Need 30+ for reliable calibration.`;
  }

  const calStatus = cal.isCalibrated ? 'Well-calibrated' :
    cal.calibrationGap > 0 ? `Overconfident by ${cal.calibrationGap}%` : `Underconfident by ${Math.abs(cal.calibrationGap)}%`;

  return `Pick: ${cal.overallPickAccuracy}% | Slip: ${cal.slipAccuracy}% | Chain avg: ${cal.avgChainLength} steps | ${calStatus} (${cal.dataPoints} picks)`;
}
