import React, { useState } from 'react';
import { Slip, Chain, ParsedSelection } from '../engine/types';
import { formatSlipForClipboard, copyToClipboard } from '../lib/clipboard';
import { slipWinProbability } from '../engine/grouping-engine';
import MatchStatsModal from './MatchStatsModal';

interface GSProps {
  scores?: Map<string, number>;
}

interface Props {
  slips: Slip[];
  activeChains?: Chain[];
  allSelections?: ParsedSelection[];
  onSlipStaked?: (slip: Slip, chainId?: string, label?: string) => string | null;
  onRemoveSlip?: (slipId: string) => void;
  onRemovePick?: (slipId: string, selectionId: string) => void;
}

export default function GeneratedSlips({ slips, activeChains, allSelections, onSlipStaked, onRemoveSlip, onRemovePick, scores }: Props & GSProps) {
  const [expandedSlip, setExpandedSlip] = useState<string | null>(null);
  const [stakedIds, setStagedIds] = useState<Set<string>>(new Set());
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'quality' | 'odds' | 'picks' | 'kickoff'>('quality');
  const [sortAsc, setSortAsc] = useState(false);
  const [slipLabel, setSlipLabel] = useState<string>('');
  const [showOmitted, setShowOmitted] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [statsModal, setStatsModal] = useState<ParsedSelection | null>(null); // analyze-from-slip
  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [oddsMin, setOddsMin] = useState<string>('');
  const [oddsMax, setOddsMax] = useState<string>('');
  const [minPicks, setMinPicks] = useState<string>('');
  const [maxPicks, setMaxPicks] = useState<string>('');
  const [minWinPct, setMinWinPct] = useState<string>('');
  const [safeOnly, setSafeOnly] = useState(false);

  function handleStake(slip: Slip) {
    setStakeError(null);
    if (onSlipStaked) {
      const error = onSlipStaked(slip, selectedChain || undefined, slipLabel || undefined);
      if (error) {
        setStakeError(error);
        return;
      }
    }
    setStagedIds(prev => new Set(prev).add(slip.id));
    setBatchSelected(prev => { const n = new Set(prev); n.delete(slip.id); return n; });
    setSlipLabel('');
  }

  function handleBatchStake() {
    if (!onSlipStaked) return;
    let errors: string[] = [];
    for (const slipId of batchSelected) {
      const slip = slips.find(s => s.id === slipId);
      if (!slip) continue;
      const error = onSlipStaked(slip, selectedChain || undefined, '');
      if (error) { errors.push(error); break; }
      setStagedIds(prev => new Set(prev).add(slipId));
    }
    if (errors.length > 0) setStakeError(errors[0]);
    setBatchSelected(new Set());
  }

  function toggleBatchSelect(slipId: string) {
    setBatchSelected(prev => {
      const n = new Set(prev);
      if (n.has(slipId)) n.delete(slipId);
      else n.add(slipId);
      return n;
    });
  }

  if (slips.length === 0) return null;

  // Filter out already staked slips — they move to Active Slips tab
  const filteredSlips = slips.filter(slip => {
    if (stakedIds.has(slip.id)) return false;

    // Odds range
    const oMin = parseFloat(oddsMin);
    const oMax = parseFloat(oddsMax);
    if (!isNaN(oMin) && slip.accumulatedOdds < oMin) return false;
    if (!isNaN(oMax) && slip.accumulatedOdds > oMax) return false;

    // Pick count range
    const pMin = parseInt(minPicks);
    const pMax = parseInt(maxPicks);
    if (!isNaN(pMin) && slip.selectionCount < pMin) return false;
    if (!isNaN(pMax) && slip.selectionCount > pMax) return false;

    // Minimum win probability
    const wMin = parseFloat(minWinPct);
    if (!isNaN(wMin)) {
      const winPct = slipWinProbability(slip.selections, scores) * 100;
      if (winPct < wMin) return false;
    }

    // Safe only — no bold/high-risk picks
    if (safeOnly && slip.hasHighRiskPick) return false;

    return true;
  });

  // Sort
  const visibleSlips = [...filteredSlips].sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case 'quality': diff = b.qualityScore - a.qualityScore; break;
      case 'odds': diff = a.accumulatedOdds - b.accumulatedOdds; break;
      case 'picks': diff = a.selectionCount - b.selectionCount; break;
      case 'kickoff':
        const aFirst = Math.min(...a.selections.map(s => s.kickOffDateTime.getTime()));
        const bFirst = Math.min(...b.selections.map(s => s.kickOffDateTime.getTime()));
        diff = aFirst - bFirst;
        break;
    }
    return sortAsc ? -diff : diff;
  });

  const anyFilterActive = !!(oddsMin || oddsMax || minPicks || maxPicks || minWinPct || safeOnly);

  return (
    <div className="space-y-2">
      {/* Sort controls + batch actions */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        <span className="text-xs text-gray-500">Sort:</span>
        {(['quality', 'odds', 'picks', 'kickoff'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-2 py-0.5 rounded text-xs capitalize ${
              sortBy === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {s === 'kickoff' ? 'kick-off' : s}
          </button>
        ))}
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-400 hover:bg-gray-600"
          title={sortAsc ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
        >
          {sortAsc ? '↑' : '↓'}
        </button>
        <span className="mx-1 text-gray-700">|</span>
        <button
          onClick={() => setCompareMode(!compareMode)}
          className={`px-2 py-0.5 rounded text-xs ${
            compareMode ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {compareMode ? 'Exit Compare' : 'Compare'}
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-2 py-0.5 rounded text-xs ${
            showFilters ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          Filters{(oddsMin || oddsMax || minPicks || maxPicks || minWinPct || safeOnly) ? ' •' : ''}
        </button>
        {batchSelected.size > 0 && (
          <button
            onClick={handleBatchStake}
            className="px-2 py-0.5 rounded text-xs bg-green-700 hover:bg-green-600 text-white font-medium"
          >
            Stake {batchSelected.size} Selected
          </button>
        )}
        <span className="text-xs text-gray-600 ml-auto">
          {visibleSlips.length !== filteredSlips.length || visibleSlips.length !== slips.length
            ? `${visibleSlips.length} shown`
            : `${slips.length} slips`}
        </span>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="p-2 mb-1 bg-gray-800 rounded border border-gray-700 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 w-20">Odds range:</span>
            <input
              type="number" step="0.1" placeholder="min" value={oddsMin}
              onChange={(e) => setOddsMin(e.target.value)}
              className="w-16 px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-600">–</span>
            <input
              type="number" step="0.1" placeholder="max" value={oddsMax}
              onChange={(e) => setOddsMax(e.target.value)}
              className="w-16 px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 w-20">Picks:</span>
            <input
              type="number" min="2" placeholder="min" value={minPicks}
              onChange={(e) => setMinPicks(e.target.value)}
              className="w-16 px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-600">–</span>
            <input
              type="number" min="2" placeholder="max" value={maxPicks}
              onChange={(e) => setMaxPicks(e.target.value)}
              className="w-16 px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 w-20">Min win %:</span>
            <input
              type="number" min="0" max="100" placeholder="e.g. 40" value={minWinPct}
              onChange={(e) => setMinWinPct(e.target.value)}
              className="w-16 px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer ml-2">
              <input type="checkbox" checked={safeOnly} onChange={(e) => setSafeOnly(e.target.checked)} className="rounded" />
              Safe only (no bold picks)
            </label>
          </div>
          {(oddsMin || oddsMax || minPicks || maxPicks || minWinPct || safeOnly) && (
            <button
              onClick={() => { setOddsMin(''); setOddsMax(''); setMinPicks(''); setMaxPicks(''); setMinWinPct(''); setSafeOnly(false); }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Empty state (after controls so filters can be cleared) */}
      {visibleSlips.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">
          {anyFilterActive
            ? 'No slips match the current filters. Adjust or clear them above.'
            : 'All generated slips have been staked. Generate more or adjust settings.'}
        </p>
      )}

      {/* Compare view: side-by-side */}
      {compareMode && batchSelected.size >= 2 && (() => {
        const compared = visibleSlips.filter(s => batchSelected.has(s.id)).slice(0, 3);
        return (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3 p-2 bg-gray-900 rounded border border-purple-900">
            {compared.map((slip, ci) => (
              <div key={slip.id} className="bg-gray-800 rounded p-2">
                <div className="text-xs font-bold text-purple-300 mb-1">
                  Slip #{visibleSlips.indexOf(slip) + 1} — {slip.accumulatedOdds.toFixed(2)} odds (Q:{slip.qualityScore})
                </div>
                <div className="space-y-0.5">
                  {slip.selections.map(sel => (
                    <div key={sel.id} className="text-xs text-gray-400 truncate">
                      <span className="text-gray-300">{sel.homeTeam}</span>
                      <span className="text-gray-600"> v </span>
                      <span className="text-gray-300">{sel.awayTeam}</span>
                      <span className={`ml-1 ${sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {sel.pick} @{sel.odds.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {visibleSlips.map((slip, idx) => (
        <div
          key={slip.id}
          className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden"
        >
          <div
            onClick={() => setExpandedSlip(expandedSlip === slip.id ? null : slip.id)}
            className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
          >
            <div className="flex items-center gap-3">
              {(compareMode || batchSelected.size > 0) && (
                <input
                  type="checkbox"
                  checked={batchSelected.has(slip.id)}
                  onChange={(e) => { e.stopPropagation(); toggleBatchSelect(slip.id); }}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded"
                />
              )}
              <span className="text-xs text-gray-500 font-mono">#{idx + 1}</span>
              <span className="text-sm font-bold text-white">
                {slip.accumulatedOdds.toFixed(2)} odds
              </span>
              <span className="text-xs text-gray-400">
                {slip.selectionCount} picks
              </span>
              {(() => {
                const winProb = Math.round(slipWinProbability(slip.selections, scores) * 100);
                const color = winProb >= 55 ? 'bg-green-900 text-green-300'
                  : winProb >= 40 ? 'bg-yellow-900 text-yellow-300'
                  : 'bg-red-900 text-red-300';
                return (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`} title="Estimated probability the whole slip wins">
                    {winProb}% win
                  </span>
                );
              })()}
              {slip.hasHighRiskPick && (
                <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">
                  bold pick
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Q: {slip.qualityScore}
              </span>
              {onRemoveSlip && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveSlip(slip.id); }}
                  className="text-xs text-gray-600 hover:text-red-400 px-1"
                  title="Remove slip"
                >
                  ✗
                </button>
              )}
              <span className="text-gray-500 text-xs">
                {expandedSlip === slip.id ? '▲' : '▼'}
              </span>
            </div>
          </div>

          {expandedSlip === slip.id && (
            <div className="border-t border-gray-700 p-3">
              <table className="w-full text-xs">
                <tbody>
                  {[...slip.selections]
                    .sort((a, b) => new Date(a.kickOffDateTime).getTime() - new Date(b.kickOffDateTime).getTime())
                    .map((sel, selIdx) => (
                    <tr key={sel.id} className="border-b border-gray-800 last:border-0">
                      <td className="py-1.5 text-gray-600 w-5">{selIdx + 1}</td>
                      <td className="py-1.5 text-gray-400">
                        {sel.date} {sel.time}
                      </td>
                      <td className="py-1.5">
                        <span
                          className="cursor-pointer hover:text-blue-300 rounded px-1 -mx-1"
                          onClick={() => setStatsModal(sel)}
                          title="Analyze this fixture (Form, Stats, Intel)"
                        >
                          <span className="text-gray-200">{sel.homeTeam}</span>
                          <span className="text-gray-500"> v </span>
                          <span className="text-gray-200">{sel.awayTeam}</span>
                          <span className="ml-1 text-[9px] text-blue-500">🔍</span>
                        </span>
                      </td>
                      <td className="py-1.5">
                        <span className={sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-400'}>
                          {sel.pick}
                        </span>
                      </td>
                      <td className="py-1.5 text-gray-500">{sel.market}</td>
                      <td className="py-1.5 text-right font-mono">
                        <span className={sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-300'}>
                          @{sel.odds.toFixed(2)}
                        </span>
                      </td>
                      {onRemovePick && slip.selectionCount > 2 && (
                        <td className="py-1.5 text-right w-6">
                          <button
                            onClick={() => onRemovePick(slip.id, sel.id)}
                            className="text-gray-600 hover:text-red-400 text-xs"
                            title="Remove this pick"
                          >
                            ✗
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3">
                {/* Slip label/note */}
                <input
                  type="text"
                  placeholder="Slip label (optional, e.g. Evening slip)"
                  value={slipLabel}
                  onChange={(e) => setSlipLabel(e.target.value)}
                  className="w-full px-2 py-1 mb-2 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
                {activeChains && activeChains.length > 0 && (
                  <div className="mb-2">
                    <select
                      value={selectedChain}
                      onChange={(e) => setSelectedChain(e.target.value)}
                      className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">No chain (standalone)</option>
                      {activeChains.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.label} — Step {c.current_step} (₦{c.current_stake.toFixed(0)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => handleStake(slip)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
                >
                  Mark as Staked
                </button>
                <button
                  onClick={async () => {
                    const text = formatSlipForClipboard(slip);
                    const ok = await copyToClipboard(text);
                    if (ok) {
                      setCopied(slip.id);
                      setTimeout(() => setCopied(null), 2000);
                    }
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-gray-300"
                >
                  {copied === slip.id ? '✓ Copied' : 'Copy'}
                </button>
                {allSelections && allSelections.length > slip.selectionCount && (
                  <button
                    onClick={() => setShowOmitted(showOmitted === slip.id ? null : slip.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium ${
                      showOmitted === slip.id ? 'bg-orange-700 text-white' : 'bg-gray-700 hover:bg-orange-900 text-orange-300'
                    }`}
                  >
                    {showOmitted === slip.id ? 'Hide Omitted' : 'Show Omitted'}
                  </button>
                )}
                {stakeError && expandedSlip === slip.id && (
                  <p className="mt-2 text-xs text-red-400">{stakeError}</p>
                )}

                {/* Omitted matches list (for Rebet workflow) */}
                {showOmitted === slip.id && allSelections && (() => {
                  const slipMatchKeys = new Set(
                    slip.selections.map(s => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`)
                  );
                  const now = Date.now();
                  const GRACE_MS = 5 * 60 * 1000;
                  const omitted = allSelections.filter(s => {
                    const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}`;
                    if (slipMatchKeys.has(key)) return false;
                    // Exclude fixtures that already started — not valid rebet candidates
                    const kickoff = new Date(s.kickOffDateTime).getTime();
                    if (!isNaN(kickoff) && kickoff <= now - GRACE_MS) return false;
                    return true;
                  });

                  const pastExcluded = allSelections.filter(s => {
                    const kickoff = new Date(s.kickOffDateTime).getTime();
                    return !isNaN(kickoff) && kickoff <= now - GRACE_MS;
                  }).length;

                  return (
                    <div className="mt-3 p-3 bg-gray-900 rounded border border-orange-900">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-orange-400 font-medium">
                          REMOVE these {omitted.length} future matches (keep {slip.selectionCount})
                          {pastExcluded > 0 && <span className="text-gray-500 font-normal"> · {pastExcluded} already-started hidden</span>}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={async () => {
                              // Rebet Template: shows original index positions for fast deletion
                              const indexedOmit = omitted.map(s => {
                                const origIdx = allSelections.findIndex(a =>
                                  a.homeTeam.toLowerCase() === s.homeTeam.toLowerCase() &&
                                  a.awayTeam.toLowerCase() === s.awayTeam.toLowerCase()
                                );
                                return { idx: origIdx + 1, match: `${s.homeTeam} v ${s.awayTeam}` };
                              }).sort((a, b) => b.idx - a.idx); // Reverse order for deletion (delete from bottom up)
                              const lines = indexedOmit.map(x => `#${x.idx} ${x.match}`);
                              const text = `DELETE ${omitted.length} (from bottom up):\n${lines.join('\n')}\n\nKEEP ${slip.selectionCount} picks → ${slip.accumulatedOdds.toFixed(2)} odds`;
                              const ok = await copyToClipboard(text);
                              if (ok) {
                                setCopied(`rebet-${slip.id}`);
                                setTimeout(() => setCopied(null), 2000);
                              }
                            }}
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              copied === `rebet-${slip.id}` ? 'bg-green-700 text-white' : 'bg-purple-800 hover:bg-purple-700 text-purple-200'
                            }`}
                          >
                            {copied === `rebet-${slip.id}` ? '✓ Copied' : 'Rebet Template'}
                          </button>
                          <button
                            onClick={async () => {
                              const lines = omitted.map((s, i) => `${i + 1}. ${s.homeTeam} v ${s.awayTeam}`);
                              const text = `REMOVE ${omitted.length} matches (keep ${slip.selectionCount}):\n\n${lines.join('\n')}`;
                              const ok = await copyToClipboard(text);
                              if (ok) {
                                setCopied(`omit-${slip.id}`);
                                setTimeout(() => setCopied(null), 2000);
                              }
                            }}
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              copied === `omit-${slip.id}` ? 'bg-green-700 text-white' : 'bg-orange-800 hover:bg-orange-700 text-orange-200'
                            }`}
                          >
                            {copied === `omit-${slip.id}` ? '✓ Copied' : 'Copy List'}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {omitted.map((s, i) => {
                          const origIdx = allSelections.findIndex(a =>
                            a.homeTeam.toLowerCase() === s.homeTeam.toLowerCase() &&
                            a.awayTeam.toLowerCase() === s.awayTeam.toLowerCase()
                          );
                          return (
                            <div key={s.id} className="text-xs text-gray-400 flex gap-2">
                              <span className="text-orange-600 w-7 text-right font-mono">#{origIdx + 1}</span>
                              <span>{s.homeTeam} v {s.awayTeam}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Analyze-from-slip modal */}
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
