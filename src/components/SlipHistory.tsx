import React, { useState, useRef } from 'react';
import { StakedSlip } from '../App';
import ConfirmDialog from './ConfirmDialog';
import { calculateAccuracy } from '../lib/accuracy';
import MatchStatsModal from './MatchStatsModal';

interface Props {
  history: StakedSlip[];
  onDelete: (slipId: string) => void;
  onClearAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  dailySlipLimit: number;
  onDailyLimitChange: (limit: number) => void;
  todayStaked: number;
}

type Filter = 'all' | 'won' | 'lost';

export default function SlipHistory({ history, onDelete, onClearAll, onExport, onImport, dailySlipLimit, onDailyLimitChange, todayStaked }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedSlip, setExpandedSlip] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statsModal, setStatsModal] = useState<{ sel: any; result: 'pending' | 'won' | 'lost' } | null>(null);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => void;
  }>({ open: false, title: '', message: '', action: () => {} });

  const filtered = filter === 'all' ? history : history.filter(h => h.result === filter);
  const wonCount = history.filter(h => h.result === 'won').length;
  const lostCount = history.filter(h => h.result === 'lost').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-blue-400">Slip History</h2>
        <div className="flex gap-2">
          <button onClick={onExport} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300">
            Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300">
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
          {history.length > 0 && (
            <button
              onClick={() => setConfirm({
                open: true,
                title: 'Clear All History',
                message: 'This will permanently delete all slip history. This cannot be undone.',
                action: onClearAll,
              })}
              className="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 rounded text-red-300"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Daily Limit & Today's Count */}
      <div className="mb-4 p-3 bg-gray-800 rounded-lg flex items-center justify-between">
        <div className="text-xs">
          <span className="text-gray-400">Today: </span>
          <span className={`font-bold ${todayStaked >= dailySlipLimit ? 'text-red-400' : 'text-green-400'}`}>
            {todayStaked}/{dailySlipLimit}
          </span>
          <span className="text-gray-500 ml-1">slips</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Daily limit:</span>
          <input
            type="number"
            min="1"
            max="20"
            value={dailySlipLimit}
            onChange={(e) => onDailyLimitChange(parseInt(e.target.value) || 5)}
            className="w-12 px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-center focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Stats */}
      {history.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-4 p-3 bg-gray-800 rounded-lg text-xs">
            <span className="text-gray-400">
              Total: <span className="text-white font-bold">{history.length}</span>
            </span>
            <span className="text-gray-400">
              Won: <span className="text-green-400 font-bold">{wonCount}</span>
            </span>
            <span className="text-gray-400">
              Lost: <span className="text-red-400 font-bold">{lostCount}</span>
            </span>
            <span className="text-gray-400">
              Win rate: <span className="text-blue-300 font-bold">
                {history.length > 0 ? Math.round((wonCount / history.length) * 100) : 0}%
              </span>
            </span>
          </div>

          {/* Accuracy Breakdown */}
          {(() => {
            const stats = calculateAccuracy(history);
            if (stats.totalPicks < 5) return null;
            return (
              <div className="p-3 bg-gray-800 rounded-lg text-xs">
                <p className="text-gray-400 font-medium mb-2">Pick Accuracy (per individual match)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-gray-500 mb-1">By Market:</p>
                    {Object.entries(stats.byMarket).map(([market, s]) => (
                      <div key={market} className="flex justify-between py-0.5">
                        <span className="text-gray-400 truncate mr-2">{market}</span>
                        <span className={`font-mono ${s.rate >= 70 ? 'text-green-400' : s.rate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {s.rate}% <span className="text-gray-600">({s.won}/{s.total})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">By Odds Range:</p>
                    {Object.entries(stats.byOddsRange).map(([range, s]) => (
                      <div key={range} className="flex justify-between py-0.5">
                        <span className="text-gray-400">{range}</span>
                        <span className={`font-mono ${s.rate >= 70 ? 'text-green-400' : s.rate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {s.rate}% <span className="text-gray-600">({s.won}/{s.total})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-gray-600 mt-2 italic">Overall pick hit rate: {stats.hitRate}% across {stats.totalPicks} picks</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1 mb-4">
        {(['all', 'won', 'lost'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-medium capitalize ${
              filter === f
                ? f === 'won' ? 'bg-green-700 text-white'
                  : f === 'lost' ? 'bg-red-700 text-white'
                  : 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {f} {f === 'won' ? `(${wonCount})` : f === 'lost' ? `(${lostCount})` : `(${history.length})`}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          {history.length === 0 ? 'No history yet. Settled slips will appear here.' : 'No slips match this filter.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((staked) => (
            <div
              key={staked.slip.id}
              className={`bg-gray-800 rounded-lg border overflow-hidden ${
                staked.result === 'won' ? 'border-green-800' : 'border-red-900'
              }`}
            >
              <div
                onClick={() => setExpandedSlip(expandedSlip === staked.slip.id ? null : staked.slip.id)}
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    staked.result === 'won' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                  }`}>
                    {staked.result.toUpperCase()}
                  </span>
                  <span className="text-sm font-bold text-white">
                    {staked.slip.accumulatedOdds.toFixed(2)} odds
                  </span>
                  <span className="text-xs text-gray-400">
                    {staked.slip.selectionCount} picks
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(staked.settledAt || staked.stakedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirm({
                        open: true,
                        title: 'Delete Slip',
                        message: 'Remove this slip from history? This cannot be undone.',
                        action: () => onDelete(staked.slip.id),
                      });
                    }}
                    className="px-1.5 py-0.5 bg-gray-700 hover:bg-red-900 rounded text-xs text-gray-400 hover:text-red-300"
                  >
                    ✗
                  </button>
                  <span className="text-gray-500 text-xs">
                    {expandedSlip === staked.slip.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {expandedSlip === staked.slip.id && (
                <div className="border-t border-gray-700 p-3">
                  <table className="w-full text-xs">
                    <tbody>
                      {staked.slip.selections.map((sel, selIdx) => {
                        const selResult = staked.selectionResults[sel.id];
                        return (
                          <tr key={sel.id} className="border-b border-gray-700 last:border-0">
                            <td className="py-1.5 text-gray-600 w-5">{selIdx + 1}</td>
                            <td className="py-1.5 text-gray-400">{sel.date} {sel.time}</td>
                            <td className="py-1.5 text-gray-200">
                              <div
                                className="cursor-pointer hover:bg-gray-750 rounded px-1 -mx-1"
                                onClick={(e) => { e.stopPropagation(); setStatsModal({ sel, result: selResult }); }}
                              >
                                {sel.homeTeam} v {sel.awayTeam}
                                {sel.score && sel.score.htHome !== undefined && (
                                  <span className="ml-1.5 text-[10px] text-gray-400">(HT {sel.score.htHome}-{sel.score.htAway})</span>
                                )}
                                {sel.score && (
                                  <span className="ml-1 text-[10px] text-blue-400 font-medium">FT {sel.score.home}-{sel.score.away}</span>
                                )}
                                {selResult === 'lost' && (
                                  <span className="ml-1 text-[9px] text-red-500">← slip breaker</span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5">
                              <span className={sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-400'}>
                                {sel.pick} @{sel.odds.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-1.5 text-gray-500">{sel.market}</td>
                            <td className="py-1.5 text-right">
                              {selResult === 'won' ? (
                                <span className="text-green-400">✓</span>
                              ) : selResult === 'lost' ? (
                                <span className="text-red-400">✗</span>
                              ) : (
                                <span className="text-gray-500">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        variant="danger"
        confirmLabel="Yes, delete"
        onConfirm={() => {
          confirm.action();
          setConfirm(c => ({ ...c, open: false }));
        }}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />

      {/* Match Stats Modal */}
      {statsModal && (
        <MatchStatsModal
          selection={statsModal.sel}
          selResult={statsModal.result}
          onClose={() => setStatsModal(null)}
        />
      )}
    </div>
  );
}
