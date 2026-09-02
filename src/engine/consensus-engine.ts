/**
 * Consensus Engine — Cross-Provider Prediction Aggregator
 *
 * Collects predictions/signals from every available source, weights them
 * by reliability, and produces a consensus confidence score.
 *
 * Sources contributing to consensus:
 *   - Historical Stats Engine (local DB: form, H2H) — weight: HIGH
 *   - TheSportsDB (recent results) — weight: MEDIUM
 *   - Football-Data.org (standings, form) — weight: HIGH (when available)
 *   - ESPN (standings position gap) — weight: MEDIUM
 *   - StatsBomb (xG data) — weight: HIGH (when available)
 *
 * Key features:
 *   - Weighted average across sources (not simple mean)
 *   - Disagreement detection: if sources conflict, confidence drops
 *   - Source attribution: shows which sources agree/disagree
 *   - Missing data handled gracefully (sources that have no opinion don't drag score down)
 */

import { predictMatch, getDatabaseSize, type MatchPrediction } from './historical-stats';
import { getTeamRecentResults } from './thesportsdb';
import { httpGetDirect } from '../lib/http';
import { findLeague } from './league-registry';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SourceSignal {
  source: string;
  weight: number;              // 0-1 (how much to trust this source)
  homeWin: number | null;      // 0-100 confidence (null = no opinion)
  draw: number | null;
  awayWin: number | null;
  over15: number | null;
  over25: number | null;
  btts: number | null;
  reasoning: string;
  available: boolean;          // Did this source have data?
}

export interface ConsensusResult {
  homeTeam: string;
  awayTeam: string;
  league: string;
  // Consensus scores (0-100)
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;
  over25: number;
  btts: number;
  // Meta
  sourcesUsed: number;
  sourcesTotal: number;
  agreement: 'strong' | 'moderate' | 'weak' | 'conflicting';
  disagreements: string[];     // Human-readable conflict descriptions
  // Individual source signals (for Compare tab)
  signals: SourceSignal[];
  // Best picks from consensus
  picks: ConsensusPick[];
}

export interface ConsensusPick {
  market: string;
  pick: string;
  confidence: number;
  agreement: 'strong' | 'moderate' | 'weak';
  sources: string[];           // Which sources support this pick
  reasoning: string[];
}

// ─── Source Weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  historicalDb: 0.35,          // Local DB (most data, most reliable)
  theSportsDb: 0.20,          // TheSportsDB (recent form)
  footballDataOrg: 0.25,      // Football-Data.org (standings, quality data)
  espnStandings: 0.15,        // ESPN (position gap)
  statsBomb: 0.05,            // StatsBomb (limited coverage, historical only)
};

// ─── Main Consensus Function ─────────────────────────────────────────────────

/**
 * Build consensus prediction from all available sources.
 * Queries each source, collects signals, weights them, detects disagreements.
 */
export async function buildConsensus(
  homeTeam: string,
  awayTeam: string,
  league: string,
  leagueId?: string
): Promise<ConsensusResult> {
  const signals: SourceSignal[] = [];

  // Collect signals from all sources in parallel
  const [historicalSignal, sportsDbSignal, standingsSignal] = await Promise.allSettled([
    getHistoricalSignal(homeTeam, awayTeam, league),
    getSportsDbSignal(homeTeam, awayTeam),
    getStandingsSignal(homeTeam, awayTeam, leagueId || guessLeagueId(league) || ''),
  ]);

  if (historicalSignal.status === 'fulfilled') signals.push(historicalSignal.value);
  if (sportsDbSignal.status === 'fulfilled') signals.push(sportsDbSignal.value);
  if (standingsSignal.status === 'fulfilled') signals.push(standingsSignal.value);

  // Calculate weighted consensus
  const consensus = calculateWeightedConsensus(signals);

  // Detect disagreements
  const disagreements = detectDisagreements(signals);
  const agreement = getAgreementLevel(signals);

  // If sources disagree strongly, reduce confidence
  const penaltyFactor = agreement === 'conflicting' ? 0.75 :
                         agreement === 'weak' ? 0.85 :
                         agreement === 'moderate' ? 0.95 : 1.0;

  const homeWin = Math.round(consensus.homeWin * penaltyFactor);
  const draw = Math.round(consensus.draw * penaltyFactor);
  const awayWin = Math.round(consensus.awayWin * penaltyFactor);
  const over15 = Math.round(consensus.over15 * penaltyFactor);
  const over25 = Math.round(consensus.over25 * penaltyFactor);
  const btts = Math.round(consensus.btts * penaltyFactor);

  // Generate picks from consensus
  const picks = generatePicks(
    { homeWin, draw, awayWin, over15, over25, btts },
    signals,
    homeTeam,
    awayTeam
  );

  return {
    homeTeam,
    awayTeam,
    league,
    homeWin,
    draw,
    awayWin,
    over15,
    over25,
    btts,
    sourcesUsed: signals.filter(s => s.available).length,
    sourcesTotal: signals.length,
    agreement,
    disagreements,
    signals,
    picks,
  };
}

