/**
 * Paper Trading Mode
 *
 * Generates slips, settles against actual results — no real money.
 * Tracks three accuracy levels independently:
 *   1. Pick accuracy:  individual selections won/lost
 *   2. Slip accuracy:  entire accumulators won/lost
 *   3. Chain survival: simulated chain step progression
 *
 * This reveals the system's TRUE win rate without financial risk.
 * "The system discovers its win rate, doesn't target a number."
 */

const PAPER_TRADES_KEY = 'rollover_paper_trades';
const PAPER_CHAINS_KEY = 'rollover_paper_chains';
const PAPER_STATS_KEY = 'rollover_paper_stats';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaperSlip {
  id: string;
  selections: PaperSelection[];
  accumulatedOdds: number;
  qualityScore: number;
  selectionCount: number;
  createdAt: string;           // ISO timestamp
  settledAt?: string;          // ISO timestamp
  result: 'pending' | 'won' | 'lost';
  chainId?: string;            // Paper chain link
}

export interface PaperSelection {
  id: string;
  homeTeam: string;
  awayTeam: string;
  pick: string;
  pickCategory: string;
  marketType: string;
  odds: number;
  kickOff: string;             // ISO date
  confidenceScore: number;     // Score at time of paper stake
  result: 'pending' | 'won' | 'lost';
}

export interface PaperChain {
  id: string;
  label: string;
  startingStake: number;
  currentStep: number;
  currentStake: number;
  status: 'active' | 'broken' | 'completed';
  startedAt: string;
  endedAt?: string;
  maxStepReached: number;
}

export interface PaperStats {
  // Pick level
  totalPicks: number;
  picksWon: number;
  picksLost: number;
  pickAccuracy: number;        // 0-100

  // Slip level
  totalSlips: number;
  slipsWon: number;
  slipsLost: number;
  slipAccuracy: number;        // 0-100

  // Chain level
  totalChains: number;
  avgChainLength: number;
  maxChainLength: number;
  chainSurvivalRate: number;   // % of chains that reached step 3+

  // By market type
  byMarket: Record<string, { picks: number; won: number; rate: number }>;

  // By confidence bracket
  byConfidence: Record<string, { picks: number; won: number; rate: number }>;

  // Timeline
  lastUpdated: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a paper trade slip from a generated slip.
 */
export function createPaperSlip(
  slipId: string,
  selections: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    pick: string;
    pickCategory: string;
    marketType: string;
    odds: number;
    kickOffDateTime: Date;
    confidenceScore: number;
  }>,
  accumulatedOdds: number,
  qualityScore: number,
  chainId?: string
): PaperSlip {
  const paperSlip: PaperSlip = {
    id: slipId,
    selections: selections.map(s => ({
      id: s.id,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      pick: s.pick,
      pickCategory: s.pickCategory,
      marketType: s.marketType,
      odds: s.odds,
      kickOff: s.kickOffDateTime.toISOString(),
      confidenceScore: s.confidenceScore,
      result: 'pending',
    })),
    accumulatedOdds,
    qualityScore,
    selectionCount: selections.length,
    createdAt: new Date().toISOString(),
    result: 'pending',
    chainId,
  };

  const trades = loadPaperTrades();
  trades.push(paperSlip);
  savePaperTrades(trades);
  return paperSlip;
}

/**
 * Settle a paper pick result.
 */
export function settlePaperPick(slipId: string, selectionId: string, result: 'won' | 'lost'): void {
  const trades = loadPaperTrades();
  const slip = trades.find(t => t.id === slipId);
  if (!slip) return;

  const sel = slip.selections.find(s => s.id === selectionId);
  if (sel) sel.result = result;

  // Check if slip is fully settled
  if (result === 'lost') {
    // One loss = slip lost (accumulator rules)
    slip.result = 'lost';
    slip.settledAt = new Date().toISOString();
    // Mark remaining pending picks as unknown (slip already lost)
    slip.selections.forEach(s => { if (s.result === 'pending') s.result = 'lost'; });

    // Break paper chain if linked
    if (slip.chainId) breakPaperChain(slip.chainId);
  } else {
    const allWon = slip.selections.every(s => s.result === 'won');
    if (allWon) {
      slip.result = 'won';
      slip.settledAt = new Date().toISOString();

      // Advance paper chain if linked
      if (slip.chainId) advancePaperChain(slip.chainId, slip.accumulatedOdds);
    }
  }

  savePaperTrades(trades);
  recalculateStats();
}

/**
 * Settle entire paper slip at once.
 */
export function settlePaperSlip(slipId: string, result: 'won' | 'lost'): void {
  const trades = loadPaperTrades();
  const slip = trades.find(t => t.id === slipId);
  if (!slip) return;

  slip.result = result;
  slip.settledAt = new Date().toISOString();
  slip.selections.forEach(s => { s.result = result; });

  if (result === 'won' && slip.chainId) {
    advancePaperChain(slip.chainId, slip.accumulatedOdds);
  } else if (result === 'lost' && slip.chainId) {
    breakPaperChain(slip.chainId);
  }

  savePaperTrades(trades);
  recalculateStats();
}

/**
 * Create a paper chain for simulation.
 */
export function createPaperChain(label: string, startingStake: number): PaperChain {
  const chain: PaperChain = {
    id: crypto.randomUUID(),
    label,
    startingStake,
    currentStep: 0,
    currentStake: startingStake,
    status: 'active',
    startedAt: new Date().toISOString(),
    maxStepReached: 0,
  };

  const chains = loadPaperChains();
  chains.push(chain);
  savePaperChains(chains);
  return chain;
}

