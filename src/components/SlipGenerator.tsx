import React, { useState } from 'react';
import { ParsedSelection, Slip, GroupingConfig } from '../engine/types';
import { generateSlipsAsync, DEFAULT_CONFIG } from '../engine/grouping-engine';

interface Props {
  selections: ParsedSelection[];
  stakedMatchKeys?: Set<string>;
  onGenerated: (slips: Slip[]) => void;
}

export default function SlipGenerator({ selections, stakedMatchKeys, onGenerated }: Props) {
  const [config, setConfig] = useState<GroupingConfig>({
    ...DEFAULT_CONFIG,
    noSameTeam: true,
    noSameKickoff: false,
  });
  const [generating, setGenerating] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  async function handleGenerate() {
    setGenerating(true);
    setWarning(null);
    setProgress(0);

    // Exclude matches already in staked slips
    const availableSelections = stakedMatchKeys && stakedMatchKeys.size > 0
      ? selections.filter(sel => {
          const key = `${sel.homeTeam.toLowerCase()}-${sel.awayTeam.toLowerCase()}`;
          return !stakedMatchKeys.has(key);
        })
      : selections;

    const slips = await generateSlipsAsync(availableSelections, {
      ...config,
      // Respect user's maxPicksPerSlip strictly, cap at 12 for performance safety
      maxPicksPerSlip: Math.min(12, config.maxPicksPerSlip),
    }, (found) => {
      setProgress(found);
    });

    setResultCount(slips.length);
    onGenerated(slips);
    setGenerating(false);

    if (config.targetOdds > 3.0) {
      setWarning('High target odds. Chain survival decreases significantly above 3.0. Stick to the rules.');
    } else if (config.targetOdds > 2.5) {
      setWarning('Moderate risk. Consider sticking to 2.0 for safer compounding.');
    }

    if (slips.length === 0) {
      setWarning('No slips could be generated with these settings. Try adjusting target odds or max picks.');
    }
  }

  return (
    <div>
      <h3 className="text-md font-semibold mb-3 text-blue-400">Slip Builder</h3>

      <div className="space-y-3">
        {/* Target Odds */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Target Accumulated Odds</label>
          <input
            type="number"
            step="any"
            min="1.5"
            value={config.targetOdds}
            onChange={(e) => {
              const target = parseFloat(e.target.value) || 3.0;
              // Wide range: ±30% of target to ensure matches are found
              const rangeMin = Math.max(1.5, target * 0.7);
              const rangeMax = target * 1.3;
              // Auto-calculate min/max picks based on odds math
              const safeMax = config.safeOddsRange.max || 1.50;
              const safeMin = config.safeOddsRange.min || 1.20;
              const autoMinPicks = Math.max(2, Math.ceil(Math.log(rangeMin) / Math.log(safeMax)));
              const autoMaxPicks = Math.min(12, Math.max(autoMinPicks + 1, Math.ceil(Math.log(rangeMax) / Math.log(safeMin))));
              setConfig({
                ...config,
                targetOdds: target,
                oddsRange: { min: rangeMin, max: rangeMax },
                minPicksPerSlip: autoMinPicks,
                maxPicksPerSlip: autoMaxPicks,
              });
            }}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-500">
            Range: {config.oddsRange.min.toFixed(1)} – {config.oddsRange.max.toFixed(1)}
          </span>
          {config.targetOdds > 2.5 && (
            <span className="text-xs text-yellow-400 block mt-1">
              ⚠ Higher odds = higher risk. Discipline says: 2 odds is enough.
            </span>
          )}
        </div>

        {/* Min/Max picks (auto-calculated, manually adjustable) */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">Min Picks</label>
            <input
              type="number"
              min="2"
              max="50"
              value={config.minPicksPerSlip}
              onChange={(e) => setConfig({ ...config, minPicksPerSlip: parseInt(e.target.value) || 2 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">Max Picks</label>
            <input
              type="number"
              min="2"
              max="50"
              value={config.maxPicksPerSlip}
              onChange={(e) => setConfig({ ...config, maxPicksPerSlip: parseInt(e.target.value) || 4 })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <span className="text-xs text-gray-500">
          Auto-adjusted for {config.targetOdds} target odds. Override manually if needed.
        </span>

        {/* Safe odds range */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Safe Odds Range (per pick)</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="number"
                step="0.05"
                min="1.01"
                value={config.safeOddsRange.min}
                onChange={(e) => setConfig({
                  ...config,
                  safeOddsRange: { ...config.safeOddsRange, min: parseFloat(e.target.value) || 1.2 }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">Min</span>
            </div>
            <div className="flex-1">
              <input
                type="number"
                step="0.05"
                min="1.01"
                value={config.safeOddsRange.max}
                onChange={(e) => setConfig({
                  ...config,
                  safeOddsRange: { ...config.safeOddsRange, max: parseFloat(e.target.value) || 1.5 }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">Max</span>
            </div>
          </div>
          <span className="text-xs text-gray-500">
            Picks outside this range are flagged as bold picks in generated slips
          </span>
        </div>

        {/* Constraints - toggleable */}
        <div className="p-2 bg-gray-800 rounded border border-gray-700">
          <label className="text-xs text-gray-400 block mb-1">Constraints</label>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.noSameTeam}
              onChange={(e) => setConfig({ ...config, noSameTeam: e.target.checked })}
              className="rounded"
            />
            No same team in slip
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.noSameKickoff}
              onChange={(e) => setConfig({ ...config, noSameKickoff: e.target.checked })}
              className="rounded"
            />
            No same kick-off time in slip
          </label>
        </div>

        {/* Max slips */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Max Slips to Generate</label>
          <input
            type="number"
            min="5"
            max="500"
            value={config.maxSlipsToGenerate}
            onChange={(e) => setConfig({ ...config, maxSlipsToGenerate: parseInt(e.target.value) || 50 })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={selections.length < config.minPicksPerSlip || generating}
          className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-bold text-sm"
        >
          {generating ? `Generating... (${progress} found)` : `Generate Slips (${selections.length} picks available)`}
        </button>

        {stakedMatchKeys && stakedMatchKeys.size > 0 && (
          <p className="text-xs text-gray-500 text-center">
            {stakedMatchKeys.size} match(es) excluded (already staked)
          </p>
        )}

        {resultCount !== null && (
          <p className="text-center text-sm">
            <span className="text-green-400 font-bold">{resultCount}</span>
            <span className="text-gray-400"> slips generated</span>
          </p>
        )}

        {warning && (
          <div className="p-2 bg-yellow-900/40 border border-yellow-700 rounded text-xs text-yellow-300">
            ⚠ {warning}
          </div>
        )}
      </div>
    </div>
  );
}