// ─── Source Signal Collectors ─────────────────────────────────────────────────

async function getHistoricalSignal(homeTeam: string, awayTeam: string, league: string): Promise<SourceSignal> {
  const dbSize = getDatabaseSize();
  if (dbSize === 0) {
    return { source: 'Historical DB', weight: WEIGHTS.historicalDb, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'No data in DB', available: false };
  }

  const prediction = predictMatch(homeTeam, awayTeam, league);

  if (prediction.dataQuality === 'insufficient') {
    return { source: 'Historical DB', weight: WEIGHTS.historicalDb, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'Insufficient data for these teams', available: false };
  }

  // Reduce weight if data quality is low
  const qualityMultiplier = prediction.dataQuality === 'high' ? 1.0 :
                             prediction.dataQuality === 'medium' ? 0.8 : 0.6;

  return {
    source: 'Historical DB',
    weight: WEIGHTS.historicalDb * qualityMultiplier,
    homeWin: prediction.homeWinConfidence,
    draw: prediction.drawConfidence,
    awayWin: prediction.awayWinConfidence,
    over15: prediction.over15Confidence,
    over25: prediction.over25Confidence,
    btts: prediction.bttsConfidence,
    reasoning: `${prediction.homeFormMatches}+${prediction.awayFormMatches} form, ${prediction.h2hMatches} H2H (${prediction.dataQuality})`,
    available: true,
  };
}

async function getSportsDbSignal(homeTeam: string, awayTeam: string): Promise<SourceSignal> {
  try {
    const [homeResults, awayResults] = await Promise.all([
      getTeamRecentResults(homeTeam),
      getTeamRecentResults(awayTeam),
    ]);

    if (homeResults.results.length === 0 && awayResults.results.length === 0) {
      return { source: 'TheSportsDB', weight: WEIGHTS.theSportsDb, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'No recent results found', available: false };
    }

    // Calculate basic form from TheSportsDB results
    const homeForm = analyzeRecentForm(homeTeam, homeResults.results, true);
    const awayForm = analyzeRecentForm(awayTeam, awayResults.results, false);

    // Derive confidence signals from form
    let homeWin = 30 + (homeForm.winRate - 50) * 0.5;
    let awayWin = 25 + (awayForm.winRate - 40) * 0.5;
    let draw = 100 - homeWin - awayWin;

    // Clamp
    homeWin = clamp(homeWin, 10, 85);
    awayWin = clamp(awayWin, 10, 80);
    draw = clamp(draw, 10, 50);

    // Normalize
    const total = homeWin + draw + awayWin;
    homeWin = Math.round((homeWin / total) * 100);
    draw = Math.round((draw / total) * 100);
    awayWin = Math.round((awayWin / total) * 100);

    const over15 = clamp(Math.round(homeForm.avgGoals + awayForm.avgGoals > 2 ? 65 + (homeForm.avgGoals + awayForm.avgGoals - 2) * 10 : 45), 20, 90);
    const btts = clamp(Math.round((homeForm.scoringRate + awayForm.scoringRate) / 2 - 10), 20, 85);

    return {
      source: 'TheSportsDB',
      weight: WEIGHTS.theSportsDb,
      homeWin, draw, awayWin,
      over15,
      over25: clamp(over15 - 15, 15, 85),
      btts,
      reasoning: `Home: ${homeForm.record} (${homeResults.results.length}gm), Away: ${awayForm.record} (${awayResults.results.length}gm)`,
      available: true,
    };
  } catch {
    return { source: 'TheSportsDB', weight: WEIGHTS.theSportsDb, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'Fetch failed', available: false };
  }
}

