import React from 'react';
import { getSystemCalibration, getCalibrationSummary, SystemCalibration } from '../engine/calibration';
import { getDatabaseStats } from '../engine/team-database';

interface Props {
  history: any[];
}

export default function CalibrationDashboard({ history }: Props) {
  const cal = getSystemCalibration(history);
  const summary = getCalibrationSummary(history);
  const dbStats = getDatabaseStats();

  if (cal.dataPoints === 0 && dbStats.teams === 0) {
    return (
      <div className="p-3 bg-gray-800 rounded-lg border border-gray-700">
        <span className="text-sm font-medium text-gray-300">System Intelligence</span>
        <p className="text-xs text-gray-500 mt-1">No data yet. Make your first predictions — the system starts learning from pick #1.</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-800 rounded-lg border border-gray-700 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-blue-300">System Intelligence</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          cal.isCalibrated ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
        }`}>
          {cal.isCalibrated ? 'Calibrated' : cal.calibrationGap > 0 ? `Overconfident +${cal.calibrationGap}%` : `Underconfident ${cal.calibrationGap}%`}
        </span>
      </div>

      {/* Summary line */}
      <p className="text-xs text-gray-400">{summary}</p>

      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <span className="text-gray-500 block">Pick Hit</span>
          <span className={`font-bold ${cal.overallPickAccuracy >= 65 ? 'text-green-400' : 'text-yellow-400'}`}>
            {cal.overallPickAccuracy}%
          </span>
        </div>
        <div className="text-center">
          <span className="text-gray-500 block">Slip Win</span>
          <span className={`font-bold ${cal.slipAccuracy >= 50 ? 'text-green-400' : 'text-yellow-400'}`}>
            {cal.slipAccuracy}%
          </span>
        </div>
        <div className="text-center">
          <span className="text-gray-500 block">Chain Avg</span>
          <span className="font-bold text-blue-400">{cal.avgChainLength}</span>
        </div>
        <div className="text-center">
          <span className="text-gray-500 block">Data</span>
          <span className="font-bold text-gray-300">{cal.dataPoints}</span>
        </div>
      </div>

      {/* Calibration buckets */}
      {cal.calibrationBuckets.length > 0 && (
        <div>
          <span className="text-xs text-gray-500 block mb-1">Predicted vs Actual (by score bucket)</span>
          <div className="space-y-1">
            {cal.calibrationBuckets.map(b => (
              <div key={b.bucket} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-12">{b.bucket}</span>
                <div className="flex-1 bg-gray-900 rounded h-3 relative overflow-hidden">
                  <div className="absolute h-full bg-blue-800 opacity-50" style={{ width: `${b.predicted}%` }} />
                  <div className="absolute h-full bg-green-600" style={{ width: `${b.actual}%` }} />
                </div>
                <span className="text-gray-400 w-20 text-right">
                  P:{b.predicted}% A:{b.actual}%
                </span>
                <span className="text-gray-600 w-8">({b.count})</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-1 text-xs text-gray-600">
            <span><span className="inline-block w-2 h-2 bg-blue-800 rounded mr-1" />Predicted</span>
            <span><span className="inline-block w-2 h-2 bg-green-600 rounded mr-1" />Actual</span>
          </div>
        </div>
      )}

      {/* Best/worst market */}
      {(cal.bestMarket || cal.worstMarket) && (
        <div className="flex gap-4 text-xs">
          {cal.bestMarket && <span className="text-green-400">Best: {cal.bestMarket} ({cal.marketAccuracy[cal.bestMarket]?.actual}%)</span>}
          {cal.worstMarket && cal.worstMarket !== cal.bestMarket && (
            <span className="text-red-400">Worst: {cal.worstMarket} ({cal.marketAccuracy[cal.worstMarket]?.actual}%)</span>
          )}
        </div>
      )}

      {/* Sweet spot */}
      {cal.sweetSpot && (
        <div className="text-xs text-gray-400">
          Sweet spot: score <span className="text-green-400 font-medium">{cal.sweetSpot.bracket}</span> → actual <span className="text-green-400 font-medium">{cal.sweetSpot.accuracy}%</span> win rate
        </div>
      )}

      {/* Team Database health */}
      <div className="border-t border-gray-700 pt-2 text-xs text-gray-500 flex justify-between">
        <span>Local DB: {dbStats.teams} teams, {dbStats.totalMatches} matches recorded</span>
        {cal.recordingSince && (
          <span>Since: {new Date(cal.recordingSince).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
