/**
 * Smart Pick Scoring Engine
 * Assigns a confidence score (0-100) to each selection based on available data.
 *
 * Factors:
 * 1. Position gap (from standings)       → 0-25 points
 * 2. Team form (last 5 results)          → 0-20 points
 * 3. H2H dominance                       → 0-15 points
 * 4. Home/away venue advantage           → 0-10 points
 * 5. Market-specific indicators          → 0-15 points
 * 6. Odds reasonableness                 → 0-15 points
 *
 * Base score starts at 0 and accumulates from factors.
 * Without data, picks get a neutral score of 50 (no data penalty/bonus).
 */

import { ParsedSelection } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeamData {
  position?: number;
  form?: string; // e.g. "WWDLW" (most recent first)
  homeWinRate?: number; // 0-100
  awayWinRate?: number; // 0-100
  avgGoalsFor?: number;
  avgGoalsAgainst?: number;
  over25Pct?: number; // 0-100
  bttsPct?: number; // 0-100
  cleanSheetPct?: number; // 0-100
}

export interface MatchData {
  homeTeam: TeamData;
  awayTeam: TeamData;
  h2h?: H2HData;
}

export interface H2HData {
  total: number;
  homeTeamWins: number; // Wins by the team playing at home in THIS fixture
  awayTeamWins: number;
  draws: number;
  avgGoals: number;
  bttsPct: number; // 0-100
}

export interface ScoringResult {
  score: number; // 0-100
  factors: ScoringFactor[];
  hasData: boolean; // Whether real data was available
  confidence: 'high' | 'medium' | 'low' | 'no_data';
  // Confidence band: how certain are we in this score?
  band: { low: number; high: number }; // e.g., { low: 67, high: 81 } means "probably 67-81"
}