async function getStandingsSignal(homeTeam: string, awayTeam: string, leagueId: string): Promise<SourceSignal> {
  if (!leagueId) {
    return { source: 'Standings', weight: WEIGHTS.espnStandings, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'League unknown', available: false };
  }

  const league = findLeague({ id: leagueId });
  if (!league?.espnSlug) {
    return { source: 'Standings', weight: WEIGHTS.espnStandings, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'No ESPN slug', available: false };
  }

  try {
    const url = `https://site.web.api.espn.com/apis/v2/sports/soccer/${league.espnSlug}/standings`;
    const data: any = await httpGetDirect(url, {});
    if (!data?.children && !data?.standings) throw new Error('No standings data');

    // Find both teams' positions
    const groups = data.children || [data];
    let homePos: number | null = null;
    let awayPos: number | null = null;
    let totalTeams = 0;

    for (const group of groups) {
      const entries = group.standings?.entries || group.entries || [];
      totalTeams = Math.max(totalTeams, entries.length);
      for (let i = 0; i < entries.length; i++) {
        const name = (entries[i].team?.displayName || entries[i].team?.name || '').toLowerCase();
        if (name.includes(homeTeam.toLowerCase()) || homeTeam.toLowerCase().includes(name)) homePos = i + 1;
        if (name.includes(awayTeam.toLowerCase()) || awayTeam.toLowerCase().includes(name)) awayPos = i + 1;
      }
    }

    if (homePos === null && awayPos === null) {
      return { source: 'Standings', weight: WEIGHTS.espnStandings, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'Teams not found in standings', available: false };
    }

    // Convert position gap to confidence signal
    const gap = (awayPos || totalTeams / 2) - (homePos || totalTeams / 2); // positive = home higher
    const gapNormalized = gap / (totalTeams || 20); // -1 to +1

    let homeWin = 50 + gapNormalized * 30; // Position advantage
    let awayWin = 50 - gapNormalized * 30;
    let draw = 25 + (1 - Math.abs(gapNormalized)) * 10; // Close teams draw more

    homeWin = clamp(Math.round(homeWin), 15, 80);
    awayWin = clamp(Math.round(awayWin), 15, 75);
    draw = clamp(Math.round(draw), 15, 45);

    const total = homeWin + draw + awayWin;
    homeWin = Math.round((homeWin / total) * 100);
    draw = Math.round((draw / total) * 100);
    awayWin = Math.round((awayWin / total) * 100);

    return {
      source: 'Standings',
      weight: WEIGHTS.espnStandings,
      homeWin, draw, awayWin,
      over15: null, // Standings don't predict goals
      over25: null,
      btts: null,
      reasoning: `Home #${homePos || '?'} vs Away #${awayPos || '?'} (gap: ${gap > 0 ? '+' : ''}${gap})`,
      available: true,
    };
  } catch {
    return { source: 'Standings', weight: WEIGHTS.espnStandings, homeWin: null, draw: null, awayWin: null, over15: null, over25: null, btts: null, reasoning: 'Standings fetch failed', available: false };
  }
}

// ─── Weighted Consensus Calculation ──────────────────────────────────────────

function calculateWeightedConsensus(signals: SourceSignal[]): {
  homeWin: number; draw: number; awayWin: number; over15: number; over25: number; btts: number;
} {
  const metrics = ['homeWin', 'draw', 'awayWin', 'over15', 'over25', 'btts'] as const;
  const result: Record<string, number> = {};

  for (const metric of metrics) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      const value = signal[metric];
      if (value === null || !signal.available) continue;
      weightedSum += value * signal.weight;
      totalWeight += signal.weight;
    }

    result[metric] = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  }

  return result as any;
}

// ─── Disagreement Detection ──────────────────────────────────────────────────

function detectDisagreements(signals: SourceSignal[]): string[] {
  const disagreements: string[] = [];
  const available = signals.filter(s => s.available);
  if (available.length < 2) return [];

  // Check 1X2 disagreement
  const homeWins = available.filter(s => s.homeWin !== null && s.homeWin > 55);
  const awayWins = available.filter(s => s.awayWin !== null && s.awayWin > 45);

  if (homeWins.length > 0 && awayWins.length > 0) {
    disagreements.push(
      `${homeWins.map(s => s.source).join(', ')} favor Home, but ${awayWins.map(s => s.source).join(', ')} favor Away`
    );
  }

  // Check over/under disagreement
  const overSources = available.filter(s => s.over25 !== null && s.over25 > 60);
  const underSources = available.filter(s => s.over25 !== null && s.over25 < 40);
  if (overSources.length > 0 && underSources.length > 0) {
    disagreements.push(
      `${overSources.map(s => s.source).join(', ')} expect goals, ${underSources.map(s => s.source).join(', ')} expect low-scoring`
    );
  }

  return disagreements;
}

function getAgreementLevel(signals: SourceSignal[]): 'strong' | 'moderate' | 'weak' | 'conflicting' {
  const available = signals.filter(s => s.available && s.homeWin !== null);
  if (available.length < 2) return 'weak';

  // Calculate variance in home win predictions
  const homeWins = available.map(s => s.homeWin!);
  const mean = homeWins.reduce((a, b) => a + b, 0) / homeWins.length;
  const variance = homeWins.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / homeWins.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 8) return 'strong';       // All sources agree within 8%
  if (stdDev < 15) return 'moderate';     // Reasonable agreement
  if (stdDev < 25) return 'weak';         // Some disagreement
  return 'conflicting';                    // Major disagreement
}

