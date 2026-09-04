import React, { useState, useMemo, useEffect } from 'react';
import { ParsedSelection } from '../engine/types';
import { interpretMarket, getMarketCategory } from '../engine/market-interpreter';
import { ScoringResult } from '../engine/scoring';
import { computeMatchIntelligence, MatchIntelligence, getFormString, getGoalAverages } from '../engine/intelligence-hints';
import { getAllMatches } from '../engine/historical-stats';
import { hasLocalData, crawlMatchHistory } from '../engine/match-crawl';
import MatchStatsModal from './MatchStatsModal';

interface Props {
  selections: ParsedSelection[];
  scores?: Map<string, ScoringResult>;
  onUpdateOdds?: (selectionId: string, newOdds: number) => void;
  onRemoveSelection?: (selectionId: string) => void;
  onUseFiltered?: (filtered: ParsedSelection[] | null) => void;
  onExportSelections?: () => void;
  onImportSelections?: (file: File) => void;
  onClearSelections?: () => void;
  onAnalyze?: (homeTeam: string, awayTeam: string, league: string) => void;
}

export default function SelectionList({ selections, scores, onUpdateOdds, onRemoveSelection, onUseFiltered, onExportSelections, onImportSelections, onClearSelections, onAnalyze }: Props) {
  const [pickFilter, setPickFilter] = useState<string>('all');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [oddsMin, setOddsMin] = useState<string>('');
  const [oddsMax, setOddsMax] = useState<string>('');
  const [futureOnly, setFutureOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'kickoff' | 'odds_asc' | 'odds_desc' | 'team' | 'score_desc'>('kickoff');
  const [statsModal, setStatsModal] = useState<ParsedSelection | null>(null);
  const [intelCache, setIntelCache] = useState<Map<string, MatchIntelligence>>(new Map());
  const [analyzingAll, setAnalyzingAll] = useState(false);
  // Batch pre-crawl state (populates the DB for a whole day's fixtures at once)
  const [preCrawling, setPreCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<{ done: number; total: number; added: number; msg: string } | null>(null);

  // Compute intelligence for all unique fixtures (lazy on demand)
  async function analyzeAllFixtures() {
    setAnalyzingAll(true);
    const allMatches = getAllMatches();
    if (allMatches.length === 0) { setAnalyzingAll(false); return; }
    const cache = new Map<string, MatchIntelligence>();
    const seen = new Set<string>();
    for (const sel of selections) {
      const key = `${sel.homeTeam}|${sel.awayTeam}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const intel = computeMatchIntelligence(sel.homeTeam, sel.awayTeam, allMatches);
      cache.set(key, intel);
    }
    setIntelCache(cache);
    setAnalyzingAll(false);
  }

  function getIntel(sel: ParsedSelection): MatchIntelligence | undefined {
    return intelCache.get(`${sel.homeTeam}|${sel.awayTeam}`);
  }

  /**
   * Batch pre-crawl: fetch + cache history for every fixture currently in the
   * `filtered` view (typically one selected day) that lacks local data. Runs
   * sequentially so we don't hammer the proxy, skips fixtures already covered,
   * and persists to the DB — so subsequent Analyze/Intel are instant. Fixtures
   * are deduped by team pair so both picks on the same match crawl once.
   */
  async function preCrawlFiltered(fixtures: ParsedSelection[]) {
    // Unique fixtures by team pair
    const seen = new Set<string>();
    const unique: ParsedSelection[] = [];
    for (const s of fixtures) {
      const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(s);
    }
    // Only those missing local data
    const toCrawl = unique.filter(s => !hasLocalData(s.homeTeam, s.awayTeam));
    if (toCrawl.length === 0) {
      setCrawlProgress({ done: 0, total: 0, added: 0, msg: 'All fixtures already have local data — nothing to crawl.' });
      setTimeout(() => setCrawlProgress(null), 4000);
      return;
    }

    setPreCrawling(true);
    let totalAdded = 0;
    for (let i = 0; i < toCrawl.length; i++) {
      const s = toCrawl[i];
      setCrawlProgress({ done: i, total: toCrawl.length, added: totalAdded, msg: `${s.homeTeam.split(' ')[0]} v ${s.awayTeam.split(' ')[0]}…` });
      try {
        const res = await crawlMatchHistory(s.homeTeam, s.awayTeam);
        totalAdded += res.added;
      } catch { /* best-effort — one failure doesn't stop the batch */ }
    }
    setCrawlProgress({ done: toCrawl.length, total: toCrawl.length, added: totalAdded, msg: `Done — added ${totalAdded} results across ${toCrawl.length} fixtures.` });
    setPreCrawling(false);
    // Refresh intel cache from the now-enriched DB
    analyzeAllFixtures();
    setTimeout(() => setCrawlProgress(null), 6000);
  }

  if (selections.length === 0) return null;

  // Get unique picks and market categories from actual data
  const uniquePicks = useMemo(() => {
    const picks = new Set(selections.map(s => s.pick));
    return Array.from(picks).sort();
  }, [selections]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(selections.map(s => getMarketCategory(s)));
    return Array.from(cats).sort();
  }, [selections]);

  // Group selections by their real calendar day (from kickOffDateTime), sorted
  // chronologically. Each entry: { key: 'YYYY-MM-DD', label: 'Tue 02 Sep', count }
  const dayGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; ts: number }>();
    for (const s of selections) {
      const d = s.kickOffDateTime ? new Date(s.kickOffDateTime) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) {
        const label = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
        map.set(key, { key, label, count: 0, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
      }
      map.get(key)!.count++;
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [selections]);

  const filtered = selections.filter(s => {
    const pickMatch = pickFilter === 'all' || s.pick === pickFilter;
    const catMatch = marketFilter === 'all' || getMarketCategory(s) === marketFilter;

    // Day filter — compare the selection's real calendar day to the chosen day key
    let dateMatch = true;
    if (dateFilter !== 'all') {
      const d = s.kickOffDateTime ? new Date(s.kickOffDateTime) : null;
      if (!d || isNaN(d.getTime())) {
        dateMatch = false;
      } else {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dateMatch = key === dateFilter;
      }
    }

    // Date range filter
    let rangeMatch = true;
    if (dateFrom || dateTo) {
      const kickOff = s.kickOffDateTime ? new Date(s.kickOffDateTime).getTime() : 0;
      if (dateFrom && kickOff) {
        const from = new Date(dateFrom).getTime();
        if (kickOff < from) rangeMatch = false;
      }
      if (dateTo && kickOff) {
        const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000; // End of day
        if (kickOff > to) rangeMatch = false;
      }
    }

    // Odds range filter
    let oddsMatch = true;
    const oMin = parseFloat(oddsMin);
    const oMax = parseFloat(oddsMax);
    if (!isNaN(oMin) && s.odds < oMin) oddsMatch = false;
    if (!isNaN(oMax) && s.odds > oMax) oddsMatch = false;

    // Future-only filter
    let futureMatch = true;
    if (futureOnly) {
      const kickoff = s.kickOffDateTime ? new Date(s.kickOffDateTime).getTime() : NaN;
      if (!isNaN(kickoff) && kickoff <= Date.now() - 5 * 60 * 1000) futureMatch = false;
    }

    return pickMatch && catMatch && dateMatch && rangeMatch && oddsMatch && futureMatch;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'kickoff': return new Date(a.kickOffDateTime).getTime() - new Date(b.kickOffDateTime).getTime();
      case 'odds_asc': return a.odds - b.odds;
      case 'odds_desc': return b.odds - a.odds;
      case 'team': return a.homeTeam.localeCompare(b.homeTeam);
      case 'score_desc': return (scores?.get(b.id)?.score || 0) - (scores?.get(a.id)?.score || 0);
      default: return 0;
    }
  });

  // Continuously feed the current filtered+sorted view to the slip generator, so
  // "what you see is what you generate". When no narrowing filter is active we
  // report null (generator uses the full pool). Keyed on the filter/sort INPUTS
  // (not the `filtered` array reference) to avoid an update loop.
  const anyFilterActive = pickFilter !== 'all' || marketFilter !== 'all' ||
    dateFilter !== 'all' || !!dateFrom || !!dateTo || !!oddsMin || !!oddsMax || futureOnly;
  useEffect(() => {
    if (!onUseFiltered) return;
    onUseFiltered(anyFilterActive ? filtered : null as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickFilter, marketFilter, dateFilter, dateFrom, dateTo, oddsMin, oddsMax, futureOnly, sortBy, selections]);

  // Detect matches with multiple picks
  const matchPickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    selections.forEach(s => {
      const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [selections]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-md font-semibold text-green-400">
          Active Selections ({selections.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={analyzeAllFixtures}
            disabled={analyzingAll}
            className="px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 rounded text-xs text-white font-medium"
          >
            {analyzingAll ? 'Analyzing...' : intelCache.size > 0 ? `Intel (${intelCache.size})` : 'Analyze All'}
          </button>
          {onExportSelections && selections.length > 0 && (
            <button
              onClick={onExportSelections}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 font-medium"
              title="Export selection list as JSON"
            >
              Export
            </button>
          )}
          {onImportSelections && (
            <label className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 font-medium cursor-pointer" title="Import selections from JSON file">
              Import
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportSelections(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {onClearSelections && selections.length > 0 && (
            <button
              onClick={onClearSelections}
              className="px-2 py-1 bg-gray-700 hover:bg-red-900 rounded text-xs text-gray-400 hover:text-red-300 font-medium"
              title="Clear all selections"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Filter by Pick and Market */}
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Pick:</span>
          <select
            value={pickFilter}
            onChange={(e) => setPickFilter(e.target.value)}
            className="px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All ({selections.length})</option>
            {uniquePicks.map(p => (
              <option key={p} value={p}>
                {p} ({selections.filter(s => s.pick === p).length})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Market:</span>
          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value)}
            className="px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All</option>
            {uniqueCategories.map(c => (
              <option key={c} value={c}>
                {c} ({selections.filter(s => getMarketCategory(s) === c).length})
              </option>
            ))}
          </select>
        </div>

        {(pickFilter !== 'all' || marketFilter !== 'all') && (
          <button
            onClick={() => { setPickFilter('all'); setMarketFilter('all'); setDateFilter('all'); setDateFrom(''); setDateTo(''); }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        )}

        {(pickFilter !== 'all' || marketFilter !== 'all' || dateFilter !== 'all' || dateFrom || dateTo) && onUseFiltered && filtered.length >= 2 && (
          <button
            onClick={() => onUseFiltered(filtered)}
            className="text-xs px-2 py-0.5 bg-green-700 hover:bg-green-600 rounded text-white font-medium"
            title="Build slips from just these picks — your full list stays intact"
          >
            Build slips from these {filtered.length}
          </button>
        )}

        {/* Batch pre-crawl — populate the DB for all filtered fixtures at once */}
        {filtered.length >= 1 && (
          <button
            onClick={() => preCrawlFiltered(filtered)}
            disabled={preCrawling}
            className="text-xs px-2 py-0.5 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-600 rounded text-white font-medium flex items-center gap-1"
            title="Crawl & cache historical data for every fixture shown here (skips ones already covered). Makes Analyze instant."
          >
            {preCrawling ? 'Pre-crawling…' : `⟳ Pre-crawl ${filtered.length !== selections.length ? 'these ' + filtered.length : 'all'}`}
          </button>
        )}

        <span className="text-xs text-gray-600 ml-auto">
          {filtered.length !== selections.length && `${filtered.length}/${selections.length}`}
        </span>
      </div>

      {/* Pre-crawl progress */}
      {crawlProgress && (
        <div className="mb-2 p-2 bg-indigo-900/30 border border-indigo-800 rounded">
          <div className="flex items-center justify-between text-[11px] text-indigo-200 mb-1">
            <span>{crawlProgress.msg}</span>
            {crawlProgress.total > 0 && <span className="text-indigo-400">{crawlProgress.done}/{crawlProgress.total} · +{crawlProgress.added}</span>}
          </div>
          {crawlProgress.total > 0 && (
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((crawlProgress.done / crawlProgress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Day chips — one-click filter by calendar day (chronological) */}
      {dayGroups.length > 1 && (
        <div className="mb-2">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs text-gray-500">Days:</span>
            <span className="text-[10px] text-gray-600">{dayGroups.length} match-days · click to filter</span>
          </div>
          <div className="flex gap-1 flex-wrap max-h-24 overflow-y-auto">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                dateFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              All ({selections.length})
            </button>
            {dayGroups.map(g => (
              <button
                key={g.key}
                onClick={() => setDateFilter(dateFilter === g.key ? 'all' : g.key)}
                className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                  dateFilter === g.key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {g.label} <span className={dateFilter === g.key ? 'text-blue-200' : 'text-gray-500'}>({g.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date range & Sort */}
      <div className="flex gap-2 mb-2 items-center flex-wrap">
        {/* Date Range */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">From:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">To:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-gray-500 hover:text-gray-300">
            Clear range
          </button>
        )}

        {/* Odds range filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Odds:</span>
          <input
            type="number" step="0.05" placeholder="min" value={oddsMin}
            onChange={(e) => setOddsMin(e.target.value)}
            className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-600">–</span>
          <input
            type="number" step="0.05" placeholder="max" value={oddsMax}
            onChange={(e) => setOddsMax(e.target.value)}
            className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          />
          {(oddsMin || oddsMax) && (
            <button onClick={() => { setOddsMin(''); setOddsMax(''); }} className="text-[10px] text-gray-500 hover:text-gray-300">✕</button>
          )}
        </div>

        {/* Future-only quick filter */}
        <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={futureOnly} onChange={(e) => setFutureOnly(e.target.checked)} className="rounded" />
          Future only
        </label>

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="kickoff">Kick-off time</option>
            <option value="odds_asc">Odds (low to high)</option>
            <option value="odds_desc">Odds (high to low)</option>
            <option value="score_desc">Confidence (high to low)</option>
            <option value="team">Team name (A-Z)</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="py-2 px-2 text-left">#</th>
              <th className="py-2 px-2 text-left">Date</th>
              <th className="py-2 px-2 text-left">Match</th>
              <th className="py-2 px-2 text-left">Pick</th>
              <th className="py-2 px-2 text-left">Market</th>
              <th className="py-2 px-2 text-right">Odds</th>
              {scores && <th className="py-2 px-2 text-center">Score</th>}
              {onRemoveSelection && <th className="py-2 px-2 w-6"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((sel, idx) => {
              const matchKey = `${sel.homeTeam.toLowerCase()}|${sel.awayTeam.toLowerCase()}`;
              const multiPick = matchPickCounts[matchKey] > 1;
              return (
                <tr key={sel.id} className="border-b border-gray-800 hover:bg-gray-800">
                  <td className="py-2 px-2 text-gray-500">{idx + 1}</td>
                  <td className="py-2 px-2 text-gray-400">
                    {sel.date} {sel.time}
                  </td>
                  <td className="py-2 px-2">
                    <div
                      className="cursor-pointer hover:bg-gray-750 rounded px-1 -mx-1"
                      onClick={() => setStatsModal(sel)}
                    >
                      <span className="text-gray-200">{sel.homeTeam}</span>
                      <span className="text-gray-500"> v </span>
                      <span className="text-gray-200">{sel.awayTeam}</span>
                      {multiPick && <span className="ml-1 text-xs text-purple-400" title="Multiple picks for this match">●</span>}
                      {/* Inline intelligence indicators */}
                      {(() => {
                        const intel = getIntel(sel);
                        if (!intel) return null;
                        const homeForm = getFormString(intel.homeTeam.homeForm);
                        const awayForm = getFormString(intel.awayTeam.awayForm);
                        const topHint = [...intel.homeTeam.hints, ...intel.awayTeam.hints, ...intel.h2hHints]
                          .filter(h => h.strength === 'strong')[0];
                        return (
                          <div className="flex items-center gap-2 mt-0.5">
                            {homeForm && (
                              <span className="text-[9px] text-gray-500">
                                H: {homeForm.split('').map((r, i) => (
                                  <span key={i} className={r === 'W' ? 'text-green-400' : r === 'L' ? 'text-red-400' : 'text-yellow-400'}>{r}</span>
                                ))}
                              </span>
                            )}
                            {awayForm && (
                              <span className="text-[9px] text-gray-500">
                                A: {awayForm.split('').map((r, i) => (
                                  <span key={i} className={r === 'W' ? 'text-green-400' : r === 'L' ? 'text-red-400' : 'text-yellow-400'}>{r}</span>
                                ))}
                              </span>
                            )}
                            {topHint && (
                              <span className="text-[9px] text-green-400">{topHint.icon} {topHint.text.substring(0, 35)}{topHint.text.length > 35 ? '...' : ''}</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`font-medium ${sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {sel.pick}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-400">
                    <span title={`${sel.market}${sel.market !== sel.pick ? ' → ' + sel.pick : ''}`} className="cursor-help border-b border-dotted border-gray-600">
                      {interpretMarket(sel)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {onUpdateOdds ? (
                      <input
                        type="number"
                        step="0.01"
                        min="1.01"
                        defaultValue={sel.odds.toFixed(2)}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (val && val >= 1.01 && val !== sel.odds) {
                            onUpdateOdds(sel.id, val);
                          }
                        }}
                        className="w-14 px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-right font-mono text-green-300 focus:outline-none focus:border-blue-500"
                      />
                    ) : (
                      <span className={`font-mono ${sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-300'}`}>
                        {sel.odds.toFixed(2)}
                      </span>
                    )}
                  </td>
                  {scores && (() => {
                    const result = scores.get(sel.id);
                    const score = result?.score ?? 0;
                    const colorClass = !result ? 'bg-gray-700 text-gray-500'
                      : score >= 75 ? 'bg-green-900 text-green-300'
                      : score >= 60 ? 'bg-yellow-900 text-yellow-300'
                      : score >= 40 ? 'bg-orange-900 text-orange-300'
                      : 'bg-red-900 text-red-300';
                    return (
                      <td className="py-2 px-2 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${colorClass}`}
                          title={result?.factors?.map(f => `${f.name}: ${f.points}/${f.maxPoints} — ${f.detail}`).join('\n') || 'No data'}
                        >
                          {result ? score : '-'}
                        </span>
                      </td>
                    );
                  })()}
                  {onAnalyze && (
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => onAnalyze(sel.homeTeam, sel.awayTeam, '')}
                        className="text-gray-600 hover:text-blue-400 text-[10px]"
                        title="Analyze this fixture"
                      >
                        Analyze
                      </button>
                    </td>
                  )}
                  {onRemoveSelection && (
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => onRemoveSelection(sel.id)}
                        className="text-gray-600 hover:text-red-400 text-xs"
                        title="Remove"
                      >
                        ✗
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Match Stats Modal */}
      {statsModal && (
        <MatchStatsModal
          selection={statsModal}
          selResult="pending"
          onClose={() => setStatsModal(null)}
        />
      )}
    </div>
  );
}
