import React from 'react';
import { Slip } from '../engine/types';
import { ScoringResult } from '../engine/scoring';
import { StakedSlip } from '../App';
import { detectCorrelation } from '../engine/scoring';

interface Props {
  slip: Slip;
  scores: Map<string, ScoringResult>;
  history: StakedSlip[];
  onConfirm: () => void;
  onCancel: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  severity: 'ok' | 'warning' | 'danger';
  detail?: string;
}

export default function PreStakeChecklist({ slip, scores, history, onConfirm, onCancel }: Props) {
  const checks = generateChecks(slip, scores, history);
  const hasBlocker = checks.some(c => c.severity === 'danger' && !c.passed);
  const warningCount = checks.filter(c => !c.passed).length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-600 max-w-md w-full p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-bold text-blue-300">Pre-Stake Checklist</h3>
          <span className="text-xs text-gray-500">{slip.accumulatedOdds.toFixed(2)} odds • {slip.selectionCount} picks</span>
        </div>

        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={i} className={`flex items-start gap-2 p-2 rounded text-xs ${
              check.passed ? 'bg-green-900/20' : check.severity === 'danger' ? 'bg-red-900/30' : 'bg-yellow-900/20'
            }`}>
              <span className="mt-0.5">
                {check.passed ? '✓' : check.severity === 'danger' ? '✗' : '⚠'}
              </span>
              <div>
                <span className={check.passed ? 'text-green-300' : check.severity === 'danger' ? 'text-red-300' : 'text-yellow-300'}>
                  {check.label}
                </span>
                {check.detail && <span className="text-gray-500 block">{check.detail}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-gray-300"
          >
            Cancel
          </button>
          {hasBlocker ? (
            <button disabled className="flex-1 py-2 bg-gray-600 rounded text-xs font-medium text-gray-500 cursor-not-allowed">
              Blocked ({warningCount} issues)
            </button>
          ) : warningCount > 0 ? (
            <button
              onClick={onConfirm}
              className="flex-1 py-2 bg-yellow-700 hover:bg-yellow-600 rounded text-xs font-medium text-white"
            >
              Proceed Anyway ({warningCount} warnings)
            </button>
          ) : (
            <button
              onClick={onConfirm}
              className="flex-1 py-2 bg-green-600 hover:bg-green-700 rounded text-xs font-medium text-white"
            >
              All Clear — Stake
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function generateChecks(slip: Slip, scores: Map<string, ScoringResult>, history: StakedSlip[]): CheckItem[] {
  const checks: CheckItem[] = [];

  // 1. All picks have data
  const noDataCount = slip.selections.filter(s => !scores.get(s.id)?.hasData).length;
  checks.push({
    label: 'All picks backed by data',
    passed: noDataCount === 0,
    severity: noDataCount >= 2 ? 'danger' : 'warning',
    detail: noDataCount > 0 ? `${noDataCount} pick(s) have no statistical backing` : undefined,
  });

  // 2. Average confidence above threshold
  const avgScore = slip.selections.reduce((sum, s) => sum + (scores.get(s.id)?.score || 0), 0) / slip.selectionCount;
  checks.push({
    label: `Average confidence ≥ 60% (current: ${Math.round(avgScore)}%)`,
    passed: avgScore >= 60,
    severity: avgScore < 50 ? 'danger' : 'warning',
  });

  // 3. No low-confidence pick (< 45)
  const lowConfPicks = slip.selections.filter(s => (scores.get(s.id)?.score || 0) < 45);
  checks.push({
    label: 'No very weak picks (< 45 confidence)',
    passed: lowConfPicks.length === 0,
    severity: 'warning',
    detail: lowConfPicks.length > 0 ? `${lowConfPicks.map(s => s.homeTeam).join(', ')}` : undefined,
  });

  // 4. Correlation check
  const { penalty, warnings } = detectCorrelation(slip.selections);
  checks.push({
    label: 'No correlated picks (same market + same day cluster)',
    passed: penalty === 0,
    severity: 'warning',
    detail: warnings.length > 0 ? warnings[0] : undefined,
  });

  // 5. No repeat losers from history
  const repeatLosers = findRepeatLosers(slip, history);
  checks.push({
    label: 'No repeat losing patterns',
    passed: repeatLosers.length === 0,
    severity: 'warning',
    detail: repeatLosers.length > 0 ? repeatLosers.join('; ') : undefined,
  });

  // 6. Slip has ≤ 3 picks (minimization philosophy)
  checks.push({
    label: 'Selection minimized (≤ 3 picks)',
    passed: slip.selectionCount <= 3,
    severity: 'warning',
    detail: slip.selectionCount > 3 ? `${slip.selectionCount} picks — more failure points` : undefined,
  });

  // 7. No same kick-off time (risk of correlated outcomes)
  const kickoffs = slip.selections.map(s => new Date(s.kickOffDateTime).getTime());
  const sameTime = kickoffs.some((k, i) => kickoffs.some((k2, j) => i !== j && Math.abs(k - k2) < 15 * 60 * 1000));
  checks.push({
    label: 'No overlapping kick-off times (< 15 min)',
    passed: !sameTime,
    severity: 'warning',
    detail: sameTime ? 'Some matches kick off at nearly the same time' : undefined,
  });

  return checks;
}

function findRepeatLosers(slip: Slip, history: StakedSlip[]): string[] {
  const warnings: string[] = [];
  const lostPicks: Record<string, number> = {};

  // Count losses per team+market combo in history
  for (const staked of history.filter(h => h.result === 'lost').slice(0, 50)) {
    for (const sel of staked.slip.selections) {
      if (staked.selectionResults[sel.id] === 'lost') {
        const key = `${sel.homeTeam.toLowerCase()}|${sel.marketType}`;
        lostPicks[key] = (lostPicks[key] || 0) + 1;
      }
    }
  }

  // Check current slip against loss history
  for (const sel of slip.selections) {
    const key = `${sel.homeTeam.toLowerCase()}|${sel.marketType}`;
    if (lostPicks[key] && lostPicks[key] >= 2) {
      warnings.push(`${sel.homeTeam} (${sel.marketType}) lost ${lostPicks[key]}x before`);
    }
  }

  return warnings;
}
