/**
 * Match Crawl Orchestrator — on-demand multi-source history fetch.
 *
 * Fires ONLY when the local DB has no data for a given fixture. Crawls every
 * available source in parallel for both teams' recent results, merges them,
 * saves to the local DB (persistent + in-memory), so the next Analyze is
 * instant and offline. The DB self-builds as you use the app.
 *
 * Sources (best-effort, run in parallel — one failing/empty doesn't block others):
 *   - Flashscore (HTML)      — global fixtures/results via day pages
 *   - 11v11 (HTML)           — deep English/international history
 *   - SoccerPunter (HTML)    — global team results
 *   - SkySports (HTML)       — recent results/form
 *   - TheSportsDB (JSON)     — global recent results, no key
 */

import type { HistoricalMatch } from './football-data-uk';
import { loadMatches, getAllMatches } from './historical-stats';
import { isSameTeam } from './team-aliases';
import { fetch11v11TeamResults } from './eleven-v-eleven';
import { fetchSoccerPunterResults } from './soccerpunter';
import { getTeamRecentResults } from './thesportsdb';

/** Does the local DB already have enough data to analyse this fixture? */
export function hasLocalData(homeTeam: string, awayTeam: string): boolean {
  const all = getAllMatches();
  if (all.length === 0) return false;
  const homeMatches = all.filter(m => isSameTeam(m.homeTeam, homeTeam) || isSameTeam(m.awayTeam, homeTeam)).length;
  const awayMatches = all.filter(m => isSameTeam(m.homeTeam, awayTeam) || isSameTeam(m.awayTeam, awayTeam)).length;
  // Need at least a few results for BOTH teams to compute meaningful form/H2H
  return homeMatches >= 3 && awayMatches >= 3;
}

/** Convert TheSportsDB recent-results shape into HistoricalMatch[]. */
function sportsDbToHistorical(
  results: { date: string; home: string; away: string; homeScore: number; awayScore: number; league: string }[]
): HistoricalMatch[] {
  return results
    .filter(r => r.home && r.away && !isNaN(r.homeScore) && !isNaN(r.awayScore))
    .map(r => {
      // TheSportsDB date is usually YYYY-MM-DD
      let date = r.date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        const [y, mo, d] = r.date.split('-');
        date = `${d}/${mo}/${y}`;
      }
      const season = seasonFromDate(date);
      return {
        division: 'thesportsdb',
        date,
        time: '',
        homeTeam: r.home,
        awayTeam: r.away,
        ftHomeGoals: r.homeScore,
        ftAwayGoals: r.awayScore,
        ftResult: r.homeScore > r.awayScore ? 'H' : r.homeScore < r.awayScore ? 'A' : 'D',
        htHomeGoals: null, htAwayGoals: null, htResult: null,
        homeShots: null, awayShots: null,
        homeShotsOnTarget: null, awayShotsOnTarget: null,
        homeCorners: null, awayCorners: null,
        homeYellows: null, awayYellows: null,
        homeReds: null, awayReds: null,
        homeFouls: null, awayFouls: null,
        season,
        leagueId: r.league || 'thesportsdb',
      } as HistoricalMatch;
    });
}

/** Convert SkySports results (fixtures with kickoff) — only finished ones have no scores here, skip. */
// SkySports fixtures don't carry scores in the list; used only for fixture presence, not results.

function seasonFromDate(date: string): string {
  const parts = date.split('/');
  if (parts.length !== 3) return '';
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(year)) return '';
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${(startYear + 1).toString().slice(2)}`;
}

/** Deduplicate matches by home|away|date, dropping malformed same-team rows. */
function dedupe(matches: HistoricalMatch[]): HistoricalMatch[] {
  const seen = new Set<string>();
  const out: HistoricalMatch[] = [];
  for (const m of matches) {
    // Guard: reject malformed rows where both teams are the same (parse errors)
    if (!m.homeTeam || !m.awayTeam) continue;
    if (m.homeTeam.trim().toLowerCase() === m.awayTeam.trim().toLowerCase()) continue;
    const key = `${m.homeTeam.toLowerCase()}|${m.awayTeam.toLowerCase()}|${m.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export interface CrawlResult {
  added: number;
  sources: string[];
  total: number;
}

/**
 * Crawl all sources for a fixture's teams, merge, save to DB.
 * Only call when hasLocalData() is false. Returns how many matches were added
 * and which sources contributed.
 */
export async function crawlMatchHistory(
  homeTeam: string,
  awayTeam: string,
  onProgress?: (msg: string) => void
): Promise<CrawlResult> {
  onProgress?.('Searching all sources...');

  const tasks: Promise<{ source: string; matches: HistoricalMatch[] }>[] = [];

  // TheSportsDB — recent results for each team (JSON, global, no key)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        getTeamRecentResults(homeTeam),
        getTeamRecentResults(awayTeam),
      ]);
      const matches = dedupe([...sportsDbToHistorical(h.results), ...sportsDbToHistorical(a.results)]);
      return { source: 'TheSportsDB', matches };
    } catch { return { source: 'TheSportsDB', matches: [] }; }
  })());

  // 11v11 — deep history (HTML)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        fetch11v11TeamResults(homeTeam),
        fetch11v11TeamResults(awayTeam),
      ]);
      return { source: '11v11', matches: dedupe([...h, ...a]) };
    } catch { return { source: '11v11', matches: [] }; }
  })());

  // SoccerPunter — global team results (HTML, best-effort)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        fetchSoccerPunterResults(homeTeam),
        fetchSoccerPunterResults(awayTeam),
      ]);
      return { source: 'SoccerPunter', matches: dedupe([...h, ...a]) };
    } catch { return { source: 'SoccerPunter', matches: [] }; }
  })());

  const settled = await Promise.allSettled(tasks);

  const contributingSources: string[] = [];
  let allMatches: HistoricalMatch[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value.matches.length > 0) {
      contributingSources.push(`${r.value.source} (${r.value.matches.length})`);
      allMatches.push(...r.value.matches);
    }
  }

  const merged = dedupe(allMatches);
  if (merged.length === 0) {
    onProgress?.('No historical data found from any source.');
    return { added: 0, sources: [], total: getAllMatches().length };
  }

  // Save to persistent DB (async, best-effort) and in-memory engine (instant).
  onProgress?.(`Merging ${merged.length} results from ${contributingSources.length} sources...`);
  const added = loadMatches(merged); // in-memory, immediate for Analyze

  // Persist to SQLite so it survives restarts (dynamic import to avoid cycle)
  try {
    const { saveMatches } = await import('../lib/match-database');
    await saveMatches(merged, 'analyze-crawl');
  } catch (e) {
    console.warn('[MatchCrawl] persist failed (kept in memory):', e);
  }

  onProgress?.(`Added ${added} results from ${contributingSources.join(', ')}`);
  return { added, sources: contributingSources, total: getAllMatches().length };
}