// ─── Pick Generation ─────────────────────────────────────────────────────────

function generatePicks(
  consensus: { homeWin: number; draw: number; awayWin: number; over15: number; over25: number; btts: number },
  signals: SourceSignal[],
  homeTeam: string,
  awayTeam: string
): ConsensusPick[] {
  const picks: ConsensusPick[] = [];
  const available = signals.filter(s => s.available);

  // Home win
  if (consensus.homeWin >= 55) {
    const supporting = available.filter(s => s.homeWin !== null && s.homeWin > 50).map(s => s.source);
    picks.push({
      market: '1X2', pick: 'Home', confidence: consensus.homeWin,
      agreement: supporting.length >= 2 ? 'strong' : supporting.length === 1 ? 'moderate' : 'weak',
      sources: supporting,
      reasoning: [`Consensus: ${consensus.homeWin}%`, `${supporting.length}/${available.length} sources agree`],
    });
  }

  // Away win
  if (consensus.awayWin >= 50) {
    const supporting = available.filter(s => s.awayWin !== null && s.awayWin > 40).map(s => s.source);
    picks.push({
      market: '1X2', pick: 'Away', confidence: consensus.awayWin,
      agreement: supporting.length >= 2 ? 'strong' : supporting.length === 1 ? 'moderate' : 'weak',
      sources: supporting,
      reasoning: [`Consensus: ${consensus.awayWin}%`, `${supporting.length}/${available.length} sources agree`],
    });
  }

  // Over 1.5
  if (consensus.over15 >= 60) {
    const supporting = available.filter(s => s.over15 !== null && s.over15 > 55).map(s => s.source);
    picks.push({
      market: 'Over/Under', pick: 'Over 1.5', confidence: consensus.over15,
      agreement: supporting.length >= 2 ? 'strong' : 'moderate',
      sources: supporting,
      reasoning: [`Consensus: ${consensus.over15}%`],
    });
  }

  // Over 2.5
  if (consensus.over25 >= 55) {
    const supporting = available.filter(s => s.over25 !== null && s.over25 > 50).map(s => s.source);
    picks.push({
      market: 'Over/Under', pick: 'Over 2.5', confidence: consensus.over25,
      agreement: supporting.length >= 2 ? 'strong' : 'moderate',
      sources: supporting,
      reasoning: [`Consensus: ${consensus.over25}%`],
    });
  }

  // BTTS
  if (consensus.btts >= 55) {
    const supporting = available.filter(s => s.btts !== null && s.btts > 50).map(s => s.source);
    picks.push({
      market: 'GG/NG', pick: 'Both Teams Score', confidence: consensus.btts,
      agreement: supporting.length >= 2 ? 'strong' : 'moderate',
      sources: supporting,
      reasoning: [`Consensus: ${consensus.btts}%`],
    });
  }

  return picks.sort((a, b) => b.confidence - a.confidence);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function analyzeRecentForm(team: string, results: any[], isHome: boolean): { winRate: number; avgGoals: number; scoringRate: number; record: string } {
  if (results.length === 0) return { winRate: 50, avgGoals: 1.2, scoringRate: 70, record: '0W-0D-0L' };

  let wins = 0, draws = 0, losses = 0, goals = 0, scored = 0;
  for (const r of results) {
    const teamIsHome = r.home.toLowerCase().includes(team.toLowerCase()) || team.toLowerCase().includes(r.home.toLowerCase());
    const gf = teamIsHome ? r.homeScore : r.awayScore;
    const ga = teamIsHome ? r.awayScore : r.homeScore;
    goals += gf;
    if (gf > 0) scored++;
    if (gf > ga) wins++;
    else if (gf === ga) draws++;
    else losses++;
  }

  const total = results.length;
  return {
    winRate: Math.round((wins / total) * 100),
    avgGoals: Math.round((goals / total) * 100) / 100,
    scoringRate: Math.round((scored / total) * 100),
    record: `${wins}W-${draws}D-${losses}L`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function guessLeagueId(leagueName: string): string | null {
  if (!leagueName) return null;
  const name = leagueName.toLowerCase();
  const map: Record<string, string> = {
    'premier league': 'eng-premier-league', 'la liga': 'esp-la-liga',
    'bundesliga': 'ger-bundesliga', 'serie a': 'ita-serie-a',
    'ligue 1': 'fra-ligue-1', 'eredivisie': 'ned-eredivisie',
    'champions league': 'uefa-champions-league',
  };
  for (const [key, id] of Object.entries(map)) {
    if (name.includes(key)) return id;
  }
  return null;
}
