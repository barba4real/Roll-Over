import React, { useState, useEffect, useMemo } from 'react';
import DisciplineBanner from './components/DisciplineBanner';
import ErrorBoundary from './components/ErrorBoundary';
import PasteInput from './components/PasteInput';
import SelectionList from './components/SelectionList';
import SlipGenerator from './components/SlipGenerator';
import ChainsWidget from './components/ChainsWidget';
import ApiSettingsModal from './components/ApiSettingsModal';
import AccuracyDashboard from './components/AccuracyDashboard';
import MatchAnalysis from './components/MatchAnalysis';
import GeneratedSlips from './components/GeneratedSlips';
import ActiveSlips from './components/ActiveSlips';
import SlipHistory from './components/SlipHistory';
import MatchScout from './components/MatchScout';
import FoulsStrategy from './components/FoulsStrategy';
import PreferredMarkets from './components/PreferredMarkets';
import { ParsedSelection, Slip, Chain } from './engine/types';
import { parseSportyBet } from './engine/parser-sportybet';
import { saveStakedSlips, loadStakedSlips, saveHistory, loadHistory, saveChains, loadChains, loadSettings, saveSettings, AppSettings, exportAllData, importAllData, saveSelections, loadSelections, exportSelections, importSelections, saveGeneratedSlips, loadGeneratedSlips, evictIfNeeded } from './lib/storage';
import { quickScore, ScoringResult, scorePick, scorePickEnhanced, buildPersonalHistory } from './engine/scoring';
import { buildMatchDataFromCache } from './engine/stats-calculator';
import { suggestBestSlip, calculateQuality, DEFAULT_CONFIG } from './engine/grouping-engine';
import { recordPrediction, buildInputsFromMatchData, recordOutcome } from './engine/prediction-log';
import { checkAndSettle, shouldPoll } from './engine/auto-settle';
import { getLiveMatches, findMatchResult } from './engine/sportscore';
import { fetchTodayFinished, fetchYesterdayResults } from './engine/flashscore';

export interface StakedSlip {
  slip: Slip;
  stakedAt: string;
  result: 'pending' | 'won' | 'lost';
  settledAt: string | null;
  selectionResults: Record<string, 'pending' | 'won' | 'lost'>;
  chainId: string | null;
  label: string; // User-defined name/note for this slip
}

