import React, { useState, useEffect } from 'react';
import { StakedSlip } from '../App';
import { Chain, ParsedSelection } from '../engine/types';
import ConfirmDialog from './ConfirmDialog';
import { formatSlipForClipboard, copyToClipboard } from '../lib/clipboard';
import { isSameTeam } from '../engine/team-aliases';
import MatchStatsModal from './MatchStatsModal';
import { SCORE_PROVIDERS, getScoreProvider, DEFAULT_SCORE_PROVIDER, ScoreRecord } from '../engine/score-providers';

interface Props {
  stakedSlips: StakedSlip[];
  chains: Chain[];
  onSlipWon: (slipId: string) => void;
  onSlipLost: (slipId: string) => void;
  onSelectionResult: (slipId: string, selectionId: string, result: 'won' | 'lost') => void;
  onUndoStake: (slipId: string) => void;
  onUpdateScores?: (updates: { slipId: string; selectionId: string; score: { home: number; away: number; htHome?: number; htAway?: number } }[]) => void;
}

// ─── Match Status Logic ──────────────────────────────────────────────────────

type MatchStatus = 'live' | 'won' | 'lost' | 'upcoming' | 'ended';

function getMatchStatus(sel: ParsedSelection, selResult: 'pending' | 'won' | 'lost'): MatchStatus {
  if (selResult === 'won') return 'won';
  if (selResult === 'lost') return 'lost';
  // Pending: check if kicked off (compare kickoff time vs now)
  const kickOff = new Date(sel.kickOffDateTime).getTime();
  const now = Date.now();
  // Match is "live" only during the game window (~115 min: 90 + HT + stoppage)
  const MATCH_DURATION_MS = 115 * 60 * 1000;
  if (now >= kickOff && now < kickOff + MATCH_DURATION_MS) return 'live';
  if (now >= kickOff + MATCH_DURATION_MS) return 'ended'; // Match is over, awaiting result
  return 'upcoming';
}

function hasLiveMatch(staked: StakedSlip): boolean {
  return staked.slip.selections.some(sel => {
    const result = staked.selectionResults[sel.id];
    return getMatchStatus(sel, result) === 'live';
  });
}

