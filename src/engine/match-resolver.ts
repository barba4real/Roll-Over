/**
 * Evidence-Based Match Resolver
 *
 * The crawl fetches historical rows for a team using several name variants, but
 * sources spell clubs differently ("Willem II" vs "Willem II Tilburg"). Rather
 * than trust the name alone (the old brittle approach that missed unaliased
 * clubs), we CONFIRM a crawled row belongs to the fixture we care about using
 * corroborating evidence:
 *
 *   - Opponent match  (strongest): the row's other side matches the fixture's
 *     other side. Two teams meeting is a near-unique fingerprint.
 *   - League match: same competition.
 *   - Date proximity: same day / within a few days.
 *   - Fuzzy name similarity: TIEBREAKER ONLY — never accepts on its own.
 *
 * Conservative policy (approved): a row is accepted only when a PRIMARY signal
 * (opponent OR league) corroborates it. Name similarity alone can never bind a
 * team — that guards against two different clubs sharing a word ("Sporting").
 *
 * When a row is confidently bound to a known club under a differently-spelled
 * name, we learn that name → canonical alias (persisted separately) so future
 * lookups are instant and the alias map self-populates.
 */

import type { HistoricalMatch } from './football-data-uk';
import { isSameTeam, resolveTeamName } from './team-aliases';
import { learnAlias } from './learned-aliases';

// ─── Fuzzy name similarity ───────────────────────────────────────────────────

