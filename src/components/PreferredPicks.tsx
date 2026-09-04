/**
 * Preferred — dedicated watchlist for the user's non-fouls preferred markets:
 * 1X2 - 1UP, Double Chance - 1UP, Win Either Half.
 *
 * Like the Fouls tab, this per-event CONFIRMS which SportyBet fixtures actually
 * carry these markets and shows their live lines/odds — a focused prioritization
 * lens over the full catalog (which lives in the Markets tab). Rows import into
 * the pool with one click.
 */

import React, { useState, useMemo } from 'react';
import { ParsedSelection } from '../engine/types';
import {
  confirmPreferredFixtures,
  preferredRowToSelection,
  sectionForKey,
  NON_FOULS_PREFERRED_KEYS,
  ConfirmedFixture,
  PreferredSection,
  PreferredMarketRow,
  TimeWindow,
  TIME_WINDOWS,
} from '../engine/sportybet';

const SECTION_ORDER: PreferredSection[] = ['Early-Payout', 'Combos', 'Halves', 'Corners', 'Team Totals', 'Other'];

interface Props {
  onImport?: (sels: ParsedSelection[]) => void;
}

// Row color by section (via the row's key -> section).
const SECTION_COLOR: Record<PreferredSection, string> = {
  'Early-Payout': 'border-green-800 bg-green-900/30 text-green-300',
  'Combos': 'border-emerald-800 bg-emerald-900/30 text-emerald-300',
  'Halves': 'border-blue-800 bg-blue-900/30 text-blue-300',
  'Corners': 'border-cyan-800 bg-cyan-900/30 text-cyan-300',
  'Team Totals': 'border-purple-800 bg-purple-900/30 text-purple-300',
  'Other': 'border-gray-600 bg-gray-800 text-gray-300',
  'Fouls': 'border-amber-800 bg-amber-900/30 text-amber-300',
};

export default function PreferredPicks({ onImport }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [win, setWin] = useState<TimeWindow>('');
  const [cap, setCap] = useState(40);
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());

  async function scan() {
    setLoading(true);
    setFixtures([]);
    setStatus('Confirming which SportyBet fixtures offer your preferred markets…');
    try {
      const confirmed = await confirmPreferredFixtures(NON_FOULS_PREFERRED_KEYS, {
        region: 'ng', window: win, maxPages: 10, cap,
        onProgress: (m) => setStatus(m),
      });
      setFixtures(confirmed);
      setStatus(`${confirmed.length} fixture(s) offer your preferred markets.`);
    } catch (e: any) {
      setStatus(`Scan failed: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  function importRow(fx: ConfirmedFixture, rowIdx: number) {
    if (!onImport) return;
    const row = fx.markets[rowIdx];
    if (row.locked) return;
    onImport([preferredRowToSelection(fx as any, row)]);
    setImported(prev => new Set(prev).add(`${fx.eventId}-${row.marketLabel}-${row.line}`));
  }

  const grouped = useMemo(() => {
    const g = new Map<string, ConfirmedFixture[]>();
    for (const f of fixtures) {
      if (!g.has(f.league)) g.set(f.league, []);
      g.get(f.league)!.push(f);
    }
    return Array.from(g.entries());
  }, [fixtures]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-green-400">Preferred Markets</h2>
          <p className="text-[11px] text-gray-500">
            Fixtures that offer your ⭐ SportyBet favorites — early-payout, combos, halves, corners,
            team totals — confirmed per-event with live lines/odds, grouped by section. Browse the
            full pool in the Markets tab; fouls have their own tab.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Window:</span>
          <select
            value={win}
            onChange={(e) => setWin(e.target.value as TimeWindow)}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
          >
            {TIME_WINDOWS.map(tw => <option key={tw.key || 'all'} value={tw.key}>{tw.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Check up to:</span>
          <select
            value={cap}
            onChange={(e) => setCap(parseInt(e.target.value))}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
            title="How many nearest-kickoff fixtures to per-event confirm"
          >
            <option value="20">20 fixtures</option>
            <option value="40">40 fixtures</option>
            <option value="80">80 fixtures</option>
            <option value="150">150 fixtures</option>
          </select>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
        >
          {loading ? 'Scanning…' : 'Scan preferred markets'}
        </button>
        {status && <span className="text-[10px] text-gray-500">{status}</span>}
      </div>

      {/* Confirmed fixtures grouped by league */}
      <div className="space-y-3">
        {grouped.map(([league, fxs]) => (
          <div key={league}>
            <div className="text-[11px] font-semibold text-gray-400 mb-1 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-gray-800">🏆 {league}</span>
              <span className="text-gray-600">{fxs.length}</span>
            </div>
            <div className="space-y-2">
              {fxs.map(fx => (
                <div key={fx.eventId} className="p-3 rounded-lg border border-gray-700 bg-gray-800/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-sm text-gray-200 font-medium">{fx.homeTeam} v {fx.awayTeam}</span>
                      <span className="ml-2 text-[10px] text-gray-500">{fx.date} {fx.time}</span>
                    </div>
                    {!fx.anyOpen && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400" title="No open line yet — unlocks nearer kickoff">🔒 pre-stage</span>
                    )}
                  </div>
                  {(() => {
                    // Group this fixture's rows by section, preserving each row's
                    // original index (importRow needs it).
                    const bySection = new Map<PreferredSection, { row: PreferredMarketRow; idx: number }[]>();
                    fx.markets.forEach((row, idx) => {
                      const sec = sectionForKey(row.key);
                      if (!bySection.has(sec)) bySection.set(sec, []);
                      bySection.get(sec)!.push({ row, idx });
                    });
                    const orderedSections = SECTION_ORDER.filter(s => bySection.has(s));
                    return (
                      <div className="space-y-1.5">
                        {orderedSections.map(sec => (
                          <div key={sec}>
                            <div className="text-[9px] uppercase tracking-wide text-gray-500 mb-0.5">{sec}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {bySection.get(sec)!.map(({ row, idx }) => {
                                const key = `${fx.eventId}-${row.marketLabel}-${row.line}`;
                                const wasImported = imported.has(key);
                                return (
                                  <button
                                    key={idx}
                                    disabled={row.locked || wasImported}
                                    onClick={() => importRow(fx, idx)}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                      row.locked
                                        ? 'border-gray-700 bg-gray-800 text-gray-500 cursor-default'
                                        : wasImported
                                          ? 'border-gray-600 bg-gray-700 text-gray-400 cursor-default'
                                          : SECTION_COLOR[sec] + ' hover:brightness-125'
                                    }`}
                                    title={row.marketLabel}
                                  >
                                    {row.marketLabel}: {row.line}
                                    {row.locked ? ' 🔒' : wasImported ? ' ✓' : ` @ ${row.odds} +`}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!loading && fixtures.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">Click "Scan preferred markets" to find fixtures offering your signature picks</p>
          <p className="text-xs mt-1">Early-payout · combos · halves · corners · team totals — with live SportyBet lines</p>
        </div>
      )}
    </div>
  );
}
