/**
 * Markets — the consolidated SportyBet fixture browser.
 *
 * SportyBet is the fixture + market spine: this tab lists the fixtures SportyBet
 * showcases (the only book the user plays), grouped by SportyBet's own leagues,
 * filtered by time windows (next 3h/6h, today, tomorrow, weekend, all upcoming).
 *
 * The list shows ONE row per fixture — no market clutter. Clicking a fixture
 * opens a side panel with the user's PREFERRED markets for that game (fouls,
 * 1X2-1UP, DC-1UP, Win Either Half — extensible via the engine registry), with
 * live lines + odds, locked markets badged for pre-staging, importable to pool.
 *
 * Read-only on odds: the user books on SportyBet itself.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { ParsedSelection } from '../engine/types';
import {
  fetchSportyBetFixtures,
  fetchFixtureMarkets,
  preferredRowToSelection,
  SbFixture,
  PreferredFixture,
  TimeWindow,
  TIME_WINDOWS,
} from '../engine/sportybet';

interface Props {
  onImport?: (sels: ParsedSelection[]) => void;
}

export default function PreferredMarkets({ onImport }: Props) {
  const [fixtures, setFixtures] = useState<SbFixture[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [win, setWin] = useState<TimeWindow>('');
  const [leagueFilter, setLeagueFilter] = useState<string>('');
  const [maxPages, setMaxPages] = useState(10);
  const [onlyPreferred, setOnlyPreferred] = useState(true);

  // Modal state (per-fixture preferred markets)
  const [openFixture, setOpenFixture] = useState<SbFixture | null>(null);
  const [modalData, setModalData] = useState<PreferredFixture | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [imported, setImported] = useState<Set<string>>(new Set());

  async function handleScan() {
    setLoading(true);
    setStatus('Loading SportyBet fixtures…');
    setFixtures([]);
    try {
      const res = await fetchSportyBetFixtures({
        region: 'ng',
        maxPages,
        pageSize: 30,
        window: win,
        onProgress: (m) => setStatus(m),
      });
      setFixtures(res.fixtures);
      setLeagues(res.leagues);
      setStatus(res.fixtures.length === 0
        ? 'No fixtures found. If this persists, confirm the Cloudflare Worker is redeployed (sportybet.com whitelisted).'
        : `Loaded ${res.fixtures.length} fixture(s).`);
    } catch (e: any) {
      setStatus(`Load failed: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(s => (s && s.startsWith('Loaded')) ? null : s), 6000);
    }
  }

  // Re-scan when the window changes (if we already have data or user is active)
  useEffect(() => {
    if (fixtures.length > 0) handleScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  const shown = useMemo(() => {
    let list = fixtures;
    if (onlyPreferred) list = list.filter(f => f.hasPreferred);
    if (leagueFilter) list = list.filter(f => f.league === leagueFilter);
    return list;
  }, [fixtures, leagueFilter, onlyPreferred]);

  // Group shown fixtures by league for a tidy list
  const grouped = useMemo(() => {
    const g = new Map<string, SbFixture[]>();
    for (const f of shown) {
      if (!g.has(f.league)) g.set(f.league, []);
      g.get(f.league)!.push(f);
    }
    return Array.from(g.entries());
  }, [shown]);

  async function openMarkets(fx: SbFixture) {
    setOpenFixture(fx);
    setModalData(null);
    setModalLoading(true);
    try {
      const data = await fetchFixtureMarkets(fx, { region: 'ng' });
      setModalData(data);
    } catch {
      setModalData({ ...fx, markets: [] } as any);
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setOpenFixture(null);
    setModalData(null);
  }

  function importRow(pf: PreferredFixture, rowIdx: number) {
    if (!onImport) return;
    const row = pf.markets[rowIdx];
    if (row.locked) return;
    onImport([preferredRowToSelection(pf, row)]);
    setImported(prev => new Set(prev).add(`${pf.eventId}-${row.marketLabel}-${row.line}`));
  }

  const marketColor = (k: string): string => {
    switch (k) {
      case '1x2_1up': return 'bg-green-900 text-green-300';
      case 'dc_1up': return 'bg-emerald-900 text-emerald-300';
      case 'home_fouls': return 'bg-amber-900 text-amber-300';
      case 'away_fouls': return 'bg-orange-900 text-orange-300';
      case 'win_either_half': return 'bg-blue-900 text-blue-300';
      default: return 'bg-gray-700 text-gray-300';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-md font-semibold text-green-400">Markets — SportyBet Fixtures</h3>
          <p className="text-[11px] text-gray-500">The fixtures SportyBet showcases (the book you play). Click a fixture to see your preferred markets — fouls locked lines shown for pre-staging.</p>
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
        >
          {loading ? 'Loading…' : '⟳ Load fixtures'}
        </button>
      </div>

      {/* Time-window presets */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {TIME_WINDOWS.map(tw => (
          <button
            key={tw.key || 'all'}
            onClick={() => setWin(tw.key)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded ${
              win === tw.key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {tw.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 max-w-[16rem]"
        >
          <option value="">All leagues ({leagues.length})</option>
          {leagues.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-gray-400">
          <input type="checkbox" checked={onlyPreferred} onChange={(e) => setOnlyPreferred(e.target.checked)} />
          Only fixtures with my markets
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-400">
          Depth:
          <select
            value={maxPages}
            onChange={(e) => setMaxPages(parseInt(e.target.value))}
            className="px-1.5 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300"
          >
            <option value={5}>5 pages</option>
            <option value={10}>10 pages</option>
            <option value={20}>20 pages</option>
            <option value={40}>40 pages</option>
          </select>
        </label>
      </div>

      {status && (
        <div className="mb-3 p-2 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-300">{status}</div>
      )}

      {/* Fixture list — one row per fixture, grouped by league */}
      <div className="space-y-3">
        {grouped.map(([league, fxs]) => (
          <div key={league}>
            <div className="text-[11px] font-semibold text-gray-400 mb-1 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-gray-800">🏆 {league}</span>
              <span className="text-gray-600">{fxs.length}</span>
            </div>
            <div className="space-y-1">
              {fxs.map(fx => (
                <button
                  key={fx.eventId}
                  onClick={() => openMarkets(fx)}
                  className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 hover:border-blue-600 p-2.5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-200">
                      {fx.homeTeam} <span className="text-gray-500">v</span> {fx.awayTeam}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-gray-500">{fx.date} {fx.time}</span>
                      {fx.hasPreferred && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900 text-green-300">markets ▸</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!loading && fixtures.length === 0 && !status && (
        <div className="text-center text-gray-600 text-xs py-8">
          Click "Load fixtures" to pull SportyBet's showcased games.
        </div>
      )}

      {/* Side panel / modal: preferred markets for the clicked fixture */}
      {openFixture && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeModal}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-full max-w-md h-full bg-gray-900 border-l border-gray-700 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-3 flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-100">
                  {openFixture.homeTeam} <span className="text-gray-500">v</span> {openFixture.awayTeam}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">🏆 {openFixture.league}</span>
                  <span className="text-[10px] text-gray-500">{openFixture.date} {openFixture.time}</span>
                </div>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-white text-lg leading-none px-1">✕</button>
            </div>

            <div className="p-3">
              {modalLoading && <div className="text-xs text-gray-400 py-6 text-center">Loading markets…</div>}

              {!modalLoading && modalData && modalData.markets.length === 0 && (
                <div className="text-xs text-gray-500 py-6 text-center">
                  No preferred markets offered on this fixture.
                </div>
              )}

              {!modalLoading && modalData && modalData.markets.length > 0 && (
                <div className="space-y-1">
                  {modalData.markets.map((r, i) => {
                    const key = `${modalData.eventId}-${r.marketLabel}-${r.line}`;
                    const done = imported.has(key);
                    return (
                      <div key={i} className="flex items-center justify-between text-[11px] py-1.5 border-b border-gray-800 last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${marketColor(r.key)}`}>{r.marketLabel}</span>
                          <span className={`font-medium truncate ${r.locked ? 'text-gray-400' : 'text-gray-200'}`}>{r.line}</span>
                          {r.locked && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0"
                              title="Market currently locked. SportyBet usually unlocks team-fouls markets a few hours before kickoff — pre-staged so you can act the moment it opens."
                            >🔒</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.locked
                            ? <span className="text-gray-500 font-mono">@—</span>
                            : <span className="text-yellow-400 font-mono">@{r.odds.toFixed(2)}</span>}
                          {onImport && (
                            <button
                              onClick={() => importRow(modalData, i)}
                              disabled={done || r.locked}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-blue-700 disabled:text-gray-600 disabled:bg-gray-800 rounded text-gray-300"
                              title={r.locked ? 'Locked — no price yet. Import enabled once it unlocks.' : 'Add to pool'}
                            >
                              {done ? '✓' : r.locked ? '🔒' : '+ Pool'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
