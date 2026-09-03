/**
 * SportyBet Integration — direct fixtures + odds from the bookmaker's own API.
 *
 * SportyBet's website is a JS-rendered SPA (HTML crawling yields nothing), but
 * its frontend loads odds from a public JSON backend that needs no key or login
 * for reading pre-match markets:
 *
 *   GET https://www.sportybet.com/api/{region}/factsCenter/pcUpcomingEvents
 *       ?sportId=sr:sport:1&marketId=...&pageSize=N&pageNum=P&option=1
 *
 * This is the SAME book the user stakes on, so importing from it means fixtures,
 * leagues, kickoffs, and odds come straight from the source of truth — the exact
 * markets they bet (including SportyBet's 1UP / 2UP early-payout markets).
 *
 * Response shape:
 *   data.totalNum
 *   data.tournaments[] { name, events[] { eventId, homeTeamName, awayTeamName,
 *     estimateStartTime(ms), sport.category.name (country) +
 *     sport.category.tournament.name (league), markets[] { id, specifier, name,
 *     desc, outcomes[] { id, odds, isActive, desc } } } }
 *
 * NOTE: this is an unofficial/internal endpoint. It can change without notice.
 * We fetch conservatively (a bounded number of pages) for personal use.
 */

import { httpGet } from '../lib/http';
import { ParsedSelection } from './types';

// Market IDs we care about (comma-joined in the query). Covers the user's
// staking vocabulary: 1X2, O/U, Double Chance, GG/NG, DNB, Odd/Even, Handicap,
// 1X2-2UP (60100), 1X2-1UP (60200), O/U&GG/NG combo (36).
const MARKET_IDS = '1,10,11,18,26,29,36,14,60100,60200';

// ─── Preferred Markets (the user's signature picks) ──────────────────────────
// The exact markets the user specialises in. Confirmed IDs from the SportyBet
// factsCenter catalog:
//   60200 = 1X2 - 1UP (early payout)
//   60110 = Double Chance - 1UP (early payout)
//   50    = Home Team to Win Either Half
//   51    = Away Team to Win Either Half
//   900544 = Home Team Fouls Over/Under (LSPORTS, group "Teams", league-gated)
//   900545 = Away Team Fouls Over/Under (LSPORTS, group "Teams", league-gated)
//   900342 = Match Fouls Over/Under (both teams combined, group "Match")
// Confirmed live from the factsCenter event catalog (EPL Brentford v Sunderland).
// We ALSO detect fouls by desc text ("...fouls...") so it keeps working even if
// the numeric id shifts, provided the id is in this filter so the market returns.
const PREFERRED_MARKET_IDS = '60200,60110,50,51,900544,900545,900342';

export type PreferredMarketKey = '1x2_1up' | 'dc_1up' | 'win_either_half' | 'home_fouls' | 'away_fouls';

export interface PreferredMarketRow {
  key: PreferredMarketKey;
  marketLabel: string;             // e.g. "Home Team Fouls O/U"
  line: string;                    // e.g. "Under 13.5" (full outcome desc)
  odds: number;
  locked: boolean;                 // market suspended (status!=0) or outcome !isActive.
                                   // Fouls unlock a few hours pre-kickoff, so we still
                                   // list them locked to pre-stage the pick.
}

export interface PreferredFixture {
  eventId: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;                  // "Country: League"
  kickoff: Date;
  date: string;                    // DD/MM
  time: string;                    // HH:MM
  markets: PreferredMarketRow[];   // only the user's preferred markets present
}

// Region path segment. SportyBet is one network across countries; /ng and /gh
// (and others) all serve the same API. Default /ng, overridable.
export type SportyRegion = 'ng' | 'gh' | 'ke' | 'ug' | 'tz' | 'zm';

