import React, { useState, useEffect } from 'react';
import { Slip } from '../engine/types';
import {
  createPaperSlip, settlePaperPick, settlePaperSlip,
  getPendingPaperTrades, getPaperStats, PaperSlip, PaperStats
} from '../engine/paper-trading';
import { ScoringResult } from '../engine/scoring';

interface Props {
  generatedSlips: Slip[];
  selectionScores: Map<string, ScoringResult>;
}

export default function PaperTrading({ generatedSlips, selectionScores }: Props) {
  const [paperSlips, setPaperSlips] = useState<PaperSlip[]>(() => getPendingPaperTrades());
  const [stats, setStats] = useState<PaperStats | null>(null);
  const [showStats, setShowStats] = useState(true);

  useEffect(() => { setStats(getPaperStats()); }, [paperSlips]);

  function handlePaperStake(slip: Slip) {
    const selections = slip.selections.map(s => ({
      ...s,
      confidenceScore: selectionScores.get(s.id)?.score || 50,
    }));
    createPaperSlip(slip.id, selections, slip.accumulatedOdds, slip.qualityScore);
    setPaperSlips(getPendingPaperTrades());
  }

  function handleSettlePick(slipId: string, selectionId: string, result: 'won' | 'lost') {
    settlePaperPick(slipId, selectionId, result);
    setPaperSlips(getPendingPaperTrades());
  }

  function handleSettleSlip(slipId: string, result: 'won' | 'lost') {
    settlePaperSlip(slipId, result);
    setPaperSlips(getPendingPaperTrades());
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="text-lg font-bold mb-4 text-purple-400">Paper Trading</h2>
      <p className="text-xs text-gray-500 mb-4">Shadow mode — track accuracy without real money. Settle against actual results.</p>

      {/* Stats Panel */}
      {stats && stats.totalSlips > 0 && (
        <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-purple-900">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-purple-300">Paper Stats</span>
            <button onClick={() => setShowStats(!showStats)} className="text-xs text-gray-500">{showStats ? 'Hide' : 'Show'}</button>
          </div>
          {showStats && (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-gray-500 block">Pick Accuracy</span>
                <span className={`text-lg font-bold ${stats.pickAccuracy >= 70 ? 'text-green-400' : stats.pickAccuracy >= 55 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {stats.pickAccuracy}%
                </span>
                <span className="text-gray-600 block">{stats.picksWon}W / {stats.picksLost}L ({stats.totalPicks} picks)</span>
              </div>
              <div>
                <span className="text-gray-500 block">Slip Accuracy</span>
                <span className={`text-lg font-bold ${stats.slipAccuracy >= 55 ? 'text-green-400' : stats.slipAccuracy >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {stats.slipAccuracy}%
                </span>
                <span className="text-gray-600 block">{stats.slipsWon}W / {stats.slipsLost}L ({stats.totalSlips} slips)</span>
              </div>
              <div>
                <span className="text-gray-500 block">Chain Survival</span>
                <span className="text-lg font-bold text-blue-400">{stats.avgChainLength}</span>
                <span className="text-gray-600 block">avg steps (max {stats.maxChainLength})</span>
              </div>
              {Object.keys(stats.byMarket).length > 0 && (
                <div className="col-span-3 mt-2 border-t border-gray-700 pt-2">
                  <span className="text-gray-500 text-xs block mb-1">By Market</span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.byMarket).map(([market, data]) => (
                      <span key={market} className="text-xs px-1.5 py-0.5 bg-gray-700 rounded">
                        {market}: <span className={data.rate >= 60 ? 'text-green-400' : 'text-gray-300'}>{data.rate}%</span>
                        <span className="text-gray-600"> ({data.picks})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Paper Stake from Generated */}
      {generatedSlips.length > 0 && (
        <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
          <span className="text-xs text-gray-400 block mb-2">Paper-stake a generated slip (no real money):</span>
          <div className="flex flex-wrap gap-2">
            {generatedSlips.slice(0, 5).map((slip, i) => (
              <button
                key={slip.id}
                onClick={() => handlePaperStake(slip)}
                className="px-2 py-1 bg-purple-800 hover:bg-purple-700 rounded text-xs text-purple-200"
              >
                Slip #{i + 1} ({slip.accumulatedOdds.toFixed(2)} odds, {slip.selectionCount}p)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pending Paper Slips */}
      {paperSlips.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-300">Pending Paper Slips ({paperSlips.length})</h3>
          {paperSlips.map(slip => (
            <div key={slip.id} className="bg-gray-800 rounded border border-gray-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  {slip.accumulatedOdds.toFixed(2)} odds • {slip.selectionCount} picks • Q:{slip.qualityScore}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => handleSettleSlip(slip.id, 'won')} className="px-2 py-0.5 bg-green-800 hover:bg-green-700 rounded text-xs text-green-300">All Won</button>
                  <button onClick={() => handleSettleSlip(slip.id, 'lost')} className="px-2 py-0.5 bg-red-900 hover:bg-red-800 rounded text-xs text-red-300">Slip Lost</button>
                </div>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {slip.selections.map(sel => (
                    <tr key={sel.id} className="border-b border-gray-700 last:border-0">
                      <td className="py-1 text-gray-400">{sel.homeTeam} v {sel.awayTeam}</td>
                      <td className="py-1 text-green-400">{sel.pick} @{sel.odds.toFixed(2)}</td>
                      <td className="py-1 text-gray-500">
                        <span className="px-1 bg-gray-700 rounded">{sel.confidenceScore}</span>
                      </td>
                      <td className="py-1 text-right">
                        {sel.result === 'pending' ? (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => handleSettlePick(slip.id, sel.id, 'won')} className="px-1 bg-green-900 rounded text-green-300">✓</button>
                            <button onClick={() => handleSettlePick(slip.id, sel.id, 'lost')} className="px-1 bg-red-900 rounded text-red-300">✗</button>
                          </div>
                        ) : (
                          <span className={sel.result === 'won' ? 'text-green-400' : 'text-red-400'}>{sel.result === 'won' ? '✓' : '✗'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {paperSlips.length === 0 && (!stats || stats.totalSlips === 0) && (
        <div className="text-center py-8 text-gray-500 text-sm">
          No paper trades yet. Generate slips and click "Paper Stake" above to start tracking without real money.
        </div>
      )}
    </div>
  );
}