export interface ScoringFactor {
  name: string;
  points: number;
  maxPoints: number;
  detail: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const SCORE_CACHE_KEY = 'rollover_score_cache';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

interface CachedScore {
  score: number;
  factors: ScoringFactor[];
  hasData: boolean;
  cachedAt: number;
}

export function getCachedScore(selectionId: string): ScoringResult | null {
  try {
    const cache = JSON.parse(localStorage.getItem(SCORE_CACHE_KEY) || '{}');
    const entry: CachedScore = cache[selectionId];
    if (entry && Date.now() - entry.cachedAt < CACHE_TTL) {
      // Apply confidence decay: score reduces slightly as cache ages
      const age = Date.now() - entry.cachedAt;
      const ageRatio = age / CACHE_TTL; // 0.0 (fresh) to 1.0 (about to expire)
      const decayPenalty = Math.round(ageRatio * 5); // Max 5 point decay
      const decayedScore = Math.max(entry.score - decayPenalty, 0);

      return {
        score: decayedScore,
        factors: entry.factors,
        hasData: entry.hasData,
        confidence: getConfidenceLevel(decayedScore, entry.hasData),
        band: computeBand(decayedScore, entry.factors),
      };
    }
  } catch { /* ignore */ }
  return null;
}

export function setCachedScore(selectionId: string, result: ScoringResult): void {
  try {
    const cache = JSON.parse(localStorage.getItem(SCORE_CACHE_KEY) || '{}');
    cache[selectionId] = {
      score: result.score,
      factors: result.factors,
      hasData: result.hasData,
      cachedAt: Date.now(),
    };
    // Prune old entries (keep max 500)
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => cache[a].cachedAt - cache[b].cachedAt);
      sorted.slice(0, keys.length - 500).forEach(k => delete cache[k]);
    }
    localStorage.setItem(SCORE_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

function getConfidenceLevel(score: number, hasData: boolean): 'high' | 'medium' | 'low' | 'no_data' {
  if (!hasData) return 'no_data';
  if (score >= 75) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

// ─── Main Scoring Function ───────────────────────────────────────────────────

/**
 * Score a pick based on available match data.
 * 
 * REVISED FORMULA (v2.1.0):
 *   Form:       30 points — last 5 results, recency-weighted
 *   Home/Away:  20 points — venue-specific win rate
 *   Scoring:    15 points — goals for/against, market-relevant stats
 *   Position:   15 points — league table gap
 *   H2H:        10 points — head-to-head record
 *   Momentum:   10 points — form direction (improving vs declining)
 *   TOTAL:     100 points
 *
 * Market-specific models apply different emphasis:
 *   - Home Win: Position + Venue weighted higher
 *   - Over 1.5/2.5: Scoring + Form weighted higher
 *   - BTTS: Scoring (both sides) + H2H goals weighted higher
 */
export function scorePick(selection: ParsedSelection, matchData?: MatchData): ScoringResult {
  // If no data available, return neutral score
  if (!matchData || (!matchData.homeTeam.position && !matchData.homeTeam.form && !matchData.h2h)) {
    return {
      score: 50,
      factors: [{ name: 'No Data', points: 50, maxPoints: 100, detail: 'No stats available — neutral score' }],
      hasData: false,
      confidence: 'no_data',
      band: { low: 20, high: 80 }, // Wide band: no data means high uncertainty
    };
  }

  const factors: ScoringFactor[] = [];
  let totalScore = 0;

  // Determine market context
  const backingHome = isBackingHome(selection);
  const backingAway = isBackingAway(selection);
  const isOverMarket = selection.pickCategory === 'over';
  const isUnderMarket = selection.pickCategory === 'under';
  const isBttsYes = selection.pickCategory === 'yes' && selection.marketType === 'gg_ng';
  const isBttsNo = selection.pickCategory === 'no' && selection.marketType === 'gg_ng';
  const isGoalMarket = isOverMarket || isUnderMarket || isBttsYes || isBttsNo;

  // Market-specific weight adjustments (multipliers on base allocation)
  const weights = getMarketWeights(selection);

  // ─── Factor 1: Form (base 30 points) ───────────────────────────────────────

  const formMax = Math.round(30 * weights.form);
  let formPoints = 0;

  if (isGoalMarket) {
    // Goal markets: use both teams' form
    const homeForm = matchData.homeTeam.form || '';
    const awayForm = matchData.awayTeam.form || '';
    const homeFormScore = calculateFormScore(homeForm);
    const awayFormScore = calculateFormScore(awayForm);
    formPoints = Math.round(((homeFormScore + awayFormScore) / 2) * (formMax / 20));
  } else {
    // Result markets: use the backed team's form
    const relevantForm = backingHome ? matchData.homeTeam.form : backingAway ? matchData.awayTeam.form : null;
    if (relevantForm && relevantForm.length >= 3) {
      formPoints = Math.round(calculateFormScore(relevantForm) * (formMax / 20));
    }
  }
  formPoints = Math.min(formPoints, formMax);
  totalScore += formPoints;
  factors.push({
    name: 'Form',
    points: formPoints,
    maxPoints: formMax,
    detail: `${backingHome ? matchData.homeTeam.form?.slice(0, 5) || '?' : backingAway ? matchData.awayTeam.form?.slice(0, 5) || '?' : 'Both teams'}`,
  });

  // ─── Factor 2: Home/Away Venue (base 20 points) ────────────────────────────

  const venueMax = Math.round(20 * weights.venue);
  let venuePoints = 0;

  if (backingHome && matchData.homeTeam.homeWinRate !== undefined) {
    venuePoints = Math.round((matchData.homeTeam.homeWinRate / 100) * venueMax);
  } else if (backingAway && matchData.awayTeam.awayWinRate !== undefined) {
    venuePoints = Math.round((matchData.awayTeam.awayWinRate / 100) * venueMax);
  } else if (isGoalMarket) {
    // For goal markets, venue matters less but still a factor (home teams score more)
    const homeRate = matchData.homeTeam.homeWinRate || 50;
    venuePoints = Math.round((homeRate / 100) * venueMax * 0.5);
  }
  venuePoints = Math.min(venuePoints, venueMax);
  totalScore += venuePoints;
  factors.push({
    name: 'Venue',
    points: venuePoints,
    maxPoints: venueMax,
    detail: backingHome ? `Home win: ${matchData.homeTeam.homeWinRate || '?'}%` :
            backingAway ? `Away win: ${matchData.awayTeam.awayWinRate || '?'}%` : 'Goal market (partial)',
  });

  // ─── Factor 3: Scoring / Goals (base 15 points) ────────────────────────────

  const scoringMax = Math.round(15 * weights.scoring);
  let scoringPoints = 0;

  if (isOverMarket) {
    const homeOver = matchData.homeTeam.over25Pct || 50;
    const awayOver = matchData.awayTeam.over25Pct || 50;
    scoringPoints = Math.round(((homeOver + awayOver) / 200) * scoringMax);
    factors.push({ name: 'Scoring', points: Math.min(scoringPoints, scoringMax), maxPoints: scoringMax, detail: `O2.5: Home ${homeOver}%, Away ${awayOver}%` });
  } else if (isUnderMarket) {
    const homeOver = matchData.homeTeam.over25Pct || 50;
    const awayOver = matchData.awayTeam.over25Pct || 50;
    const underPct = 100 - (homeOver + awayOver) / 2;
    scoringPoints = Math.round((underPct / 100) * scoringMax);
    factors.push({ name: 'Scoring', points: Math.min(scoringPoints, scoringMax), maxPoints: scoringMax, detail: `U2.5: ${Math.round(underPct)}%` });
  } else if (isBttsYes) {
    const homeBtts = matchData.homeTeam.bttsPct || 50;
    const awayBtts = matchData.awayTeam.bttsPct || 50;
    scoringPoints = Math.round(((homeBtts + awayBtts) / 200) * scoringMax);
    factors.push({ name: 'Scoring', points: Math.min(scoringPoints, scoringMax), maxPoints: scoringMax, detail: `BTTS: Home ${homeBtts}%, Away ${awayBtts}%` });
  } else if (isBttsNo) {
    const homeCS = matchData.homeTeam.cleanSheetPct || 30;
    const awayCS = matchData.awayTeam.cleanSheetPct || 30;
    scoringPoints = Math.round(((homeCS + awayCS) / 200) * scoringMax);
    factors.push({ name: 'Scoring', points: Math.min(scoringPoints, scoringMax), maxPoints: scoringMax, detail: `CS: Home ${homeCS}%, Away ${awayCS}%` });
  } else {
    // 1X2/DC: backed team's scoring vs opponent's conceding
    const attacker = backingHome ? matchData.homeTeam : matchData.awayTeam;
    const defender = backingHome ? matchData.awayTeam : matchData.homeTeam;
    const goalsFor = attacker.avgGoalsFor ?? 1.2;
    const goalsAgainst = defender.avgGoalsAgainst ?? 1.2;
    const advantage = Math.min(Math.max((goalsFor - goalsAgainst + 1.5) / 3, 0), 1); // Normalize 0-1
    scoringPoints = Math.round(advantage * scoringMax);
    factors.push({ name: 'Scoring', points: Math.min(scoringPoints, scoringMax), maxPoints: scoringMax, detail: `Scores ${goalsFor} vs concedes ${goalsAgainst}` });
  }
  scoringPoints = Math.min(scoringPoints, scoringMax);
  totalScore += scoringPoints;

  // ─── Factor 4: Position Gap (base 15 points) ───────────────────────────────

  const posMax = Math.round(15 * weights.position);
  let posPoints = 0;

  if (matchData.homeTeam.position && matchData.awayTeam.position) {
    const posGap = matchData.awayTeam.position - matchData.homeTeam.position;

    if (backingHome && posGap > 0) {
      posPoints = Math.min(Math.round(posGap * 1.2), posMax);
    } else if (backingAway && posGap < 0) {
      posPoints = Math.min(Math.round(Math.abs(posGap) * 1.2), posMax);
    } else if (backingHome && posGap < 0) {
      posPoints = Math.max(0, Math.round(posMax * 0.2) - Math.abs(posGap));
    } else if (backingAway && posGap > 0) {
      posPoints = Math.max(0, Math.round(posMax * 0.2) - posGap);
    } else if (isGoalMarket) {
      posPoints = Math.min(Math.round(Math.abs(posGap) * 0.8), Math.round(posMax * 0.7));
    } else {
      posPoints = Math.round(posMax * 0.4);
    }

    factors.push({
      name: 'Position',
      points: Math.min(posPoints, posMax),
      maxPoints: posMax,
      detail: `Gap: ${posGap > 0 ? '+' : ''}${posGap} (#${matchData.homeTeam.position} vs #${matchData.awayTeam.position})`,
    });
  }
  posPoints = Math.min(posPoints, posMax);
  totalScore += posPoints;

  // ─── Factor 5: H2H (base 10 points) ────────────────────────────────────────

  const h2hMax = Math.round(10 * weights.h2h);
  let h2hPoints = 0;

  if (matchData.h2h && matchData.h2h.total >= 2) {
    const h2h = matchData.h2h;

    if (backingHome) {
      h2hPoints = Math.round((h2h.homeTeamWins / h2h.total) * h2hMax);
    } else if (backingAway) {
      h2hPoints = Math.round((h2h.awayTeamWins / h2h.total) * h2hMax);
    } else if (isOverMarket) {
      h2hPoints = h2h.avgGoals >= 3.0 ? h2hMax : h2h.avgGoals >= 2.5 ? Math.round(h2hMax * 0.7) : Math.round(h2hMax * 0.3);
    } else if (isBttsYes) {
      h2hPoints = Math.round((h2h.bttsPct / 100) * h2hMax);
    } else if (isBttsNo) {
      h2hPoints = Math.round(((100 - h2h.bttsPct) / 100) * h2hMax);
    } else {
      h2hPoints = Math.round(h2hMax * 0.5);
    }

    factors.push({
      name: 'H2H',
      points: Math.min(h2hPoints, h2hMax),
      maxPoints: h2hMax,
      detail: `${h2h.total} games: ${h2h.homeTeamWins}H ${h2h.draws}D ${h2h.awayTeamWins}A, avg ${h2h.avgGoals}g`,
    });
  }
  h2hPoints = Math.min(h2hPoints, h2hMax);
  totalScore += h2hPoints;

  // ─── Factor 6: Momentum (base 10 points) ───────────────────────────────────
  // Momentum = direction of form. WWWDL = declining. LWWWW = improving.

  const momentumMax = Math.round(10 * weights.momentum);
  let momentumPoints = 0;

  const momentumForm = backingHome ? matchData.homeTeam.form : backingAway ? matchData.awayTeam.form :
    (matchData.homeTeam.form || '') + (matchData.awayTeam.form || '');

  if (momentumForm && momentumForm.length >= 4) {
    momentumPoints = calculateMomentum(momentumForm, momentumMax);
    factors.push({
      name: 'Momentum',
      points: momentumPoints,
      maxPoints: momentumMax,
      detail: momentumPoints >= momentumMax * 0.7 ? 'Improving' : momentumPoints >= momentumMax * 0.4 ? 'Stable' : 'Declining',
    });
  }
  totalScore += momentumPoints;

  // Clamp to 0-100
  const finalScore = Math.min(Math.max(Math.round(totalScore), 0), 100);

  return {
    score: finalScore,
    factors,
    hasData: true,
    confidence: getConfidenceLevel(finalScore, true),
    // Band width based on how many factors had data (more factors = narrower band)
    band: computeBand(finalScore, factors),
  };
}

// ─── Market-Specific Weight Models ───────────────────────────────────────────

interface MarketWeights {
  form: number;
  venue: number;
  scoring: number;
  position: number;
  h2h: number;
  momentum: number;
}

/**
 * Returns weight multipliers for each factor based on market type.
 * Base allocations are: Form 30, Venue 20, Scoring 15, Position 15, H2H 10, Momentum 10.
 * Multipliers shift emphasis per market. All multipliers average to ~1.0.
 */
function getMarketWeights(selection: ParsedSelection): MarketWeights {
  const isOver = selection.pickCategory === 'over';
  const isUnder = selection.pickCategory === 'under';
  const isBtts = selection.marketType === 'gg_ng';
  const is1x2 = selection.marketType === '1x2';
  const isDC = selection.marketType === 'double_chance';

  if (isOver || isUnder) {
    // Goal markets: Scoring and Form matter most, Position less
    return { form: 1.1, venue: 0.7, scoring: 1.5, position: 0.7, h2h: 1.2, momentum: 1.0 };
  }
  if (isBtts) {
    // BTTS: Scoring dominates, H2H goal history important
    return { form: 0.9, venue: 0.6, scoring: 1.6, position: 0.6, h2h: 1.4, momentum: 1.0 };
  }
  if (is1x2 || isDC) {
    // Result markets: Position and Venue most important
    return { form: 1.0, venue: 1.3, scoring: 0.8, position: 1.3, h2h: 1.0, momentum: 1.0 };
  }
  // Default (handicap, other)
  return { form: 1.0, venue: 1.0, scoring: 1.0, position: 1.0, h2h: 1.0, momentum: 1.0 };
}

/**
 * Calculate momentum with VELOCITY (acceleration, not just direction).
 * LLLLW = barely improving (velocity: low)
 * LLLWW = accelerating (velocity: medium)
 * LLWWW = strong turnaround (velocity: high)
 * WWWWL = decelerating (was great, now dropping)
 */
function calculateMomentum(form: string, maxPoints: number): number {
  if (form.length < 4) return Math.round(maxPoints * 0.5);

  const scoreChar = (c: string) => c === 'W' ? 3 : c === 'D' ? 1 : 0;

  // Split into 3 segments for velocity detection
  const seg1 = form.slice(0, 2); // Most recent
  const seg2 = form.slice(2, 4); // Middle
  const seg3 = form.slice(4, 6) || form.slice(3, 5); // Oldest

  const avg1 = seg1.split('').reduce((s, c) => s + scoreChar(c), 0) / seg1.length;
  const avg2 = seg2.split('').reduce((s, c) => s + scoreChar(c), 0) / Math.max(seg2.length, 1);
  const avg3 = seg3.length > 0 ? seg3.split('').reduce((s, c) => s + scoreChar(c), 0) / seg3.length : avg2;

  // Direction: recent vs older
  const direction = avg1 - avg2; // Positive = improving

  // Acceleration: is improvement speeding up or slowing down?
  const prevDirection = avg2 - avg3;
  const acceleration = direction - prevDirection; // Positive = accelerating improvement

  // Combined: 60% direction + 40% acceleration
  const combined = direction * 0.6 + acceleration * 0.4;

  // Normalize to 0-1 range (combined can range from about -4.5 to +4.5)
  const normalized = Math.min(1, Math.max(0, (combined + 3) / 6));

  return Math.round(normalized * maxPoints);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute confidence band width based on data quality.
 * More factors with data = narrower band = higher certainty.
 */
function computeBand(score: number, factors: ScoringFactor[]): { low: number; high: number } {
  // Count factors that had meaningful contribution (points > 0)
  const activeFactors = factors.filter(f => f.points > 0 && f.name !== 'No Data').length;
  // Width narrows with more data: 6 factors = ±5, 3 factors = ±12, 1 factor = ±18
  const halfWidth = Math.max(3, Math.round(20 - activeFactors * 2.5));
  return {
    low: Math.max(0, score - halfWidth),
    high: Math.min(100, score + halfWidth),
  };
}

function isBackingHome(sel: ParsedSelection): boolean {
  return sel.pickCategory === 'home' || sel.pickCategory === 'home_or_draw' || sel.pickCategory === 'home_or_away';
}

function isBackingAway(sel: ParsedSelection): boolean {
  return sel.pickCategory === 'away' || sel.pickCategory === 'draw_or_away' || sel.pickCategory === 'home_or_away';
}

/**
 * Convert form string (WWDLW) to score (0-20)
 * W=4, D=2, L=0, weighted by recency (most recent worth more)
 */
function calculateFormScore(form: string): number {
  if (!form) return 5; // Neutral if no form
  const chars = form.slice(0, 5).split('');
  let total = 0;
  const weights = [1.5, 1.3, 1.1, 0.9, 0.7]; // Most recent = most important

  chars.forEach((c, i) => {
    const weight = weights[i] || 0.7;
    if (c === 'W') total += 4 * weight;
    else if (c === 'D') total += 2 * weight;
    // L = 0
  });

  // Max possible with 5 wins: 4*(1.5+1.3+1.1+0.9+0.7) = 4*5.5 = 22 → normalize to 20
  return Math.min(Math.round((total / 22) * 20), 20);
}

/**
 * Score odds reasonableness: low odds with high confidence = good value
 * Very high odds with moderate confidence = risky
 */
function scoreOddsReasonableness(odds: number, currentScore: number): number {
  // Expected confidence thresholds by odds range
  if (odds <= 1.30) {
    // Very low odds: should be very confident (75+) to score well
    return currentScore >= 55 ? 13 : currentScore >= 40 ? 8 : 4;
  } else if (odds <= 1.50) {
    // Safe zone: moderate confidence suffices
    return currentScore >= 45 ? 12 : currentScore >= 30 ? 7 : 4;
  } else if (odds <= 1.80) {
    // Medium risk: need decent backing
    return currentScore >= 40 ? 10 : currentScore >= 25 ? 6 : 3;
  } else if (odds <= 2.20) {
    // Higher risk: harder to justify
    return currentScore >= 50 ? 8 : currentScore >= 35 ? 5 : 2;
  } else {
    // High odds: unless very strong data, risky
    return currentScore >= 55 ? 6 : currentScore >= 40 ? 3 : 1;
  }
}

// ─── Batch Scoring ───────────────────────────────────────────────────────────

/**
 * Score all selections, using cache where available.
 * Returns a map of selectionId → ScoringResult.
 */
export function scoreAllSelections(
  selections: ParsedSelection[],
  matchDataMap: Map<string, MatchData>
): Map<string, ScoringResult> {
  const results = new Map<string, ScoringResult>();

  for (const sel of selections) {
    // Check cache first
    const cached = getCachedScore(sel.id);
    if (cached) {
      results.set(sel.id, cached);
      continue;
    }

    // Build match key for lookup
    const matchKey = `${sel.homeTeam.toLowerCase()}|${sel.awayTeam.toLowerCase()}`;
    const matchData = matchDataMap.get(matchKey);

    const result = scorePick(sel, matchData);
    setCachedScore(sel.id, result);
    results.set(sel.id, result);
  }

  return results;
}

/**
 * Quick score without API data — uses only odds and pick category heuristics.
 * Good as a fallback when no API key is configured.
 */
export function quickScore(selection: ParsedSelection): ScoringResult {
  const factors: ScoringFactor[] = [];
  let score = 50; // Base neutral

  // Odds-based heuristic: lower odds = bookmaker thinks it's more likely
  if (selection.odds <= 1.30) {
    score += 15;
    factors.push({ name: 'Low Odds', points: 15, maxPoints: 15, detail: `${selection.odds.toFixed(2)} — strong favorite` });
  } else if (selection.odds <= 1.50) {
    score += 10;
    factors.push({ name: 'Safe Odds', points: 10, maxPoints: 15, detail: `${selection.odds.toFixed(2)} — safe zone` });
  } else if (selection.odds <= 1.80) {
    score += 5;
    factors.push({ name: 'Medium Odds', points: 5, maxPoints: 15, detail: `${selection.odds.toFixed(2)} — moderate risk` });
  } else if (selection.odds <= 2.50) {
    score -= 5;
    factors.push({ name: 'Higher Odds', points: -5, maxPoints: 15, detail: `${selection.odds.toFixed(2)} — risky` });
  } else {
    score -= 15;
    factors.push({ name: 'High Odds', points: -15, maxPoints: 15, detail: `${selection.odds.toFixed(2)} — very risky` });
  }

  // Market type heuristic
  if (selection.marketType === 'over_under' && selection.pickCategory === 'over') {
    // Over markets tend to be popular but volatile
    score -= 3;
  } else if (selection.marketType === '1x2' && selection.pickCategory === 'home') {
    // Home advantage is real
    score += 5;
    factors.push({ name: 'Home Advantage', points: 5, maxPoints: 10, detail: 'Home teams win ~46% of matches' });
  }

  score = Math.min(Math.max(score, 10), 85); // Cap without real data

  return {
    score,
    factors,
    hasData: false,
    confidence: 'no_data',
    band: { low: Math.max(0, score - 20), high: Math.min(100, score + 20) }, // Wide band for no-data
  };
}

// ─── Enhancement: Correlation Detection (#7) ─────────────────────────────────

/**
 * Detect correlated picks within a slip and apply penalty.
 * Same league + same day = outcomes are statistically correlated.
 * Returns a penalty (negative adjustment) to apply to slip quality.
 */
export function detectCorrelation(selections: ParsedSelection[]): { penalty: number; warnings: string[] } {
  const warnings: string[] = [];
  let penalty = 0;

  // Group by date
  const byDate: Record<string, ParsedSelection[]> = {};
  for (const sel of selections) {
    const dateKey = sel.date;
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(sel);
  }

  // Check for same-league same-day clusters
  for (const [date, datePicks] of Object.entries(byDate)) {
    const byMarketType: Record<string, ParsedSelection[]> = {};
    for (const pick of datePicks) {
      const mKey = pick.marketType;
      if (!byMarketType[mKey]) byMarketType[mKey] = [];
      byMarketType[mKey].push(pick);
    }

    // If 3+ picks on same date with same market type, flag correlation
    for (const [market, picks] of Object.entries(byMarketType)) {
      if (picks.length >= 3) {
        penalty += (picks.length - 2) * 3; // 3 points per extra correlated pick
        warnings.push(`${picks.length} ${market} picks on ${date} — outcomes may be correlated`);
      }
    }
  }

  // Same league clustering (more than 2 picks from visibly same league)
  // We approximate by looking at team name patterns (e.g., many Spanish/Italian teams)

  return { penalty: Math.min(penalty, 15), warnings };
}

/**
 * Apply correlation penalty to a slip's quality score.
 */
export function adjustSlipForCorrelation(
  qualityScore: number,
  selections: ParsedSelection[]
): { adjustedScore: number; warnings: string[] } {
  const { penalty, warnings } = detectCorrelation(selections);
  return {
    adjustedScore: Math.max(qualityScore - penalty, 0),
    warnings,
  };
}

// ─── Enhancement: Personal History Weighting (#8) ────────────────────────────

/**
 * Historical performance record for a specific pick pattern.
 */
export interface PersonalRecord {
  wins: number;
  losses: number;
  total: number;
  hitRate: number; // 0-100
}

/**
 * Build a personal performance database from settled history.
 * Keys: market type, pick category, odds range, team involvement.
 */
export function buildPersonalHistory(history: any[]): Map<string, PersonalRecord> {
  const records = new Map<string, PersonalRecord>();

  function addResult(key: string, won: boolean) {
    const existing = records.get(key) || { wins: 0, losses: 0, total: 0, hitRate: 0 };
    existing.total++;
    if (won) existing.wins++;
    else existing.losses++;
    existing.hitRate = Math.round((existing.wins / existing.total) * 100);
    records.set(key, existing);
  }

  for (const staked of history) {
    for (const sel of staked.slip?.selections || []) {
      const selResult = staked.selectionResults?.[sel.id];
      if (!selResult || selResult === 'pending') continue;
      const won = selResult === 'won';

      // Key by market type
      addResult(`market:${sel.marketType}`, won);

      // Key by pick category
      addResult(`pick:${sel.pickCategory}`, won);

      // Key by odds range
      const oddsKey = sel.odds < 1.30 ? 'odds:<1.30' :
                      sel.odds < 1.50 ? 'odds:1.30-1.50' :
                      sel.odds < 1.80 ? 'odds:1.50-1.80' :
                      sel.odds < 2.50 ? 'odds:1.80-2.50' : 'odds:2.50+';
      addResult(oddsKey, won);

      // Key by team (home or away)
      addResult(`team:${sel.homeTeam.toLowerCase()}`, won);
      addResult(`team:${sel.awayTeam.toLowerCase()}`, won);
    }
  }

  return records;
}

/**
 * Get personal history adjustment for a pick.
 * Positive = historically profitable pattern, negative = historically losing.
 * Range: -10 to +10 points.
 */
export function getPersonalHistoryAdjustment(
  selection: ParsedSelection,
  personalHistory: Map<string, PersonalRecord>
): { adjustment: number; detail: string } {
  if (personalHistory.size === 0) return { adjustment: 0, detail: 'No personal history' };

  const adjustments: number[] = [];
  const details: string[] = [];

  // Check market type record
  const marketRecord = personalHistory.get(`market:${selection.marketType}`);
  if (marketRecord && marketRecord.total >= 5) {
    const deviation = marketRecord.hitRate - 50; // 0 = average, >0 = above average
    const adj = Math.round(deviation * 0.1); // ±5 max from market
    adjustments.push(adj);
    if (Math.abs(adj) >= 2) {
      details.push(`${selection.marketType}: ${marketRecord.hitRate}% hit (${marketRecord.total} picks)`);
    }
  }

  // Check pick category record
  const pickRecord = personalHistory.get(`pick:${selection.pickCategory}`);
  if (pickRecord && pickRecord.total >= 5) {
    const deviation = pickRecord.hitRate - 50;
    const adj = Math.round(deviation * 0.08);
    adjustments.push(adj);
  }

  // Check team record (penalty for serial losers)
  const homeRecord = personalHistory.get(`team:${selection.homeTeam.toLowerCase()}`);
  const awayRecord = personalHistory.get(`team:${selection.awayTeam.toLowerCase()}`);
  if (homeRecord && homeRecord.total >= 3 && homeRecord.hitRate < 35) {
    adjustments.push(-3);
    details.push(`${selection.homeTeam}: only ${homeRecord.hitRate}% hit for you`);
  }
  if (awayRecord && awayRecord.total >= 3 && awayRecord.hitRate < 35) {
    adjustments.push(-3);
    details.push(`${selection.awayTeam}: only ${awayRecord.hitRate}% hit for you`);
  }

  // Average all adjustments, clamp to ±10
  const totalAdj = adjustments.length > 0
    ? Math.min(Math.max(Math.round(adjustments.reduce((a, b) => a + b, 0) / adjustments.length * 2), -10), 10)
    : 0;

  return {
    adjustment: totalAdj,
    detail: details.length > 0 ? details.join('; ') : (totalAdj === 0 ? 'Neutral history' : 'Based on your past results'),
  };
}

// ─── Enhancement: Multi-API Scoring Fusion (#10) ─────────────────────────────

/**
 * Blend external prediction data into a score.
 * When KickoffAPI predictions are available, fuse them with the statistical score.
 */
export interface ExternalPrediction {
  homePercent: number; // 0-100
  drawPercent: number; // 0-100
  awayPercent: number; // 0-100
  advice?: string;
}

export function fuseWithExternalPrediction(
  baseScore: number,
  selection: ParsedSelection,
  prediction: ExternalPrediction
): { fusedScore: number; detail: string } {
  const backingHome = isBackingHome(selection);
  const backingAway = isBackingAway(selection);
  const isDraw = selection.pickCategory === 'draw';

  let externalConfidence = 50; // Neutral
  if (backingHome) externalConfidence = prediction.homePercent;
  else if (backingAway) externalConfidence = prediction.awayPercent;
  else if (isDraw) externalConfidence = prediction.drawPercent;
  else if (selection.pickCategory === 'home_or_draw') externalConfidence = prediction.homePercent + prediction.drawPercent;
  else if (selection.pickCategory === 'draw_or_away') externalConfidence = prediction.drawPercent + prediction.awayPercent;

  // Normalize to 0-100 range
  externalConfidence = Math.min(Math.max(externalConfidence, 0), 100);

  // Weighted blend: 60% our score, 40% external
  const fusedScore = Math.round(baseScore * 0.6 + externalConfidence * 0.4);

  return {
    fusedScore: Math.min(Math.max(fusedScore, 0), 100),
    detail: `API: ${externalConfidence}% → blended ${fusedScore}`,
  };
}

// ─── Enhanced Score Function (combines all enhancements) ─────────────────────

/**
 * Full scoring with all enhancements applied.
 * Call this instead of scorePick() when you have history + external data available.
 */
export function scorePickEnhanced(
  selection: ParsedSelection,
  matchData?: MatchData,
  personalHistory?: Map<string, PersonalRecord>,
  externalPrediction?: ExternalPrediction
): ScoringResult {
  // Base scoring
  const baseResult = scorePick(selection, matchData);
  let finalScore = baseResult.score;
  const factors = [...baseResult.factors];

  // Apply personal history adjustment
  if (personalHistory && personalHistory.size > 0) {
    const { adjustment, detail } = getPersonalHistoryAdjustment(selection, personalHistory);
    if (adjustment !== 0) {
      finalScore += adjustment;
      factors.push({
        name: 'Personal History',
        points: adjustment,
        maxPoints: 10,
        detail,
      });
    }
  }

  // Apply external prediction fusion
  if (externalPrediction) {
    const { fusedScore, detail } = fuseWithExternalPrediction(finalScore, selection, externalPrediction);
    const fusionDiff = fusedScore - finalScore;
    if (Math.abs(fusionDiff) >= 2) {
      factors.push({
        name: 'API Prediction',
        points: fusionDiff,
        maxPoints: 15,
        detail,
      });
    }
    finalScore = fusedScore;
  }

  // Clamp
  finalScore = Math.min(Math.max(Math.round(finalScore), 0), 100);

  return {
    score: finalScore,
    factors,
    hasData: baseResult.hasData,
    confidence: getConfidenceLevel(finalScore, baseResult.hasData),
    band: computeBand(finalScore, factors),
  };
}
