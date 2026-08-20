import { StakedSlip } from '../App';

export interface AccuracyStats {
  totalPicks: number;
  wonPicks: number;
  lostPicks: number;
  hitRate: number;
  byMarket: Record<string, { total: number; won: number; rate: number }>;
  byOddsRange: Record<string, { total: number; won: number; rate: number }>;
}

/**
 * Calculate accuracy stats from settled history
 */
export function calculateAccuracy(history: StakedSlip[]): AccuracyStats {
  let totalPicks = 0;
  let wonPicks = 0;
  let lostPicks = 0;
  const byMarket: Record<string, { total: number; won: number }> = {};
  const byOddsRange: Record<string, { total: number; won: number }> = {};

  for (const staked of history) {
    for (const sel of staked.slip.selections) {
      const selResult = staked.selectionResults[sel.id];
      if (selResult === 'pending') continue;

      totalPicks++;
      const isWon = selResult === 'won';
      if (isWon) wonPicks++;
      else lostPicks++;

      // By market
      const market = sel.market || 'Unknown';
      if (!byMarket[market]) byMarket[market] = { total: 0, won: 0 };
      byMarket[market].total++;
      if (isWon) byMarket[market].won++;

      // By odds range
      const oddsKey = sel.odds < 1.25 ? '1.00-1.24' :
                      sel.odds < 1.40 ? '1.25-1.39' :
                      sel.odds < 1.60 ? '1.40-1.59' :
                      sel.odds < 2.00 ? '1.60-1.99' : '2.00+';
      if (!byOddsRange[oddsKey]) byOddsRange[oddsKey] = { total: 0, won: 0 };
      byOddsRange[oddsKey].total++;
      if (isWon) byOddsRange[oddsKey].won++;
    }
  }

  const hitRate = totalPicks > 0 ? Math.round((wonPicks / totalPicks) * 100) : 0;

  const marketStats: Record<string, { total: number; won: number; rate: number }> = {};
  for (const [k, v] of Object.entries(byMarket)) {
    marketStats[k] = { ...v, rate: Math.round((v.won / v.total) * 100) };
  }

  const oddsStats: Record<string, { total: number; won: number; rate: number }> = {};
  for (const [k, v] of Object.entries(byOddsRange)) {
    oddsStats[k] = { ...v, rate: Math.round((v.won / v.total) * 100) };
  }

  return {
    totalPicks,
    wonPicks,
    lostPicks,
    hitRate,
    byMarket: marketStats,
    byOddsRange: oddsStats,
  };
}
