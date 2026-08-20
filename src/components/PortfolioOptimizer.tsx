import React, { useState } from 'react';
import { Slip } from '../engine/types';
import { optimizePortfolio, DEFAULT_PORTFOLIO_CONFIG, PortfolioResult } from '../engine/portfolio-optimizer';
import { ScoringResult } from '../engine/scoring';

interface Props {
  slips: Slip[];
  selectionScores: Map<string, ScoringResult>;
  onApplyPortfolio: (optimizedSlips: Slip[]) => void;
}

export default function PortfolioOptimizer({ slips, selectionScores, onApplyPortfolio }: Props) {
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [maxSlips, setMaxSlips] = useState(10);
  const [optimizing, setOptimizing] = useState(false);

  function handleOptimize() {
    setOptimizing(true);
    setTimeout(() => {
      const scores = new Map<string, number>();
      for (const [id, sr] of selectionScores) scores.set(id, sr.score);

      const portfolio = optimizePortfolio(slips, scores, { ...DEFAULT_PORTFOLIO_CONFIG, maxSlips });
      setResult(portfolio);
      setOptimizing(false);
    }, 50);
  }

  function handleApply() {
    if (result) onApplyPortfolio(result.slips);
  }

  if (slips.length < 3) return null;

  return (
    <div className="p-3 bg-gray-800 rounded-lg border border-blue-900 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-blue-300">Portfolio Optimizer</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">
            Max:
            <input
              type="number" min={3} max={50} value={maxSlips}
              onChange={e => setMaxSlips(parseInt(e.target.value) || 10)}
              className="w-10 ml-1 px-1 bg-gray-900 border border-gray-600 rounded text-xs text-center"
            />
          </label>
          <button
            onClick={handleOptimize}
            disabled={optimizing}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-xs font-medium"
          >
            {optimizing ? 'Optimizing...' : `Optimize (${slips.length} → ${maxSlips})`}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-gray-500 block">Selected</span>
              <span className="text-white font-bold">{result.slips.length} slips</span>
            </div>
            <div>
              <span className="text-gray-500 block">Diversity</span>
              <span className={`font-bold ${result.diversityScore >= 70 ? 'text-green-400' : result.diversityScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {result.diversityScore}/100
              </span>
            </div>
            <div>
              <span className="text-gray-500 block">Score</span>
              <span className="text-blue-300 font-bold">{result.totalScore.toFixed(0)}</span>
            </div>
          </div>

          {result.exposureWarnings.length > 0 && (
            <div className="p-2 bg-yellow-900/30 border border-yellow-800 rounded text-xs text-yellow-300">
              {result.exposureWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <button
            onClick={handleApply}
            className="w-full py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium text-white"
          >
            Apply Optimized Portfolio ({result.slips.length} slips)
          </button>
        </div>
      )}
    </div>
  );
}
