/**
 * FoulsStrategy — Team Fouls Over/Under analysis.
 *
 * FIXTURES come from SportyBet (the book we play) — specifically the fixtures
 * that OFFER a fouls market, so every suggestion is actually bettable. FOUL
 * HISTORY / stats come from Flashscore (and any future crawl/API source) as an
 * enrichment feeder — used only to compute team foul averages + hit rates.
 *
 * Shows: team foul averages, under/over hit rates, best picks, risk flags.
 */

import React, { useState } from 'react';
import { fetchDayFixtures, FlashscoreFixture } from '../engine/flashscore';
import { fetchMatchEnrichment, getCachedEnrichment } from '../engine/match-enrichment';
import { confirmFoulsFixtures, FoulsFixture, TimeWindow, TIME_WINDOWS } from '../engine/sportybet';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeamFoulsProfile {
  team: string;
  avgFouls: number;
  matches: number;
  under12_5: number;
  under13_5: number;
  under14_5: number;
  over14_5: number;
  lastFouls: number[]; // Last 5 foul counts
  trend: 'up' | 'down' | 'stable';
}

interface FoulsPickSuggestion {
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  league: string;
  target: 'home' | 'away';
  line: number; // e.g. 13.5
  direction: 'under' | 'over';
  confidence: number; // 0-100
  avgFouls: number;
  hitRate: number; // % of matches that would hit
  risk: 'low' | 'medium' | 'high';
  reasoning: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FoulsStrategy() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [fixtures, setFixtures] = useState<FlashscoreFixture[]>([]);
  const [foulsFixtures, setFoulsFixtures] = useState<FoulsFixture[]>([]);
  const [suggestions, setSuggestions] = useState<FoulsPickSuggestion[]>([]);
  const [teamProfiles, setTeamProfiles] = useState<Map<string, TeamFoulsProfile>>(new Map());
  const [win, setWin] = useState<TimeWindow>('');
  const [cap, setCap] = useState(40);
  const [targetLine, setTargetLine] = useState(13.5);