interface SbOutcome { id: string; odds: string; isActive: number; desc: string; }
interface SbMarket { id: string; specifier?: string; name: string; desc: string; outcomes: SbOutcome[]; status?: number; }
interface SbEvent {
  eventId: string;
  gameId?: string;
  estimateStartTime: number;
  homeTeamName: string;
  awayTeamName: string;
  sport?: { category?: { name?: string; tournament?: { name?: string } } };
  markets?: SbMarket[];
}
interface SbTournament { id: string; name: string; events: SbEvent[]; categoryName?: string; }
interface SbResponse { bizCode: number; data?: { totalNum: number; tournaments: SbTournament[] }; }

const BASE = 'https://www.sportybet.com';

/**
 * Fetch one page of upcoming football events, filtered to the given market IDs.
 */
async function fetchPageFor(region: SportyRegion, marketIds: string, pageNum: number, pageSize: number): Promise<SbTournament[]> {
  const url = `${BASE}/api/${region}/factsCenter/pcUpcomingEvents`
    + `?sportId=sr:sport:1&marketId=${marketIds}`
    + `&pageSize=${pageSize}&pageNum=${pageNum}&option=1`;
  try {
    const res = await httpGet(url) as SbResponse;
    if (res && res.bizCode === 10000 && res.data?.tournaments) return res.data.tournaments;
    // Some proxy paths wrap raw JSON — tolerate a string body.
    if (typeof res === 'string') {
      try { const parsed = JSON.parse(res) as SbResponse; return parsed.data?.tournaments || []; } catch { return []; }
    }
    return [];
  } catch {
    return [];
  }
}

/** Fetch one page of upcoming football events with the default market set. */
async function fetchPage(region: SportyRegion, pageNum: number, pageSize: number): Promise<SbTournament[]> {
  return fetchPageFor(region, MARKET_IDS, pageNum, pageSize);
}

/**
 * Fetch upcoming SportyBet events across a bounded number of pages and map them
 * to ParsedSelection[]. Each active outcome of each supported market becomes one
 * selection — the same granularity as pasting individual picks.
 *
 * @param opts.region       region path (default 'ng')
 * @param opts.maxPages      how many pages to pull (default 5)
 * @param opts.pageSize      events per page (default 20)
 * @param opts.markets       which markets to import (default: 1X2 + O/U 2.5 + DC + GG/NG)
 * @param opts.onProgress    progress callback
 */
export async function fetchSportyBetSelections(opts?: {
  region?: SportyRegion;
  maxPages?: number;
  pageSize?: number;
  onProgress?: (msg: string) => void;
}): Promise<ParsedSelection[]> {
  const region = opts?.region ?? 'ng';
  const maxPages = opts?.maxPages ?? 5;
  const pageSize = opts?.pageSize ?? 20;
  const onProgress = opts?.onProgress;

  const selections: ParsedSelection[] = [];
  let index = 0;

  for (let page = 1; page <= maxPages; page++) {
    onProgress?.(`Fetching SportyBet page ${page}/${maxPages}...`);
    const tournaments = await fetchPage(region, page, pageSize);
    if (tournaments.length === 0) break; // no more data

    for (const t of tournaments) {
      for (const ev of t.events || []) {
        const kickoff = new Date(ev.estimateStartTime);
        if (isNaN(kickoff.getTime())) continue;
        const country = ev.sport?.category?.name || '';
        const leagueName = ev.sport?.category?.tournament?.name || t.name || '';
        const league = country ? `${country}: ${leagueName}` : leagueName;

        for (const m of ev.markets || []) {
          if (m.status && m.status !== 0) continue; // skip suspended/settled markets
          for (const oc of m.outcomes || []) {
            if (!oc.isActive) continue;
            const odds = parseFloat(oc.odds);
            if (!isFinite(odds) || odds < 1.01) continue;

            const { marketLabel, pickLabel, category, marketType } = mapMarket(m, oc);
            if (!pickLabel) continue;

            selections.push(buildSelection({
              index: index++,
              kickoff,
              gameId: ev.gameId || ev.eventId,
              home: ev.homeTeamName,
              away: ev.awayTeamName,
              league,
              odds: Math.round(odds * 100) / 100,
              market: marketLabel,
              pick: pickLabel,
              category,
              marketType,
            }));
          }
        }
      }
    }
  }

  onProgress?.(`Imported ${selections.length} SportyBet selections.`);
  return selections;
}

