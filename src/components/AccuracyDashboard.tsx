/**
 * AccuracyDashboard — Shows prediction accuracy stats, best leagues, market breakdown.
 * Accessible from the main dashboard or a dedicated tab.
 */

import React, { useState, useEffect } from 'react';
import {
  getAccuracyStats,
  getRecentPredictions,
  getPredictionCounts,
  settlePendingPredictions,
  AccuracyStats,
  TrackedPrediction,
} from '../engine/prediction-tracker';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AccuracyDashboard({ open, onClose }: Props) {
  const [stats, setStats] = useState<AccuracyStats | null>(null);
  const [recent, setRecent] = useState<TrackedPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([getAccuracyStats(), getRecentPredictions(30)]);
      setStats(s);
      setRecent(r);
    } catch (e) {
      console.warn('[AccuracyDashboard] Failed to load:', e);
    }
    setLoading(false);
  }

  async function handleSettle() {
    setSettling(true);
    try {
      const result = await settlePendingPredictions();
      console.log(`Settled: ${result.settled} (${result.won} won, ${result.lost} lost)`);
      await loadData();
    } catch {}
    setSettling(false);
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-4 md:inset-x-16 md:inset-y-8 z-50 bg-gray-900 rounded-xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
          <h2 className="text-lg font-bold text-blue-400">Prediction Accuracy</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSettle}
              disabled={settling}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
            >
              {settling ? 'Settling...' : 'Settle Now'}
            </button>
            <button onClick={onClose} className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-lg">
              &#10005;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12"><p className="text-sm text-gray-400 animate-pulse">Loading stats...</p></div>
          ) : !stats || stats.total === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400">No predictions tracked yet.</p>
              <p className="text-xs text-gray-500 mt-2">Scout fixtures and they'll automatically be logged here. Results are settled from ESPN every 30 minutes.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Overall Stats */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="Total Predictions" value={stats.total.toString()} />
                <StatCard label="Hit Rate" value={`${stats.hitRate}%`} color={stats.hitRate >= 60 ? 'green' : stats.hitRate >= 45 ? 'yellow' : 'red'} />
                <StatCard label="Won" value={stats.won.toString()} color="green" />
                <StatCard label="Pending" value={stats.pending.toString()} color="blue" />
              </div>

              {/* Confidence Breakdown */}
              <section>
                <h3 className="text-sm font-bold text-gray-200 mb-2">By Confidence Level</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-gray-800 rounded">
                    <div className="text-xs text-gray-400">High (75%+)</div>
                    <div className="text-lg font-bold text-green-400">{stats.byConfidenceRange.high.hitRate}%</div>
                    <div className="text-[10px] text-gray-500">{stats.byConfidenceRange.high.won}/{stats.byConfidenceRange.high.total} won</div>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <div className="text-xs text-gray-400">Medium (55-74%)</div>
                    <div className="text-lg font-bold text-yellow-400">{stats.byConfidenceRange.medium.hitRate}%</div>
                    <div className="text-[10px] text-gray-500">{stats.byConfidenceRange.medium.won}/{stats.byConfidenceRange.medium.total} won</div>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <div className="text-xs text-gray-400">Low (&lt;55%)</div>
                    <div className="text-lg font-bold text-gray-400">{stats.byConfidenceRange.low.hitRate}%</div>
                    <div className="text-[10px] text-gray-500">{stats.byConfidenceRange.low.won}/{stats.byConfidenceRange.low.total} won</div>
                  </div>
                </div>
              </section>

              {/* By Market */}
              <section>
                <h3 className="text-sm font-bold text-gray-200 mb-2">By Market / Pick Type</h3>
                <div className="space-y-1">
                  {Object.entries(stats.byMarket)
                    .sort((a, b) => b[1].hitRate - a[1].hitRate)
                    .map(([market, data]) => (
                      <div key={market} className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded">
                        <span className="text-xs text-gray-300">{market}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-gray-500">{data.won}/{data.total}</span>
                          <span className={`text-xs font-bold ${data.hitRate >= 60 ? 'text-green-400' : data.hitRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {data.hitRate}%
                          </span>
                          <div className="w-16 h-1.5 bg-gray-700 rounded overflow-hidden">
                            <div className={`h-full rounded ${data.hitRate >= 60 ? 'bg-green-500' : data.hitRate >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${data.hitRate}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </section>

              {/* By League */}
              <section>
                <h3 className="text-sm font-bold text-gray-200 mb-2">By League (Best Performing)</h3>
                <div className="space-y-1">
                  {Object.entries(stats.byLeague)
                    .filter(([, d]) => d.total >= 3) // Min 3 predictions
                    .sort((a, b) => b[1].hitRate - a[1].hitRate)
                    .slice(0, 10)
                    .map(([league, data]) => (
                      <div key={league} className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded">
                        <span className="text-xs text-gray-300 truncate max-w-[150px]">{league}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-gray-500">{data.won}/{data.total}</span>
                          <span className={`text-xs font-bold ${data.hitRate >= 60 ? 'text-green-400' : data.hitRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {data.hitRate}%
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </section>

              {/* Recent Trend */}
              <section>
                <h3 className="text-sm font-bold text-gray-200 mb-2">10-Day Trend</h3>
                <div className="flex items-end gap-1 h-12">
                  {stats.recentTrend.map((rate, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      {rate >= 0 ? (
                        <div
                          className={`w-full rounded-t ${rate >= 60 ? 'bg-green-600' : rate >= 45 ? 'bg-yellow-600' : 'bg-red-600'}`}
                          style={{ height: `${Math.max(4, rate * 0.48)}px` }}
                          title={`${rate}%`}
                        />
                      ) : (
                        <div className="w-full h-1 bg-gray-700 rounded" title="No data" />
                      )}
                      <span className="text-[8px] text-gray-600 mt-0.5">{i === 0 ? 'Today' : `-${i}d`}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Recent Predictions */}
              <section>
                <h3 className="text-sm font-bold text-gray-200 mb-2">Recent Predictions</h3>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {recent.slice(0, 20).map(p => (
                    <div key={p.id} className="flex items-center justify-between px-2 py-1 bg-gray-800 rounded text-[10px]">
                      <div className="flex items-center gap-2 flex-1">
                        <span className={`w-4 h-4 flex items-center justify-center rounded text-[8px] font-bold ${
                          p.status === 'won' ? 'bg-green-700 text-green-200' :
                          p.status === 'lost' ? 'bg-red-700 text-red-200' :
                          'bg-gray-700 text-gray-400'
                        }`}>{p.status === 'won' ? 'W' : p.status === 'lost' ? 'L' : '?'}</span>
                        <span className="text-gray-300 truncate max-w-[140px]">{p.homeTeam} v {p.awayTeam}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{p.pick}</span>
                        <span className="text-gray-400">{p.confidence}%</span>
                        {p.homeScore !== null && <span className="text-gray-500">{p.homeScore}-{p.awayScore}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, color = 'gray' }: { label: string; value: string; color?: string }) {
  const colorClass = color === 'green' ? 'text-green-400' : color === 'yellow' ? 'text-yellow-400' : color === 'red' ? 'text-red-400' : color === 'blue' ? 'text-blue-400' : 'text-gray-200';
  return (
    <div className="p-3 bg-gray-800 rounded text-center">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}
