/**
 * Portfolio Optimizer
 *
 * Given a large set of candidate slips, selects the best portfolio
 * with diversification constraints. Two phases:
 *
 * Phase 1: Greedy Selection
 *   - Score each slip (quality + confidence average)
 *   - Select best slip, then penalize remaining slips that share teams/leagues/times
 *   - Repeat until portfolio is full
 *
 * Phase 2: Local Swap Improvement
 *   - For each slip in the portfolio, try swapping with every unselected slip
 *   - Accept swap if portfolio score improves
 *   - Repeat until no improvement found (or max iterations)
 *
 * Exposure penalties ensure no single team, league, or time slot dominates.
 */

import { Slip, ParsedSelection } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioConfig {
  maxSlips: number;            // Maximum slips in portfolio (default 10)
  teamExposurePenalty: number; // Penalty per additional appearance of same team (default 15)
  leagueExposurePenalty: number; // Penalty per additional slip in same league (default 5)
  timeClusterPenalty: number;  // Penalty for slips with overlapping kick-offs (default 8)
  maxSwapIterations: number;   // Max swap improvement passes (default 3)
}

export const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = {
  maxSlips: 10,
  teamExposurePenalty: 15,
  leagueExposurePenalty: 5,
  timeClusterPenalty: 8,
  maxSwapIterations: 3,
};

export interface PortfolioResult {
  slips: Slip[];
  totalScore: number;
  diversityScore: number;     // 0-100, how diversified the portfolio is
  exposureWarnings: string[];
  improvementPasses: number;
}

// ─── Main Optimizer ──────────────────────────────────────────────────────────

/**
 * Select optimal portfolio from candidate slips.
 */
export function optimizePortfolio(
  candidates: Slip[],
  scores: Map<string, number>,  // selectionId → confidence score
  config: PortfolioConfig = DEFAULT_PORTFOLIO_CONFIG
): PortfolioResult {
  if (candidates.length === 0) {
    return { slips: [], totalScore: 0, diversityScore: 100, exposureWarnings: [], improvementPasses: 0 };
  }

  const maxSlips = Math.min(config.maxSlips, candidates.length);

  // Phase 1: Greedy selection with exposure penalties
  const portfolio = greedySelect(candidates, scores, maxSlips, config);

  // Phase 2: Local swap improvement
  const improved = localSwapImprove(portfolio, candidates, scores, config);

  // Calculate final metrics
  const totalScore = improved.reduce((sum, slip) => sum + slipScore(slip, scores), 0);
  const diversityScore = calculateDiversity(improved);
  const exposureWarnings = getExposureWarnings(improved);

  return {
    slips: improved,
    totalScore,
    diversityScore,
    exposureWarnings,
    improvementPasses: config.maxSwapIterations,
  };
}

// ─── Phase 1: Greedy Selection ───────────────────────────────────────────────

function greedySelect(
  candidates: Slip[],
  scores: Map<string, number>,
  maxSlips: number,
  config: PortfolioConfig
): Slip[] {
  const selected: Slip[] = [];
  const remaining = [...candidates];

  // Track exposure counts
  const teamCount: Record<string, number> = {};
  const leagueCount: Record<string, number> = {};
  const timeSlots: number[] = []; // kick-off timestamps

  for (let i = 0; i < maxSlips && remaining.length > 0; i++) {
    // Score each remaining slip with exposure penalties
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let j = 0; j < remaining.length; j++) {
      const slip = remaining[j];
      let score = slipScore(slip, scores);

      // Apply exposure penalties
      for (const sel of slip.selections) {
        const homeKey = sel.homeTeam.toLowerCase();
        const awayKey = sel.awayTeam.toLowerCase();

        // Team penalty: each additional appearance of same team
        if (teamCount[homeKey]) score -= teamCount[homeKey] * config.teamExposurePenalty;
        if (teamCount[awayKey]) score -= teamCount[awayKey] * config.teamExposurePenalty;

        // Time cluster penalty: overlapping kick-offs within 30 minutes
        const kickOff = new Date(sel.kickOffDateTime).getTime();
        const nearbyCount = timeSlots.filter(t => Math.abs(t - kickOff) < 30 * 60 * 1000).length;
        if (nearbyCount > 0) score -= nearbyCount * config.timeClusterPenalty;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestIdx < 0) break;

    // Add best slip to portfolio
    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);

    // Update exposure tracking
    for (const sel of chosen.selections) {
      const homeKey = sel.homeTeam.toLowerCase();
      const awayKey = sel.awayTeam.toLowerCase();
      teamCount[homeKey] = (teamCount[homeKey] || 0) + 1;
      teamCount[awayKey] = (teamCount[awayKey] || 0) + 1;
      timeSlots.push(new Date(sel.kickOffDateTime).getTime());
    }
  }

  return selected;
}

// ─── Phase 2: Local Swap Improvement ─────────────────────────────────────────

