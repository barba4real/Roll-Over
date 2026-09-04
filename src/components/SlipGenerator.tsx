import React, { useState } from 'react';
import { ParsedSelection, Slip, GroupingConfig } from '../engine/types';
import { generateSlipsAsync, generateSlipsByWave, DEFAULT_CONFIG, countPastFixtures, coverageReport, getEligible } from '../engine/grouping-engine';

/**
 * Build a kickoff window (ISO datetime-local strings) for a named tier, based on
 * the fixtures actually present. Tiers split the day: Morning < 12:00,
 * Afternoon 12:00–17:00, Evening >= 17:00. Uses the most common fixture date.
 */
function tierWindow(selections: ParsedSelection[], tier: 'morning' | 'afternoon' | 'evening'): { from: string; to: string } | null {
  const future = selections.filter(s => s.kickOffDateTime);
  if (future.length === 0) return null;
  // Use the earliest upcoming fixture's date as the anchor day
  const dates = future.map(s => new Date(s.kickOffDateTime)).sort((a, b) => a.getTime() - b.getTime());
  const anchor = dates[0];
  const y = anchor.getFullYear();
  const m = (anchor.getMonth() + 1).toString().padStart(2, '0');
  const d = anchor.getDate().toString().padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const ranges = {
    morning: ['00:00', '11:59'],
    afternoon: ['12:00', '16:59'],
    evening: ['17:00', '23:59'],
  } as const;
  const [start, end] = ranges[tier];
  return { from: `${dateStr}T${start}`, to: `${dateStr}T${end}` };
}

interface Props {
  selections: ParsedSelection[];
  onGenerated: (slips: Slip[]) => void;
  /** Confidence scores per selection id (0-100). Drives which picks are chosen. */
  scores?: Map<string, number>;
}

/**
 * Compute a sensible odds window and pick bounds for a target odds level.
 *
 * The window widens as the target grows — combining discrete odds into an exact
 * high total is hard, so a 2.0 target uses a tight window while a 5.0 target
 * needs a wider one to have any valid combinations at all.
 *
 * Min picks: fewest safe picks that can reach the lower bound.
 * Max picks: most safe picks before overshooting the upper bound.
 */
function deriveOddsConfig(target: number, safeMin: number, safeMax: number) {
  // Widen proportionally: ~12% at 2.0, ~20% at 5.0, capped at 25%.
  const pct = Math.min(0.25, 0.10 + (target - 2) * 0.03);
  const rangeMin = Math.max(1.2, target * (1 - pct));
  const rangeMax = target * (1 + pct);
  const sMax = safeMax || 1.6;
  const sMin = safeMin || 1.2;
  const autoMinPicks = Math.max(2, Math.floor(Math.log(rangeMin) / Math.log(sMax)));
  const autoMaxPicks = Math.min(12, Math.max(autoMinPicks + 3, Math.ceil(Math.log(rangeMax) / Math.log(sMin))));
  return { rangeMin, rangeMax, autoMinPicks, autoMaxPicks };
}