function advancePaperChain(chainId: string, odds: number): void {
  const chains = loadPaperChains();
  const chain = chains.find(c => c.id === chainId);
  if (!chain || chain.status !== 'active') return;

  chain.currentStep++;
  chain.currentStake *= odds;
  chain.maxStepReached = Math.max(chain.maxStepReached, chain.currentStep);
  savePaperChains(chains);
}

function breakPaperChain(chainId: string): void {
  const chains = loadPaperChains();
  const chain = chains.find(c => c.id === chainId);
  if (!chain || chain.status !== 'active') return;

  chain.status = 'broken';
  chain.endedAt = new Date().toISOString();
  savePaperChains(chains);
}

/**
 * Get all paper trades (pending + settled).
 */
export function getPaperTrades(): PaperSlip[] {
  return loadPaperTrades();
}

/**
 * Get pending paper trades (not yet settled).
 */
export function getPendingPaperTrades(): PaperSlip[] {
  return loadPaperTrades().filter(t => t.result === 'pending');
}

/**
 * Get paper chains.
 */
export function getPaperChains(): PaperChain[] {
  return loadPaperChains();
}

/**
 * Get computed paper trading stats.
 */
export function getPaperStats(): PaperStats {
  const cached = loadPaperStats();
  if (cached) return cached;
  return recalculateStats();
}

/**
 * Recalculate all paper trading statistics from raw data.
 */
export function recalculateStats(): PaperStats {
  const trades = loadPaperTrades();
  const chains = loadPaperChains();

  const settled = trades.filter(t => t.result !== 'pending');

  // Pick level
  let totalPicks = 0, picksWon = 0, picksLost = 0;
  const byMarket: Record<string, { picks: number; won: number }> = {};
  const byConfidence: Record<string, { picks: number; won: number }> = {};

  for (const slip of settled) {
    for (const sel of slip.selections) {
      if (sel.result === 'pending') continue;
      totalPicks++;
      if (sel.result === 'won') picksWon++;
      else picksLost++;

      // By market
      if (!byMarket[sel.marketType]) byMarket[sel.marketType] = { picks: 0, won: 0 };
      byMarket[sel.marketType].picks++;
      if (sel.result === 'won') byMarket[sel.marketType].won++;

      // By confidence bracket
      const bracket = sel.confidenceScore < 50 ? '<50' :
                      sel.confidenceScore < 60 ? '50-59' :
                      sel.confidenceScore < 70 ? '60-69' :
                      sel.confidenceScore < 80 ? '70-79' : '80+';
      if (!byConfidence[bracket]) byConfidence[bracket] = { picks: 0, won: 0 };
      byConfidence[bracket].picks++;
      if (sel.result === 'won') byConfidence[bracket].won++;
    }
  }

  // Slip level
  const slipsWon = settled.filter(s => s.result === 'won').length;
  const slipsLost = settled.filter(s => s.result === 'lost').length;

  // Chain level
  const completedChains = chains.filter(c => c.status !== 'active');
  const avgChainLength = completedChains.length > 0
    ? Math.round((completedChains.reduce((sum, c) => sum + c.maxStepReached, 0) / completedChains.length) * 10) / 10
    : 0;
  const maxChainLength = chains.length > 0 ? Math.max(...chains.map(c => c.maxStepReached)) : 0;
  const chainsSurvivedTo3 = completedChains.filter(c => c.maxStepReached >= 3).length;

  const stats: PaperStats = {
    totalPicks,
    picksWon,
    picksLost,
    pickAccuracy: totalPicks > 0 ? Math.round((picksWon / totalPicks) * 100) : 0,
    totalSlips: settled.length,
    slipsWon,
    slipsLost,
    slipAccuracy: settled.length > 0 ? Math.round((slipsWon / settled.length) * 100) : 0,
    totalChains: chains.length,
    avgChainLength,
    maxChainLength,
    chainSurvivalRate: completedChains.length > 0 ? Math.round((chainsSurvivedTo3 / completedChains.length) * 100) : 0,
    byMarket: Object.fromEntries(
      Object.entries(byMarket).map(([k, v]) => [k, { ...v, rate: Math.round((v.won / v.picks) * 100) }])
    ),
    byConfidence: Object.fromEntries(
      Object.entries(byConfidence).map(([k, v]) => [k, { ...v, rate: Math.round((v.won / v.picks) * 100) }])
    ),
    lastUpdated: new Date().toISOString(),
  };

  savePaperStats(stats);
  return stats;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function loadPaperTrades(): PaperSlip[] {
  try {
    const data = localStorage.getItem(PAPER_TRADES_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function savePaperTrades(trades: PaperSlip[]): void {
  try {
    // Keep max 500 trades (prune oldest settled)
    if (trades.length > 500) {
      const pending = trades.filter(t => t.result === 'pending');
      const settled = trades.filter(t => t.result !== 'pending')
        .sort((a, b) => (b.settledAt || '').localeCompare(a.settledAt || ''));
      trades = [...pending, ...settled.slice(0, 500 - pending.length)];
    }
    localStorage.setItem(PAPER_TRADES_KEY, JSON.stringify(trades));
  } catch (e) { console.error('Failed to save paper trades:', e); }
}

function loadPaperChains(): PaperChain[] {
  try {
    const data = localStorage.getItem(PAPER_CHAINS_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function savePaperChains(chains: PaperChain[]): void {
  try {
    localStorage.setItem(PAPER_CHAINS_KEY, JSON.stringify(chains));
  } catch (e) { console.error('Failed to save paper chains:', e); }
}

function loadPaperStats(): PaperStats | null {
  try {
    const data = localStorage.getItem(PAPER_STATS_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function savePaperStats(stats: PaperStats): void {
  try {
    localStorage.setItem(PAPER_STATS_KEY, JSON.stringify(stats));
  } catch { /* ignore */ }
}
