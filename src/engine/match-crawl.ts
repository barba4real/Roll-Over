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
import { isSameTeam, isKnownCanonical } from './team-aliases';
import { resolveRows, FixtureContext } from './match-resolver';
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
      // Preserve the real competition name in `division` (falls back to the
      // source tag) so the Analyze modal can surface which league a result
      // came from — useful for deciding the exact league to stake on.
      return {
        division: r.league || 'thesportsdb',
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
  onProgress?: (msg: string) => void,
  league?: string | null
): Promise<CrawlResult> {
  onProgress?.('Searching all sources...');

  // Flashscore is the most reliable league source — it groups fixtures under an
  // explicit "Country: League" header. Look it up in parallel with the crawl so
  // it adds no latency; used as the trusted league signal + to backfill rows
  // that come from sources which don't carry a competition (11v11/SoccerPunter).
  const leaguePromise: Promise<string | null> = (async () => {
    if (league) return league; // caller already knows it (e.g. from the pasted fixture)
    try {
      const { findFlashscoreLeague } = await import('./flashscore');
      return await findFlashscoreLeague(homeTeam, awayTeam);
    } catch { return null; }
  })();

  // Each batch is a team's results from one source, tagged with WHICH fixture
  // side we queried, so the resolver can confirm identity by evidence and learn
  // aliases. { source, trackedName, matches }
  type Batch = { source: string; trackedName: string; matches: HistoricalMatch[] };
  const tasks: Promise<Batch[]>[] = [];

  // TheSportsDB — recent results for each team (JSON, global, no key)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        getTeamRecentResults(homeTeam),
        getTeamRecentResults(awayTeam),
      ]);
      return [
        { source: 'TheSportsDB', trackedName: homeTeam, matches: dedupe(sportsDbToHistorical(h.results)) },
        { source: 'TheSportsDB', trackedName: awayTeam, matches: dedupe(sportsDbToHistorical(a.results)) },
      ];
    } catch { return []; }
  })());

  // 11v11 — deep history (HTML)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        fetch11v11TeamResults(homeTeam),
        fetch11v11TeamResults(awayTeam),
      ]);
      return [
        { source: '11v11', trackedName: homeTeam, matches: dedupe(h) },
        { source: '11v11', trackedName: awayTeam, matches: dedupe(a) },
      ];
    } catch { return []; }
  })());

  // SoccerPunter — global team results (HTML, best-effort)
  tasks.push((async () => {
    try {
      const [h, a] = await Promise.all([
        fetchSoccerPunterResults(homeTeam),
        fetchSoccerPunterResults(awayTeam),
      ]);
      return [
        { source: 'SoccerPunter', trackedName: homeTeam, matches: dedupe(h) },
        { source: 'SoccerPunter', trackedName: awayTeam, matches: dedupe(a) },
      ];
    } catch { return []; }
  })());

  const settled = await Promise.allSettled(tasks);

  // Authoritative league (Flashscore or caller-provided) — used as the resolver's
  // trusted league signal and to backfill the fixture's own row below.
  const detectedLeague = await leaguePromise;
  const ctx: FixtureContext = { homeTeam, awayTeam, league: detectedLeague };

  const contributingSources: string[] = [];
  const sourceCounts: Record<string, number> = {};
  let allMatches: HistoricalMatch[] = [];
  let totalLearned = 0;

  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const batch of r.value) {
      if (batch.matches.length === 0) continue;

      // Confirm identity by evidence. A batch is trusted if EITHER the queried
      // name already resolves to a known canonical (curated/learned alias), OR
      // the resolver corroborates at least one row (opponent / league). This
      // keeps legitimate form data while catching wrong-club fetches, and it
      // auto-learns aliases for confirmed-but-differently-spelled clubs.
      const knownName = isKnownCanonical(batch.trackedName);
      const { accepted: corroborated, learned } = resolveRows(batch.matches, ctx, batch.trackedName);
      totalLearned += learned;

      // If we corroborated any row for this team, we trust the whole batch as
      // that team's games (its matches vs third parties are still that team's).
      const trusted = knownName || corroborated.length > 0;
      const rowsToKeep = trusted ? batch.matches : corroborated;
      if (rowsToKeep.length === 0) continue;

      allMatches.push(...rowsToKeep);
      sourceCounts[batch.source] = (sourceCounts[batch.source] || 0) + rowsToKeep.length;
    }
  }

  for (const [src, n] of Object.entries(sourceCounts)) {
    if (n > 0) contributingSources.push(`${src} (${n})`);
  }

  const merged = dedupe(allMatches);
  if (merged.length === 0) {
    onProgress?.('No historical data found from any source.');
    return { added: 0, sources: [], total: getAllMatches().length };
  }

  // Backfill the authoritative league onto THIS fixture's own row(s) when the
  // source didn't carry one (generic tag). We only stamp rows where BOTH teams
  // are this fixture's pair — a team's other games belong to other leagues and
  // must not be mislabelled.
  if (detectedLeague) {
    const isGeneric = (s: string) => !s || /^(11v11|soccerpunter|thesportsdb|analyze-crawl)$/i.test(s);
    for (const m of merged) {
      const isThisPair =
        (isSameTeam(m.homeTeam, homeTeam) && isSameTeam(m.awayTeam, awayTeam)) ||
        (isSameTeam(m.homeTeam, awayTeam) && isSameTeam(m.awayTeam, homeTeam));
      if (isThisPair && isGeneric(m.division)) {
        m.division = detectedLeague;
        if (isGeneric(m.leagueId)) m.leagueId = detectedLeague;
      }
    }
  }
  if (totalLearned > 0) onProgress?.(`Learned ${totalLearned} team name alias(es) from matched fixtures.`);

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