export default function SlipGenerator({ selections, onGenerated, scores }: Props) {
  const [config, setConfig] = useState<GroupingConfig>(() => {
    const d = deriveOddsConfig(DEFAULT_CONFIG.targetOdds, DEFAULT_CONFIG.safeOddsRange.min, DEFAULT_CONFIG.safeOddsRange.max);
    return {
      ...DEFAULT_CONFIG,
      oddsRange: { min: d.rangeMin, max: d.rangeMax },
      minPicksPerSlip: d.autoMinPicks,
      maxPicksPerSlip: d.autoMaxPicks,
      noSameTeam: true,
      noSameKickoff: false,
      sameKickoffToleranceMin: 0,
      spreadAcrossDates: false,
      maxPicksPerDay: 0,
      maxRepeatAcrossSlips: 1,
      futureOnly: true,
      coverageMode: true,
      autoCapSlips: true,
      kickoffFrom: undefined,
      kickoffTo: undefined,
    };
  });
  const [generating, setGenerating] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [coverage, setCoverage] = useState<{ total: number; used: number; unused: number; maxRepeat: number } | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setWarning(null);
    setProgress(0);

    const slips = await generateSlipsAsync(
      selections,
      { ...config, maxPicksPerSlip: Math.min(12, config.maxPicksPerSlip) },
      (found) => setProgress(found),
      scores
    );

    setResultCount(slips.length);
    // Coverage report
    const elig = getEligible(selections, { ...config, maxPicksPerSlip: Math.min(12, config.maxPicksPerSlip) });
    const rep = coverageReport(elig, slips);
    setCoverage({ total: rep.totalFixtures, used: rep.usedFixtures, unused: rep.unused.length, maxRepeat: rep.maxRepeat });
    onGenerated(slips);
    setGenerating(false);

    if (config.targetOdds > 3.0) {
      setWarning('High target odds. Chain survival decreases significantly above 3.0. Stick to the rules.');
    } else if (config.targetOdds > 2.5) {
      setWarning('Moderate risk. Consider sticking to 2.0 for safer compounding.');
    }

    if (slips.length === 0) {
      setWarning('No slips could be generated with these settings. Try more picks, a wider safe-odds range, or a different target.');
    }
  }

  // Auto-grouped wave generation: split the pool into kickoff waves (Next 3h / 6h
  // / 12h / Today / Tomorrow) and build slips WITHIN each wave — only fixtures
  // that play together combine. One action across all waves.
  async function handleGenerateByWave() {
    setGenerating(true);
    setWarning(null);
    setProgress(0);
    const cfg = { ...config, maxPicksPerSlip: Math.min(12, config.maxPicksPerSlip) };
    const slips = await generateSlipsByWave(selections, cfg, (found) => setProgress(found), scores);
    setResultCount(slips.length);
    const elig = getEligible(selections, cfg);
    const rep = coverageReport(elig, slips);
    setCoverage({ total: rep.totalFixtures, used: rep.usedFixtures, unused: rep.unused.length, maxRepeat: rep.maxRepeat });
    onGenerated(slips);
    setGenerating(false);
    if (slips.length === 0) {
      setWarning('No wave slips could be generated. A wave needs at least the minimum picks to form a slip.');
    }
  }

  // Determine mode: filters-only (pasted/researched picks) vs confidence-ranked
  const meaningfulScoreCount = (() => {
    if (!scores) return 0;
    let n = 0;
    for (const s of selections) {
      const v = scores.get(s.id);
      if (v !== undefined && Math.abs(v - 50) >= 8) n++;
    }
    return n;
  })();
  const filtersOnlyMode = meaningfulScoreCount < Math.max(2, Math.ceil(selections.length / 3));

  // How many pasted fixtures have already started (excluded when futureOnly is on)
  const pastCount = countPastFixtures(selections);

  // Available match-days from the pool (chronological), for the reliable Day picker
  const availableDays = (() => {
    const map = new Map<string, { key: string; label: string; count: number; ts: number }>();
    for (const s of selections) {
      const d = s.kickOffDateTime ? new Date(s.kickOffDateTime) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' }),
          count: 0,
          ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        });
      }
      map.get(key)!.count++;
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  })();

  // Set the kickoff window to a full calendar day (00:00–23:59 of that day)
  function setWindowToDay(dayKey: string) {
    if (!dayKey) { setConfig({ ...config, kickoffFrom: undefined, kickoffTo: undefined }); return; }
    setConfig({ ...config, kickoffFrom: `${dayKey}T00:00`, kickoffTo: `${dayKey}T23:59` });
  }

  // Which day (if any) the current window represents
  const currentDayKey = (() => {
    if (config.kickoffFrom && config.kickoffFrom.endsWith('T00:00') && config.kickoffTo?.endsWith('T23:59')) {
      return config.kickoffFrom.slice(0, 10);
    }
    return '';
  })();

  // Estimate how many ZERO-REPEAT slips one clean pass yields: eligible picks
  // divided by the average picks needed to reach the target odds. This tells the
  // user the ideal slip count where every fixture is used exactly once.
  const cleanPassEstimate = (() => {
    const eligibleCount = selections.length - (config.futureOnly ? pastCount : 0);
    if (eligibleCount < config.minPicksPerSlip) return 0;
    // avg pick odds within the safe band midpoint
    const midOdds = (config.safeOddsRange.min + config.safeOddsRange.max) / 2 || 1.4;
    const picksPerSlip = Math.max(
      config.minPicksPerSlip,
      Math.min(config.maxPicksPerSlip, Math.ceil(Math.log(config.targetOdds) / Math.log(midOdds)))
    );
    return Math.max(1, Math.floor(eligibleCount / picksPerSlip));
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold text-blue-400">Slip Builder</h3>
        {selections.length > 0 && (
          filtersOnlyMode ? (
            <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded" title="Your picks are used as-is. Only the odds target and filters decide the slips — no confidence reordering.">
              Filters-only mode
            </span>
          ) : (
            <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded" title="Confidence scores rank picks and slips.">
              Confidence-ranked
            </span>
          )
        )}
      </div>

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
              const d = deriveOddsConfig(target, config.safeOddsRange.min, config.safeOddsRange.max);
              setConfig({
                ...config,
                targetOdds: target,
                oddsRange: { min: d.rangeMin, max: d.rangeMax },
                minPicksPerSlip: d.autoMinPicks,
                maxPicksPerSlip: d.autoMaxPicks,
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

        {/* Kickoff window — tiered rollover */}
        <div className="p-2 bg-gray-800 rounded border border-gray-700">
          <label className="text-xs text-gray-400 block mb-1">Kick-off Window (tiered rollover)</label>
          <div className="flex gap-1 mb-2 flex-wrap">
            {(['morning', 'afternoon', 'evening'] as const).map(tier => {
              const active = (() => {
                const w = tierWindow(selections, tier);
                return w && config.kickoffFrom === w.from && config.kickoffTo === w.to;
              })();
              return (
                <button
                  key={tier}
                  onClick={() => {
                    const w = tierWindow(selections, tier);
                    if (w) setConfig({ ...config, kickoffFrom: w.from, kickoffTo: w.to });
                  }}
                  className={`px-2 py-1 rounded text-xs capitalize ${
                    active ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {tier}
                </button>
              );
            })}
            <button
              onClick={() => {
                // Rolling 3-hour window from the earliest upcoming fixture
                const future = selections.filter(s => s.kickOffDateTime).map(s => new Date(s.kickOffDateTime)).sort((a, b) => a.getTime() - b.getTime());
                if (future.length === 0) return;
                const start = future[0];
                const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
                const fmt = (dt: Date) => {
                  const y = dt.getFullYear(); const m = (dt.getMonth() + 1).toString().padStart(2, '0');
                  const d = dt.getDate().toString().padStart(2, '0');
                  const h = dt.getHours().toString().padStart(2, '0'); const mi = dt.getMinutes().toString().padStart(2, '0');
                  return `${y}-${m}-${d}T${h}:${mi}`;
                };
                setConfig({ ...config, kickoffFrom: fmt(start), kickoffTo: fmt(end) });
              }}
              className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-400 hover:bg-gray-600"
              title="3-hour window from the earliest fixture — all games settle within it"
            >
              +3h window
            </button>
            {(config.kickoffFrom || config.kickoffTo) && (
              <button
                onClick={() => setConfig({ ...config, kickoffFrom: undefined, kickoffTo: undefined })}
                className="px-2 py-1 rounded text-xs bg-gray-700 text-red-300 hover:bg-red-900"
              >
                Clear
              </button>
            )}
          </div>
          {/* Reliable Day picker (dropdown — no calendar popup needed) */}
          {availableDays.length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] text-gray-500 block mb-1">Pick a day (whole-day window)</span>
              <select
                value={currentDayKey}
                onChange={(e) => setWindowToDay(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              >
                <option value="">All days (no window)</option>
                {availableDays.map(d => (
                  <option key={d.key} value={d.key}>{d.label} — {d.count} fixtures</option>
                ))}
              </select>
            </div>
          )}

          {/* Manual time range (advanced) — type values directly; the native
              calendar popup is unreliable in the desktop webview, so these are
              typeable text fields formatted as YYYY-MM-DDTHH:MM */}
          <details className="mb-1">
            <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-400">Advanced: exact time range</summary>
            <div className="flex gap-2 items-center mt-1">
              <div className="flex-1">
                <span className="text-[10px] text-gray-500 block">From</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD HH:MM"
                  value={config.kickoffFrom ? config.kickoffFrom.replace('T', ' ') : ''}
                  onChange={(e) => setConfig({ ...config, kickoffFrom: e.target.value ? e.target.value.replace(' ', 'T') : undefined })}
                  className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div className="flex-1">
                <span className="text-[10px] text-gray-500 block">To</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD HH:MM"
                  value={config.kickoffTo ? config.kickoffTo.replace('T', ' ') : ''}
                  onChange={(e) => setConfig({ ...config, kickoffTo: e.target.value ? e.target.value.replace(' ', 'T') : undefined })}
                  className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </details>
          {(() => {
            const inWindow = getEligible(selections, config).length;
            return (
              <p className="text-[10px] text-gray-600 mt-1">
                {config.kickoffFrom || config.kickoffTo
                  ? `${inWindow} fixture(s) in this window will be used.`
                  : 'No window set — all upcoming fixtures eligible. Set a window to build a tier (e.g. morning slip → stake → evening slip).'}
              </p>
            );
          })()}
        </div>

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
              checked={config.coverageMode}
              onChange={(e) => setConfig({ ...config, coverageMode: e.target.checked })}
              className="rounded"
            />
            Coverage mode — use every fixture once before any repeats
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.futureOnly}
              onChange={(e) => setConfig({ ...config, futureOnly: e.target.checked })}
              className="rounded"
            />
            Future fixtures only (exclude already-started/finished games)
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.noSameTeam}
              onChange={(e) => setConfig({ ...config, noSameTeam: e.target.checked })}
              className="rounded"
            />
            No same team on same date in slip
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.noSameKickoff}
              onChange={(e) => setConfig({ ...config, noSameKickoff: e.target.checked })}
              className="rounded"
            />
            No same kick-off time in slip
            {config.noSameKickoff && (
              <select
                value={config.sameKickoffToleranceMin ?? 0}
                onChange={(e) => setConfig({ ...config, sameKickoffToleranceMin: parseInt(e.target.value) })}
                onClick={(e) => e.stopPropagation()}
                className="ml-1 px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-[10px] text-gray-300"
                title="How close counts as 'same' kickoff"
              >
                <option value={0}>exact time</option>
                <option value={15}>within 15 min</option>
                <option value={30}>within 30 min</option>
              </select>
            )}
          </label>
          <p className="text-[10px] text-gray-500 ml-6 -mt-0.5">
            Off by default — the roll-over combines same/near-kickoff games. Tick to separate them.
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={config.spreadAcrossDates}
              onChange={(e) => setConfig({ ...config, spreadAcrossDates: e.target.checked })}
              className="rounded"
            />
            Spread across dates (min 2 matchdays per slip)
          </label>
          <div className="flex items-center gap-2 py-0.5">
            <label className="text-xs text-gray-300 cursor-pointer flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.maxPicksPerDay > 0}
                onChange={(e) => setConfig({ ...config, maxPicksPerDay: e.target.checked ? 3 : 0 })}
                className="rounded"
              />
              Max picks per day
            </label>
            {config.maxPicksPerDay > 0 && (
              <select
                value={config.maxPicksPerDay}
                onChange={(e) => setConfig({ ...config, maxPicksPerDay: parseInt(e.target.value) })}
                className="px-1.5 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              >
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            )}
          </div>
          <p className="text-[9px] text-gray-600 mt-1">Same team on different dates is always allowed (e.g. Arsenal's next 3 games)</p>
          <div className="flex items-center gap-2 py-1 mt-1 border-t border-gray-700 pt-2">
            <span className="text-xs text-gray-400">Pick repeat across slips:</span>
            <select
              value={config.maxRepeatAcrossSlips}
              onChange={(e) => setConfig({ ...config, maxRepeatAcrossSlips: parseInt(e.target.value) })}
              className="px-1.5 py-0.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="1">1 (unique)</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
            <span className="text-[9px] text-gray-600">Max times a pick appears across all slips</span>
          </div>
        </div>

        {/* Max slips */}
        <div>
          {/* Auto-cap toggle — overrides manual slip count */}
          {config.coverageMode && (
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer mb-2 p-2 bg-gray-800 rounded border border-green-900/50">
              <input
                type="checkbox"
                checked={config.autoCapSlips}
                onChange={(e) => setConfig({ ...config, autoCapSlips: e.target.checked })}
                className="rounded"
              />
              <span>
                Auto-cap slips (zero-repeat)
                {config.autoCapSlips && cleanPassEstimate > 0 && (
                  <span className="text-green-400 font-bold"> → {cleanPassEstimate} slips</span>
                )}
                <span className="block text-[10px] text-gray-500">
                  Automatically generates exactly enough slips to use each fixture once. Overrides the count below.
                </span>
              </span>
            </label>
          )}

          <label className={`text-xs block mb-1 flex items-center justify-between ${config.autoCapSlips && config.coverageMode ? 'text-gray-600' : 'text-gray-400'}`}>
            <span>Max Slips to Generate {config.autoCapSlips && config.coverageMode && <span className="text-[10px]">(auto-capped)</span>}</span>
            <span className="text-blue-300 font-mono font-bold text-sm">{config.maxSlipsToGenerate}</span>
          </label>
          <input
            type="range"
            min="5"
            max="200"
            step="5"
            value={config.maxSlipsToGenerate}
            disabled={config.autoCapSlips && config.coverageMode}
            onChange={(e) => setConfig({ ...config, maxSlipsToGenerate: parseInt(e.target.value) || 50 })}
            className="w-full accent-blue-500 disabled:opacity-40"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-gray-600">5</span>
            <input
              type="number"
              min="5"
              max="500"
              value={config.maxSlipsToGenerate}
              onChange={(e) => setConfig({ ...config, maxSlipsToGenerate: parseInt(e.target.value) || 50 })}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-center focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-gray-600">200</span>
          </div>
          {/* Manual guidance only shown when auto-cap is OFF */}
          {config.coverageMode && !config.autoCapSlips && cleanPassEstimate > 0 && (
            <>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-gray-400">
                  Zero-repeat max: <span className="text-green-400 font-bold">{cleanPassEstimate} slips</span>
                  <span className="text-gray-600"> (each fixture used once)</span>
                </span>
                {config.maxSlipsToGenerate !== cleanPassEstimate && (
                  <button
                    onClick={() => setConfig({ ...config, maxSlipsToGenerate: cleanPassEstimate })}
                    className="px-2 py-0.5 bg-green-800 hover:bg-green-700 rounded text-green-200"
                  >
                    Match
                  </button>
                )}
              </div>
              {config.maxSlipsToGenerate > cleanPassEstimate && (
                <p className="text-[10px] text-yellow-500 mt-1">
                  Asking for more than {cleanPassEstimate} means some fixtures repeat across slips.
                </p>
              )}
            </>
          )}
        </div>

        {/* Past-fixture notice */}
        {config.futureOnly && pastCount > 0 && (
          <div className="p-2 bg-orange-900/30 border border-orange-800 rounded text-xs text-orange-300">
            {pastCount} pasted fixture{pastCount > 1 ? 's have' : ' has'} already started and will be excluded.
            Only future games are used for slips.
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={selections.length < config.minPicksPerSlip || generating}
          className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-bold text-sm"
        >
          {(() => {
            const available = selections.length - (config.futureOnly ? pastCount : 0);
            return generating ? `Generating... (${progress} found)` : `Generate Slips (${available} future picks available)`;
          })()}
        </button>

        {/* Generate PER WAVE — slips only combine fixtures that play together */}
        <button
          onClick={handleGenerateByWave}
          disabled={selections.length < config.minPicksPerSlip || generating}
          className="w-full py-2 mt-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium text-xs"
          title="Split the pool into kickoff waves (Next 3h / 6h / 12h / Today / Tomorrow) and build slips within each — only fixtures that play together are combined."
        >
          {generating ? 'Generating…' : '⧗ Generate per kickoff wave'}
        </button>

        {resultCount !== null && (
          <p className="text-center text-sm">
            <span className="text-green-400 font-bold">{resultCount}</span>
            <span className="text-gray-400"> slips generated</span>
          </p>
        )}

        {coverage && resultCount !== null && resultCount > 0 && (
          <div className="p-2 bg-gray-800 rounded border border-gray-700 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400">Coverage</span>
              <span className={coverage.unused === 0 ? 'text-green-400' : 'text-yellow-400'}>
                {coverage.used}/{coverage.total} fixtures used
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-700 rounded-full mb-1">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${coverage.total > 0 ? (coverage.used / coverage.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>{coverage.unused > 0 ? `${coverage.unused} unused — generate more slips to use them` : 'All fixtures covered'}</span>
              <span>Max repeat: {coverage.maxRepeat}×</span>
            </div>
          </div>
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