function getSlipSortKey(staked: StakedSlip): number {
  // LIVE slips first (lowest sort key), then by earliest upcoming kickoff
  const isLive = hasLiveMatch(staked);
  if (isLive) return 0;

  // Sort by earliest pending kickoff
  const pendingKickoffs = staked.slip.selections
    .filter(s => staked.selectionResults[s.id] === 'pending')
    .map(s => new Date(s.kickOffDateTime).getTime());

  if (pendingKickoffs.length === 0) return Infinity;
  return Math.min(...pendingKickoffs);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActiveSlips({ stakedSlips, chains, onSlipWon, onSlipLost, onSelectionResult, onUndoStake, onUpdateScores }: Props) {
  const [expandedSlip, setExpandedSlip] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [fetchingScores, setFetchingScores] = useState(false);
  const [scoreStatus, setScoreStatus] = useState<string | null>(null);
  // Global score-provider picker (per user model: pick ONE source, then fetch).
  const [scoreProviderId, setScoreProviderId] = useState<string>(() => {
    try { return localStorage.getItem('rollover_score_provider') || DEFAULT_SCORE_PROVIDER; } catch { return DEFAULT_SCORE_PROVIDER; }
  });
  // Per-selection fetch in-flight (keyed by selectionId) for focused buttons.
  const [rowFetching, setRowFetching] = useState<Set<string>>(new Set());
  const [statsModal, setStatsModal] = useState<{ sel: typeof stakedSlips[0]['slip']['selections'][0]; result: 'pending' | 'won' | 'lost' } | null>(null);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => void;
    variant: 'danger' | 'warning' | 'info';
  }>({ open: false, title: '', message: '', action: () => {}, variant: 'danger' });

  // Update display every 30 seconds (for live status detection)
  useEffect(() => {
    if (stakedSlips.length === 0) return;
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [stakedSlips.length]);

  // Auto-fetch scores on mount
  useEffect(() => {
    if (onUpdateScores) {
      handleFetchScores();
    }
  }, []); // Only on mount

  // Fuzzy team name matching — handles "Atletico Madrid" vs "Atl. Madrid", "Malaga CF" vs "Malaga" etc.
  function fuzzyTeamMatch(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    // Try first significant word (e.g. "Atletico" in "Atletico Madrid", "Malaga" in "Malaga CF")
    const aWords = a.split(/[\s.]+/).filter(w => w.length > 2);
    const bWords = b.split(/[\s.]+/).filter(w => w.length > 2);
    // Check if the most distinctive word is shared
    const aKey = aWords.find(w => w.length >= 4) || aWords[0] || '';
    const bKey = bWords.find(w => w.length >= 4) || bWords[0] || '';
    if (aKey && bKey) {
      // "atletico" matches "atletico", "malaga" matches "malaga"
      if (aKey === bKey) return true;
      // "atletico" starts with "atl" — handle abbreviations
      if (aKey.startsWith(bKey.substring(0, 3)) || bKey.startsWith(aKey.substring(0, 3))) {
        // Verify at least one more word matches or second keyword overlaps
        if (aWords.length > 1 && bWords.length > 1) {
          return aWords.some(w => bWords.some(bw => bw.includes(w) || w.includes(bw)));
        }
        return true;
      }
    }
    return false;
  }

  // Match a selection to a normalized score record (exact alias match, then fuzzy).
  function matchRecord(sel: ParsedSelection, records: ScoreRecord[]): ScoreRecord | undefined {
    return records.find(r => {
      if (isSameTeam(sel.homeTeam, r.homeTeam) && isSameTeam(sel.awayTeam, r.awayTeam)) return true;
      return fuzzyTeamMatch(
        sel.homeTeam.toLowerCase().replace(/\s*(fc|cf|sc|ac|cd|ud)$/i, '').trim(),
        r.homeTeam.toLowerCase().replace(/\s*(fc|cf|sc|ac|cd|ud)$/i, '').trim()
      ) && fuzzyTeamMatch(
        sel.awayTeam.toLowerCase().replace(/\s*(fc|cf|sc|ac|cd|ud)$/i, '').trim(),
        r.awayTeam.toLowerCase().replace(/\s*(fc|cf|sc|ac|cd|ud)$/i, '').trim()
      );
    });
  }

  // Enrich a Flashscore finished record with HT score from its detail page.
  async function enrichHalfTime(rec: ScoreRecord): Promise<{ htHome?: number; htAway?: number }> {
    if (rec.provider !== 'Flashscore' || !rec.matchId) return {};
    try {
      const { httpGetText } = await import('../lib/http');
      const res = await httpGetText(`https://www.flashscore.mobi/match/${rec.matchId}/`, {});
      if (res.text && res.text.length > 500) {
        const htMatch = res.text.match(/<div class="detail"><b>\d+-\d+<\/b>\s*\((\d+)-(\d+),\d+-\d+\)/);
        if (htMatch) return { htHome: parseInt(htMatch[1]), htAway: parseInt(htMatch[2]) };
        const halfMatch = res.text.match(/1st Half:\s*<b>(\d+)-(\d+)<\/b>/);
        if (halfMatch) return { htHome: parseInt(halfMatch[1]), htAway: parseInt(halfMatch[2]) };
      }
    } catch { /* ignore */ }
    return {};
  }

  /**
   * Bulk update finished scores across all staked slips, from the CHOSEN provider.
   * (Livescore/pastscore both surface finished + running; here we settle finished.)
   */
  async function handleFetchScores() {
    if (!onUpdateScores) return;
    const provider = getScoreProvider(scoreProviderId);
    if (!provider || !provider.fetchFinished) {
      setScoreStatus('Selected provider has no result feed');
      setTimeout(() => setScoreStatus(null), 3000);
      return;
    }
    setFetchingScores(true);
    setScoreStatus(`Fetching from ${provider.label}…`);
    try {
      // Day offsets for all started-but-unresolved selections.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const offsets = new Set<number>();
      for (const staked of stakedSlips) {
        for (const sel of staked.slip.selections) {
          if (new Date(sel.kickOffDateTime).getTime() > Date.now()) continue;
          const kd = new Date(sel.kickOffDateTime); kd.setHours(0, 0, 0, 0);
          offsets.add(Math.round((kd.getTime() - today.getTime()) / 86400000));
        }
      }
      if (offsets.size === 0) {
        setScoreStatus('No matches to update');
        setFetchingScores(false);
        setTimeout(() => setScoreStatus(null), 3000);
        return;
      }

      setScoreStatus(`Loading ${provider.label} — ${offsets.size} day(s)…`);
      const records = await provider.fetchFinished(Array.from(offsets));
      setScoreStatus(`Found ${records.length} finished. Matching…`);

      const updates: { slipId: string; selectionId: string; score: { home: number; away: number; htHome?: number; htAway?: number } }[] = [];
      for (const staked of stakedSlips) {
        for (const sel of staked.slip.selections) {
          if (new Date(sel.kickOffDateTime).getTime() > Date.now()) continue;
          if (sel.score?.htHome !== undefined) continue; // already fully resolved
          const rec = matchRecord(sel, records);
          if (!rec || rec.homeScore === null || rec.awayScore === null) continue;
          const ht = await enrichHalfTime(rec);
          updates.push({
            slipId: staked.slip.id,
            selectionId: sel.id,
            score: { home: rec.homeScore, away: rec.awayScore, ...ht },
          });
        }
      }

      if (updates.length === 0) {
        setScoreStatus(`No matches found on ${provider.label}`);
      } else {
        onUpdateScores(updates);
        setScoreStatus(`Updated ${updates.length} match${updates.length > 1 ? 'es' : ''} from ${provider.label}`);
      }
    } catch (e) {
      setScoreStatus('Fetch failed');
      console.error('[Scores]', e);
    }
    setFetchingScores(false);
    setTimeout(() => setScoreStatus(null), 4000);
  }

  /**
   * Focused fetch for ONE selection from the chosen provider. `mode` decides
   * which feed: 'live' for a running match, 'past' for a finished result. This
   * powers the per-row Livescore / Fetch-result buttons.
   */
  async function fetchOneSelection(
    slipId: string,
    sel: ParsedSelection,
    mode: 'live' | 'past',
  ) {
    if (!onUpdateScores) return;
    const provider = getScoreProvider(scoreProviderId);
    if (!provider) return;
    const feed = mode === 'live' ? provider.fetchLive : provider.fetchFinished;
    if (!feed) {
      setScoreStatus(`${provider.label} has no ${mode === 'live' ? 'livescore' : 'result'} feed`);
      setTimeout(() => setScoreStatus(null), 3000);
      return;
    }
    setRowFetching(prev => new Set(prev).add(sel.id));
    setScoreStatus(`${mode === 'live' ? 'Livescore' : 'Result'} · ${provider.label}…`);
    try {
      // For past: query the fixture's own day; for live: today.
      let records: ScoreRecord[];
      if (mode === 'live') {
        records = await (provider.fetchLive as () => Promise<ScoreRecord[]>)();
      } else {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const kd = new Date(sel.kickOffDateTime); kd.setHours(0, 0, 0, 0);
        const off = Math.round((kd.getTime() - today.getTime()) / 86400000);
        records = await (provider.fetchFinished as (o: number[]) => Promise<ScoreRecord[]>)([off]);
      }
      const rec = matchRecord(sel, records);
      if (!rec || rec.homeScore === null || rec.awayScore === null) {
        setScoreStatus(`No ${mode === 'live' ? 'live score' : 'result'} found on ${provider.label}`);
      } else {
        const ht = mode === 'past' ? await enrichHalfTime(rec) : {};
        onUpdateScores([{ slipId, selectionId: sel.id, score: { home: rec.homeScore, away: rec.awayScore, ...ht } }]);
        setScoreStatus(`${sel.homeTeam} ${rec.homeScore}-${rec.awayScore} ${sel.awayTeam} · ${provider.label}`);
      }
    } catch (e) {
      setScoreStatus('Fetch failed');
      console.error('[Scores:row]', e);
    }
    setRowFetching(prev => { const n = new Set(prev); n.delete(sel.id); return n; });
    setTimeout(() => setScoreStatus(null), 4000);
  }

  function persistProvider(id: string) {
    setScoreProviderId(id);
    try { localStorage.setItem('rollover_score_provider', id); } catch { /* ignore */ }
  }

  function askConfirm(title: string, message: string, action: () => void, variant: 'danger' | 'warning' | 'info' = 'danger') {
    setConfirm({ open: true, title, message, action, variant });
  }

  if (stakedSlips.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-bold mb-4 text-blue-400">Active Slips (Staked)</h2>
        <p className="text-sm text-gray-500">
          No staked slips yet. Generate slips and mark them as staked after placing on your provider.
        </p>
      </div>
    );
  }

  // Sort: LIVE first, then by earliest kickoff
  const sortedSlips = [...stakedSlips].sort((a, b) => getSlipSortKey(a) - getSlipSortKey(b));

  // Count live slips
  const liveCount = sortedSlips.filter(s => hasLiveMatch(s)).length;

  // Count slips where ALL matches have ended (no live, no upcoming) but not settled
  const endedSlips = sortedSlips.filter(staked => {
    const statuses = staked.slip.selections.map(sel =>
      getMatchStatus(sel, staked.selectionResults[sel.id])
    );
    return statuses.every(s => s === 'ended' || s === 'won' || s === 'lost') &&
           statuses.some(s => s === 'ended');
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-blue-400">
          Active Slips ({stakedSlips.length})
          {liveCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              <span className="text-green-400">{liveCount} LIVE</span>
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {scoreStatus && <span className="text-[10px] text-blue-400 max-w-[16rem] truncate" title={scoreStatus}>{scoreStatus}</span>}
          {/* Global score-provider picker — common to all rows. Pick one source. */}
          <label className="flex items-center gap-1 text-[10px] text-gray-400" title="Score source. Fixtures come from SportyBet; scores/results come from the provider you pick here.">
            Scores:
            <select
              value={scoreProviderId}
              onChange={(e) => persistProvider(e.target.value)}
              className="px-1.5 py-1 bg-gray-800 border border-gray-600 rounded text-[10px] text-gray-300"
            >
              {SCORE_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button
            onClick={handleFetchScores}
            disabled={fetchingScores}
            className="px-2 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-600 rounded text-[10px] font-medium text-white"
            title="Update finished results for all staked slips from the selected provider"
          >
            {fetchingScores ? 'Fetching...' : 'Update all'}
          </button>
        </div>
      </div>

      {/* Bulk settle actions for ended slips */}
      {endedSlips.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-800 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-yellow-300 font-medium">
              {endedSlips.length} slip{endedSlips.length > 1 ? 's' : ''} awaiting result
            </span>
            <span className="text-xs text-gray-500">All matches finished — mark outcome</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => askConfirm(
                'Mark All Ended Slips as WON',
                `Mark ${endedSlips.length} slip(s) as WON? This will move them to history and advance linked chains.`,
                () => { for (const s of endedSlips) onSlipWon(s.slip.id); },
                'info'
              )}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium text-white"
            >
              All Won ({endedSlips.length})
            </button>
            <button
              onClick={() => askConfirm(
                'Mark All Ended Slips as LOST',
                `Mark ${endedSlips.length} slip(s) as LOST? This will move them to history and break linked chains.`,
                () => { for (const s of endedSlips) onSlipLost(s.slip.id); },
                'danger'
              )}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-xs font-medium text-white"
            >
              All Lost ({endedSlips.length})
            </button>
            <span className="text-xs text-gray-500 self-center ml-2">
              Or expand each slip to settle individually
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sortedSlips.map((staked) => {
          const wonCount = Object.values(staked.selectionResults).filter(r => r === 'won').length;
          const totalCount = staked.slip.selectionCount;
          const pendingCount = Object.values(staked.selectionResults).filter(r => r === 'pending').length;
          const slipIsLive = hasLiveMatch(staked);

          // Count per-status
          const liveMatchCount = staked.slip.selections.filter(sel =>
            getMatchStatus(sel, staked.selectionResults[sel.id]) === 'live'
          ).length;

          // Kick-off countdown for next upcoming match
          const now = Date.now();
          const upcomingKickoffs = staked.slip.selections
            .filter(s => getMatchStatus(s, staked.selectionResults[s.id]) === 'upcoming')
            .map(s => new Date(s.kickOffDateTime).getTime());
          const nextKickoff = upcomingKickoffs.length > 0 ? Math.min(...upcomingKickoffs) : null;
          let countdownText = '';
          if (nextKickoff) {
            const diff = nextKickoff - now;
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            countdownText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
          }

          // Staked timestamp
          const stakedAgo = (() => {
            const diff = now - new Date(staked.stakedAt).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
          })();

          return (
            <div
              key={staked.slip.id}
              className={`bg-gray-800 rounded-lg border overflow-hidden ${
                slipIsLive ? 'border-green-500' : 'border-green-700'
              }`}
            >
              {/* Header */}
              <div
                onClick={() => setExpandedSlip(expandedSlip === staked.slip.id ? null : staked.slip.id)}
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {slipIsLive ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                      </span>
                      LIVE ({liveMatchCount})
                    </span>
                  ) : (() => {
                    const endedCount = staked.slip.selections.filter(sel =>
                      getMatchStatus(sel, staked.selectionResults[sel.id]) === 'ended'
                    ).length;
                    const pendingResults = staked.slip.selections.filter(sel =>
                      staked.selectionResults[sel.id] === 'pending'
                    ).length;
                    if (endedCount > 0 && endedCount >= pendingResults) {
                      return (
                        <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded font-medium">
                          ENDED — Awaiting Result
                        </span>
                      );
                    }
                    if (endedCount > 0) {
                      return (
                        <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded font-medium">
                          {endedCount} Ended • {pendingResults - endedCount} Upcoming
                        </span>
                      );
                    }
                    return (
                      <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded font-medium">
                        STAKED
                      </span>
                    );
                  })()}
                  {staked.chainId && (
                    <span className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">
                      {chains.find(c => c.id === staked.chainId)?.label || 'Chain'}
                    </span>
                  )}
                  <span className="text-sm font-bold text-white">
                    {staked.slip.accumulatedOdds.toFixed(2)} odds
                  </span>
                  <span className="text-xs text-gray-400">
                    {wonCount}/{totalCount} won • {pendingCount} pending
                  </span>
                  {staked.label && (
                    <span className="text-xs text-gray-500 italic">"{staked.label}"</span>
                  )}
                  {countdownText && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                      ⏱ next: {countdownText}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">{stakedAgo}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      askConfirm(
                        'Mark Slip as Won',
                        'Mark ALL picks in this slip as won? This will move it to history.',
                        () => onSlipWon(staked.slip.id),
                        'info'
                      );
                    }}
                    className="px-2 py-1 bg-green-700 hover:bg-green-600 rounded text-xs"
                  >
                    All Won
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      askConfirm(
                        'Mark Slip as Lost',
                        'Mark this entire slip as lost? This action moves it to history.',
                        () => onSlipLost(staked.slip.id),
                        'danger'
                      );
                    }}
                    className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs"
                  >
                    Slip Lost
                  </button>
                  <span className="text-gray-500 text-xs">
                    {expandedSlip === staked.slip.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Expanded: per-match marking with live status */}
              {expandedSlip === staked.slip.id && (
                <div className="border-t border-gray-700 p-3">
                  <p className="text-xs text-gray-500 mb-2">Mark each match individually. One loss = slip lost.</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {[...staked.slip.selections]
                        .sort((a, b) => new Date(a.kickOffDateTime).getTime() - new Date(b.kickOffDateTime).getTime())
                        .map((sel, selIdx) => {
                        const selResult = staked.selectionResults[sel.id];
                        const status = getMatchStatus(sel, selResult);

                        return (
                          <tr key={sel.id} className={`border-b border-gray-700 last:border-0 ${
                            status === 'live' ? 'bg-green-900/10' : ''
                          }`}>
                            <td className="py-2 w-6">
                              {status === 'live' && (
                                <span className="relative flex h-2.5 w-2.5" title="Match is LIVE">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                </span>
                              )}
                              {status === 'won' && <span className="text-green-400" title="Won">✓</span>}
                              {status === 'lost' && <span className="text-red-400" title="Lost">✗</span>}
                              {status === 'upcoming' && <span className="text-gray-500" title="Upcoming">○</span>}
                              {status === 'ended' && <span className="text-yellow-400" title="Match ended — awaiting result">◉</span>}
                            </td>
                            <td className="py-2 text-gray-400 w-16">
                              {sel.date} {sel.time}
                            </td>
                            <td className="py-2">
                              <div
                                className="cursor-pointer hover:bg-gray-750 rounded px-1 -mx-1"
                                onClick={(e) => { e.stopPropagation(); setStatsModal({ sel, result: selResult }); }}
                              >
                                <span className="text-gray-200">{sel.homeTeam}</span>
                                <span className="text-gray-500"> v </span>
                                <span className="text-gray-200">{sel.awayTeam}</span>
                                {status === 'live' && (
                                  <span className="ml-1.5 text-xs text-green-400 font-medium">LIVE</span>
                                )}
                                {status === 'ended' && !sel.score && (
                                  <span className="ml-1.5 text-xs text-yellow-400 font-medium">FT</span>
                                )}
                                {sel.score && sel.score.htHome !== undefined && (
                                  <span className="ml-1.5 text-[10px] text-gray-400">HT {sel.score.htHome}-{sel.score.htAway}</span>
                                )}
                                {sel.score && (
                                  <span className="ml-1 text-[10px] font-bold text-blue-400">FT {sel.score.home}-{sel.score.away}</span>
                                )}
                                {/* Focused per-fixture score buttons (from the chosen provider). */}
                                {status === 'live' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); fetchOneSelection(staked.slip.id, sel, 'live'); }}
                                    disabled={rowFetching.has(sel.id)}
                                    className="ml-1.5 px-1 py-0.5 bg-green-900 hover:bg-green-800 disabled:opacity-50 rounded text-[9px] text-green-300 align-middle"
                                    title="Fetch live score for this running match from the selected provider"
                                  >
                                    {rowFetching.has(sel.id) ? '…' : '⟳ live'}
                                  </button>
                                )}
                                {status === 'ended' && !sel.score && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); fetchOneSelection(staked.slip.id, sel, 'past'); }}
                                    disabled={rowFetching.has(sel.id)}
                                    className="ml-1.5 px-1 py-0.5 bg-yellow-900 hover:bg-yellow-800 disabled:opacity-50 rounded text-[9px] text-yellow-300 align-middle"
                                    title="This match ended but has no result — fetch it from the selected provider"
                                  >
                                    {rowFetching.has(sel.id) ? '…' : '⟳ result'}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2">
                              <span className={sel.odds > 1.5 ? 'text-yellow-400' : 'text-green-400'}>
                                {sel.pick} @{sel.odds.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-2 text-gray-500">{sel.market}</td>
                            <td className="py-2 text-right">
                              {selResult === 'pending' ? (
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => onSelectionResult(staked.slip.id, sel.id, 'won')}
                                    className="px-1.5 py-0.5 bg-green-800 hover:bg-green-700 rounded text-xs text-green-300"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    onClick={() => {
                                      askConfirm(
                                        'Mark Match as Lost',
                                        `Mark "${sel.homeTeam} v ${sel.awayTeam}" as lost? This will mark the ENTIRE SLIP as lost.`,
                                        () => onSelectionResult(staked.slip.id, sel.id, 'lost'),
                                        'danger'
                                      );
                                    }}
                                    className="px-1.5 py-0.5 bg-red-900 hover:bg-red-800 rounded text-xs text-red-300"
                                  >
                                    ✗
                                  </button>
                                </div>
                              ) : selResult === 'won' ? (
                                <span className="text-green-400 font-bold">✓ Won</span>
                              ) : (
                                <span className="text-red-400 font-bold">✗ Lost</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        askConfirm(
                          'Undo Stake',
                          'Move this slip back to generated? Only do this if you did NOT actually place this bet.',
                          () => onUndoStake(staked.slip.id),
                          'warning'
                        );
                      }}
                      className="px-2 py-1 bg-yellow-900 hover:bg-yellow-800 rounded text-xs text-yellow-300"
                    >
                      Undo Stake
                    </button>
                    <button
                      onClick={async () => {
                        const text = formatSlipForClipboard(staked.slip);
                        const ok = await copyToClipboard(text);
                        if (ok) {
                          setCopied(staked.slip.id);
                          setTimeout(() => setCopied(null), 2000);
                        }
                      }}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300"
                    >
                      {copied === staked.slip.id ? '✓ Copied' : 'Copy to clipboard'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        variant={confirm.variant}
        confirmLabel="Yes, proceed"
        onConfirm={() => {
          confirm.action();
          setConfirm(c => ({ ...c, open: false }));
        }}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />

      {/* Match Stats Modal */}
      {statsModal && (
        <MatchStatsModal
          selection={statsModal.sel}
          selResult={statsModal.result}
          onClose={() => setStatsModal(null)}
        />
      )}
    </div>
  );
}