type View = 'home' | 'paste' | 'slips' | 'history' | 'fouls' | 'sporty';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [selections, setSelections] = useState<ParsedSelection[]>(() => loadSelections());
  // Optional subset the Slip Builder uses (e.g. one day's picks filtered from the
  // master pool). null = builder uses the full selections list. This lets the
  // master 2-week pool stay intact while you build one day at a time.
  const [builderPool, setBuilderPool] = useState<ParsedSelection[] | null>(null);
  const [generatedSlips, setGeneratedSlips] = useState<Slip[]>(() => loadGeneratedSlips());
  const [stakedSlips, setStagedSlips] = useState<StakedSlip[]>(() => loadStakedSlips());
  const [history, setHistory] = useState<StakedSlip[]>(() => loadHistory());
  const [chains, setChains] = useState<Chain[]>(() => loadChains());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [statsVersion, setStatsVersion] = useState(0); // Incremented when new stats are cached
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showScout, setShowScout] = useState(() => {
    const v = localStorage.getItem('rollover_show_scout');
    return v === null ? true : v === 'true';
  });
  const [showGenerated, setShowGenerated] = useState(() => {
    const v = localStorage.getItem('rollover_show_generated');
    return v === null ? true : v === 'true';
  });
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [analyzeFixture, setAnalyzeFixture] = useState<{ home: string; away: string; league: string } | null>(null);
  const [sbImporting, setSbImporting] = useState(false);
  const [sbMsg, setSbMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('rollover_theme');
    return (saved === 'light') ? 'light' : 'dark';
  });

  // Apply theme class to document
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('rollover_theme', theme);
  }, [theme]);

  useEffect(() => { saveStakedSlips(stakedSlips); }, [stakedSlips]);
  useEffect(() => { saveHistory(history); }, [history]);
  useEffect(() => { saveChains(chains); }, [chains]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveSelections(selections); }, [selections]);
  useEffect(() => { saveGeneratedSlips(generatedSlips); }, [generatedSlips]);

  // Evict old cache entries on app start if storage is getting full
  useEffect(() => { evictIfNeeded(); }, []);

  // Background data refresh: load historical DB + silent refresh + auto-scout + prediction tracking
  useEffect(() => {
    (async () => {
      try {
        const { initBackgroundServices } = await import('./lib/background-service');
        await initBackgroundServices();
      } catch (e) {
        console.warn('[App] Background service init failed:', e);
      }
    })();
  }, []);

  // Auto Result-Checking: poll every 5 minutes, auto-settle finished picks
  // Also runs immediately on mount for returning users with ended matches
  useEffect(() => {
    async function runAutoSettle() {
      // Build pending selections list from active slips
      const pending = stakedSlips.flatMap(staked =>
        staked.slip.selections
          .filter(sel => staked.selectionResults[sel.id] === 'pending')
          .map(sel => ({
            slipId: staked.slip.id,
            selectionId: sel.id,
            homeTeam: sel.homeTeam,
            awayTeam: sel.awayTeam,
            pick: sel.pick,
            pickCategory: sel.pickCategory,
            marketType: sel.marketType,
            kickOffDateTime: new Date(sel.kickOffDateTime),
          }))
      );

      if (!shouldPoll(pending)) return;

      const settlements = await checkAndSettle(pending);
      // Apply each settlement — update scores on selections first, then mark result
      for (const s of settlements) {
        setStagedSlips(prev => prev.map(slip =>
          slip.slip.id === s.slipId ? {
            ...slip,
            slip: {
              ...slip.slip,
              selections: slip.slip.selections.map(sel =>
                sel.id === s.selectionId ? { ...sel, score: { home: s.homeScore, away: s.awayScore } } : sel
              )
            }
          } : slip
        ));
        handleSelectionResult(s.slipId, s.selectionId, s.result);
      }
    }

    // Run immediately on mount (catches matches that ended while app was closed)
    runAutoSettle();

    // Then every 3 minutes
    const interval = setInterval(runAutoSettle, 3 * 60 * 1000);

    return () => clearInterval(interval);
  }, [stakedSlips.length]); // Re-create interval only when slip count changes

  // Backfill missing scores for already-settled selections (one-time on mount)
  useEffect(() => {
    let cancelled = false;
    async function backfillScores() {
      // Check if any staked slip has settled selections without scores
      const needsBackfill = stakedSlips.some(staked =>
        staked.slip.selections.some(sel =>
          staked.selectionResults[sel.id] !== 'pending' && !sel.score
        )
      );
      // Also check history
      const historyNeedsBackfill = history.some(staked =>
        staked.slip.selections.some(sel => !sel.score)
      );

      if (!needsBackfill && !historyNeedsBackfill) return;

      try {
        // Fetch from multiple sources
        const [liveMatches, todayFS, yesterdayFS] = await Promise.all([
          getLiveMatches().catch(() => [] as any[]),
          fetchTodayFinished().catch(() => []),
          fetchYesterdayResults().catch(() => []),
        ]);
        if (cancelled) return;

        // Build a combined lookup function
        function lookupScore(homeTeam: string, awayTeam: string): { home: number; away: number } | null {
          // Try sportscore/ESPN first
          const match = findMatchResult(liveMatches, homeTeam, awayTeam);
          if (match && match.homeScore !== null && match.awayScore !== null) {
            return { home: match.homeScore, away: match.awayScore };
          }
          // Try Flashscore today + yesterday
          const homeNorm = homeTeam.toLowerCase();
          const awayNorm = awayTeam.toLowerCase();
          const allFS = [...todayFS, ...yesterdayFS];
          const fsMatch = allFS.find(f => {
            const fH = f.homeTeam.toLowerCase();
            const fA = f.awayTeam.toLowerCase();
            return (fH.includes(homeNorm) || homeNorm.includes(fH)) &&
                   (fA.includes(awayNorm) || awayNorm.includes(fA));
          });
          if (fsMatch && fsMatch.score) {
            const parts = fsMatch.score.split('-').map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              return { home: parts[0], away: parts[1] };
            }
          }
          return null;
        }

        // Backfill staked slips
        if (needsBackfill) {
          setStagedSlips(prev => prev.map(staked => {
            let changed = false;
            const updatedSelections = staked.slip.selections.map(sel => {
              if (staked.selectionResults[sel.id] === 'pending' || sel.score) return sel;
              const score = lookupScore(sel.homeTeam, sel.awayTeam);
              if (score) { changed = true; return { ...sel, score }; }
              return sel;
            });
            if (!changed) return staked;
            return { ...staked, slip: { ...staked.slip, selections: updatedSelections } };
          }));
        }

        // Backfill history
        if (historyNeedsBackfill) {
          setHistory(prev => prev.map(staked => {
            let changed = false;
            const updatedSelections = staked.slip.selections.map(sel => {
              if (sel.score) return sel;
              const score = lookupScore(sel.homeTeam, sel.awayTeam);
              if (score) { changed = true; return { ...sel, score }; }
              return sel;
            });
            if (!changed) return staked;
            return { ...staked, slip: { ...staked.slip, selections: updatedSelections } };
          }));
        }
      } catch { /* non-critical */ }
    }
    backfillScores();
    return () => { cancelled = true; };
  }, []); // Only on mount

  // Upcoming match notifications — alert 15 min before kickoff
  useEffect(() => {
    if (stakedSlips.length === 0) return;

    // Request notification permission on first staked slip
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const notifiedKey = 'rollover_notified_matches';
    function getNotified(): Set<string> {
      try {
        const data = localStorage.getItem(notifiedKey);
        return data ? new Set(JSON.parse(data)) : new Set();
      } catch { return new Set(); }
    }
    function saveNotified(set: Set<string>) {
      try {
        // Keep only recent (last 200 entries to prevent bloat)
        const arr = Array.from(set).slice(-200);
        localStorage.setItem(notifiedKey, JSON.stringify(arr));
      } catch {}
    }

    function checkUpcoming() {
      if ('Notification' in window && Notification.permission !== 'granted') return;

      const now = Date.now();
      const ALERT_WINDOW = 15 * 60 * 1000; // 15 minutes before kickoff
      const notified = getNotified();

      for (const staked of stakedSlips) {
        for (const sel of staked.slip.selections) {
          if (staked.selectionResults[sel.id] !== 'pending') continue;

          const kickOff = new Date(sel.kickOffDateTime).getTime();
          const timeUntil = kickOff - now;
          const matchKey = `${sel.homeTeam}-${sel.awayTeam}-${sel.date}`;

          // Fire notification 15 min before kickoff (within 0-15 min window)
          if (timeUntil > 0 && timeUntil <= ALERT_WINDOW && !notified.has(matchKey)) {
            const mins = Math.round(timeUntil / 60000);
            new Notification('Match Starting Soon', {
              body: `${sel.homeTeam} v ${sel.awayTeam} kicks off in ${mins} min`,
              icon: undefined,
              tag: matchKey, // Prevents duplicate OS notifications
            });
            notified.add(matchKey);
          }
        }
      }

      saveNotified(notified);
    }

    // Check immediately then every minute
    checkUpcoming();
    const interval = setInterval(checkUpcoming, 60 * 1000);
    return () => clearInterval(interval);
  }, [stakedSlips.length]);

  // Compute confidence scores for all selections (uses cached stats + quick fallback)
  const selectionScores = useMemo(() => {
    const scores = new Map<string, ScoringResult>();
    // Build personal history from settled slips
    const personalHistory = history.length >= 5 ? buildPersonalHistory(history) : undefined;

    for (const sel of selections) {
      const matchData = buildMatchDataFromCache(sel.homeTeam, sel.awayTeam);
      let result: ScoringResult;
      if (matchData) {
        result = scorePickEnhanced(sel, matchData, personalHistory);
      } else {
        result = quickScore(sel);
      }
      scores.set(sel.id, result);
    }
    return scores;
  }, [selections, statsVersion, history.length]);

  // Flat id → numeric score map (fed into the slip builder engine)
  const scoreMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, result] of selectionScores) m.set(id, result.score);
    return m;
  }, [selectionScores]);

  // Record predictions OUTSIDE useMemo (side-effect, batched)
  useEffect(() => {
    if (selections.length === 0) return;
    const personalHistory = history.length >= 5 ? buildPersonalHistory(history) : undefined;
    for (const sel of selections) {
      const matchData = buildMatchDataFromCache(sel.homeTeam, sel.awayTeam);
      if (matchData) {
        const result = selectionScores.get(sel.id);
        if (result && result.confidence !== 'no_data') {
          recordPrediction(
            sel.id, sel.homeTeam, sel.awayTeam, sel.kickOffDateTime,
            sel.pick, sel.pickCategory, sel.marketType, sel.odds,
            buildInputsFromMatchData(matchData),
            result.score, result.confidence,
            result.factors
          );
        }
      }
    }
  }, [selections.length, statsVersion]);

  // Get all match keys currently in staked slips (for duplicate prevention)
  function getStakedMatchKeys(): Set<string> {
    const keys = new Set<string>();
    for (const staked of stakedSlips) {
      for (const sel of staked.slip.selections) {
        keys.add(`${sel.homeTeam.toLowerCase()}-${sel.awayTeam.toLowerCase()}`);
      }
    }
    return keys;
  }

  function handleSlipStaked(slip: Slip, chainId?: string, label?: string): string | null {
    const stakedKeys = getStakedMatchKeys();
    const conflicts: string[] = [];
    for (const sel of slip.selections) {
      const key = `${sel.homeTeam.toLowerCase()}-${sel.awayTeam.toLowerCase()}`;
      if (stakedKeys.has(key)) {
        conflicts.push(`${sel.homeTeam} v ${sel.awayTeam}`);
      }
    }

    if (conflicts.length > 0) {
      return `Cannot stake: ${conflicts.join(', ')} already in an active slip.`;
    }

    // Daily limit check
    const today = new Date().toDateString();
    const stakedToday = stakedSlips.filter(s => new Date(s.stakedAt).toDateString() === today).length
      + history.filter(h => new Date(h.stakedAt).toDateString() === today).length;
    if (stakedToday >= settings.dailySlipLimit) {
      return `Daily limit reached (${settings.dailySlipLimit} slips today). Discipline > action.`;
    }

    const stakedSlip: StakedSlip = {
      slip,
      stakedAt: new Date().toISOString(),
      result: 'pending',
      settledAt: null,
      selectionResults: Object.fromEntries(
        slip.selections.map(s => [s.id, 'pending' as const])
      ),
      chainId: chainId || null,
      label: label || '',
    };
    setStagedSlips(prev => [...prev, stakedSlip]);
    return null;
  }

  // Chain management
  const activeChains = chains.filter(c => c.status === 'active');

  function handleCreateChain(label: string, startingStake: number) {
    const chain: Chain = {
      id: crypto.randomUUID(),
      label,
      starting_stake: startingStake,
      target_amount: null,
      current_step: 0,
      current_stake: startingStake,
      status: 'active',
      started_at: new Date().toISOString(),
      ended_at: null,
      break_reason: null,
    };
    setChains(prev => [...prev, chain]);
  }

  function advanceChain(chainId: string, winAmount: number) {
    setChains(prev => prev.map(c => {
      if (c.id !== chainId) return c;
      return { ...c, current_step: c.current_step + 1, current_stake: winAmount };
    }));
  }

  function breakChain(chainId: string, reason: string) {
    setChains(prev => prev.map(c => {
      if (c.id !== chainId) return c;
      return { ...c, status: 'broken' as const, ended_at: new Date().toISOString(), break_reason: reason };
    }));
  }

  function handleSlipWon(slipId: string) {
    const slip = stakedSlips.find(s => s.slip.id === slipId);
    if (!slip) return;

    // Record outcomes for all picks in prediction log
    slip.slip.selections.forEach(sel => recordOutcome(sel.id, 'won'));

    const settled: StakedSlip = {
      ...slip,
      result: 'won',
      settledAt: new Date().toISOString(),
      selectionResults: Object.fromEntries(
        Object.keys(slip.selectionResults).map(k => [k, 'won' as const])
      ),
    };
    setHistory(h => [settled, ...h]);
    setStagedSlips(prev => prev.filter(s => s.slip.id !== slipId));

    // Auto-advance linked chain
    if (slip.chainId) {
      const winAmount = slip.slip.accumulatedOdds * (chains.find(c => c.id === slip.chainId)?.current_stake || 0);
      advanceChain(slip.chainId, winAmount);
    }
  }

  function handleSlipLost(slipId: string) {
    const slip = stakedSlips.find(s => s.slip.id === slipId);
    if (!slip) return;

    // Record outcomes — we don't know which pick lost, mark all as lost for now
    // (handleSelectionResult handles granular per-pick tracking)
    slip.slip.selections.forEach(sel => {
      if (slip.selectionResults[sel.id] === 'pending') recordOutcome(sel.id, 'lost');
    });

    const settled: StakedSlip = { ...slip, result: 'lost', settledAt: new Date().toISOString() };
    setHistory(h => [settled, ...h]);
    setStagedSlips(prev => prev.filter(s => s.slip.id !== slipId));

    // Auto-break linked chain
    if (slip.chainId) {
      breakChain(slip.chainId, 'Slip lost');
    }
  }

  function handleSelectionResult(slipId: string, selectionId: string, result: 'won' | 'lost') {
    const slip = stakedSlips.find(s => s.slip.id === slipId);
    if (!slip) return;

    // Record outcome in prediction log for calibration
    recordOutcome(selectionId, result);

    const updated = { ...slip.selectionResults, [selectionId]: result };

    if (result === 'lost') {
      const settled: StakedSlip = { ...slip, selectionResults: updated, result: 'lost', settledAt: new Date().toISOString() };
      setHistory(h => [settled, ...h]);
      setStagedSlips(prev => prev.filter(s => s.slip.id !== slipId));
      if (slip.chainId) {
        breakChain(slip.chainId, 'Match lost');
      }
      return;
    }

    const allWon = Object.values(updated).every(v => v === 'won');
    if (allWon) {
      const settled: StakedSlip = { ...slip, selectionResults: updated, result: 'won', settledAt: new Date().toISOString() };
      setHistory(h => [settled, ...h]);
      setStagedSlips(prev => prev.filter(s => s.slip.id !== slipId));
      if (slip.chainId) {
        const winAmount = slip.slip.accumulatedOdds * (chains.find(c => c.id === slip.chainId)?.current_stake || 0);
        advanceChain(slip.chainId, winAmount);
      }
      return;
    }

    // Partial update — just update the selection result
    setStagedSlips(prev => prev.map(s =>
      s.slip.id === slipId ? { ...s, selectionResults: updated } : s
    ));
  }

  function handleUndoStake(slipId: string) {
    const slip = stakedSlips.find(s => s.slip.id === slipId);
    if (slip) {
      setGeneratedSlips(g => {
        if (g.some(x => x.id === slip.slip.id)) return g;
        return [slip.slip, ...g];
      });
    }
    setStagedSlips(prev => prev.filter(s => s.slip.id !== slipId));
  }

  function handleDeleteHistory(slipId: string) {
    setHistory(prev => prev.filter(h => h.slip.id !== slipId));
  }

  function handleClearHistory() {
    setHistory([]);
  }

  function handleExport() {
    const data = exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rollover-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = importAllData(text);
      if (result.success) {
        // Reload state from storage
        setStagedSlips(loadStakedSlips());
        setHistory(loadHistory());
        setChains(loadChains());
        setSettings(loadSettings());
      } else {
        alert(result.error || 'Import failed');
      }
    };
    reader.readAsText(file);
  }

  // Selection list export/import/clear
  function handleExportSelections() {
    const data = exportSelections(selections);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rollover-selections-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportSelections(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = importSelections(text);
      if (result.success && result.selections) {
        // Merge with existing, dedup by homeTeam+awayTeam+pick+market
        setSelections(prev => {
          const existingKeys = new Set(prev.map(s =>
            `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`
          ));
          const newPicks = result.selections!.filter(s => {
            const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`;
            return !existingKeys.has(key);
          });
          return [...prev, ...newPicks];
        });
      } else {
        alert(result.error || 'Import failed');
      }
    };
    reader.readAsText(file);
  }

  function handleClearSelections() {
    if (confirm('Clear all selections? This cannot be undone.')) {
      setSelections([]);
    }
  }

  const pendingCount = stakedSlips.length;
  const historyCount = history.length;

  // Slip management: merge two slips into one
  function handleMergeSlips(slipId1: string, slipId2: string) {
    setGeneratedSlips(prev => {
      const slip1 = prev.find(s => s.id === slipId1);
      const slip2 = prev.find(s => s.id === slipId2);
      if (!slip1 || !slip2) return prev;

      // Merge, de-duplicating any shared fixtures (never same match twice)
      const seenKeys = new Set<string>();
      const mergedSelections = [...slip1.selections, ...slip2.selections].filter(s => {
        const key = `${s.homeTeam.toLowerCase()}-${s.awayTeam.toLowerCase()}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      const accOdds = mergedSelections.reduce((acc, s) => acc * s.odds, 1);
      const merged: Slip = {
        id: crypto.randomUUID(),
        selections: mergedSelections,
        accumulatedOdds: Math.round(accOdds * 100) / 100,
        qualityScore: calculateQuality(mergedSelections, DEFAULT_CONFIG),
        hasHighRiskPick: mergedSelections.some(s => s.odds > 1.6),
        selectionCount: mergedSelections.length,
      };
      return [merged, ...prev.filter(s => s.id !== slipId1 && s.id !== slipId2)];
    });
  }

  // Remove a pick from a generated slip
  function handleRemovePick(slipId: string, selectionId: string) {
    setGeneratedSlips(prev => prev.map(slip => {
      if (slip.id !== slipId) return slip;
      const remaining = slip.selections.filter(s => s.id !== selectionId);
      if (remaining.length < 2) return null as any; // Remove slip if less than 2 picks
      const accOdds = remaining.reduce((acc, s) => acc * s.odds, 1);
      return {
        ...slip,
        selections: remaining,
        accumulatedOdds: Math.round(accOdds * 100) / 100,
        selectionCount: remaining.length,
        qualityScore: calculateQuality(remaining, DEFAULT_CONFIG),
        hasHighRiskPick: remaining.some(s => s.odds > 1.6),
      };
    }).filter(Boolean));
  }

  // Remove entire generated slip
  function handleRemoveSlip(slipId: string) {
    setGeneratedSlips(prev => prev.filter(s => s.id !== slipId));
  }

  // Quick paste from clipboard on dashboard
  async function handleQuickPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const result = parseSportyBet(text);
        // Strip already-started fixtures before they enter the working set
        const now = Date.now();
        const GRACE_MS = 5 * 60 * 1000;
        const future = result.activeSelections.filter(s => {
          const k = s.kickOffDateTime ? new Date(s.kickOffDateTime).getTime() : NaN;
          return isNaN(k) || k > now - GRACE_MS;
        });
        if (future.length > 0) {
          setSelections(future);
          setView('paste');
        }
      }
    } catch (e) {
      console.error('Clipboard read failed:', e);
    }
  }

  // Import fixtures + odds directly from SportyBet's API (the book the user
  // stakes on). Non-destructive: merges into the existing pool, deduped by
  // team-pair + market + pick, and drops already-started fixtures — same rules
  // as the paste workflow, so the two coexist.
  async function handleSportyBetImport() {
    setSbImporting(true);
    setSbMsg('Connecting to SportyBet...');
    try {
      const { fetchSportyBetSelections } = await import('./engine/sportybet');
      const imported = await fetchSportyBetSelections({
        region: 'ng',
        maxPages: 6,
        pageSize: 20,
        onProgress: (m) => setSbMsg(m),
      });
      const now = Date.now();
      const GRACE_MS = 5 * 60 * 1000;
      const future = imported.filter(s => {
        const k = s.kickOffDateTime ? new Date(s.kickOffDateTime).getTime() : NaN;
        return isNaN(k) || k > now - GRACE_MS;
      });
      if (future.length === 0) {
        setSbMsg('No upcoming SportyBet fixtures found. If this persists, redeploy the Cloudflare Worker (sportybet.com must be whitelisted).');
      } else {
        setSelections(prev => {
          const keyOf = (s: typeof future[number]) => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.market.toLowerCase()}|${s.pick.toLowerCase()}`;
          const existing = new Set(prev.map(keyOf));
          const fresh = future.filter(s => !existing.has(keyOf(s)));
          return [...prev, ...fresh];
        });
        setSbMsg(`Imported ${future.length} SportyBet selections.`);
        setView('paste');
      }
    } catch (e: any) {
      setSbMsg(`SportyBet import failed: ${e?.message || 'unknown error'}`);
    } finally {
      setSbImporting(false);
      setTimeout(() => setSbMsg(null), 7000);
    }
  }

  // Suggest best slip at a target odds level using confidence scores
  function handleSuggestSlip(targetOdds: number) {
    const slip = suggestBestSlip(selections, scoreMap, targetOdds);
    if (slip) {
      setGeneratedSlips(prev => {
        // Don't add duplicate
        if (prev.some(s => s.id === slip.id)) return prev;
        return [slip, ...prev];
      });
    } else {
      alert(`Cannot build a ${targetOdds}-odds slip from current selections. Need more eligible picks with sufficient confidence.`);
    }
  }

  // Keyboard shortcuts: Ctrl+G=Paste&Build, Ctrl+1/2/3=suggest slips
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'g':
          case 'G':
            e.preventDefault();
            setView('paste');
            break;
          case '1':
            e.preventDefault();
            handleSuggestSlip(2.0);
            break;
          case '2':
            e.preventDefault();
            handleSuggestSlip(3.0);
            break;
          case '3':
            e.preventDefault();
            handleSuggestSlip(5.0);
            break;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Add a scouted match pick to selections for slip generation
  function handleAddScoutedPick(pick: ParsedSelection) {
    setSelections(prev => {
      // Don't add duplicates (same teams)
      const exists = prev.some(s =>
        s.homeTeam.toLowerCase() === pick.homeTeam.toLowerCase() &&
        s.awayTeam.toLowerCase() === pick.awayTeam.toLowerCase()
      );
      if (exists) return prev;
      return [...prev, pick];
    });
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      <DisciplineBanner />

      <nav className="flex gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => setView('home')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'home' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setView('paste')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'paste' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          Paste & Build {selections.length > 0 && <span className="ml-1 bg-blue-700 text-white px-1.5 py-0.5 rounded-full text-xs">{selections.length}</span>}
        </button>
        <button
          onClick={() => setView('sporty')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'sporty' ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
          title="SportyBet fixtures — the book you play. Click a fixture for your preferred markets."
        >
          Markets
        </button>
        <button
          onClick={() => setView('fouls')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'fouls' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          Fouls
        </button>
        <button
          onClick={() => setView('slips')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'slips' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          Active Slips {pendingCount > 0 && <span className="ml-1 bg-green-600 text-white px-1.5 py-0.5 rounded-full text-xs">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setView('history')}
          className={`px-4 py-2 rounded text-sm font-medium ${
            view === 'history' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          }`}
        >
          History {historyCount > 0 && <span className="ml-1 bg-gray-600 text-white px-1.5 py-0.5 rounded-full text-xs">{historyCount}</span>}
        </button>
        <span className="ml-auto text-xs text-gray-600 self-center px-2">v3.0.0 FS+</span>
        <button
          onClick={() => setShowAccuracy(true)}
          className="px-2 py-2 rounded text-sm font-medium text-gray-300 hover:bg-gray-700"
          title="Prediction Accuracy"
        >
          &#9776;
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="px-2 py-2 rounded text-sm font-medium text-gray-300 hover:bg-gray-700"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '\u2600' : '\u263D'}
        </button>
        <button
          onClick={() => setShowApiSettings(true)}
          className="px-3 py-2 rounded text-sm font-medium text-gray-300 hover:bg-gray-700"
          title="API Settings"
        >
          ⚙
        </button>
      </nav>

      <ErrorBoundary fallbackMessage="A section of the app encountered an error. Your selections and data are safe.">
      <main className="flex-1 overflow-hidden">
        {view === 'home' && (
          <div className="h-full p-4 overflow-y-auto pb-16">
              <h2 className="text-lg font-bold mb-4 text-blue-400">Command Center</h2>

              {/* Quick Actions Bar */}
              <div className="flex gap-2 mb-4 flex-wrap">
                <button
                  onClick={handleQuickPaste}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
                >
                  Quick Paste from Clipboard
                </button>
                <button
                  onClick={handleSportyBetImport}
                  disabled={sbImporting}
                  className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs font-medium text-white flex items-center gap-1"
                  title="Pull upcoming fixtures + odds straight from SportyBet — the book you stake on"
                >
                  {sbImporting ? 'Importing…' : '⬇ Import from SportyBet'}
                </button>
                <button
                  onClick={() => setView('paste')}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-gray-300"
                >
                  Paste & Build
                </button>
                {generatedSlips.length >= 2 && (
                  <button
                    onClick={() => {
                      if (generatedSlips.length >= 2) {
                        handleMergeSlips(generatedSlips[0].id, generatedSlips[1].id);
                      }
                    }}
                    className="px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium"
                  >
                    Merge Top 2 Slips
                  </button>
                )}
                {generatedSlips.length > 0 && (
                  <button
                    onClick={() => setGeneratedSlips([])}
                    className="px-3 py-2 bg-gray-700 hover:bg-red-900 rounded text-xs font-medium text-gray-400 hover:text-red-300"
                  >
                    Clear Generated
                  </button>
                )}
              </div>

              {/* SportyBet import status */}
              {sbMsg && (
                <div className="mb-4 p-2 bg-green-900/25 border border-green-800 rounded text-[11px] text-green-200">{sbMsg}</div>
              )}

              {/* Selections Summary */}
              {selections.length > 0 && (
                <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-blue-900">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-blue-600 text-white px-2 py-1 rounded-full text-xs font-bold">{selections.length}</span>
                      <span className="text-sm text-gray-300 font-medium">Active Selections</span>
                    </div>
                    <button
                      onClick={() => setView('paste')}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View All →
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-gray-400">
                      Avg Odds: <span className="text-gray-200 font-mono">
                        {(selections.reduce((sum, s) => sum + s.odds, 0) / selections.length).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-gray-400">
                      Eligible: <span className="text-green-400 font-mono">
                        {selections.filter(s => s.isEligibleForGrouping).length}
                      </span>
                    </div>
                    <div className="text-gray-400">
                      Markets: <span className="text-gray-200 font-mono">
                        {new Set(selections.map(s => s.marketType)).size} types
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(() => {
                      const marketCounts: Record<string, number> = {};
                      selections.forEach(s => { marketCounts[s.marketType] = (marketCounts[s.marketType] || 0) + 1; });
                      return Object.entries(marketCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([market, count]) => (
                          <span key={market} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                            {market.replace('_', '/')} ({count})
                          </span>
                        ));
                    })()}
                  </div>
                </div>
              )}

              {/* Suggest Best Slip */}
              {selections.filter(s => s.isEligibleForGrouping).length >= 2 && (
                <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-green-900">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 font-medium">Smart Slip Suggestion</span>
                    <span className="text-xs text-gray-500">Uses confidence scores</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleSuggestSlip(2.0)}
                      className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium text-white"
                    >
                      Safest 2-Odds
                    </button>
                    <button
                      onClick={() => handleSuggestSlip(3.0)}
                      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs font-medium text-white"
                    >
                      Best 3-Odds Slip
                    </button>
                    <button
                      onClick={() => handleSuggestSlip(5.0)}
                      className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium text-white"
                    >
                      Bold 5-Odds
                    </button>
                  </div>
                </div>
              )}

              {/* Data Health Indicator */}
              {selections.length > 0 && (() => {
                const STATS_CACHE_KEY = 'rollover_team_stats_cache';
                try {
                  const cache = JSON.parse(localStorage.getItem(STATS_CACHE_KEY) || '{}');
                  const entries = Object.values(cache) as any[];
                  if (entries.length === 0) return null;
                  const latestCachedAt = Math.max(...entries.map((e: any) => e.cachedAt || 0));
                  const ageMs = Date.now() - latestCachedAt;
                  const ageHours = Math.round(ageMs / (60 * 60 * 1000) * 10) / 10;
                  const isStale = ageHours > 24;
                  const isFresh = ageHours < 4;
                  return (
                    <div className={`mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                      isStale ? 'bg-red-900/30 border border-red-900' : isFresh ? 'bg-green-900/30 border border-green-900' : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <span className="text-gray-400">
                        Stats data: <span className={isFresh ? 'text-green-400' : isStale ? 'text-red-400' : 'text-yellow-400'}>
                          {ageHours < 1 ? `${Math.round(ageMs / 60000)}m old` : `${ageHours}h old`}
                        </span>
                        <span className="text-gray-600 ml-2">({entries.length} teams cached)</span>
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        isFresh ? 'bg-green-800 text-green-300' : isStale ? 'bg-red-800 text-red-300' : 'bg-yellow-800 text-yellow-300'
                      }`}>
                        {isFresh ? 'Fresh' : isStale ? 'Stale' : 'OK'}
                      </span>
                    </div>
                  );
                } catch { return null; }
              })()}

              {/* Streak & P&L Summary */}
              {history.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-800 rounded-lg p-3">
                    <span className="text-xs text-gray-400 block mb-1">Win Streak</span>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">
                        {(() => {
                          let streak = 0;
                          for (const h of history) {
                            if (h.result === 'won') streak++;
                            else break;
                          }
                          return streak;
                        })()}
                      </span>
                      <span className="text-xs text-gray-500">current</span>
                    </div>
                    <div className="flex gap-0.5 mt-2">
                      {history.slice(0, 10).map((h, i) => (
                        <span
                          key={i}
                          className={`w-4 h-4 rounded-sm flex items-center justify-center text-xs font-bold ${
                            h.result === 'won' ? 'bg-green-800 text-green-300' : 'bg-red-900 text-red-300'
                          }`}
                        >
                          {h.result === 'won' ? '✓' : '✗'}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs text-gray-500 mt-1 block">Last {Math.min(history.length, 10)}</span>
                  </div>

                  <div className="bg-gray-800 rounded-lg p-3">
                    <span className="text-xs text-gray-400 block mb-1">Overall P&L</span>
                    <div className="flex items-baseline gap-2">
                      {(() => {
                        const wonCount = history.filter(h => h.result === 'won').length;
                        const lostCount = history.filter(h => h.result === 'lost').length;
                        const winRate = history.length > 0 ? Math.round((wonCount / history.length) * 100) : 0;
                        return (
                          <>
                            <span className={`text-lg font-bold ${wonCount > lostCount ? 'text-green-400' : 'text-red-400'}`}>
                              {wonCount}W / {lostCount}L
                            </span>
                            <span className="text-xs text-gray-400">{winRate}%</span>
                          </>
                        );
                      })()}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      Total slips: {history.length}
                    </div>
                  </div>
                </div>
              )}

              {/* Active Slips Quick View */}
              {pendingCount > 0 && (
                <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-green-900">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-green-600 text-white px-2 py-1 rounded-full text-xs font-bold">{pendingCount}</span>
                      <span className="text-sm text-gray-300 font-medium">Active Slips</span>
                    </div>
                    <button
                      onClick={() => setView('slips')}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View All →
                    </button>
                  </div>
                  {stakedSlips.slice(0, 3).map(staked => {
                    const wonCount = Object.values(staked.selectionResults).filter(r => r === 'won').length;
                    const totalCount = staked.slip.selectionCount;
                    return (
                      <div key={staked.slip.id} className="flex items-center justify-between py-1 text-xs border-t border-gray-700">
                        <span className="text-gray-300">
                          {staked.label || `${staked.slip.accumulatedOdds.toFixed(2)} odds`}
                          <span className="text-gray-500 ml-2">{wonCount}/{totalCount} won</span>
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSlipWon(staked.slip.id)}
                            className="px-1.5 py-0.5 bg-green-800 hover:bg-green-700 rounded text-green-300"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => handleSlipLost(staked.slip.id)}
                            className="px-1.5 py-0.5 bg-red-900 hover:bg-red-800 rounded text-red-300"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Match Scout — collapsible */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => { const v = !showScout; setShowScout(v); localStorage.setItem('rollover_show_scout', String(v)); }}
                    className="flex items-center gap-2 text-md font-semibold text-blue-400 hover:text-blue-300"
                  >
                    <span className="text-xs">{showScout ? '▼' : '▶'}</span>
                    Match Scout
                  </button>
                  <span className="text-xs text-gray-500">{showScout ? 'Click to hide' : 'Click to show'}</span>
                </div>
                {showScout && <MatchScout onAddPick={handleAddScoutedPick} />}
              </div>

              {/* Generated Slips with Actions — collapsible */}
              {generatedSlips.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => { const v = !showGenerated; setShowGenerated(v); localStorage.setItem('rollover_show_generated', String(v)); }}
                      className="flex items-center gap-2 text-md font-semibold text-green-400 hover:text-green-300"
                    >
                      <span className="text-xs">{showGenerated ? '▼' : '▶'}</span>
                      Generated ({generatedSlips.length} slips)
                    </button>
                    <span className="text-xs text-gray-500">{showGenerated ? 'Click to hide' : 'Click to show'}</span>
                  </div>
                  {showGenerated && (
                    <GeneratedSlips
                      slips={generatedSlips}
                      activeChains={activeChains}
                      allSelections={selections}
                      onSlipStaked={handleSlipStaked}
                      onRemoveSlip={handleRemoveSlip}
                      onRemovePick={handleRemovePick}
                      scores={scoreMap}
                    />
                  )}
                </div>
              )}

              {generatedSlips.length === 0 && stakedSlips.length === 0 && history.length === 0 && (
                <div className="bg-gray-800 rounded-lg p-6 text-center">
                  <p className="text-gray-400 text-sm mb-3">Ready to start. Paste your bet list to generate slips.</p>
                  <button
                    onClick={handleQuickPaste}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
                  >
                    Quick Paste from Clipboard
                  </button>
                </div>
              )}
          </div>
        )}

        {view === 'paste' && (
          <div className="flex h-full pb-16">
            <div className="flex-1 p-4 overflow-y-auto border-r border-gray-700">
              <PasteInput
                onParsed={setSelections}
                existingCount={selections.length}
                onMerge={(newPicks) => {
                  setSelections(prev => {
                    const existingKeys = new Set(
                      prev.map(s => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`)
                    );
                    const unique = newPicks.filter(s => {
                      const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`;
                      if (existingKeys.has(key)) return false;
                      existingKeys.add(key);
                      return true;
                    });
                    return [...prev, ...unique];
                  });
                }}
              />
              {selections.length > 0 && (
                <div className="mt-4">
                  <SelectionList
                    selections={selections}
                    scores={selectionScores}
                    onUpdateOdds={(selId, newOdds) => {
                      setSelections(prev => prev.map(s => s.id === selId ? { ...s, odds: newOdds } : s));
                    }}
                    onRemoveSelection={(selId) => {
                      setSelections(prev => prev.filter(s => s.id !== selId));
                    }}
                    onUseFiltered={(filtered) => {
                      // Non-destructive: scope the builder to this subset (e.g. one
                      // day) while keeping the full master pool intact.
                      setBuilderPool(filtered);
                    }}
                    onExportSelections={handleExportSelections}
                    onImportSelections={handleImportSelections}
                    onClearSelections={handleClearSelections}
                    onAnalyze={(home, away, league) => setAnalyzeFixture({ home, away, league })}
                  />
                </div>
              )}

              {/* Generated Slips with Merge & Purge on Paste page */}
              {generatedSlips.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-green-400">
                      Generated ({generatedSlips.length} slips)
                    </h3>
                    <div className="flex gap-2">
                      {generatedSlips.length >= 2 && (
                        <button
                          onClick={() => handleMergeSlips(generatedSlips[0].id, generatedSlips[1].id)}
                          className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium"
                          title="Merge the top 2 slips into one"
                        >
                          Merge Top 2
                        </button>
                      )}
                      <button
                        onClick={() => {
                          // Purge: remove slips that exceed max picks or have low quality
                          const purged = generatedSlips.filter(s => s.qualityScore >= 40);
                          if (purged.length < generatedSlips.length) {
                            setGeneratedSlips(purged);
                          } else {
                            // If all pass quality, remove bottom 50%
                            const sorted = [...generatedSlips].sort((a, b) => b.qualityScore - a.qualityScore);
                            setGeneratedSlips(sorted.slice(0, Math.ceil(sorted.length / 2)));
                          }
                        }}
                        className="px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-xs font-medium"
                        title="Remove low-quality slips (quality < 40 or bottom 50%)"
                      >
                        Purge Weak
                      </button>
                      <button
                        onClick={() => setGeneratedSlips([])}
                        className="px-2 py-1 bg-gray-700 hover:bg-red-900 rounded text-xs font-medium text-gray-400 hover:text-red-300"
                        title="Clear all generated slips"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <GeneratedSlips
                    slips={generatedSlips}
                    activeChains={activeChains}
                    allSelections={selections}
                    onSlipStaked={handleSlipStaked}
                    onRemoveSlip={handleRemoveSlip}
                    onRemovePick={handleRemovePick}
                    /* No scores — Paste page shows pure market-implied win% only */
                  />
                </div>
              )}
            </div>

            <div className="w-96 p-4 overflow-y-auto">
              {selections.length > 0 && (
                <>
                  {builderPool && (
                    <div className="mb-2 p-2 bg-blue-900/30 border border-blue-800 rounded text-xs text-blue-300 flex items-center justify-between">
                      <span>Builder scoped to {builderPool.length} selected picks (of {selections.length})</span>
                      <button
                        onClick={() => setBuilderPool(null)}
                        className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                      >
                        Use all
                      </button>
                    </div>
                  )}
                  <SlipGenerator
                    selections={builderPool ?? selections}
                    onGenerated={setGeneratedSlips}
                    /* No scores passed — Paste & Build is pure distribution of YOUR
                       hand-studied predictions. Prediction/scoring belongs to Scout. */
                  />
                </>
              )}
            </div>
          </div>
        )}

        {view === 'fouls' && (
          <div className="h-full p-4 overflow-y-auto pb-16">
            <FoulsStrategy />
          </div>
        )}

        {view === 'sporty' && (
          <div className="h-full p-4 overflow-y-auto pb-16">
            <PreferredMarkets onImport={(sels) => {
              // Non-destructive merge into the pool, deduped by team+market+pick;
              // drop already-started fixtures (same discipline as paste).
              const now = Date.now();
              const GRACE_MS = 5 * 60 * 1000;
              const future = sels.filter(s => {
                const k = s.kickOffDateTime ? new Date(s.kickOffDateTime).getTime() : NaN;
                return isNaN(k) || k > now - GRACE_MS;
              });
              if (future.length === 0) return;
              setSelections(prev => {
                const keyOf = (s: ParsedSelection) => `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.market.toLowerCase()}|${s.pick.toLowerCase()}`;
                const existing = new Set(prev.map(keyOf));
                const fresh = future.filter(s => !existing.has(keyOf(s)));
                return [...prev, ...fresh];
              });
            }} />
          </div>
        )}

        {view === 'slips' && (
          <div className="h-full p-4 overflow-y-auto pb-16">
              <ActiveSlips
                stakedSlips={stakedSlips}
                chains={chains}
                onSlipWon={handleSlipWon}
                onSlipLost={handleSlipLost}
                onSelectionResult={handleSelectionResult}
                onUndoStake={handleUndoStake}
                onUpdateScores={(updates) => {
                  setStagedSlips(prev => prev.map(staked => {
                    const slipUpdates = updates.filter(u => u.slipId === staked.slip.id);
                    if (slipUpdates.length === 0) return staked;
                    return {
                      ...staked,
                      slip: {
                        ...staked.slip,
                        selections: staked.slip.selections.map(sel => {
                          const upd = slipUpdates.find(u => u.selectionId === sel.id);
                          return upd ? { ...sel, score: upd.score } : sel;
                        })
                      }
                    };
                  }));
                  // Also update history slips with same scores
                  setHistory(prev => prev.map(staked => {
                    const slipUpdates = updates.filter(u => u.slipId === staked.slip.id);
                    if (slipUpdates.length === 0) return staked;
                    return {
                      ...staked,
                      slip: {
                        ...staked.slip,
                        selections: staked.slip.selections.map(sel => {
                          const upd = slipUpdates.find(u => u.selectionId === sel.id);
                          return upd ? { ...sel, score: upd.score } : sel;
                        })
                      }
                    };
                  }));
                }}
              />
          </div>
        )}

        {view === 'history' && (
          <div className="h-full p-4 overflow-y-auto pb-16">
              <SlipHistory
                history={history}
                onDelete={handleDeleteHistory}
                onClearAll={handleClearHistory}
                onExport={handleExport}
                onImport={handleImport}
                dailySlipLimit={settings.dailySlipLimit}
                onDailyLimitChange={(limit) => setSettings({ ...settings, dailySlipLimit: limit })}
                todayStaked={
                  stakedSlips.filter(s => new Date(s.stakedAt).toDateString() === new Date().toDateString()).length
                  + history.filter(h => new Date(h.stakedAt).toDateString() === new Date().toDateString()).length
                }
              />
          </div>
        )}
      </main>
      </ErrorBoundary>

      {/* Floating Widgets */}
      <ChainsWidget
        chains={chains}
        onCreateChain={handleCreateChain}
        onAdvanceChain={advanceChain}
        onBreakChain={breakChain}
      />

      {/* API Settings Modal */}
      <ApiSettingsModal
        open={showApiSettings}
        onClose={() => setShowApiSettings(false)}
      />
      <AccuracyDashboard
        open={showAccuracy}
        onClose={() => setShowAccuracy(false)}
      />
      {analyzeFixture && (
        <MatchAnalysis
          homeTeam={analyzeFixture.home}
          awayTeam={analyzeFixture.away}
          league={analyzeFixture.league}
          onClose={() => setAnalyzeFixture(null)}
        />
      )}
    </div>
  );
}
