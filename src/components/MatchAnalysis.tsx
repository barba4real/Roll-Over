/**
 * MatchAnalysis — Full analysis panel for a fixture (Futball24/SofaScore style).
 *
 * Tabs: H2H, Home Form, Away Form, Standings
 * Opened from Match Scout when clicking "Analyze" on any match.
 */

import React, { useState, useEffect } from 'react';
import FormTable, { FormMatch } from './FormTable';
import { getMatchAnalysis, MatchAnalysisData, StandingsRow } from '../engine/match-analysis';
import { buildConsensus, ConsensusResult } from '../engine/consensus-engine';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  homeTeam: string;
  awayTeam: string;
  league: string;
  leagueId?: string;
  onClose: () => void;
}

type Tab = 'h2h' | 'compare' | 'home' | 'away' | 'standings' | 'consensus';

// ─── Component ───────────────────────────────────────────────────────────────

export default function MatchAnalysis({ homeTeam, awayTeam, league, leagueId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('h2h');
  const [data, setData] = useState<MatchAnalysisData | null>(null);
  const [consensus, setConsensus] = useState<ConsensusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Fetch analysis and consensus in parallel
    Promise.all([
      getMatchAnalysis(homeTeam, awayTeam, league, leagueId),
      buildConsensus(homeTeam, awayTeam, league, leagueId),
    ]).then(([analysisResult, consensusResult]) => {
      if (!cancelled) {
        setData(analysisResult);
        setConsensus(consensusResult);
        setLoading(false);
      }
    }).catch(e => {
      if (!cancelled) {
        setError(e.message || 'Failed to load analysis');
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [homeTeam, awayTeam, league, leagueId]);

  // ─── Tab Navigation ──────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string }[] = [
    { id: 'h2h', label: 'H2H' },
    { id: 'compare', label: 'Compare' },
    { id: 'home', label: homeTeam.split(' ').slice(-1)[0] || 'Home' },
    { id: 'away', label: awayTeam.split(' ').slice(-1)[0] || 'Away' },
    { id: 'standings', label: 'Table' },
    { id: 'consensus', label: 'Consensus' },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-200">
                {homeTeam} <span className="text-gray-500">vs</span> {awayTeam}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">{league}</p>
            </div>
            <button
              onClick={onClose}
              className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-lg"
            >
              &#10005;
            </button>
          </div>

          {/* Prediction Summary */}
          {data?.prediction && data.prediction.picks.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              {data.prediction.picks.slice(0, 3).map((pick, i) => (
                <span
                  key={i}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    pick.confidence >= 70 ? 'bg-green-900 text-green-300' :
                    pick.confidence >= 55 ? 'bg-yellow-900 text-yellow-300' :
                    'bg-gray-700 text-gray-400'
                  }`}
                >
                  {pick.pick} {pick.confidence}%
                </span>
              ))}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                data.prediction.dataQuality === 'high' ? 'bg-green-900/50 text-green-400' :
                data.prediction.dataQuality === 'medium' ? 'bg-blue-900/50 text-blue-400' :
                'bg-gray-700 text-gray-500'
              }`}>
                {data.prediction.dataQuality} data
              </span>
              {data.dataSources.length > 0 && (
                <span className="text-[9px] text-gray-600 ml-1">
                  ({data.dataSources.length} sources)
                </span>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-t text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-900 text-blue-400 border border-gray-700 border-b-0'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-gray-400 animate-pulse">Loading analysis...</p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-300">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* H2H Tab */}
              {activeTab === 'h2h' && <H2HTab data={data} />}

              {/* Side-by-Side Comparison */}
              {activeTab === 'compare' && data && <SideBySideComparison data={data} />}

              {/* Home Form Tab */}
              {activeTab === 'home' && (
                <FormTable
                  team={homeTeam}
                  title={`${homeTeam} - Home Form`}
                  matches={data.homeForm.matches.map(m => ({
                    date: m.date,
                    opponent: m.opponent,
                    goalsFor: m.goalsFor,
                    goalsAgainst: m.goalsAgainst,
                    result: m.result,
                    league: m.league,
                    isHome: true,
                  }))}
                />
              )}

              {/* Away Form Tab */}
              {activeTab === 'away' && (
                <FormTable
                  team={awayTeam}
                  title={`${awayTeam} - Away Form`}
                  matches={data.awayForm.matches.map(m => ({
                    date: m.date,
                    opponent: m.opponent,
                    goalsFor: m.goalsFor,
                    goalsAgainst: m.goalsAgainst,
                    result: m.result,
                    league: m.league,
                    isHome: false,
                  }))}
                />
              )}

              {/* Standings Tab */}
              {activeTab === 'standings' && <StandingsTab data={data} />}

              {/* Consensus Tab */}
              {activeTab === 'consensus' && <CompareTab consensus={consensus} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Side-by-Side Comparison ─────────────────────────────────────────────────

function SideBySideComparison({ data }: { data: MatchAnalysisData }) {
  const home = data.homeForm.stats;
  const away = data.awayForm.stats;

  const metrics = [
    { label: 'Win Rate', homeVal: home.winRate, awayVal: away.winRate, suffix: '%', higherBetter: true },
    { label: 'Avg Goals', homeVal: home.avgGoalsScored, awayVal: away.avgGoalsScored, suffix: '', higherBetter: true },
    { label: 'Avg Conceded', homeVal: home.avgGoalsConceded, awayVal: away.avgGoalsConceded, suffix: '', higherBetter: false },
    { label: 'Clean Sheets', homeVal: home.cleanSheetRate, awayVal: away.cleanSheetRate, suffix: '%', higherBetter: true },
    { label: 'Scoring Rate', homeVal: home.scoringRate, awayVal: away.scoringRate, suffix: '%', higherBetter: true },
    { label: 'BTTS Rate', homeVal: home.bttsRate, awayVal: away.bttsRate, suffix: '%', higherBetter: false },
    { label: 'Over 1.5', homeVal: home.over15Rate, awayVal: away.over15Rate, suffix: '%', higherBetter: true },
    { label: 'Over 2.5', homeVal: home.over25Rate, awayVal: away.over25Rate, suffix: '%', higherBetter: true },
  ];

  return (
    <div>
      {/* Team Names + Form Strips */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-center flex-1">
          <div className="text-xs font-bold text-gray-200">{data.homeTeam} (H)</div>
          <div className="flex justify-center gap-0.5 mt-1">
            {home.formString.slice(0, 8).split('').map((r, i) => (
              <span key={i} className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold ${
                r === 'W' ? 'bg-green-700 text-green-200' : r === 'D' ? 'bg-yellow-700 text-yellow-200' : 'bg-red-700 text-red-200'
              }`}>{r}</span>
            ))}
          </div>
          <div className="text-[10px] text-gray-500 mt-1">{home.matches} matches</div>
        </div>
        <div className="text-xs text-gray-600 px-3">vs</div>
        <div className="text-center flex-1">
          <div className="text-xs font-bold text-gray-200">{data.awayTeam} (A)</div>
          <div className="flex justify-center gap-0.5 mt-1">
            {away.formString.slice(0, 8).split('').map((r, i) => (
              <span key={i} className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold ${
                r === 'W' ? 'bg-green-700 text-green-200' : r === 'D' ? 'bg-yellow-700 text-yellow-200' : 'bg-red-700 text-red-200'
              }`}>{r}</span>
            ))}
          </div>
          <div className="text-[10px] text-gray-500 mt-1">{away.matches} matches</div>
        </div>
      </div>

      {/* Comparison Bars */}
      <div className="space-y-1.5">
        {metrics.map((m, i) => {
          const homeWins = m.higherBetter ? m.homeVal > m.awayVal : m.homeVal < m.awayVal;
          const awayWins = m.higherBetter ? m.awayVal > m.homeVal : m.awayVal < m.homeVal;
          const total = m.homeVal + m.awayVal || 1;

          return (
            <div key={i} className="flex items-center gap-2">
              <span className={`w-10 text-right text-[10px] font-mono ${homeWins ? 'text-green-400 font-bold' : 'text-gray-400'}`}>
                {m.homeVal}{m.suffix}
              </span>
              <div className="flex-1 flex items-center gap-0.5 h-3">
                <div className="flex-1 flex justify-end">
                  <div className={`h-full rounded-l ${homeWins ? 'bg-green-600' : 'bg-gray-600'}`}
                    style={{ width: `${(m.homeVal / total) * 100}%`, minWidth: '4px' }} />
                </div>
                <span className="text-[8px] text-gray-500 w-14 text-center">{m.label}</span>
                <div className="flex-1">
                  <div className={`h-full rounded-r ${awayWins ? 'bg-blue-600' : 'bg-gray-600'}`}
                    style={{ width: `${(m.awayVal / total) * 100}%`, minWidth: '4px' }} />
                </div>
              </div>
              <span className={`w-10 text-left text-[10px] font-mono ${awayWins ? 'text-blue-400 font-bold' : 'text-gray-400'}`}>
                {m.awayVal}{m.suffix}
              </span>
            </div>
          );
        })}
      </div>

      {/* W-D-L Summary */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="p-2 bg-gray-800 rounded text-center">
          <div className="text-[10px] text-gray-400">{data.homeTeam}</div>
          <div className="text-sm font-bold text-gray-200">{home.wins}W - {home.draws}D - {home.losses}L</div>
          <div className="text-[10px] text-gray-500">GF: {home.goalsScored} | GA: {home.goalsConceded}</div>
        </div>
        <div className="p-2 bg-gray-800 rounded text-center">
          <div className="text-[10px] text-gray-400">{data.awayTeam}</div>
          <div className="text-sm font-bold text-gray-200">{away.wins}W - {away.draws}D - {away.losses}L</div>
          <div className="text-[10px] text-gray-500">GF: {away.goalsScored} | GA: {away.goalsConceded}</div>
        </div>
      </div>
    </div>
  );
}

// ─── H2H Sub-Component ───────────────────────────────────────────────────────

function H2HTab({ data }: { data: MatchAnalysisData }) {
  const { h2h } = data;
  const { record, meetings } = h2h;
  const [filter, setFilter] = React.useState<'all' | 'league' | 'cups'>('all');

  if (record.totalMatches === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">No head-to-head data found.</p>
        <p className="text-xs text-gray-500 mt-1">Click "Sync Data" to import more historical results.</p>
      </div>
    );
  }

  // Filter meetings by competition type
  const filteredMeetings = meetings.filter(m => {
    if (filter === 'all') return true;
    const league = (m.league || '').toLowerCase();
    const isCup = league.includes('cup') || league.includes('pokal') || league.includes('copa') || league.includes('coupe') || league.includes('fa ') || league.includes('league cup') || league.includes('champions') || league.includes('europa');
    if (filter === 'cups') return isCup;
    return !isCup; // league = not cup
  });

  // Recalculate stats based on filtered meetings
  const totalGames = filteredMeetings.length;
  const homeWins = filteredMeetings.filter(m => m.result === 'H').length;
  const draws = filteredMeetings.filter(m => m.result === 'D').length;
  const awayWins = filteredMeetings.filter(m => m.result === 'A').length;
  const homeWinPct = totalGames > 0 ? Math.round((homeWins / totalGames) * 100) : 0;
  const drawPct = totalGames > 0 ? Math.round((draws / totalGames) * 100) : 0;
  const awayWinPct = totalGames > 0 ? Math.round((awayWins / totalGames) * 100) : 0;
  const totalGoalsH = filteredMeetings.reduce((s, m) => s + m.homeGoals, 0);
  const totalGoalsA = filteredMeetings.reduce((s, m) => s + m.awayGoals, 0);
  const avgGoals = totalGames > 0 ? ((totalGoalsH + totalGoalsA) / totalGames).toFixed(1) : '0';
  const bttsCount = filteredMeetings.filter(m => m.homeGoals > 0 && m.awayGoals > 0).length;
  const bttsRate = totalGames > 0 ? Math.round((bttsCount / totalGames) * 100) : 0;

  return (
    <div>
      {/* Filter Toggle */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-[10px] text-gray-500 mr-1">Filter:</span>
        {(['all', 'league', 'cups'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded font-medium ${
              filter === f ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {f === 'all' ? `All (${meetings.length})` : f === 'league' ? 'League' : 'Cups'}
          </button>
        ))}
      </div>

      {totalGames === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">No {filter} meetings found.</p>
      ) : (
        <>
          {/* Summary Bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300">{data.homeTeam}</span>
              <span className="text-xs text-gray-500">{totalGames} meetings</span>
              <span className="text-xs text-gray-300">{data.awayTeam}</span>
            </div>
            <div className="flex h-4 rounded overflow-hidden">
              {homeWinPct > 0 && (
                <div className="bg-green-700 flex items-center justify-center" style={{ width: `${homeWinPct}%` }}>
                  <span className="text-[9px] text-white font-bold">{homeWins}W</span>
                </div>
              )}
              {drawPct > 0 && (
                <div className="bg-yellow-700 flex items-center justify-center" style={{ width: `${drawPct}%` }}>
                  <span className="text-[9px] text-white font-bold">{draws}D</span>
                </div>
              )}
              {awayWinPct > 0 && (
                <div className="bg-red-700 flex items-center justify-center" style={{ width: `${awayWinPct}%` }}>
                  <span className="text-[9px] text-white font-bold">{awayWins}W</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-2 mb-4 p-2 bg-gray-800 rounded">
            <div className="text-center">
              <div className="text-xs text-gray-400">Total Goals</div>
              <div className="text-sm font-medium text-gray-200">{totalGoalsH}-{totalGoalsA}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Avg Goals</div>
              <div className="text-sm font-medium text-gray-200">{avgGoals}/game</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">BTTS %</div>
              <div className="text-sm font-medium text-gray-200">{bttsRate}%</div>
            </div>
          </div>

          {/* Last Meetings */}
          <h4 className="text-xs font-medium text-gray-400 mb-2">Meetings ({filter})</h4>
          <div className="space-y-0.5">
            {filteredMeetings.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5 bg-gray-800 rounded text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 w-16 text-[10px]">{m.date}</span>
                  {m.league && <span className="text-[8px] text-gray-600 bg-gray-700 px-1 rounded">{m.league.slice(0, 12)}</span>}
                </div>
                <div className="flex items-center gap-2 flex-1 justify-center">
                  <span className={`text-right flex-1 ${m.result === 'H' ? 'text-green-400 font-medium' : 'text-gray-300'}`}>
                    {m.homeTeam}
                  </span>
                  <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                    m.result === 'H' ? 'bg-green-900 text-green-300' :
                    m.result === 'D' ? 'bg-yellow-900 text-yellow-300' :
                    'bg-red-900 text-red-300'
                  }`}>
                    {m.homeGoals}-{m.awayGoals}
                  </span>
                  <span className={`text-left flex-1 ${m.result === 'A' ? 'text-green-400 font-medium' : 'text-gray-300'}`}>
                    {m.awayTeam}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Standings Sub-Component ─────────────────────────────────────────────────

function StandingsTab({ data }: { data: MatchAnalysisData }) {
  const { standings } = data;

  if (!standings || standings.table.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">Standings not available for this league.</p>
        <p className="text-xs text-gray-500 mt-1">ESPN may not have standings data for this competition.</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-gray-400 mb-2">{standings.leagueName}</h4>

      {/* Position gap */}
      {standings.homePosition && standings.awayPosition && (
        <div className="mb-3 p-2 bg-gray-800 rounded flex items-center justify-between">
          <span className="text-xs text-gray-300">{data.homeTeam}: <span className="text-blue-400 font-bold">#{standings.homePosition}</span></span>
          <span className="text-xs text-gray-500">Gap: {Math.abs(standings.homePosition - standings.awayPosition)} positions</span>
          <span className="text-xs text-gray-300">{data.awayTeam}: <span className="text-blue-400 font-bold">#{standings.awayPosition}</span></span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-1 px-1">#</th>
              <th className="text-left py-1 px-1">Team</th>
              <th className="text-center py-1 px-1">P</th>
              <th className="text-center py-1 px-1">W</th>
              <th className="text-center py-1 px-1">D</th>
              <th className="text-center py-1 px-1">L</th>
              <th className="text-center py-1 px-1">GF</th>
              <th className="text-center py-1 px-1">GA</th>
              <th className="text-center py-1 px-1">GD</th>
              <th className="text-center py-1 px-1 font-bold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.table.map((row) => (
              <tr
                key={row.position}
                className={`border-b border-gray-800 ${
                  row.isHome ? 'bg-blue-900/20 text-blue-300' :
                  row.isAway ? 'bg-purple-900/20 text-purple-300' :
                  'text-gray-300'
                }`}
              >
                <td className="py-1 px-1 text-gray-500">{row.position}</td>
                <td className="py-1 px-1 font-medium truncate max-w-[120px]">
                  {row.isHome && <span className="text-blue-400 mr-0.5">&#9679;</span>}
                  {row.isAway && <span className="text-purple-400 mr-0.5">&#9679;</span>}
                  {row.team}
                </td>
                <td className="text-center py-1 px-1">{row.played}</td>
                <td className="text-center py-1 px-1">{row.won}</td>
                <td className="text-center py-1 px-1">{row.drawn}</td>
                <td className="text-center py-1 px-1">{row.lost}</td>
                <td className="text-center py-1 px-1">{row.goalsFor}</td>
                <td className="text-center py-1 px-1">{row.goalsAgainst}</td>
                <td className="text-center py-1 px-1">{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td>
                <td className="text-center py-1 px-1 font-bold">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Compare Sub-Component ───────────────────────────────────────────────────

function CompareTab({ consensus }: { consensus: ConsensusResult | null }) {
  if (!consensus) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">Consensus data not available.</p>
      </div>
    );
  }

  const { signals, agreement, disagreements, picks } = consensus;
  const available = signals.filter(s => s.available);

  return (
    <div>
      {/* Agreement indicator */}
      <div className={`mb-3 p-2 rounded flex items-center justify-between ${
        agreement === 'strong' ? 'bg-green-900/30 border border-green-800' :
        agreement === 'moderate' ? 'bg-blue-900/30 border border-blue-800' :
        agreement === 'weak' ? 'bg-yellow-900/30 border border-yellow-800' :
        'bg-red-900/30 border border-red-800'
      }`}>
        <span className={`text-xs font-medium ${
          agreement === 'strong' ? 'text-green-400' :
          agreement === 'moderate' ? 'text-blue-400' :
          agreement === 'weak' ? 'text-yellow-400' :
          'text-red-400'
        }`}>
          Sources {agreement === 'strong' ? 'strongly agree' :
                  agreement === 'moderate' ? 'mostly agree' :
                  agreement === 'weak' ? 'partially disagree' :
                  'conflict'}
        </span>
        <span className="text-xs text-gray-500">{consensus.sourcesUsed}/{consensus.sourcesTotal} sources active</span>
      </div>

      {/* Disagreements */}
      {disagreements.length > 0 && (
        <div className="mb-3 space-y-1">
          {disagreements.map((d, i) => (
            <p key={i} className="text-xs text-yellow-400">&#9888; {d}</p>
          ))}
        </div>
      )}

      {/* Source comparison table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-1.5 px-2">Source</th>
              <th className="text-center py-1.5 px-1">Home</th>
              <th className="text-center py-1.5 px-1">Draw</th>
              <th className="text-center py-1.5 px-1">Away</th>
              <th className="text-center py-1.5 px-1">O1.5</th>
              <th className="text-center py-1.5 px-1">O2.5</th>
              <th className="text-center py-1.5 px-1">BTTS</th>
              <th className="text-left py-1.5 px-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal, i) => (
              <tr key={i} className={`border-b border-gray-800 ${signal.available ? '' : 'opacity-40'}`}>
                <td className="py-1.5 px-2 font-medium text-gray-300">{signal.source}</td>
                <td className="text-center py-1.5 px-1">{signal.homeWin !== null ? <ConfCell value={signal.homeWin} /> : <span className="text-gray-600">-</span>}</td>
                <td className="text-center py-1.5 px-1">{signal.draw !== null ? <ConfCell value={signal.draw} /> : <span className="text-gray-600">-</span>}</td>
                <td className="text-center py-1.5 px-1">{signal.awayWin !== null ? <ConfCell value={signal.awayWin} /> : <span className="text-gray-600">-</span>}</td>
                <td className="text-center py-1.5 px-1">{signal.over15 !== null ? <ConfCell value={signal.over15} /> : <span className="text-gray-600">-</span>}</td>
                <td className="text-center py-1.5 px-1">{signal.over25 !== null ? <ConfCell value={signal.over25} /> : <span className="text-gray-600">-</span>}</td>
                <td className="text-center py-1.5 px-1">{signal.btts !== null ? <ConfCell value={signal.btts} /> : <span className="text-gray-600">-</span>}</td>
                <td className="py-1.5 px-2 text-gray-500 truncate max-w-[120px]">{signal.reasoning}</td>
              </tr>
            ))}
            {/* Consensus row */}
            <tr className="border-t-2 border-blue-700 bg-blue-900/20 font-bold">
              <td className="py-2 px-2 text-blue-300">CONSENSUS</td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.homeWin} bold /></td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.draw} bold /></td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.awayWin} bold /></td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.over15} bold /></td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.over25} bold /></td>
              <td className="text-center py-2 px-1"><ConfCell value={consensus.btts} bold /></td>
              <td className="py-2 px-2 text-blue-400">{agreement}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Consensus picks */}
      {picks.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-2">Consensus Picks</h4>
          <div className="space-y-1.5">
            {picks.map((pick, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-gray-800 rounded">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${
                    pick.confidence >= 65 ? 'text-green-400' :
                    pick.confidence >= 55 ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>{pick.pick}</span>
                  <span className="text-[10px] text-gray-500">{pick.market}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    pick.agreement === 'strong' ? 'bg-green-900/50 text-green-400' :
                    pick.agreement === 'moderate' ? 'bg-blue-900/50 text-blue-400' :
                    'bg-gray-700 text-gray-500'
                  }`}>{pick.agreement}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-600">{pick.sources.join(', ')}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    pick.confidence >= 65 ? 'bg-green-900 text-green-300' :
                    pick.confidence >= 55 ? 'bg-yellow-900 text-yellow-300' :
                    'bg-gray-700 text-gray-400'
                  }`}>{pick.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {picks.length === 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-gray-500">No consensus picks pass the confidence threshold.</p>
        </div>
      )}
    </div>
  );
}

// ─── Confidence Cell Helper ──────────────────────────────────────────────────

function ConfCell({ value, bold = false }: { value: number; bold?: boolean }) {
  const color = value >= 65 ? 'text-green-400' :
                value >= 50 ? 'text-yellow-400' :
                value >= 35 ? 'text-gray-300' :
                'text-red-400';
  return <span className={`${color} ${bold ? 'font-bold text-[11px]' : ''}`}>{value}%</span>;
}
