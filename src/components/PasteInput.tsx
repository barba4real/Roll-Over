import React, { useState } from 'react';
import { parseSportyBet } from '../engine/parser-sportybet';
import { ParsedSelection } from '../engine/types';

interface Props {
  onParsed: (selections: ParsedSelection[]) => void;
  onMerge?: (newSelections: ParsedSelection[]) => void;
  existingCount?: number;
}

/**
 * Duplicate detection:
 * - Same fixture = same homeTeam + awayTeam (case-insensitive)
 * - But different pick/market on same fixture is NOT a duplicate (multi-pick)
 * - True duplicate = same fixture + same pick + same market
 */
function findDuplicates(
  incoming: ParsedSelection[],
  existing: ParsedSelection[]
): { unique: ParsedSelection[]; duplicates: ParsedSelection[] } {
  const existingKeys = new Set(
    existing.map(s =>
      `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`
    )
  );

  const unique: ParsedSelection[] = [];
  const duplicates: ParsedSelection[] = [];

  for (const sel of incoming) {
    const key = `${sel.homeTeam.toLowerCase()}|${sel.awayTeam.toLowerCase()}|${sel.pick.toLowerCase()}|${sel.market.toLowerCase()}`;
    if (existingKeys.has(key)) {
      duplicates.push(sel);
    } else {
      unique.push(sel);
      existingKeys.add(key); // prevent dupes within the incoming batch too
    }
  }

  return { unique, duplicates };
}

export default function PasteInput({ onParsed, onMerge, existingCount = 0 }: Props) {
  const [rawText, setRawText] = useState('');
  const [parseInfo, setParseInfo] = useState<{
    total: number;
    active: number;
    excluded: number;
    errors: string[];
    context: string;
    duplicatesFound?: number;
    uniqueAdded?: number;
  } | null>(null);

  function handleParse() {
    if (!rawText.trim()) return;

    const result = parseSportyBet(rawText);

    setParseInfo({
      total: result.selections.length,
      active: result.activeSelections.length,
      excluded: result.selections.length - result.activeSelections.length,
      errors: result.errors,
      context: result.context,
    });

    if (result.context === 'compact_unsupported') return;

    onParsed(result.activeSelections);
  }

  function handleMerge() {
    if (!rawText.trim() || !onMerge) return;

    const result = parseSportyBet(rawText);

    if (result.context === 'compact_unsupported') {
      setParseInfo({
        total: result.selections.length,
        active: 0,
        excluded: 0,
        errors: result.errors,
        context: result.context,
      });
      return;
    }

    // onMerge handles dedup in App.tsx, but we show info here
    setParseInfo({
      total: result.selections.length,
      active: result.activeSelections.length,
      excluded: result.selections.length - result.activeSelections.length,
      errors: result.errors,
      context: result.context,
    });

    onMerge(result.activeSelections);
  }

  function handleClear() {
    setRawText('');
    setParseInfo(null);
    onParsed([]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-blue-400">Paste Bet List</h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) setRawText(text);
              } catch (e) {
                console.error('Clipboard read failed:', e);
              }
            }}
            className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-white"
          >
            Paste from Clipboard
          </button>
          <label className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 cursor-pointer">
            Import File
            <input
              type="file"
              accept=".txt,.text"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    if (text) {
                      setRawText(text);
                    }
                  };
                  reader.readAsText(file);
                }
                e.target.value = '';
              }}
            />
          </label>
          {rawText && (
            <button
              onClick={handleClear}
              className="text-xs text-gray-400 hover:text-red-400"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Paste your SportyBet bet list here (full detailed format)..."
        className="w-full h-48 p-3 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
      />

      <div className="flex gap-2 mt-2 items-center">
        <button
          onClick={handleParse}
          disabled={!rawText.trim()}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium"
          title="Replace current selections with this paste"
        >
          Replace All
        </button>
        {onMerge && (
          <button
            onClick={handleMerge}
            disabled={!rawText.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium"
            title="Add new picks to existing list, skip duplicates (same fixture + pick + market)"
          >
            Merge & Dedupe
          </button>
        )}
        {existingCount > 0 && (
          <span className="text-xs text-gray-500 ml-2">
            {existingCount} picks already loaded
          </span>
        )}
      </div>

      {parseInfo && (
        <div className="mt-3 p-3 bg-gray-800 rounded-lg text-sm">
          <div className="flex gap-4 flex-wrap">
            <span className="text-gray-400">
              Context: <span className="text-blue-300">{parseInfo.context}</span>
            </span>
            <span className="text-gray-400">
              Total: <span className="text-white font-medium">{parseInfo.total}</span>
            </span>
            <span className="text-gray-400">
              Active: <span className="text-green-400 font-medium">{parseInfo.active}</span>
            </span>
            {parseInfo.excluded > 0 && (
              <span className="text-gray-400">
                Excluded: <span className="text-yellow-400 font-medium">{parseInfo.excluded}</span>
              </span>
            )}
            {parseInfo.duplicatesFound !== undefined && parseInfo.duplicatesFound > 0 && (
              <span className="text-gray-400">
                Dupes skipped: <span className="text-orange-400 font-medium">{parseInfo.duplicatesFound}</span>
              </span>
            )}
            {parseInfo.uniqueAdded !== undefined && (
              <span className="text-gray-400">
                New added: <span className="text-green-400 font-medium">{parseInfo.uniqueAdded}</span>
              </span>
            )}
          </div>
          {parseInfo.excluded > 0 && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-800 rounded text-xs text-yellow-300">
              {parseInfo.excluded} match(es) excluded — already settled, void, or live. Only "Not Started" matches are used.
            </div>
          )}
          {parseInfo.errors.length > 0 && (
            <div className="mt-2">
              {parseInfo.errors.map((err, idx) => (
                <p key={idx} className="text-red-400 text-xs">{err}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dedup explanation */}
      <p className="text-xs text-gray-600 mt-2">
        Duplicate = same fixture + same pick + same market. Different picks on the same match are kept (multi-pick). Same fixture never appears twice in a generated slip.
      </p>
    </div>
  );
}