// ─── Preferred Markets Scout ─────────────────────────────────────────────────

/**
 * Match a SportyBet market to one of the user's preferred markets. Fouls are
 * detected by group + desc text (robust to id changes); the others by id.
 * Returns null if the market isn't one of the five.
 */
function classifyPreferred(m: SbMarket): { key: PreferredMarketKey; marketLabel: string } | null {
  const group = ((m as any).group || '').toLowerCase();
  const desc = (m.desc || '').toLowerCase();

  if (m.id === '60200') return { key: '1x2_1up', marketLabel: '1X2 - 1UP' };
  if (m.id === '60110') return { key: 'dc_1up', marketLabel: 'Double Chance - 1UP' };
  if (m.id === '50') return { key: 'win_either_half', marketLabel: 'Home Team to Win Either Half' };
  if (m.id === '51') return { key: 'win_either_half', marketLabel: 'Away Team to Win Either Half' };

  // Fouls — league-gated (big leagues only, e.g. EPL/LaLiga). Confirmed ids
  // 900544 (home) / 900545 (away); group is "Teams", desc is
  // "Home/Away Team Fouls Over/Under". We match by id first, then fall back to
  // desc text so it keeps working if the numeric id ever shifts.
  if (m.id === '900544') return { key: 'home_fouls', marketLabel: 'Home Team Fouls O/U' };
  if (m.id === '900545') return { key: 'away_fouls', marketLabel: 'Away Team Fouls O/U' };
  if (desc.includes('foul') || group === 'fouls') {
    if (desc.includes('home')) return { key: 'home_fouls', marketLabel: 'Home Team Fouls O/U' };
    if (desc.includes('away')) return { key: 'away_fouls', marketLabel: 'Away Team Fouls O/U' };
    // "Fouls Over/Under" with no home/away = combined match total; treat as home
    // bucket so it still surfaces as an available fouls market to book.
    return { key: 'home_fouls', marketLabel: 'Match Fouls O/U' };
  }
  return null;
}

/**
 * Scan upcoming SportyBet fixtures and return only those that OFFER at least one
 * of the user's preferred markets, with the live line + odds per market. This is
 * the availability scout: fixtures where these (often uncommon) markets exist and
 * can actually be booked.
 *
 * @param opts.region      region path (default 'ng')
 * @param opts.maxPages     pages to scan (default 10)
 * @param opts.pageSize     events per page (default 30)
 * @param opts.leagueFilter optional substring to restrict to a league/country
 * @param opts.onProgress   progress callback
 */
