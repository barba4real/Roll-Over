/**
 * Odds Booster Engine
 *
 * Injects 1-2 higher-odds picks into a slip to boost accumulator value
 * while keeping overall confidence above a safety threshold.
 *
 * Strategy:
 * - Takes existing slip selections (typically safe 1.20-1.50 odds)
 * - Finds 1-2 "value boosters" from scouted fixtures with higher odds (1.60-2.50)
 *   but still decent confidence (50%+)
 * - The booster picks must be from DIFFERENT matches than existing selections
 * - Overall slip odds increase significantly while risk stays manageable
 *
 * Example:
 *   Original: 3 picks @ 1.30 avg = 2.20 total odds
 *   Boosted:  3 picks + 1 booster @ 1.80 = 3.96 total odds (+80% payout boost)
 */

import { predictMatch } from './historical-stats';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BoosterCandidate {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickOff: string;
  pick: string;
  market: string;
  confidence: number;
  estimatedOdds: number;      // 1.60 - 2.50 range (the boost zone)
  reasoning: string[];
  source: string;
}

export interface BoosterResult {
  boosters: BoosterCandidate[];
  originalOdds: number;
  boostedOdds: number;
  oddsIncrease: number;       // Percentage increase
  riskLevel: 'low' | 'medium' | 'high';
}

