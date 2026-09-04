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
  fetchFixtureMarkets,
  preferredRowToSelection,
  withinWindow,
  SbFixture,
  PreferredFixture,
  TimeWindow,
  TIME_WINDOWS,
} from '../engine/sportybet';
import { useFixtureStore, pullFixtures } from '../engine/sportybet-store';

interface Props {
  onImport?: (sels: ParsedSelection[]) => void;
}

export default function PreferredMarkets({ onImport }: Props) {
  // Fixtures come from the SHARED store — one pull feeds both Markets + Scout.
  const store = useFixtureStore();
  const fixtures = store.fixtures;
  const leagues = store.leagues;
  const loading = store.loading;
  const status = store.progress || store.error;

  // Window is a LOCAL, in-memory filter over the cached full slate — switching
  // it never re-pulls. Default to the full "all upcoming" view.
  const [win, setWin] = useState<TimeWindow>('');
  const [leagueFilter, setLeagueFilter] = useState<string>('');
  // Collapsed league groups (by league name). Default: all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Modal state (per-fixture preferred markets)
  const [openFixture, setOpenFixture] = useState<SbFixture | null>(null);
  const [modalData, setModalData] = useState<PreferredFixture | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [imported, setImported] = useState<Set<string>>(new Set());

  function handleScan() {
    // Manual refresh: force a fresh FULL pull into the shared store (updates
    // Scout too). Windows are filtered locally, so this is the only network call.
    void pullFixtures({ force: true });
  }

  function toggleCollapse(league: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league); else next.add(league);
      return next;
    });
  }
  const allCollapsed = (leaguesShown: string[]) => leaguesShown.every(l => collapsed.has(l));
  function toggleAll(leaguesShown: string[]) {
    setCollapsed(allCollapsed(leaguesShown) ? new Set() : new Set(leaguesShown));
  }

  // Markets = the FULL SportyBet catalog (every showcased league). Time-window
  // (Next 3h/6h/…) is applied IN-MEMORY over the cached slate — no re-pull.
  const shown = useMemo(() => {
    const now = new Date();
    let list = win ? fixtures.filter(f => withinWindow(f.kickoff, win, now)) : fixtures;
    if (leagueFilter) list = list.filter(f => f.league === leagueFilter);
    return list;
  }, [fixtures, leagueFilter, win]);

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
      case 'win_either_half_home': return 'bg-blue-900 text-blue-300';
      case 'win_either_half_away': return 'bg-blue-900 text-blue-300';
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
        <div className="flex items-center gap-2">
          {!loading && fixtures.length > 0 && (
            <span className="text-[11px] text-gray-300">
              <span className="font-semibold text-green-400">{fixtures.length}</span> fixtures · {leagues.length} leagues
            </span>
          )}
          {store.pulledAt && (
            <span className="text-[10px] text-gray-600">
              {(() => { const m = Math.round((Date.now() - store.pulledAt) / 60000); return m < 60 ? `pulled ${m}m ago` : `pulled ${Math.round(m / 60)}h ago`; })()}
            </span>
          )}
          <button
            onClick={handleScan}
            disabled={loading}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
          >
            {loading ? 'Loading…' : '⟳ Load fixtures'}
          </button>
        </div>
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
        {grouped.length > 0 && (
          <button
            onClick={() => toggleAll(grouped.map(([l]) => l))}
            className="ml-auto text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            {allCollapsed(grouped.map(([l]) => l)) ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {status && (
        <div className="mb-3 p-2 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-300">{status}</div>
      )}

      {/* Showing summary (respects the current filters) */}
      {!loading && shown.length > 0 && (
        <div className="mb-2 text-[10px] text-gray-500">
          Showing {shown.length} fixture(s) across {grouped.length} league(s)
          {shown.length !== fixtures.length && <span className="text-gray-600"> (filtered from {fixtures.length})</span>}
        </div>
      )}

      {/* Fixture list — collapsible groups, one row per fixture */}
      <div className="space-y-2">
        {grouped.map(([league, fxs]) => {
          const isCollapsed = collapsed.has(league);
          return (
            <div key={league} className="border border-gray-800 rounded overflow-hidden">
              <button
                onClick={() => toggleCollapse(league)}
                className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-800 hover:bg-gray-750 text-left"
              >
                <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1.5">
                  <span className="text-gray-500 w-3 inline-block">{isCollapsed ? '▸' : '▾'}</span>
                  🏆 {league}
                </span>
                <span className="text-[10px] text-gray-500">{fxs.length}</span>
              </button>
              {!isCollapsed && (
                <div className="space-y-1 p-1">
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
              )}
            </div>
          );
        })}
      </div>

      {loading && fixtures.length === 0 && (
        <div className="text-center text-gray-500 text-xs py-8 animate-pulse">
          Syncing SportyBet fixtures…
        </div>
      )}
      {!loading && fixtures.length === 0 && (
        <div className="text-center text-gray-600 text-xs py-8">
          No fixtures cached yet. Click "Load fixtures" to sync SportyBet's showcased games.
        </div>
      )}
      {/* Window filter matched nothing, but we DO have cached fixtures */}
      {!loading && fixtures.length > 0 && shown.length === 0 && (
        <div className="text-center text-gray-500 text-xs py-8">
          No fixtures in this window. {fixtures.length} cached across other times —
          <button onClick={() => setWin('')} className="ml-1 text-blue-400 hover:underline">show all upcoming</button>.
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