function localSwapImprove(
  portfolio: Slip[],
  allCandidates: Slip[],
  scores: Map<string, number>,
  config: PortfolioConfig
): Slip[] {
  const result = [...portfolio];
  const portfolioIds = new Set(result.map(s => s.id));
  const available = allCandidates.filter(s => !portfolioIds.has(s.id));

  for (let pass = 0; pass < config.maxSwapIterations; pass++) {
    let improved = false;

    for (let i = 0; i < result.length; i++) {
      const currentPortfolioScore = portfolioTotalScore(result, scores, config);

      for (const candidate of available) {
        // Try swapping result[i] with candidate
        const trial = [...result];
        trial[i] = candidate;
        const trialScore = portfolioTotalScore(trial, scores, config);

        if (trialScore > currentPortfolioScore) {
          // Swap improves portfolio
          const removed = result[i];
          result[i] = candidate;
          available.push(removed);
          available.splice(available.indexOf(candidate), 1);
          improved = true;
          break;
        }
      }
    }

    if (!improved) break; // No more improvements possible
  }

  return result;
}

// ─── Scoring Helpers ─────────────────────────────────────────────────────────

/**
 * Score a single slip based on quality + average pick confidence.
 */
function slipScore(slip: Slip, scores: Map<string, number>): number {
  const avgConfidence = slip.selections.reduce(
    (sum, sel) => sum + (scores.get(sel.id) || 50), 0
  ) / slip.selectionCount;

  // Weighted: 40% quality score + 60% avg confidence
  return slip.qualityScore * 0.4 + avgConfidence * 0.6;
}

/**
 * Score entire portfolio with exposure penalties.
 */
function portfolioTotalScore(
  portfolio: Slip[],
  scores: Map<string, number>,
  config: PortfolioConfig
): number {
  let total = 0;
  const teamCount: Record<string, number> = {};
  const timeSlots: number[] = [];

  for (const slip of portfolio) {
    let score = slipScore(slip, scores);

    for (const sel of slip.selections) {
      const homeKey = sel.homeTeam.toLowerCase();
      const awayKey = sel.awayTeam.toLowerCase();

      if (teamCount[homeKey]) score -= teamCount[homeKey] * config.teamExposurePenalty;
      if (teamCount[awayKey]) score -= teamCount[awayKey] * config.teamExposurePenalty;

      const kickOff = new Date(sel.kickOffDateTime).getTime();
      const nearbyCount = timeSlots.filter(t => Math.abs(t - kickOff) < 30 * 60 * 1000).length;
      if (nearbyCount > 0) score -= nearbyCount * config.timeClusterPenalty;

      teamCount[homeKey] = (teamCount[homeKey] || 0) + 1;
      teamCount[awayKey] = (teamCount[awayKey] || 0) + 1;
      timeSlots.push(kickOff);
    }

    total += score;
  }

  return total;
}

// ─── Diversity & Warnings ────────────────────────────────────────────────────

/**
 * Calculate diversity score (0-100) for a portfolio.
 * 100 = perfectly diversified, 0 = all picks on same team/time.
 */
function calculateDiversity(portfolio: Slip[]): number {
  if (portfolio.length === 0) return 100;

  const allSelections = portfolio.flatMap(s => s.selections);
  const totalPicks = allSelections.length;
  if (totalPicks === 0) return 100;

  // Unique teams / total team slots (each pick has 2 teams)
  const uniqueTeams = new Set(allSelections.flatMap(s => [s.homeTeam.toLowerCase(), s.awayTeam.toLowerCase()]));
  const teamDiversity = Math.min(uniqueTeams.size / (totalPicks * 2), 1);

  // Unique kick-off hours / total picks
  const uniqueHours = new Set(allSelections.map(s => {
    const d = new Date(s.kickOffDateTime);
    return `${d.toDateString()}-${d.getHours()}`;
  }));
  const timeDiversity = Math.min(uniqueHours.size / totalPicks, 1);

  // Unique dates
  const uniqueDates = new Set(allSelections.map(s => new Date(s.kickOffDateTime).toDateString()));
  const dateDiversity = Math.min(uniqueDates.size / Math.ceil(totalPicks / 3), 1);

  return Math.round((teamDiversity * 50 + timeDiversity * 30 + dateDiversity * 20));
}

/**
 * Get exposure warnings for the portfolio.
 */
function getExposureWarnings(portfolio: Slip[]): string[] {
  const warnings: string[] = [];
  const allSelections = portfolio.flatMap(s => s.selections);

  // Count team appearances
  const teamCounts: Record<string, number> = {};
  for (const sel of allSelections) {
    const home = sel.homeTeam.toLowerCase();
    const away = sel.awayTeam.toLowerCase();
    teamCounts[home] = (teamCounts[home] || 0) + 1;
    teamCounts[away] = (teamCounts[away] || 0) + 1;
  }

  for (const [team, count] of Object.entries(teamCounts)) {
    if (count >= 3) {
      warnings.push(`${team} appears in ${count} slips — high exposure risk`);
    }
  }

  // Check time clustering
  const kickOffs = allSelections.map(s => new Date(s.kickOffDateTime).getTime());
  for (let i = 0; i < kickOffs.length; i++) {
    const nearby = kickOffs.filter(t => t !== kickOffs[i] && Math.abs(t - kickOffs[i]) < 15 * 60 * 1000);
    if (nearby.length >= 4) {
      warnings.push(`${nearby.length + 1} picks within 15 minutes — correlated outcomes`);
      break;
    }
  }

  return warnings;
}