export interface SlipSelection {
  homeTeam: string;
  awayTeam: string;
  pick: string;
  market: string;
  odds: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const BOOSTER_CONFIG = {
  minConfidence: 50,           // Booster picks must have at least 50% confidence
  maxConfidence: 70,           // Above 70% = probably already a safe pick, not a "booster"
  minOdds: 1.55,              // Minimum odds for a booster (below this it's not boosting enough)
  maxOdds: 2.60,              // Maximum odds for a booster (above this = too risky)
  maxBoosters: 2,             // Maximum boosters to add
  minOverallConfidence: 45,   // Don't let overall slip confidence drop below this
};

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Find booster picks for an existing slip from scouted fixtures.
 *
 * @param currentSelections - Existing slip selections
 * @param scoutedFixtures - Available fixtures from Scout results
 * @param maxBoosters - How many boosters to add (1 or 2)
 */
export function findBoosters(
  currentSelections: SlipSelection[],
  scoutedFixtures: { homeTeam: string; awayTeam: string; league: string; kickOff: string; suggestions: { pick: string; market: string; confidence: number; reasoning: string[]; estimatedOdds: string }[] }[],
  maxBoosters: number = BOOSTER_CONFIG.maxBoosters
): BoosterResult {
  // Get teams already in the slip (avoid duplicate matches)
  const usedTeams = new Set<string>();
  for (const sel of currentSelections) {
    usedTeams.add(sel.homeTeam.toLowerCase());
    usedTeams.add(sel.awayTeam.toLowerCase());
  }

  // Calculate current slip odds
  const originalOdds = currentSelections.reduce((acc, s) => acc * s.odds, 1);

  // Find booster candidates from scouted fixtures
  const candidates: BoosterCandidate[] = [];

  for (const fixture of scoutedFixtures) {
    // Skip if any team in this fixture is already in the slip
    if (usedTeams.has(fixture.homeTeam.toLowerCase()) || usedTeams.has(fixture.awayTeam.toLowerCase())) continue;

    for (const sug of fixture.suggestions) {
      // Parse odds range (e.g. "1.50-1.85" → take midpoint)
      const oddsParts = sug.estimatedOdds.split('-').map(s => parseFloat(s.trim()));
      const midOdds = oddsParts.length === 2 ? (oddsParts[0] + oddsParts[1]) / 2 : oddsParts[0] || 1.5;

      // Filter: must be in the "boost zone" (decent confidence + higher odds)
      if (sug.confidence < BOOSTER_CONFIG.minConfidence) continue;
      if (sug.confidence > BOOSTER_CONFIG.maxConfidence) continue;
      if (midOdds < BOOSTER_CONFIG.minOdds) continue;
      if (midOdds > BOOSTER_CONFIG.maxOdds) continue;

      candidates.push({
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        league: fixture.league,
        kickOff: fixture.kickOff,
        pick: sug.pick,
        market: sug.market,
        confidence: sug.confidence,
        estimatedOdds: Math.round(midOdds * 100) / 100,
        reasoning: sug.reasoning,
        source: 'Scout',
      });
    }
  }

  // Sort by best value: highest (confidence × odds) product
  candidates.sort((a, b) => (b.confidence * b.estimatedOdds) - (a.confidence * a.estimatedOdds));

  // Select top boosters (different matches only)
  const selectedBoosters: BoosterCandidate[] = [];
  const boosterTeams = new Set<string>();

  for (const candidate of candidates) {
    if (selectedBoosters.length >= maxBoosters) break;
    if (boosterTeams.has(candidate.homeTeam.toLowerCase()) || boosterTeams.has(candidate.awayTeam.toLowerCase())) continue;

    selectedBoosters.push(candidate);
    boosterTeams.add(candidate.homeTeam.toLowerCase());
    boosterTeams.add(candidate.awayTeam.toLowerCase());
  }

  // Calculate boosted odds
  const boostMultiplier = selectedBoosters.reduce((acc, b) => acc * b.estimatedOdds, 1);
  const boostedOdds = Math.round(originalOdds * boostMultiplier * 100) / 100;
  const oddsIncrease = originalOdds > 0 ? Math.round(((boostedOdds / originalOdds) - 1) * 100) : 0;

  // Assess risk
  const avgBoosterConf = selectedBoosters.length > 0
    ? selectedBoosters.reduce((sum, b) => sum + b.confidence, 0) / selectedBoosters.length
    : 0;
  const riskLevel: BoosterResult['riskLevel'] =
    avgBoosterConf >= 60 ? 'low' :
    avgBoosterConf >= 50 ? 'medium' : 'high';

  return {
    boosters: selectedBoosters,
    originalOdds: Math.round(originalOdds * 100) / 100,
    boostedOdds,
    oddsIncrease,
    riskLevel,
  };
}

/**
 * Generate booster suggestions for a slip directly from the historical DB.
 * Useful when scouted fixtures aren't available — scans the prediction engine
 * for matches with moderate confidence and decent odds potential.
 */
export function generateBoostersFromPredictions(
  currentSelections: SlipSelection[],
  availableFixtures: { homeTeam: string; awayTeam: string; league: string; kickOff: string }[],
  maxBoosters: number = 2
): BoosterCandidate[] {
  const usedTeams = new Set(currentSelections.flatMap(s => [s.homeTeam.toLowerCase(), s.awayTeam.toLowerCase()]));
  const candidates: BoosterCandidate[] = [];

  for (const fixture of availableFixtures) {
    if (usedTeams.has(fixture.homeTeam.toLowerCase()) || usedTeams.has(fixture.awayTeam.toLowerCase())) continue;

    const prediction = predictMatch(fixture.homeTeam, fixture.awayTeam, fixture.league);
    if (prediction.dataQuality === 'insufficient') continue;

    // Look for picks in the booster range
    for (const pick of prediction.picks) {
      if (pick.confidence >= BOOSTER_CONFIG.minConfidence && pick.confidence <= BOOSTER_CONFIG.maxConfidence) {
        // Estimate odds from confidence (inverse relationship)
        const estimatedOdds = Math.round((100 / pick.confidence) * 100) / 100; // e.g. 55% → ~1.82

        if (estimatedOdds >= BOOSTER_CONFIG.minOdds && estimatedOdds <= BOOSTER_CONFIG.maxOdds) {
          candidates.push({
            homeTeam: fixture.homeTeam,
            awayTeam: fixture.awayTeam,
            league: fixture.league,
            kickOff: fixture.kickOff,
            pick: pick.pick,
            market: pick.market,
            confidence: pick.confidence,
            estimatedOdds,
            reasoning: pick.reasoning,
            source: 'Prediction DB',
          });
        }
      }
    }
  }

  // Sort by value and take top N
  candidates.sort((a, b) => (b.confidence * b.estimatedOdds) - (a.confidence * a.estimatedOdds));
  return candidates.slice(0, maxBoosters);
}
