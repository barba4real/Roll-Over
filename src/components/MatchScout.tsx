import React, { useState } from 'react';
import { ScoutedMatch, PickSuggestion, scoutMatches } from '../engine/match-scout';
import { setApiKey } from '../engine/api-football';
import { setFootballDataKey, FREE_COMPETITIONS } from '../engine/football-data-org';
import { setOddsApiKey, getAllSoccerOdds, findMatchOdds, detectValue } from '../engine/odds-api';
import { setKickoffApiKey } from '../engine/kickoff-api';
import { setSportmonksToken } from '../engine/sportmonks';
import { fetchAllProviders } from '../engine/provider-orchestrator';
import { ParsedSelection } from '../engine/types';

interface Props {
  onAddPick?: (pick: ParsedSelection) => void;
}

const ALL_LEAGUES = FREE_COMPETITIONS.map(c => ({ ...c, checked: true }));

export default function MatchScout({ onAddPick }: Props) {
  // Initialize all saved API keys on mount (silent, no gate)
  useState(() => {
    const key = localStorage.getItem('rollover_footballdata_key');
    if (key) setFootballDataKey(key);
    const key2 = localStorage.getItem('rollover_api_football_key');
    if (key2) setApiKey(key2);
    const key3 = localStorage.getItem('rollover_odds_api_key');
    if (key3) setOddsApiKey(key3);
    const key4 = localStorage.getItem('rollover_kickoff_api_key');
    if (key4) setKickoffApiKey(key4);
    const key5 = localStorage.getItem('rollover_sportmonks_token');
    if (key5) setSportmonksToken(key5);
  });

  // Provider toggles — which providers to use in scout
  const [providerToggles, setProviderToggles] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('rollover_scout_providers');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      thesportsdb: true,
      espn: true,
      openligadb: true,
      sportscore: true,
      footballdata: true,
      apifootball: true,
      kickoffapi: true,
      sportmonks: true,
      oddsapi: true,
    };
  });

  function toggleProvider(id: string) {
    setProviderToggles(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      localStorage.setItem('rollover_scout_providers', JSON.stringify(updated));
      return updated;
    });
  }

  const [leagues, setLeagues] = useState(() => {
    const saved = localStorage.getItem('rollover_scout_leagues');
    return saved ? JSON.parse(saved) : ALL_LEAGUES;
  });
  const [matches, setMatches] = useState<ScoutedMatch[]>(() => {
    // Load cached results if fresh (< 12 hours old)
    try {
      const cached = localStorage.getItem('rollover_scout_cache');
      if (cached) {
        const { results, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        if (age < 12 * 60 * 60 * 1000) { // 12 hours
          return results;
        }
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(2);
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);
  const [addedPicks, setAddedPicks] = useState<Set<string>>(new Set());
  const [valueMap, setValueMap] = useState<Record<string, { isValue: boolean; edge: number; marketOdds: number }>>({});

  function cacheResults(results: ScoutedMatch[]) {
    try {
      localStorage.setItem('rollover_scout_cache', JSON.stringify({
        results,
        timestamp: Date.now(),
      }));
    } catch {}
  }

  function handleAddPick(match: ScoutedMatch, sug: { market: string; pick: string; estimatedOdds: string }) {
    if (!onAddPick) return;
    const key = `${match.fixtureId}-${sug.pick}`;
    if (addedPicks.has(key)) return;

    // Parse estimated odds — take midpoint of range like "1.30-1.50"
    const oddsParts = sug.estimatedOdds.split('-').map(s => parseFloat(s.trim()));
    const odds = oddsParts.length === 2 ? (oddsParts[0] + oddsParts[1]) / 2 : oddsParts[0] || 1.3;

    const kickOff = new Date(match.kickOff);
    const day = kickOff.getDate().toString().padStart(2, '0');
    const month = (kickOff.getMonth() + 1).toString().padStart(2, '0');
    const hour = kickOff.getHours().toString().padStart(2, '0');
    const min = kickOff.getMinutes().toString().padStart(2, '0');

    const selection: ParsedSelection = {
      id: crypto.randomUUID(),
      index: 0,
      date: `${day}/${month}`,
      time: `${hour}:${min}`,
      kickOffDateTime: kickOff,
      gameId: match.fixtureId.toString(),
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      status: 'not_started',
      score: null,
      pick: sug.pick,
      pickCategory: sug.pick.toLowerCase().includes('over') ? 'over' :
                    sug.pick.toLowerCase().includes('home') ? 'home' :
                    sug.pick.toLowerCase().includes('away') ? 'away' : 'other',
      odds: Math.round(odds * 100) / 100,
      market: sug.market,
      marketType: sug.market === '1X2' ? '1x2' :
                  sug.market.includes('Over') ? 'over_under' :
                  sug.market === 'GG/NG' ? 'gg_ng' : 'other',
      marketVariant: null,
      result: null,
      resultMessage: null,
      isSettled: false,
      isVoid: false,
      isSuspended: false,
      isEligibleForGrouping: true,
    };

    onAddPick(selection);
    setAddedPicks(prev => new Set(prev).add(key));
  }

  function toggleLeague(code: string) {
    const updated = leagues.map((l: any) => l.code === code ? { ...l, checked: !l.checked } : l);
    setLeagues(updated);
    localStorage.setItem('rollover_scout_leagues', JSON.stringify(updated));
  }

  function selectAllLeagues(checked: boolean) {
    const updated = leagues.map((l: any) => ({ ...l, checked }));
    setLeagues(updated);
    localStorage.setItem('rollover_scout_leagues', JSON.stringify(updated));
  }

  async function handleScout() {
    setLoading(true);
    setError(null);
    setMatches([]);

    const selectedLeagues = leagues.filter((l: any) => l.checked).map((l: any) => l.code);
    if (selectedLeagues.length === 0) {
      setError('No leagues selected. Check at least one league.');
      setLoading(false);
      return;
    }

    try {
      let results: ScoutedMatch[] = [];

      // Strategy: Use provider orchestrator to get ALL fixtures, then run scout analysis.
      // Falls back to Football-Data.org-only scout if orchestrator returns nothing.
      const orchestratorResult = await fetchAllProviders({
        days,
        leagueCodes: selectedLeagues,
        useFootballData: providerToggles.footballdata,
        useTheSportsDb: providerToggles.thesportsdb,
        useEspn: providerToggles.espn,
        useApiFootball: providerToggles.apifootball,
        useKickoffApi: providerToggles.kickoffapi,
      });

      if (orchestratorResult.fixtures.length > 0) {
        // Convert unified fixtures into ScoutedMatch format with suggestions
        results = orchestratorResult.fixtures
          .filter(f => f.homeTeam.name && f.awayTeam.name)
          .map(fixture => {
            const suggestions: PickSuggestion[] = [];

            // Generate suggestions from available data
            const homeWin = fixture.homeWinRate || 50;
            const posGap = fixture.positionGap || 0;
            const over25 = fixture.over25Pct || 50;
            const btts = fixture.bttsPct || 50;

            // Home win suggestion
            if (homeWin >= 65 || posGap >= 5) {
              const conf = Math.min(90, Math.round(50 + (homeWin - 50) * 0.5 + posGap * 1.5));
              if (conf >= 60) {
                suggestions.push({
                  market: '1X2', pick: 'Home', confidence: conf,
                  reasoning: [`Home win: ${homeWin}%`, posGap > 0 ? `Gap: +${posGap}` : ''].filter(Boolean),
                  estimatedOdds: conf >= 75 ? '1.20-1.40' : '1.35-1.60',
                });
              }
            }

            // Over 1.5 suggestion
            if (over25 >= 55 || (fixture.homeAvgGoals || 0) + (fixture.awayAvgGoals || 0) >= 2.5) {
              const conf = Math.min(85, Math.round(45 + over25 * 0.4));
              if (conf >= 60) {
                suggestions.push({
                  market: 'Over/Under', pick: 'Over 1.5', confidence: conf,
                  reasoning: [`O2.5: ${over25}%`, `Avg goals: ${((fixture.homeAvgGoals || 1) + (fixture.awayAvgGoals || 1)).toFixed(1)}`],
                  estimatedOdds: conf >= 72 ? '1.15-1.30' : '1.25-1.45',
                });
              }
            }

            // BTTS suggestion
            if (btts >= 55) {
              const conf = Math.min(80, Math.round(40 + btts * 0.45));
              if (conf >= 60) {
                suggestions.push({
                  market: 'GG/NG', pick: 'Both Teams Score', confidence: conf,
                  reasoning: [`BTTS: ${btts}%`],
                  estimatedOdds: '1.50-1.85',
                });
              }
            }

            return {
              fixtureId: parseInt(fixture.id) || Math.random() * 100000,
              homeTeam: { id: fixture.homeTeam.id, name: fixture.homeTeam.name },
              awayTeam: { id: fixture.awayTeam.id, name: fixture.awayTeam.name },
              league: { id: 0, name: fixture.league, country: '' },
              kickOff: fixture.kickOff,
              suggestions: suggestions.sort((a, b) => b.confidence - a.confidence),
              redFlags: [],
              isSkipped: false,
            };
          })
          .filter(m => m.suggestions.length > 0)
          .sort((a, b) => (b.suggestions[0]?.confidence || 0) - (a.suggestions[0]?.confidence || 0));

        if (orchestratorResult.providersFailed.length > 0) {
          setError(`Providers: ${orchestratorResult.providersUsed.join(', ')} ✓ | Failed: ${orchestratorResult.providersFailed.join(', ')}`);
        }
      }

      // Fallback: if orchestrator got nothing but Football-Data.org key is set, use original scout
      if (results.length === 0 && localStorage.getItem('rollover_footballdata_key')) {
        results = await scoutMatches(days, selectedLeagues);
      }

      setMatches(results);
      cacheResults(results);

      // Value detection with Odds-API if available
      if (providerToggles.oddsapi && localStorage.getItem('rollover_odds_api_key') && results.length > 0) {
        try {
          const oddsEvents = await getAllSoccerOdds();
          const newValueMap: Record<string, { isValue: boolean; edge: number; marketOdds: number }> = {};

          for (const match of results) {
            const odds = findMatchOdds(oddsEvents, match.homeTeam.name, match.awayTeam.name);
            if (!odds) continue;

            for (const sug of match.suggestions) {
              const key = `${match.fixtureId}-${sug.pick}`;
              let marketOdds = 0;
              if (sug.pick === 'Home') marketOdds = odds.home;
              else if (sug.pick === 'Away') marketOdds = odds.away;

              if (marketOdds > 0) {
                const value = detectValue(sug.confidence, marketOdds);
                newValueMap[key] = { ...value, marketOdds };
              }
            }
          }

          setValueMap(newValueMap);
        } catch {
          // Odds fetch failed — not critical
        }
      }

      if (results.length === 0) {
        setError('NO_BET_TODAY');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to scout. Check your API key.');
    } finally {
      setLoading(false);
    }
  }

  // Main scout view — works immediately (no key gate, 4 providers need no key)
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold text-blue-400">Match Scout</h3>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs focus:outline-none"
          >
            <option value={1}>Today</option>
            <option value={2}>2 days</option>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
            <option value={14}>2 weeks</option>
          </select>
          <button
            onClick={handleScout}
            disabled={loading}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-xs font-medium"
          >
            {loading ? 'Scouting...' : 'Scout'}
          </button>
        </div>
      </div>

      {/* League Checkboxes */}
      <div className="mb-3 p-2 bg-gray-800 rounded border border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">Leagues to scout:</span>
          <div className="flex gap-2">
            <button onClick={() => selectAllLeagues(true)} className="text-xs text-blue-400 hover:text-blue-300">All</button>
            <button onClick={() => selectAllLeagues(false)} className="text-xs text-gray-500 hover:text-gray-300">None</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {leagues.map((league: any) => (
            <label
              key={league.code}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer ${
                league.checked ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={league.checked}
                onChange={() => toggleLeague(league.code)}
                className="hidden"
              />
              {league.name}
            </label>
          ))}
        </div>
      </div>

      {/* Active providers indicator — ALL 9 providers, clickable toggles */}
      <div className="flex flex-wrap gap-1 mb-3">
        <span className="text-xs text-gray-500 self-center mr-1">Providers:</span>
        {/* Always active (no key needed) */}
        <button onClick={() => toggleProvider('thesportsdb')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.thesportsdb ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          TheSportsDB {providerToggles.thesportsdb ? '✓' : '○'}
        </button>
        <button onClick={() => toggleProvider('espn')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.espn ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          ESPN {providerToggles.espn ? '✓' : '○'}
        </button>
        <button onClick={() => toggleProvider('openligadb')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.openligadb ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          OpenLigaDB {providerToggles.openligadb ? '✓' : '○'}
        </button>
        <button onClick={() => toggleProvider('sportscore')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${providerToggles.sportscore ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'}`}>
          SportScore {providerToggles.sportscore ? '✓' : '○'}
        </button>
        {/* Key-based providers */}
        <button onClick={() => toggleProvider('footballdata')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_footballdata_key') ? 'bg-gray-800 text-gray-600' :
          providerToggles.footballdata ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          Football-Data {localStorage.getItem('rollover_footballdata_key') ? (providerToggles.footballdata ? '✓' : '○') : '—'}
        </button>
        <button onClick={() => toggleProvider('apifootball')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_api_football_key') ? 'bg-gray-800 text-gray-600' :
          providerToggles.apifootball ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          API-Football {localStorage.getItem('rollover_api_football_key') ? (providerToggles.apifootball ? '✓' : '○') : '—'}
        </button>
        <button onClick={() => toggleProvider('kickoffapi')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_kickoff_api_key') ? 'bg-gray-800 text-gray-600' :
          providerToggles.kickoffapi ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          KickoffAPI {localStorage.getItem('rollover_kickoff_api_key') ? (providerToggles.kickoffapi ? '✓' : '○') : '—'}
        </button>
        <button onClick={() => toggleProvider('sportmonks')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_sportmonks_token') ? 'bg-gray-800 text-gray-600' :
          providerToggles.sportmonks ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          Sportmonks {localStorage.getItem('rollover_sportmonks_token') ? (providerToggles.sportmonks ? '✓' : '○') : '—'}
        </button>
        <button onClick={() => toggleProvider('oddsapi')} className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
          !localStorage.getItem('rollover_odds_api_key') ? 'bg-gray-800 text-gray-600' :
          providerToggles.oddsapi ? 'bg-purple-900 text-purple-300' : 'bg-gray-800 text-gray-600 line-through'
        }`}>
          Odds-API {localStorage.getItem('rollover_odds_api_key') ? (providerToggles.oddsapi ? '✓' : '○') : '—'}
        </button>
      </div>

      {loading && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-400 animate-pulse">Analyzing fixtures...</p>
          <p className="text-xs text-gray-500 mt-1">Scanning {leagues.filter((l: any) => l.checked).length} leagues, {days} day(s)</p>
        </div>
      )}

      {error && error === 'NO_BET_TODAY' && (
        <div className="p-6 bg-gray-800 border-2 border-yellow-700 rounded-lg text-center mb-3">
          <div className="text-2xl mb-2">🛑</div>
          <p className="text-lg font-bold text-yellow-400 mb-1">NO BET TODAY</p>
          <p className="text-xs text-gray-400 mb-2">
            No matches passed the confidence threshold. The data says sit this one out.
          </p>
          <p className="text-xs text-yellow-600 italic">
            "The best rollover move some days is no move at all."
          </p>
        </div>
      )}

      {error && error !== 'NO_BET_TODAY' && (
        <div className="p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-300 mb-3">
          {error}
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{matches.length} matches with confident picks</p>
            {(() => {
              try {
                const cached = localStorage.getItem('rollover_scout_cache');
                if (cached) {
                  const { timestamp } = JSON.parse(cached);
                  const age = Math.round((Date.now() - timestamp) / 60000);
                  return <span className="text-xs text-gray-600">{age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`}</span>;
                }
              } catch {}
              return null;
            })()}
          </div>
          {matches.map((match) => (
            <div key={match.fixtureId} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <div
                onClick={() => setExpandedMatch(expandedMatch === match.fixtureId ? null : match.fixtureId)}
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
              >
                <div className="flex-1">
                  <div className="text-sm text-gray-200">
                    {match.homeTeam.name} <span className="text-gray-500">v</span> {match.awayTeam.name}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{match.league.name}</span>
                    <span className="text-xs text-gray-600">
                      {new Date(match.kickOff).toLocaleDateString()} {new Date(match.kickOff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {match.suggestions[0] && (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      match.suggestions[0].confidence >= 75 ? 'bg-green-900 text-green-300' :
                      match.suggestions[0].confidence >= 65 ? 'bg-yellow-900 text-yellow-300' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {match.suggestions[0].pick} ({match.suggestions[0].confidence}%)
                    </span>
                  )}
                  <span className="text-gray-500 text-xs">{expandedMatch === match.fixtureId ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedMatch === match.fixtureId && (
                <div className="border-t border-gray-700 p-3">
                  {match.redFlags.length > 0 && (
                    <div className="mb-2">
                      {match.redFlags.map((flag, i) => (
                        <p key={i} className="text-xs text-yellow-400">⚠ {flag}</p>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    {match.suggestions.map((sug, i) => (
                      <div key={i} className="flex items-start justify-between p-2 bg-gray-900 rounded">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${
                              sug.confidence >= 75 ? 'text-green-400' : sug.confidence >= 65 ? 'text-yellow-400' : 'text-gray-400'
                            }`}>
                              {sug.pick}
                            </span>
                            <span className="text-xs text-gray-500">{sug.market}</span>
                            <span className="text-xs text-gray-600">~{sug.estimatedOdds}</span>
                            {(() => {
                              const vKey = `${match.fixtureId}-${sug.pick}`;
                              const val = valueMap[vKey];
                              if (val?.isValue) {
                                return (
                                  <span className="text-xs bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                                    VALUE +{val.edge}%
                                  </span>
                                );
                              }
                              if (val && !val.isValue) {
                                return (
                                  <span className="text-xs text-gray-600">@{val.marketOdds.toFixed(2)}</span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <div className="mt-1">
                            {sug.reasoning.map((r, j) => (
                              <p key={j} className="text-xs text-gray-500">{r}</p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            sug.confidence >= 75 ? 'bg-green-900 text-green-300' :
                            sug.confidence >= 65 ? 'bg-yellow-900 text-yellow-300' :
                            'bg-gray-700 text-gray-400'
                          }`}>
                            {sug.confidence}%
                          </span>
                          {onAddPick && (
                            <button
                              onClick={() => handleAddPick(match, sug)}
                              disabled={addedPicks.has(`${match.fixtureId}-${sug.pick}`)}
                              className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-white"
                            >
                              {addedPicks.has(`${match.fixtureId}-${sug.pick}`) ? 'Added ✓' : '+ Slip'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && matches.length === 0 && !error && (
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">Click "Scout" to find safe picks from all providers.</p>
          <p className="text-xs text-gray-600 mt-1">Works instantly — add API keys in Settings for more data sources.</p>
        </div>
      )}
    </div>
  );
}
