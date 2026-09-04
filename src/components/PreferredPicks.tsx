/**
 * Preferred — dedicated watchlist for the user's ⭐ SportyBet favorite markets
 * (early-payout, combos, halves, corners, team totals). Fouls have their own tab.
 *
 * Per-event CONFIRMS which SportyBet fixtures actually carry these markets and
 * shows their live lines/odds, grouped by section. Features:
 *  - Results persist across tab navigation + app restart (no needless re-scan).
 *  - Massive client-side filters (section / league / text / window / odds / open).
 *  - Multi-select rows -> sticky "Build slip" bar (combined odds) -> import all.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ParsedSelection } from '../engine/types';
import {
  confirmPreferredFixtures,
  preferredRowToSelection,
  sectionForKey,
  withinWindow,
  NON_FOULS_PREFERRED_KEYS,
  ConfirmedFixture,
  PreferredSection,
  PreferredMarketRow,
  TimeWindow,
  TIME_WINDOWS,
} from '../engine/sportybet';
import { savePreferredMarkets } from '../engine/preferred-markets-store';

const SECTION_ORDER: PreferredSection[] = ['Early-Payout', 'Combos', 'Halves', 'Corners', 'Team Totals', 'Other'];

const SECTION_COLOR: Record<PreferredSection, string> = {
  'Early-Payout': 'border-green-800 bg-green-900/30 text-green-300',
  'Combos': 'border-emerald-800 bg-emerald-900/30 text-emerald-300',
  'Halves': 'border-blue-800 bg-blue-900/30 text-blue-300',
  'Corners': 'border-cyan-800 bg-cyan-900/30 text-cyan-300',
  'Team Totals': 'border-purple-800 bg-purple-900/30 text-purple-300',
  'Other': 'border-gray-600 bg-gray-800 text-gray-300',
  'Fouls': 'border-amber-800 bg-amber-900/30 text-amber-300',
};

interface Props {
  onImport?: (sels: ParsedSelection[]) => void;
}

// ─── Module-level persistence (survives unmount/remount within a session) ────
let persistedFixtures: ConfirmedFixture[] | null = null;
let persistedScannedAt: number | null = null;
const LS_KEY = 'rollover_preferred_cache';

// Serialize / restore (kickoff Date <-> epoch ms) for localStorage survival.
function saveCache(fixtures: ConfirmedFixture[], scannedAt: number) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      scannedAt,
      fixtures: fixtures.map(f => ({ ...f, kickoff: f.kickoff.getTime() })),
    }));
  } catch {}
}
function loadCache(): { fixtures: ConfirmedFixture[]; scannedAt: number } | null {
  if (persistedFixtures) return { fixtures: persistedFixtures, scannedAt: persistedScannedAt || 0 };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const fixtures: ConfirmedFixture[] = (p.fixtures || []).map((f: any) => ({ ...f, kickoff: new Date(f.kickoff) }));
    return { fixtures, scannedAt: p.scannedAt || 0 };
  } catch { return null; }
}

// A row identity stable across renders/fixtures.
const rowKey = (fx: ConfirmedFixture, row: PreferredMarketRow) => `${fx.eventId}|${row.marketLabel}|${row.line}`;

export default function PreferredPicks({ onImport }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [cap, setCap] = useState(40);
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>(() => loadCache()?.fixtures ?? []);
  const [scannedAt, setScannedAt] = useState<number | null>(() => loadCache()?.scannedAt ?? null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Filters (all client-side over the scanned set) ──
  const [fSections, setFSections] = useState<Set<PreferredSection>>(new Set());
  const [fLeagues, setFLeagues] = useState<Set<string>>(new Set());
  const [fText, setFText] = useState('');
  const [fWin, setFWin] = useState<TimeWindow>('');
  const [fOddsMin, setFOddsMin] = useState('');
  const [fOddsMax, setFOddsMax] = useState('');
  const [fOpenOnly, setFOpenOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Keep the module singleton in sync so navigation away/back restores instantly.
  useEffect(() => {
    if (fixtures.length > 0) { persistedFixtures = fixtures; persistedScannedAt = scannedAt; }
  }, [fixtures, scannedAt]);

  async function scan() {
    setLoading(true);
    setStatus('Confirming which SportyBet fixtures offer your preferred markets…');
    try {
      const confirmed = await confirmPreferredFixtures(NON_FOULS_PREFERRED_KEYS, {
        region: 'ng', window: '', maxPages: 12, cap,
        onProgress: (m) => setStatus(m),
      });
      const now = Date.now();
      setFixtures(confirmed);
      setScannedAt(now);
      persistedFixtures = confirmed; persistedScannedAt = now;
      saveCache(confirmed, now);
      // Persist confirmed markets + live odds to SQLite for the Python predictor
      // (value comparison — read-only on its side).
      void savePreferredMarkets(confirmed, sectionForKey);
      setStatus(`${confirmed.length} fixture(s) offer your preferred markets.`);
    } catch (e: any) {
      setStatus(`Scan failed: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Row selection + import ──
  function toggleSelect(fx: ConfirmedFixture, row: PreferredMarketRow) {
    if (row.locked) return;
    const k = rowKey(fx, row);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function importSelected() {
    if (!onImport || selected.size === 0) return;
    const sels: ParsedSelection[] = [];
    const done = new Set<string>();
    for (const fx of fixtures) {
      for (const row of fx.markets) {
        const k = rowKey(fx, row);
        if (selected.has(k) && !row.locked) {
          sels.push(preferredRowToSelection(fx as any, row));
          done.add(k);
        }
      }
    }
    if (sels.length === 0) return;
    onImport(sels);
    setImported(prev => new Set([...prev, ...done]));
    setSelected(new Set());
  }

  function importOne(fx: ConfirmedFixture, row: PreferredMarketRow) {
    if (!onImport || row.locked) return;
    onImport([preferredRowToSelection(fx as any, row)]);
    setImported(prev => new Set(prev).add(rowKey(fx, row)));
  }

  // ── Derived: leagues present, filtered fixtures (+ per-row odds/open filter) ──
  const resultLeagues = useMemo(() => {
    const c = new Map<string, number>();
    for (const f of fixtures) c.set(f.league, (c.get(f.league) || 0) + 1);
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1]);
  }, [fixtures]);

  const oddsMin = parseFloat(fOddsMin);
  const oddsMax = parseFloat(fOddsMax);

  // Returns fixtures with their rows already filtered by section/odds/open, so
  // a fixture only appears if it has at least one row matching the row-filters.
  const view = useMemo(() => {
    const now = new Date();
    const q = fText.trim().toLowerCase();
    const out: { fx: ConfirmedFixture; rows: { row: PreferredMarketRow; idx: number }[] }[] = [];

    for (const fx of fixtures) {
      // Fixture-level filters
      if (fLeagues.size > 0 && !fLeagues.has(fx.league)) continue;
      if (fWin && !withinWindow(fx.kickoff, fWin, now)) continue;
      if (q) {
        const hay = `${fx.homeTeam} ${fx.awayTeam} ${fx.league}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      // Row-level filters
      const rows: { row: PreferredMarketRow; idx: number }[] = [];
      fx.markets.forEach((row, idx) => {
        const sec = sectionForKey(row.key);
        if (fSections.size > 0 && !fSections.has(sec)) return;
        if (fOpenOnly && row.locked) return;
        if (!isNaN(oddsMin) && !(row.odds >= oddsMin)) return;
        if (!isNaN(oddsMax) && !(row.odds <= oddsMax)) return;
        rows.push({ row, idx });
      });
      if (rows.length === 0) continue;
      out.push({ fx, rows });
    }
    return out;
  }, [fixtures, fLeagues, fWin, fText, fSections, fOpenOnly, oddsMin, oddsMax]);

  // Group filtered view by league
  const grouped = useMemo(() => {
    const g = new Map<string, typeof view>();
    for (const item of view) {
      if (!g.has(item.fx.league)) g.set(item.fx.league, []);
      g.get(item.fx.league)!.push(item);
    }
    return Array.from(g.entries());
  }, [view]);

  const shownRowCount = useMemo(() => view.reduce((s, v) => s + v.rows.length, 0), [view]);

  // Combined odds of the current multi-selection (product of picked row odds).
  const combinedOdds = useMemo(() => {
    let acc = 1; let n = 0;
    for (const fx of fixtures) for (const row of fx.markets) {
      if (selected.has(rowKey(fx, row)) && row.odds >= 1.01) { acc *= row.odds; n++; }
    }
    return n > 0 ? acc : 0;
  }, [selected, fixtures]);

  const hasAnyFilter = fSections.size > 0 || fLeagues.size > 0 || fText || fWin || fOddsMin || fOddsMax || fOpenOnly;
  function clearFilters() {
    setFSections(new Set()); setFLeagues(new Set()); setFText(''); setFWin('');
    setFOddsMin(''); setFOddsMax(''); setFOpenOnly(false);
  }
  function toggleSection(s: PreferredSection) {
    setFSections(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleLeagueFilter(l: string) {
    setFLeagues(prev => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; });
  }
  function toggleCollapse(l: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; });
  }

  return (
    <div className="pb-20">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-green-400">Preferred Markets</h2>
          <p className="text-[11px] text-gray-500">
            Fixtures offering your ⭐ SportyBet favorites, confirmed per-event with live lines.
            Select rows to build a slip. Results are remembered — no re-scan on return.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scannedAt && (
            <span className="text-[10px] text-gray-600">
              {(() => { const m = Math.round((Date.now() - scannedAt) / 60000); return m < 60 ? `scanned ${m}m ago` : `scanned ${Math.round(m / 60)}h ago`; })()}
            </span>
          )}
          <select
            value={cap}
            onChange={(e) => setCap(parseInt(e.target.value))}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
            title="How many nearest-kickoff fixtures to per-event confirm"
          >
            <option value="20">20</option>
            <option value="40">40</option>
            <option value="80">80</option>
            <option value="150">150</option>
          </select>
          <button
            onClick={scan}
            disabled={loading}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
          >
            {loading ? 'Scanning…' : fixtures.length > 0 ? '⟳ Re-scan' : 'Scan'}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      {fixtures.length > 0 && (
        <div className="mb-3 p-2 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={fText}
              onChange={(e) => setFText(e.target.value)}
              placeholder="Filter team or league…"
              className="flex-1 min-w-[140px] px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 placeholder-gray-600"
            />
            <select value={fWin} onChange={(e) => setFWin(e.target.value as TimeWindow)} className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300">
              {TIME_WINDOWS.map(tw => <option key={tw.key || 'all'} value={tw.key}>{tw.label}</option>)}
            </select>
            <input value={fOddsMin} onChange={(e) => setFOddsMin(e.target.value)} placeholder="min odds" inputMode="decimal" className="w-20 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 placeholder-gray-600" />
            <input value={fOddsMax} onChange={(e) => setFOddsMax(e.target.value)} placeholder="max odds" inputMode="decimal" className="w-20 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 placeholder-gray-600" />
            <label className="flex items-center gap-1 text-[11px] text-gray-400">
              <input type="checkbox" checked={fOpenOnly} onChange={(e) => setFOpenOnly(e.target.checked)} /> Open lines only
            </label>
            {hasAnyFilter && <button onClick={clearFilters} className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Clear</button>}
          </div>
          {/* Section chips */}
          <div className="flex items-center gap-1 flex-wrap">
            {SECTION_ORDER.map(s => (
              <button key={s} onClick={() => toggleSection(s)} className={`text-[10px] px-1.5 py-0.5 rounded ${fSections.has(s) ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>{s}</button>
            ))}
          </div>
          {/* League chips */}
          {resultLeagues.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap max-h-20 overflow-y-auto">
              {resultLeagues.map(([l, c]) => (
                <button key={l} onClick={() => toggleLeagueFilter(l)} className={`text-[10px] px-1.5 py-0.5 rounded ${fLeagues.has(l) ? 'bg-indigo-700 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`} title={`${c} fixtures`}>
                  {l} <span className="opacity-60">{c}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {status && <div className="mb-2 text-[11px] text-gray-400">{status}</div>}
      {fixtures.length > 0 && (
        <div className="mb-2 text-[10px] text-gray-500">
          Showing {view.length} fixture(s), {shownRowCount} market(s){view.length !== fixtures.length && <span className="text-gray-600"> (filtered from {fixtures.length})</span>}
        </div>
      )}

      {/* ── Fixtures (collapsible by league) ── */}
      <div className="space-y-2">
        {grouped.map(([league, items]) => {
          const isC = collapsed.has(league);
          return (
            <div key={league} className="border border-gray-800 rounded overflow-hidden">
              <button onClick={() => toggleCollapse(league)} className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-800 hover:bg-gray-750 text-left">
                <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1.5">
                  <span className="text-gray-500 w-3 inline-block">{isC ? '▸' : '▾'}</span> 🏆 {league}
                </span>
                <span className="text-[10px] text-gray-500">{items.length}</span>
              </button>
              {!isC && (
                <div className="space-y-2 p-1">
                  {items.map(({ fx, rows }) => {
                    // group the (already row-filtered) rows by section
                    const bySection = new Map<PreferredSection, { row: PreferredMarketRow; idx: number }[]>();
                    for (const r of rows) {
                      const sec = sectionForKey(r.row.key);
                      if (!bySection.has(sec)) bySection.set(sec, []);
                      bySection.get(sec)!.push(r);
                    }
                    const secs = SECTION_ORDER.filter(s => bySection.has(s));
                    return (
                      <div key={fx.eventId} className="p-3 rounded-lg border border-gray-700 bg-gray-800/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <div>
                            <span className="text-sm text-gray-200 font-medium">{fx.homeTeam} v {fx.awayTeam}</span>
                            <span className="ml-2 text-[10px] text-gray-500">{fx.date} {fx.time}</span>
                          </div>
                          {!fx.anyOpen && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400" title="No open line yet — unlocks nearer kickoff">🔒 pre-stage</span>}
                        </div>
                        <div className="space-y-1.5">
                          {secs.map(sec => (
                            <div key={sec}>
                              <div className="text-[9px] uppercase tracking-wide text-gray-500 mb-0.5">{sec}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {bySection.get(sec)!.map(({ row }) => {
                                  const k = rowKey(fx, row);
                                  const isSel = selected.has(k);
                                  const wasImp = imported.has(k);
                                  return (
                                    <button
                                      key={k}
                                      disabled={row.locked}
                                      onClick={() => toggleSelect(fx, row)}
                                      onDoubleClick={() => importOne(fx, row)}
                                      title={`${row.marketLabel} — click to select, double-click to import one`}
                                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                        row.locked ? 'border-gray-700 bg-gray-800 text-gray-500 cursor-default'
                                        : isSel ? 'border-white bg-blue-700 text-white'
                                        : wasImp ? 'border-gray-600 bg-gray-700 text-gray-400'
                                        : SECTION_COLOR[sec] + ' hover:brightness-125'
                                      }`}
                                    >
                                      {isSel ? '✓ ' : ''}{row.marketLabel}: {row.line}
                                      {row.locked ? ' 🔒' : ` @ ${row.odds}`}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && fixtures.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">Click "Scan" to find fixtures offering your signature picks</p>
          <p className="text-xs mt-1">Early-payout · combos · halves · corners · team totals — with live SportyBet lines</p>
        </div>
      )}
      {!loading && fixtures.length > 0 && view.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-xs">
          No markets match the current filters.
          <button onClick={clearFilters} className="ml-1 text-blue-400 hover:underline">Clear filters</button>
        </div>
      )}

      {/* ── Sticky slip-builder bar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 border-t border-gray-700 px-4 py-2 flex items-center justify-between shadow-2xl">
          <div className="text-xs text-gray-300">
            <span className="font-semibold text-green-400">{selected.size}</span> pick(s) selected
            {combinedOdds > 0 && <span className="ml-3 text-gray-400">combined odds <span className="font-semibold text-gray-200">{combinedOdds.toFixed(2)}</span></span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600">Clear</button>
            <button onClick={importSelected} className="px-4 py-1.5 rounded text-xs font-medium bg-green-700 hover:bg-green-600 text-white">
              Build slip → pool ({selected.size})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