export async function fetchPreferredMarkets(opts?: {
  region?: SportyRegion;
  maxPages?: number;
  pageSize?: number;
  leagueFilter?: string | null;
  onProgress?: (msg: string) => void;
}): Promise<PreferredFixture[]> {
  const region = opts?.region ?? 'ng';
  const maxPages = opts?.maxPages ?? 10;
  const pageSize = opts?.pageSize ?? 30;
  const leagueFilter = (opts?.leagueFilter || '').toLowerCase().trim();
  const onProgress = opts?.onProgress;

  const now = Date.now();
  const out: PreferredFixture[] = [];

  for (let page = 1; page <= maxPages; page++) {
    onProgress?.(`Scanning SportyBet page ${page}/${maxPages}…`);
    const tournaments = await fetchPageFor(region, PREFERRED_MARKET_IDS, page, pageSize);
    if (tournaments.length === 0) break;

    for (const t of tournaments) {
      for (const ev of t.events || []) {
        const kickoff = new Date(ev.estimateStartTime);
        if (isNaN(kickoff.getTime()) || kickoff.getTime() <= now) continue; // upcoming only

        const country = ev.sport?.category?.name || '';
        const leagueName = ev.sport?.category?.tournament?.name || t.name || '';
        const league = country ? `${country}: ${leagueName}` : leagueName;
        if (leagueFilter && !league.toLowerCase().includes(leagueFilter)) continue;

        const rows: PreferredMarketRow[] = [];
        for (const m of ev.markets || []) {
          const cls = classifyPreferred(m);
          if (!cls) continue;
          const isFouls = cls.key === 'home_fouls' || cls.key === 'away_fouls';
          const marketLocked = !!(m.status && m.status !== 0);
          // Non-fouls preferred markets: keep the tight rule (skip suspended
          // markets) since those are broadly available anyway. Fouls: surface
          // even when the whole market is suspended, because it typically stays
          // locked until a few hours before kickoff and we want it pre-staged.
          if (marketLocked && !isFouls) continue;
          for (const oc of m.outcomes || []) {
            const active = !!oc.isActive;
            const odds = parseFloat(oc.odds);
            const hasPrice = isFinite(odds) && odds >= 1.01;
            const locked = marketLocked || !active || !hasPrice;
            // For fouls we keep locked lines (they carry the line label even
            // with no live price). For everything else we require a real price.
            if (!isFouls && locked) continue;
            if (isFouls && !oc.desc) continue; // need at least the line label
            rows.push({
              key: cls.key,
              marketLabel: cls.marketLabel,
              line: (oc.desc || '').trim(),
              odds: hasPrice ? Math.round(odds * 100) / 100 : 0,
              locked,
            });
          }
        }
        if (rows.length === 0) continue; // fixture doesn't offer any preferred market

        // Live (unlocked) rows first so actionable prices sit at the top; within
        // each group keep the market grouping stable.
        rows.sort((a, b) => Number(a.locked) - Number(b.locked));

        out.push({
          eventId: ev.eventId,
          gameId: ev.gameId || ev.eventId,
          homeTeam: ev.homeTeamName,
          awayTeam: ev.awayTeamName,
          league,
          kickoff,
          date: `${pad2(kickoff.getDate())}/${pad2(kickoff.getMonth() + 1)}`,
          time: `${pad2(kickoff.getHours())}:${pad2(kickoff.getMinutes())}`,
          markets: rows,
        });
      }
    }
  }

  // Sort by soonest kickoff
  out.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  onProgress?.(`Found ${out.length} fixture(s) offering your preferred markets.`);
  return out;
}

/**
 * Convert a chosen preferred-market row into a ParsedSelection for the pool.
 */
export function preferredRowToSelection(fx: PreferredFixture, row: PreferredMarketRow): ParsedSelection {
  const marketType: ParsedSelection['marketType'] =
    row.key === '1x2_1up' ? '1x2' :
    row.key === 'dc_1up' ? 'double_chance' :
    (row.key === 'home_fouls' || row.key === 'away_fouls') ? 'fouls' :
    'special';
  const category: ParsedSelection['pickCategory'] =
    row.line.toLowerCase().includes('over') ? 'over' :
    row.line.toLowerCase().includes('under') ? 'under' :
    row.line.toLowerCase().includes('home') ? (row.line.toLowerCase().includes('draw') ? 'home_or_draw' : 'home') :
    row.line.toLowerCase().includes('away') ? (row.line.toLowerCase().includes('draw') ? 'draw_or_away' : 'away') :
    row.line.toLowerCase() === 'yes' ? 'yes' :
    row.line.toLowerCase() === 'no' ? 'no' : 'other';

  return buildSelection({
    index: 0,
    kickoff: fx.kickoff,
    gameId: fx.gameId,
    home: fx.homeTeam,
    away: fx.awayTeam,
    league: fx.league,
    odds: row.odds,
    market: row.marketLabel,
    pick: row.line,
    category,
    marketType,
  });
}

// ─── Market Mapping ──────────────────────────────────────────────────────────

/**
 * Map a SportyBet market + outcome to Roll-Over's market/pick vocabulary. Uses
 * the human-readable `desc` fields the API already provides, so labels match
 * what the user sees on the bookmaker.
 */
