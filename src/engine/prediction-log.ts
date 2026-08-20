/**
 * Prediction Log — Data Snapshot per Prediction
 *
 * Every scored pick gets a snapshot stored with:
 * - All input data used (form, position, H2H, goals, rates)
 * - The resulting score and factors
 * - Timestamp of when the prediction was made
 * - Model version used
 * - Outcome (filled in later when match settles)
 *
 * This is the foundation for calibration:
 * "When my model says 75%, does it actually win 75% of the time?"
 */

const PREDICTION_LOG_KEY = 'rollover_prediction_log';
const MODEL_VERSION = '2.1.0';
const MAX_LOG_ENTRIES = 2000; // Keep last 2000 predictions

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PredictionSnapshot {
  id: string;                  // Unique ID (matches selection ID)
  timestamp: string;           // ISO timestamp when prediction was made
  modelVersion: string;        // Scoring model version

  // Match context
  homeTeam: string;
  awayTeam: string;
  kickOff: string;             // ISO date
  league?: string;

  // Pick context
  pick: string;                // e.g., "Home", "Over 2.5"
  pickCategory: string;        // e.g., "home", "over", "yes"
  marketType: string;          // e.g., "1x2", "over_under", "gg_ng"
  odds: number;

  // Input data snapshot (what the model saw)
  inputs: PredictionInputs;

  // Output
  score: number;               // Final confidence score 0-100
  confidence: string;          // 'high' | 'medium' | 'low' | 'no_data'
  factors: { name: string; points: number; maxPoints: number }[];

  // Outcome (filled when settled)
  outcome?: 'won' | 'lost' | 'void';
  settledAt?: string;          // ISO timestamp when outcome recorded
}

export interface PredictionInputs {
  // Home team data
  homePosition?: number;
  homeForm?: string;
  homeWinRate?: number;
  homeAvgGoalsFor?: number;
  homeAvgGoalsAgainst?: number;
  homeOver25Pct?: number;
  homeBttsPct?: number;
  homeCleanSheetPct?: number;

  // Away team data
  awayPosition?: number;
  awayForm?: string;
  awayWinRate?: number;
  awayAvgGoalsFor?: number;
  awayAvgGoalsAgainst?: number;
  awayOver25Pct?: number;
  awayBttsPct?: number;
  awayCleanSheetPct?: number;

  // H2H data
  h2hTotal?: number;
  h2hHomeWins?: number;
  h2hAwayWins?: number;
  h2hDraws?: number;
  h2hAvgGoals?: number;
  h2hBttsPct?: number;

  // Derived
  positionGap?: number;
  momentumScore?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a prediction snapshot for a scored pick.
 */
export function recordPrediction(
  selectionId: string,
  homeTeam: string,
  awayTeam: string,
  kickOff: Date,
  pick: string,
  pickCategory: string,
  marketType: string,
  odds: number,
  inputs: PredictionInputs,
  score: number,
  confidence: string,
  factors: { name: string; points: number; maxPoints: number }[],
  league?: string
): void {
  const snapshot: PredictionSnapshot = {
    id: selectionId,
    timestamp: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    homeTeam,
    awayTeam,
    kickOff: kickOff.toISOString(),
    league,
    pick,
    pickCategory,
    marketType,
    odds,
    inputs,
    score,
    confidence,
    factors: factors.map(f => ({ name: f.name, points: f.points, maxPoints: f.maxPoints })),
  };

  const log = loadLog();

  // Update or append
  const existingIdx = log.findIndex(p => p.id === selectionId);
  if (existingIdx >= 0) {
    log[existingIdx] = { ...log[existingIdx], ...snapshot };
  } else {
    log.push(snapshot);
  }

  // Prune if over limit
  if (log.length > MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES);
  }

  saveLog(log);
}

/**
 * Record the outcome for a prediction (when match settles).
 */
export function recordOutcome(selectionId: string, outcome: 'won' | 'lost' | 'void'): void {
  const log = loadLog();
  const entry = log.find(p => p.id === selectionId);
  if (entry) {
    entry.outcome = outcome;
    entry.settledAt = new Date().toISOString();
    saveLog(log);
  }
}

/**
 * Get all predictions (for calibration analysis).
 */
export function getPredictionLog(): PredictionSnapshot[] {
  return loadLog();
}

/**
 * Get only settled predictions (have outcomes).
 */
export function getSettledPredictions(): PredictionSnapshot[] {
  return loadLog().filter(p => p.outcome !== undefined);
}

/**
 * Get calibration data: group predictions by score bucket, compare predicted vs actual.
 * Returns: { bucket: '70-80', predicted: 75, actual: 68, count: 24 }
 */