  async function scanForPicks() {
    setLoading(true);
    setSuggestions([]);
    setTeamProfiles(new Map());
    setFoulsFixtures([]);
    setStatus('Confirming which SportyBet fixtures actually offer fouls…');

    try {
      // Step 1: DEDICATED FOULS SEARCH — per-event confirm which SportyBet
      // fixtures actually carry a fouls market, and grab their LIVE lines/odds.
      // This is the fouls watchlist: only games we can genuinely play fouls on.
      const confirmed = await confirmFoulsFixtures({
        region: 'ng', window: win, maxPages: 10, cap,
        onProgress: (m) => setStatus(m),
      });
      setFoulsFixtures(confirmed);

      // Map to the FlashscoreFixture shape the downstream history analysis expects.
      const allFixtures: FlashscoreFixture[] = confirmed.map(f => ({
        matchId: f.eventId,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        time: f.time,
        country: '',
        league: f.league, // already "Country: League"
        score: null,
        isFinished: false,
        date: f.date,
      }));
      setFixtures(allFixtures);
      setStatus(`${confirmed.length} fixture(s) offer fouls. Fetching foul history from Flashscore…`);

      // Step 2: For each team, fetch their recent match stats to get foul averages
      // We look at the last 5-7 finished matches per team
      const profiles = new Map<string, TeamFoulsProfile>();
      const teamsToAnalyze = new Set<string>();
      for (const f of allFixtures) {
        teamsToAnalyze.add(f.homeTeam);
        teamsToAnalyze.add(f.awayTeam);
      }

      // Fetch recent results for foul data (last 3 days of finished matches)
      const finishedMatches: FlashscoreFixture[] = [];
      for (let d = -1; d >= -7; d--) {
        setStatus(`Scanning day ${Math.abs(d)} of 7 for foul history...`);
        const dayFixtures = await fetchDayFixtures(d);
        const finished = dayFixtures.filter(f => f.isFinished && f.matchId);
        finishedMatches.push(...finished);
      }

      // Step 3: For finished matches involving our teams, fetch stats to get fouls
      const relevantMatches = finishedMatches.filter(f =>
        teamsToAnalyze.has(f.homeTeam) || teamsToAnalyze.has(f.awayTeam)
      );

      setStatus(`Fetching fouls for ${Math.min(relevantMatches.length, 30)} relevant matches...`);
      let fetched = 0;
      for (const match of relevantMatches.slice(0, 30)) {
        if (!match.matchId) continue;

        let enrichment = getCachedEnrichment(match.matchId);
        if (!enrichment) {
          enrichment = await fetchMatchEnrichment(match.matchId);
          await new Promise(r => setTimeout(r, 400)); // Rate limit
        }

        if (enrichment?.stats.fouls) {
          const [homeFouls, awayFouls] = enrichment.stats.fouls;

          // Update home team profile
          updateProfile(profiles, match.homeTeam, homeFouls);
          // Update away team profile
          updateProfile(profiles, match.awayTeam, awayFouls);
        }
        fetched++;
        if (fetched % 5 === 0) setStatus(`Processed ${fetched}/${Math.min(relevantMatches.length, 30)} matches...`);
      }

      setTeamProfiles(profiles);

      // Step 4: Generate suggestions
      setStatus('Generating pick suggestions...');
      const picks: FoulsPickSuggestion[] = [];

      for (const fixture of allFixtures) {
        const homeProfile = profiles.get(fixture.homeTeam);
        const awayProfile = profiles.get(fixture.awayTeam);

        // Analyze home team fouls
        if (homeProfile && homeProfile.matches >= 3) {
          const hitRate = getHitRate(homeProfile, targetLine, 'under');
          if (hitRate >= 60) {
            picks.push({
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              kickoff: `${fixture.date} ${fixture.time}`,
              league: `${fixture.league}`,
              target: 'home',
              line: targetLine,
              direction: 'under',
              confidence: Math.min(95, hitRate),
              avgFouls: homeProfile.avgFouls,
              hitRate,
              risk: homeProfile.avgFouls > targetLine - 1 ? 'high' : homeProfile.avgFouls > targetLine - 2 ? 'medium' : 'low',
              reasoning: `${fixture.homeTeam} avg ${homeProfile.avgFouls.toFixed(1)} fouls. Under ${targetLine} hit in ${hitRate}% of last ${homeProfile.matches} games.`,
            });
          }
        }

        // Analyze away team fouls
        if (awayProfile && awayProfile.matches >= 3) {
          const hitRate = getHitRate(awayProfile, targetLine, 'under');
          if (hitRate >= 60) {
            picks.push({
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              kickoff: `${fixture.date} ${fixture.time}`,
              league: `${fixture.league}`,
              target: 'away',
              line: targetLine,
              direction: 'under',
              confidence: Math.min(95, hitRate),
              avgFouls: awayProfile.avgFouls,
              hitRate,
              risk: awayProfile.avgFouls > targetLine - 1 ? 'high' : awayProfile.avgFouls > targetLine - 2 ? 'medium' : 'low',
              reasoning: `${fixture.awayTeam} avg ${awayProfile.avgFouls.toFixed(1)} fouls. Under ${targetLine} hit in ${hitRate}% of last ${awayProfile.matches} games.`,
            });
          }
        }
      }

      // Sort by confidence descending
      picks.sort((a, b) => b.confidence - a.confidence);
      setSuggestions(picks);
      setStatus(`Done. ${picks.length} picks found.`);
    } catch (e: any) {
      setStatus(`Error: ${e.message || 'Failed to scan'}`);
    }
    setLoading(false);
  }