function normalizeForCompare(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[.'-]/g, ' ')
    .replace(/\b(fc|afc|sc|cf|ac|ss|us|rc|sv|vfl|vfb|tsg|sg|cd|ca|club|city|town|united|utd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-overlap similarity in [0,1]. 1 = identical token sets after
 * normalization; 0 = no shared tokens. Robust to suffixes/word order.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeForCompare(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeForCompare(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Dice coefficient
  return (2 * shared) / (ta.size + tb.size);
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function toMs(date: string): number {
  if (!date) return NaN;
  if (date.includes('/')) {
    const [d, m, y] = date.split('/');
    const yy = y.length === 2 ? '20' + y : y;
    return new Date(`${yy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).getTime();
  }
  return new Date(date.slice(0, 10)).getTime();
}

function daysBetween(a: string, b: string): number {
  const ta = toMs(a), tb = toMs(b);
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86400000;
}

// ─── Target fixture context ──────────────────────────────────────────────────

export interface FixtureContext {
  homeTeam: string;
  awayTeam: string;
  league?: string | null;         // competition name, if known
  date?: string | null;           // fixture date (DD/MM/YYYY or ISO), if known
}

export interface ResolveResult {
  accepted: boolean;
  score: number;                  // 0-100 confidence
  why: string[];                  // signals that fired, for provenance
  /** Which fixture side this row's tracked team corresponds to (for alias learning). */
  boundTeam?: 'home' | 'away' | null;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score a crawled row against a fixture context. `trackedName` is the name we
 * queried the source with (one of the fixture's teams, possibly a variant).
 *
 * Accept policy (conservative): require a PRIMARY corroborating signal —
 * either the opponent matches one of the fixture's teams, or the league matches
 * — combined with reasonable name/date agreement. Name similarity alone never
 * accepts.
 */
export function scoreRow(
  row: HistoricalMatch,
  ctx: FixtureContext,
  trackedName: string
): ResolveResult {
  const why: string[] = [];
  let score = 0;
  let boundTeam: 'home' | 'away' | null = null;

  const fixtureTeams = [ctx.homeTeam, ctx.awayTeam];

  // Does either side of the row correspond (by alias) to a fixture team?
  const rowHomeIsFixtureTeam = fixtureTeams.find(t => isSameTeam(row.homeTeam, t));
  const rowAwayIsFixtureTeam = fixtureTeams.find(t => isSameTeam(row.awayTeam, t));

  // ── Opponent signal (PRIMARY) ──
  // The tracked team is on one side; if the OTHER side matches the fixture's
  // other team, that is the strongest possible confirmation.
  const trackedOnHome = isSameTeam(row.homeTeam, trackedName) || nameSimilarity(row.homeTeam, trackedName) >= 0.6;
  const trackedOnAway = isSameTeam(row.awayTeam, trackedName) || nameSimilarity(row.awayTeam, trackedName) >= 0.6;

  let opponentMatched = false;
  if (trackedOnHome && rowAwayIsFixtureTeam && !isSameTeam(rowAwayIsFixtureTeam, trackedName)) {
    opponentMatched = true; boundTeam = 'home';
  } else if (trackedOnAway && rowHomeIsFixtureTeam && !isSameTeam(rowHomeIsFixtureTeam, trackedName)) {
    opponentMatched = true; boundTeam = 'away';
  }
  if (opponentMatched) { score += 60; why.push('opponent'); }

  // ── League signal (PRIMARY) ──
  let leagueMatched = false;
  if (ctx.league && (row.division || row.leagueId)) {
    const rowLeague = `${row.division} ${row.leagueId}`.toLowerCase();
    const ctxLeague = ctx.league.toLowerCase();
    // ignore generic source tags stamped by crawlers
    const generic = /^(11v11|soccerpunter|thesportsdb)$/i;
    if (!generic.test(row.division || '') || !generic.test(row.leagueId || '')) {
      if (rowLeague.includes(ctxLeague) || ctxLeague.includes(row.division?.toLowerCase() || '\u0000')) {
        leagueMatched = true; score += 30; why.push('league');
      }
    }
  }

  // ── Date proximity (SUPPORTING) ──
  if (ctx.date && row.date) {
    const dd = daysBetween(ctx.date, row.date);
    if (dd === 0) { score += 10; why.push('same-day'); }
    else if (dd <= 3) { score += 5; why.push('date≈'); }
  }

  // ── Name similarity (TIEBREAKER ONLY) ──
  const sim = Math.max(nameSimilarity(row.homeTeam, trackedName), nameSimilarity(row.awayTeam, trackedName));
  if (sim >= 0.8) { score += 10; why.push('name'); }
  else if (sim >= 0.6) { score += 5; why.push('name~'); }

  // ── Accept policy ──
  // A PRIMARY signal (opponent OR league) is required. Opponent alone is enough
  // (very high specificity). League requires a supporting date or name signal.
  const hasPrimary = opponentMatched || leagueMatched;
  const accepted =
    opponentMatched ||
    (leagueMatched && (why.includes('same-day') || why.includes('date≈') || sim >= 0.6));

  return {
    accepted: hasPrimary && accepted,
    score: Math.min(100, score),
    why,
    boundTeam,
  };
}

/**
 * Given a set of crawled rows for a tracked team and the fixture context,
 * return only the rows that are confidently this team's, and learn any
 * new name→canonical aliases discovered along the way.
 *
 * We keep the row as-is (its own home/away/score); acceptance just governs
 * whether it enters the DB. A row where the tracked team is confirmed but under
 * a different spelling teaches us the alias for next time.
 */
export function resolveRows(
  rows: HistoricalMatch[],
  ctx: FixtureContext,
  trackedName: string
): { accepted: HistoricalMatch[]; learned: number } {
  const accepted: HistoricalMatch[] = [];
  let learned = 0;

  // The canonical name of the fixture side we're tracking.
  const trackedCanonical = resolveTeamName(trackedName);

  for (const row of rows) {
    const res = scoreRow(row, ctx, trackedName);
    if (!res.accepted) continue;
    accepted.push(row);

    // Learn: when confirmed via a PRIMARY signal, bind the row's spelling of
    // the tracked team to our canonical, so it resolves instantly next time.
    if (res.boundTeam) {
      const rowTrackedName = res.boundTeam === 'home' ? row.homeTeam : row.awayTeam;
      if (rowTrackedName && !isSameTeam(rowTrackedName, trackedCanonical)) {
        learnAlias(rowTrackedName, trackedCanonical, res.why.join('+'));
        learned++;
      }
    }
  }

  return { accepted, learned };
}
