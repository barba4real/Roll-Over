/**
 * FormTable — Reusable component showing team recent results.
 *
 * Displays a list of recent matches with:
 * - W/D/L colored badges
 * - Score
 * - Opponent name
 * - Date
 * - Competition filter (all/league/cups)
 *
 * Used by MatchAnalysis for both Home Form and Away Form tabs.
 */

import React, { useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FormMatch {
  date: string;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
  league?: string;
  isHome: boolean;
}

interface Props {
  team: string;
  matches: FormMatch[];
  title: string;       // e.g. "Home Form" or "Away Form"
  showFilters?: boolean;
  allMatches?: FormMatch[];  // All matches (home+away) for venue toggle
  nextFixtures?: { opponent: string; date: string; isHome: boolean; league?: string }[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FormTable({ team, matches, title, showFilters = true, allMatches, nextFixtures }: Props) {
  const [limit, setLimit] = useState(10);
  const [venueFilter, setVenueFilter] = useState<'all' | 'home' | 'away'>('all');

  // Apply venue filter if allMatches is provided
  const baseMatches = allMatches ? (
    venueFilter === 'all' ? allMatches :
    venueFilter === 'home' ? allMatches.filter(m => m.isHome) :
    allMatches.filter(m => !m.isHome)
  ) : matches;

  const visibleMatches = baseMatches.slice(0, limit);

  // Stats summary
  const total = visibleMatches.length;
  const wins = visibleMatches.filter(m => m.result === 'W').length;
  const draws = visibleMatches.filter(m => m.result === 'D').length;
  const losses = visibleMatches.filter(m => m.result === 'L').length;
  const goalsFor = visibleMatches.reduce((sum, m) => sum + m.goalsFor, 0);
  const goalsAgainst = visibleMatches.reduce((sum, m) => sum + m.goalsAgainst, 0);
  const cleanSheets = visibleMatches.filter(m => m.goalsAgainst === 0).length;
  const btts = visibleMatches.filter(m => m.goalsFor > 0 && m.goalsAgainst > 0).length;
  const over15 = visibleMatches.filter(m => m.goalsFor + m.goalsAgainst >= 2).length;
  const over25 = visibleMatches.filter(m => m.goalsFor + m.goalsAgainst >= 3).length;

  // Form string (most recent first)
  const formString = visibleMatches.slice(0, 10).map(m => m.result);

  return (
    <div>
      {/* Header + Filters */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-300">{title}</h4>
        <div className="flex items-center gap-2">
          {/* Venue toggle (Home/All/Away) */}
          {allMatches && (
            <div className="flex gap-0.5">
              {(['home', 'all', 'away'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setVenueFilter(f)}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                    venueFilter === f ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'home' ? 'H' : 'A'}
                </button>
              ))}
            </div>
          )}
          {showFilters && (
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="text-[10px] px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded focus:outline-none"
            >
              <option value={5}>Last 5</option>
              <option value={10}>Last 10</option>
              <option value={15}>Last 15</option>
              <option value={20}>Last 20</option>
            </select>
          )}
        </div>
      </div>

      {/* Next Fixtures */}
      {nextFixtures && nextFixtures.length > 0 && (
        <div className="mb-3 p-2 bg-gray-800 rounded border border-gray-700">
          <div className="text-[10px] text-gray-500 mb-1">Next fixtures:</div>
          <div className="space-y-0.5">
            {nextFixtures.slice(0, 5).map((f, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">
                  {f.isHome ? 'vs' : '@'} {f.opponent}
                </span>
                <div className="flex items-center gap-1">
                  {f.league && <span className="text-[8px] text-gray-600">{f.league.slice(0, 10)}</span>}
                  <span className="text-gray-500">{f.date}</span>
                  <span className={`text-[8px] px-1 rounded ${f.isHome ? 'bg-green-900 text-green-400' : 'bg-blue-900 text-blue-400'}`}>
                    {f.isHome ? 'H' : 'A'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form Strip */}
      <div className="flex items-center gap-0.5 mb-3">
        {formString.map((r, i) => (
          <span
            key={i}
            className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${
              r === 'W' ? 'bg-green-700 text-green-200' :
              r === 'D' ? 'bg-yellow-700 text-yellow-200' :
              'bg-red-700 text-red-200'
            }`}
          >
            {r}
          </span>
        ))}
        {formString.length === 0 && <span className="text-xs text-gray-500">No data</span>}
      </div>

      {/* Stats Summary */}
      {total > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3 p-2 bg-gray-900 rounded">
          <div className="text-center">
            <div className="text-xs text-gray-400">W-D-L</div>
            <div className="text-sm font-medium text-gray-200">{wins}-{draws}-{losses}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Goals</div>
            <div className="text-sm font-medium text-gray-200">{goalsFor}-{goalsAgainst}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">CS %</div>
            <div className="text-sm font-medium text-gray-200">{total > 0 ? Math.round(cleanSheets / total * 100) : 0}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">BTTS %</div>
            <div className="text-sm font-medium text-gray-200">{total > 0 ? Math.round(btts / total * 100) : 0}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Win %</div>
            <div className="text-sm font-medium text-green-400">{total > 0 ? Math.round(wins / total * 100) : 0}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Avg GF</div>
            <div className="text-sm font-medium text-gray-200">{total > 0 ? (goalsFor / total).toFixed(1) : '0'}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">O1.5 %</div>
            <div className="text-sm font-medium text-gray-200">{total > 0 ? Math.round(over15 / total * 100) : 0}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">O2.5 %</div>
            <div className="text-sm font-medium text-gray-200">{total > 0 ? Math.round(over25 / total * 100) : 0}%</div>
          </div>
        </div>
      )}

      {/* Match List */}
      {visibleMatches.length > 0 ? (
        <div className="space-y-0.5">
          {visibleMatches.map((match, i) => (
            <div key={i} className="flex items-center justify-between px-2 py-1 bg-gray-900 rounded text-xs">
              <div className="flex items-center gap-2 flex-1">
                <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold ${
                  match.result === 'W' ? 'bg-green-700 text-green-200' :
                  match.result === 'D' ? 'bg-yellow-700 text-yellow-200' :
                  'bg-red-700 text-red-200'
                }`}>
                  {match.result}
                </span>
                <span className="text-gray-400 w-16 text-[10px]">{match.date}</span>
                <span className={`text-[8px] px-0.5 rounded ${match.isHome ? 'text-green-500' : 'text-blue-500'}`}>{match.isHome ? 'H' : 'A'}</span>
                <span className="text-gray-300 truncate">{match.opponent}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono font-medium ${
                  match.result === 'W' ? 'text-green-400' :
                  match.result === 'D' ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {match.goalsFor}-{match.goalsAgainst}
                </span>
                {match.league && <span className="text-[9px] text-gray-600 w-12 truncate text-right">{match.league}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 text-center py-4">No match data available. Click "Sync Data" to import historical results.</p>
      )}
    </div>
  );
}