  function updateProfile(profiles: Map<string, TeamFoulsProfile>, team: string, fouls: number) {
    const existing = profiles.get(team) || {
      team,
      avgFouls: 0,
      matches: 0,
      under12_5: 0,
      under13_5: 0,
      under14_5: 0,
      over14_5: 0,
      lastFouls: [],
      trend: 'stable' as const,
    };

    existing.lastFouls.push(fouls);
    existing.matches++;
    existing.avgFouls = existing.lastFouls.reduce((s, f) => s + f, 0) / existing.lastFouls.length;
    if (fouls < 12.5) existing.under12_5++;
    if (fouls < 13.5) existing.under13_5++;
    if (fouls < 14.5) existing.under14_5++;
    if (fouls > 14.5) existing.over14_5++;

    // Trend: compare last 2 vs first 2
    if (existing.lastFouls.length >= 4) {
      const recent = (existing.lastFouls[existing.lastFouls.length - 1] + existing.lastFouls[existing.lastFouls.length - 2]) / 2;
      const older = (existing.lastFouls[0] + existing.lastFouls[1]) / 2;
      existing.trend = recent > older + 1 ? 'up' : recent < older - 1 ? 'down' : 'stable';
    }

    profiles.set(team, existing);
  }

  function getHitRate(profile: TeamFoulsProfile, line: number, direction: 'under' | 'over'): number {
    if (profile.matches === 0) return 0;
    const hits = profile.lastFouls.filter(f => direction === 'under' ? f < line : f > line).length;
    return Math.round((hits / profile.lastFouls.length) * 100);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <h2 className="text-lg font-bold mb-4 text-blue-400">Fouls Strategy</h2>
      <p className="text-xs text-gray-500 mb-4">
        Dedicated fouls watchlist. Confirms which SportyBet fixtures actually offer a fouls
        market (per-event check) and shows their live lines/odds, then layers Flashscore foul
        history on top to grade Under/Over picks.
      </p>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Window:</span>
          <select
            value={win}
            onChange={(e) => setWin(e.target.value as TimeWindow)}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
          >
            {TIME_WINDOWS.map(tw => <option key={tw.key || 'all'} value={tw.key}>{tw.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Check up to:</span>
          <select
            value={cap}
            onChange={(e) => setCap(parseInt(e.target.value))}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
            title="How many nearest-kickoff fixtures to per-event confirm for fouls"
          >
            <option value="20">20 fixtures</option>
            <option value="40">40 fixtures</option>
            <option value="80">80 fixtures</option>
            <option value="150">150 fixtures</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Target line:</span>
          <select
            value={targetLine}
            onChange={(e) => setTargetLine(parseFloat(e.target.value))}
            className="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300"
          >
            {[9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5].map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <button
          onClick={scanForPicks}
          disabled={loading}
          className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 rounded text-xs font-medium text-white"
        >
          {loading ? 'Scanning...' : 'Scan for Fouls Picks'}
        </button>
        {status && <span className="text-[10px] text-gray-500">{status}</span>}
      </div>

      {/* Confirmed fouls fixtures — the live SportyBet watchlist */}
      {foulsFixtures.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-amber-400 mb-2">
            SportyBet Fouls Markets ({foulsFixtures.length})
          </h3>
          <div className="space-y-2">
            {foulsFixtures.map((fx) => (
              <div key={fx.eventId} className="p-3 rounded-lg border border-gray-700 bg-gray-800/60">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="text-sm text-gray-200 font-medium">{fx.homeTeam} v {fx.awayTeam}</span>
                    <span className="ml-2 text-[10px] text-gray-500">{fx.date} {fx.time}</span>
                    <span className="ml-2 text-[10px] text-gray-600">{fx.league}</span>
                  </div>
                  {!fx.anyOpen && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400" title="No open fouls line yet — pre-stage; unlocks nearer kickoff">🔒 pre-stage</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fx.fouls.map((row, ri) => (
                    <span
                      key={ri}
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        row.locked
                          ? 'border-gray-700 bg-gray-800 text-gray-500'
                          : 'border-amber-800 bg-amber-900/30 text-amber-300'
                      }`}
                      title={row.marketLabel}
                    >
                      {row.marketLabel.replace(' Fouls O/U', '').replace('Match Fouls O/U', 'Match')}: {row.line}
                      {row.locked ? ' 🔒' : ` @ ${row.odds}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-green-400 mb-2">Suggested Picks ({suggestions.length})</h3>
          <div className="space-y-2">
            {suggestions.map((pick, i) => (
              <div key={i} className={`p-3 rounded-lg border ${
                pick.risk === 'low' ? 'bg-green-900/10 border-green-800' :
                pick.risk === 'medium' ? 'bg-yellow-900/10 border-yellow-800' :
                'bg-red-900/10 border-red-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-200 font-medium">
                      {pick.homeTeam} v {pick.awayTeam}
                    </span>
                    <span className="ml-2 text-[10px] text-gray-500">{pick.kickoff}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                      pick.confidence >= 80 ? 'bg-green-800 text-green-300' :
                      pick.confidence >= 70 ? 'bg-yellow-800 text-yellow-300' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {pick.confidence}%
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      pick.risk === 'low' ? 'bg-green-900 text-green-400' :
                      pick.risk === 'medium' ? 'bg-yellow-900 text-yellow-400' :
                      'bg-red-900 text-red-400'
                    }`}>
                      {pick.risk} risk
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="text-xs text-blue-400 font-medium">
                    {pick.target === 'home' ? pick.homeTeam : pick.awayTeam} Under {pick.line} Fouls
                  </span>
                  <span className="text-[10px] text-gray-500">{pick.league}</span>
                </div>
                <div className="mt-1 text-[10px] text-gray-400">
                  {pick.reasoning}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Profiles */}
      {teamProfiles.size > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">Team Foul Profiles ({teamProfiles.size} teams)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-500">
                  <th className="py-2 px-2 text-left">Team</th>
                  <th className="py-2 px-2 text-center">Avg</th>
                  <th className="py-2 px-2 text-center">Games</th>
                  <th className="py-2 px-2 text-center">U12.5</th>
                  <th className="py-2 px-2 text-center">U13.5</th>
                  <th className="py-2 px-2 text-center">U14.5</th>
                  <th className="py-2 px-2 text-center">O14.5</th>
                  <th className="py-2 px-2 text-center">Last 5</th>
                  <th className="py-2 px-2 text-center">Trend</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(teamProfiles.values())
                  .sort((a, b) => a.avgFouls - b.avgFouls)
                  .map((profile, i) => (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-800">
                      <td className="py-1.5 px-2 text-gray-200">{profile.team}</td>
                      <td className={`py-1.5 px-2 text-center font-medium ${
                        profile.avgFouls < 12 ? 'text-green-400' :
                        profile.avgFouls < 14 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>{profile.avgFouls.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-center text-gray-500">{profile.matches}</td>
                      <td className="py-1.5 px-2 text-center">{Math.round((profile.under12_5 / profile.matches) * 100)}%</td>
                      <td className="py-1.5 px-2 text-center">{Math.round((profile.under13_5 / profile.matches) * 100)}%</td>
                      <td className="py-1.5 px-2 text-center">{Math.round((profile.under14_5 / profile.matches) * 100)}%</td>
                      <td className="py-1.5 px-2 text-center">{Math.round((profile.over14_5 / profile.matches) * 100)}%</td>
                      <td className="py-1.5 px-2 text-center text-gray-400">
                        {profile.lastFouls.slice(-5).join(', ')}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {profile.trend === 'up' ? '📈' : profile.trend === 'down' ? '📉' : '➡️'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && suggestions.length === 0 && teamProfiles.size === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">Click "Scan for Fouls Picks" to analyze SportyBet fixtures that offer fouls</p>
          <p className="text-xs mt-1">Fixtures from SportyBet · foul history from Flashscore</p>
        </div>
      )}
    </div>
  );
}
