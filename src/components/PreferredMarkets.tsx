/**
 * Preferred Markets Scout
 *
 * Scans upcoming SportyBet fixtures and surfaces ONLY those that offer the
 * user's signature markets — 1X2-1UP, Double Chance-1UP, Home/Away Team Fouls
 * O/U, and Win Either Half. These markets aren't in every game (fouls especially
 * are league-gated), so the scout answers "which fixtures can I actually place
 * my picks on?" with the live line + odds, ready to book on SportyBet.
 *
 * Read-only: it shows availability + odds. The user books on SportyBet itself.
 * Found selections can be imported into the pool for coverage building.
 */

import React, { useState, useMemo } from 'react';
import { ParsedSelection } from '../engine/types';
import {
  fetchPreferredMarkets,
  preferredRowToSelection,
  PreferredFixture,
  PreferredMarketKey,
} from '../engine/sportybet';

interface Props {
  onImport?: (sels: ParsedSelection[]) => void;
}

const MARKET_FILTERS: { key: PreferredMarketKey | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '1x2_1up', label: '1X2 1UP' },
  { key: 'dc_1up', label: 'DC 1UP' },
  { key: 'home_fouls', label: 'Home Fouls' },
  { key: 'away_fouls', label: 'Away Fouls' },
  { key: 'win_either_half', label: 'Win Either Half' },
];

export default function PreferredMarkets({ onImport }: Props) {
  const [fixtures, setFixtures] = useState<PreferredFixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState('');
  const [marketFilter, setMarketFilter] = useState<PreferredMarketKey | 'all'>('all');
  const [maxPages, setMaxPages] = useState(10);
  const [imported, setImported] = useState<Set<string>>(new Set());

  async function handleScan() {
    setLoading(true);
    setStatus('Scanning SportyBet…');
    setFixtures([]);
    try {
      const res = await fetchPreferredMarkets({
        region: 'ng',
        maxPages,
        pageSize: 30,
        leagueFilter: leagueFilter.trim() || null,
        onProgress: (m) => setStatus(m),
      });
      setFixtures(res);
      setStatus(res.length === 0
        ? 'No fixtures found offering your markets. If this persists, confirm the Cloudflare Worker is redeployed (sportybet.com whitelisted).'
        : `Found ${res.length} fixture(s) offering your preferred markets.`);
    } catch (e: any) {
      setStatus(`Scan failed: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(s => (s && s.startsWith('Found') ? null : s)), 8000);
    }
  }

  // Fixtures filtered to the chosen market (a fixture shows if it has ≥1 row of that market)
  const shown = useMemo(() => {
    if (marketFilter === 'all') return fixtures;
    return fixtures
      .map(fx => ({ ...fx, markets: fx.markets.filter(r => r.key === marketFilter) }))
      .filter(fx => fx.markets.length > 0);
  }, [fixtures, marketFilter]);

  // Count how many fixtures offer each market (for the filter chips)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const fx of fixtures) {
      const keys = new Set(fx.markets.map(r => r.key));
      for (const k of keys) c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [fixtures]);

  function importRow(fx: PreferredFixture, rowIdx: number) {
    if (!onImport) return;
    const row = fx.markets[rowIdx];
    const sel = preferredRowToSelection(fx, row);
    onImport([sel]);
    setImported(prev => new Set(prev).add(`${fx.eventId}-${row.marketLabel}-${row.line}`));
  }

  function importFixture(fx: PreferredFixture) {
    if (!onImport) return;
    const sels = fx.markets.map(r => preferredRowToSelection(fx, r));
    onImport(sels);
    setImported(prev => {
      const n = new Set(prev);
      fx.markets.forEach(r => n.add(`${fx.eventId}-${r.marketLabel}-${r.line}`));
      return n;
    });
  }

  const marketColor = (k: PreferredMarketKey): string => {
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
          <h3 className="text-md font-semibold text-green-400">Preferred Markets Scout</h3>
          <p className="text-[11px] text-gray-500">Fixtures that offer your signature picks on SportyBet — with live lines &amp; odds.</p>
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
        >
          {loading ? 'Scanning…' : '⟳ Scan SportyBet'}
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          type="text"
          placeholder="Filter by league/country (e.g. MLS, England)"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 w-64"
        />
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

      {/* Market filter chips */}
      {fixtures.length > 0 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {MARKET_FILTERS.map(mf => {
            const n = mf.key === 'all' ? fixtures.length : (counts[mf.key] || 0);
            if (mf.key !== 'all' && n === 0) return null;
            return (
              <button
                key={mf.key}
                onClick={() => setMarketFilter(mf.key as any)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                  marketFilter === mf.key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {mf.label} ({n})
              </button>
            );
          })}
        </div>
      )}

      {status && (
        <div className="mb-3 p-2 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-300">{status}</div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {shown.map(fx => {
          const allRowsImported = fx.markets.every(r => imported.has(`${fx.eventId}-${r.marketLabel}-${r.line}`));
          return (
            <div key={fx.eventId} className="bg-gray-800 rounded-lg border border-gray-700 p-3">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm text-gray-200">
                    {fx.homeTeam} <span className="text-gray-500">v</span> {fx.awayTeam}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">🏆 {fx.league}</span>
                    <span className="text-[10px] text-gray-500">{fx.date} {fx.time}</span>
                  </div>
                </div>
                {onImport && (
                  <button
                    onClick={() => importFixture(fx)}
                    disabled={allRowsImported}
                    className="text-[10px] px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-white font-medium shrink-0"
                    title="Import all of this fixture's preferred-market picks into the pool"
                  >
                    {allRowsImported ? 'Imported' : '+ Import all'}
                  </button>
                )}
              </div>

              {/* Market rows */}
              <div className="space-y-0.5">
                {fx.markets.map((r, i) => {
                  const key = `${fx.eventId}-${r.marketLabel}-${r.line}`;
                  const done = imported.has(key);
                  return (
                    <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-gray-800 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${marketColor(r.key)}`}>{r.marketLabel}</span>
                        <span className="text-gray-200 font-medium">{r.line}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400 font-mono">@{r.odds.toFixed(2)}</span>
                        {onImport && (
                          <button
                            onClick={() => importRow(fx, i)}
                            disabled={done}
                            className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-blue-700 disabled:text-gray-600 rounded text-gray-300"
                          >
                            {done ? '✓' : '+ Slip'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && fixtures.length === 0 && !status && (
        <div className="text-center text-gray-600 text-xs py-8">
          Click "Scan SportyBet" to find fixtures offering your preferred markets.
        </div>
      )}
    </div>
  );
}