export function getCalibrationData(): CalibrationBucket[] {
  const settled = getSettledPredictions();
  if (settled.length === 0) return [];

  const buckets: Record<string, { wins: number; total: number; sumScore: number }> = {
    '0-30': { wins: 0, total: 0, sumScore: 0 },
    '30-50': { wins: 0, total: 0, sumScore: 0 },
    '50-60': { wins: 0, total: 0, sumScore: 0 },
    '60-70': { wins: 0, total: 0, sumScore: 0 },
    '70-80': { wins: 0, total: 0, sumScore: 0 },
    '80-100': { wins: 0, total: 0, sumScore: 0 },
  };

  for (const pred of settled) {
    if (pred.outcome === 'void') continue;
    const bucket = pred.score < 30 ? '0-30' :
                   pred.score < 50 ? '30-50' :
                   pred.score < 60 ? '50-60' :
                   pred.score < 70 ? '60-70' :
                   pred.score < 80 ? '70-80' : '80-100';
    buckets[bucket].total++;
    buckets[bucket].sumScore += pred.score;
    if (pred.outcome === 'won') buckets[bucket].wins++;
  }

  return Object.entries(buckets)
    .filter(([, v]) => v.total > 0)
    .map(([bucket, v]) => ({
      bucket,
      predicted: Math.round(v.sumScore / v.total),
      actual: Math.round((v.wins / v.total) * 100),
      count: v.total,
    }));
}

/**
 * Get calibration by market type.
 */
export function getCalibrationByMarket(): Record<string, { predicted: number; actual: number; count: number }> {
  const settled = getSettledPredictions();
  const byMarket: Record<string, { wins: number; total: number; sumScore: number }> = {};

  for (const pred of settled) {
    if (pred.outcome === 'void') continue;
    if (!byMarket[pred.marketType]) byMarket[pred.marketType] = { wins: 0, total: 0, sumScore: 0 };
    byMarket[pred.marketType].total++;
    byMarket[pred.marketType].sumScore += pred.score;
    if (pred.outcome === 'won') byMarket[pred.marketType].wins++;
  }

  const result: Record<string, { predicted: number; actual: number; count: number }> = {};
  for (const [market, v] of Object.entries(byMarket)) {
    if (v.total >= 3) {
      result[market] = {
        predicted: Math.round(v.sumScore / v.total),
        actual: Math.round((v.wins / v.total) * 100),
        count: v.total,
      };
    }
  }
  return result;
}

export interface CalibrationBucket {
  bucket: string;
  predicted: number;
  actual: number;
  count: number;
}

/**
 * Build PredictionInputs from MatchData (used when recording predictions).
 */
export function buildInputsFromMatchData(matchData: any): PredictionInputs {
  if (!matchData) return {};

  return {
    homePosition: matchData.homeTeam?.position,
    homeForm: matchData.homeTeam?.form,
    homeWinRate: matchData.homeTeam?.homeWinRate,
    homeAvgGoalsFor: matchData.homeTeam?.avgGoalsFor,
    homeAvgGoalsAgainst: matchData.homeTeam?.avgGoalsAgainst,
    homeOver25Pct: matchData.homeTeam?.over25Pct,
    homeBttsPct: matchData.homeTeam?.bttsPct,
    homeCleanSheetPct: matchData.homeTeam?.cleanSheetPct,

    awayPosition: matchData.awayTeam?.position,
    awayForm: matchData.awayTeam?.form,
    awayWinRate: matchData.awayTeam?.awayWinRate,
    awayAvgGoalsFor: matchData.awayTeam?.avgGoalsFor,
    awayAvgGoalsAgainst: matchData.awayTeam?.avgGoalsAgainst,
    awayOver25Pct: matchData.awayTeam?.over25Pct,
    awayBttsPct: matchData.awayTeam?.bttsPct,
    awayCleanSheetPct: matchData.awayTeam?.cleanSheetPct,

    h2hTotal: matchData.h2h?.total,
    h2hHomeWins: matchData.h2h?.homeTeamWins,
    h2hAwayWins: matchData.h2h?.awayTeamWins,
    h2hDraws: matchData.h2h?.draws,
    h2hAvgGoals: matchData.h2h?.avgGoals,
    h2hBttsPct: matchData.h2h?.bttsPct,

    positionGap: (matchData.homeTeam?.position && matchData.awayTeam?.position)
      ? matchData.awayTeam.position - matchData.homeTeam.position
      : undefined,
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function loadLog(): PredictionSnapshot[] {
  try {
    const data = localStorage.getItem(PREDICTION_LOG_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLog(log: PredictionSnapshot[]): void {
  try {
    localStorage.setItem(PREDICTION_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.error('Failed to save prediction log:', e);
  }
}