function mapMarket(m: SbMarket, oc: SbOutcome): {
  marketLabel: string;
  pickLabel: string;
  category: ParsedSelection['pickCategory'];
  marketType: ParsedSelection['marketType'];
} {
  const mid = m.id;
  const d = (oc.desc || '').trim();
  const lower = d.toLowerCase();

  const cat = (): ParsedSelection['pickCategory'] => {
    if (lower.includes('over')) return 'over';
    if (lower.includes('under')) return 'under';
    if (lower === 'home' || lower.includes('home')) return lower.includes('draw') ? 'home_or_draw' : lower.includes('away') ? 'home_or_away' : 'home';
    if (lower === 'away' || lower.includes('away')) return lower.includes('draw') ? 'draw_or_away' : 'away';
    if (lower === 'draw') return 'draw';
    if (lower === 'yes') return 'yes';
    if (lower === 'no') return 'no';
    return 'other';
  };

  switch (mid) {
    case '1':
      return { marketLabel: '1X2', pickLabel: d, category: cat(), marketType: '1x2' };
    case '60200':
      return { marketLabel: '1X2 - 1UP', pickLabel: d, category: cat(), marketType: '1x2' };
    case '60100':
      return { marketLabel: '1X2 - 2UP', pickLabel: d, category: cat(), marketType: '1x2' };
    case '18': {
      // specifier like "total=2.5" → "Over/Under 2.5"; outcome desc already "Over 2.5"
      const line = (m.specifier || '').replace('total=', '');
      return { marketLabel: `Over/Under ${line}`.trim(), pickLabel: d, category: cat(), marketType: 'over_under' };
    }
    case '10':
      return { marketLabel: 'Double Chance', pickLabel: d, category: cat(), marketType: 'double_chance' };
    case '29':
      return { marketLabel: 'GG/NG', pickLabel: lower === 'yes' ? 'GG' : 'NG', category: cat(), marketType: 'gg_ng' };
    case '11':
      return { marketLabel: 'Draw No Bet', pickLabel: d, category: cat(), marketType: 'other' };
    case '26':
      return { marketLabel: 'Odd/Even', pickLabel: d, category: 'other', marketType: 'other' };
    case '14': {
      const hcp = (m.specifier || '').replace('hcp=', '');
      return { marketLabel: `Handicap ${hcp}`.trim(), pickLabel: d, category: 'handicap', marketType: 'handicap' };
    }
    case '36': {
      const line = (m.specifier || '').replace('total=', '');
      return { marketLabel: `O/U ${line} & GG/NG`.trim(), pickLabel: d, category: 'combo', marketType: 'combo' };
    }
    default:
      return { marketLabel: m.name || m.desc || 'Other', pickLabel: d, category: 'other', marketType: 'other' };
  }
}

// ─── Selection Builder ───────────────────────────────────────────────────────

function pad2(n: number): string { return n.toString().padStart(2, '0'); }

function buildSelection(a: {
  index: number;
  kickoff: Date;
  gameId: string;
  home: string;
  away: string;
  league: string;
  odds: number;
  market: string;
  pick: string;
  category: ParsedSelection['pickCategory'];
  marketType: ParsedSelection['marketType'];
}): ParsedSelection {
  return {
    id: crypto.randomUUID(),
    index: a.index,
    date: `${pad2(a.kickoff.getDate())}/${pad2(a.kickoff.getMonth() + 1)}`,
    time: `${pad2(a.kickoff.getHours())}:${pad2(a.kickoff.getMinutes())}`,
    kickOffDateTime: a.kickoff,
    gameId: a.gameId,
    homeTeam: a.home,
    awayTeam: a.away,
    status: 'not_started',
    score: null,
    pick: a.pick,
    pickCategory: a.category,
    odds: a.odds,
    market: a.market,
    marketType: a.marketType,
    marketVariant: a.league || null,   // stash league here for display/analysis
    result: null,
    resultMessage: null,
    isSettled: false,
    isVoid: false,
    isSuspended: false,
    isEligibleForGrouping: true,
  };
}
