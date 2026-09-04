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
// The scan filter is now derived from the PREFERRED_MARKETS registry below
// (PREFERRED_IDS_CSV), so adding a market in one place updates the query too.

export type PreferredMarketKey = '1x2_1up' | 'dc_1up' | 'win_either_half' | 'home_fouls' | 'away_fouls';

// ─── Preferred-market registry (single place to add a new preferred market) ──
// To add a market later: append one entry here with its SportyBet market id(s),
// a stable key, a display label, and (optionally) a desc-text matcher fallback.
// Everything downstream (scan filter, classification, modal grouping) is driven
// off this table, so no other code needs editing.
export interface PreferredMarketDef {
  key: PreferredMarketKey;
  label: string;                 // shown in the modal group header
  ids: string[];                 // SportyBet market ids that map to this key
  // Optional fallback matcher on the market desc/group when id shifts.
  match?: (descLower: string, groupLower: string) => boolean;
  // For fouls-type markets we surface even when locked (they unlock pre-kickoff).
  surfaceWhenLocked?: boolean;
}

export const PREFERRED_MARKETS: PreferredMarketDef[] = [
  { key: '1x2_1up', label: '1X2 - 1UP', ids: ['60200'] },
  { key: 'dc_1up', label: 'Double Chance - 1UP', ids: ['60110'] },
  { key: 'win_either_half', label: 'Win Either Half', ids: ['50', '51'] },
  {
    key: 'home_fouls', label: 'Home Team Fouls O/U', ids: ['900544'],
    match: (d, g) => (d.includes('foul') && d.includes('home')) || (g === 'fouls' && d.includes('home')),
    surfaceWhenLocked: true,
  },
  {
    key: 'away_fouls', label: 'Away Team Fouls O/U', ids: ['900545'],
    match: (d, g) => (d.includes('foul') && d.includes('away')) || (g === 'fouls' && d.includes('away')),
    surfaceWhenLocked: true,
  },
  // Match-total fouls (both teams). No home/away in desc; bucket under home_fouls
  // so it still surfaces. Kept last so home/away ids match first.
  {
    key: 'home_fouls', label: 'Match Fouls O/U', ids: ['900342'],
    match: (d) => d.includes('foul') && !d.includes('home') && !d.includes('away'),
    surfaceWhenLocked: true,
  },
];

// Comma-joined id list for the scan filter, derived from the registry.
const PREFERRED_IDS_CSV = Array.from(new Set(PREFERRED_MARKETS.flatMap(m => m.ids))).join(',');

export interface PreferredMarketRow {
  key: PreferredMarketKey;
  marketLabel: string;             // e.g. "Home Team Fouls O/U"
  line: string;                    // e.g. "Under 13.5" (full outcome desc)
  odds: number;
  locked: boolean;                 // outcome not active / not priced (decided per
                                   // outcome, NOT from m.status). Fouls that are not
                                   // yet open are still listed so the pick can be
                                   // pre-staged before they unlock.
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

// A plain fixture row for the consolidated Markets tab — NO market expansion.
// One row per SportyBet event. Markets are fetched on demand when clicked.
export interface SbFixture {
  eventId: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  country: string;                 // e.g. "England"
  leagueName: string;              // e.g. "Premier League"
  league: string;                  // "Country: League" (display)
  kickoff: Date;
  date: string;                    // DD/MM
  time: string;                    // HH:MM
  hasPreferred: boolean;           // event was returned under the preferred-id filter,
                                   // i.e. it offers at least one preferred market
}

// Time-window presets for the fixture list. Extensible: add an entry here and a
// case in withinWindow(). '' = no window (all upcoming).
export type TimeWindow = '' | '3h' | '6h' | 'today' | 'tomorrow' | 'weekend';

export const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '', label: 'All upcoming' },
  { key: '3h', label: 'Next 3 hours' },
  { key: '6h', label: 'Next 6 hours' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'Weekend' },
];

/** True if a kickoff falls within the selected time window (local time). */
export function withinWindow(kickoff: Date, win: TimeWindow, now: Date = new Date()): boolean {
  const t = kickoff.getTime();
  if (t <= now.getTime()) return false; // upcoming only
  switch (win) {
    case '': return true;
    case '3h': return t <= now.getTime() + 3 * 3600_000;
    case '6h': return t <= now.getTime() + 6 * 3600_000;
    case 'today': {
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      return t <= end.getTime();
    }
    case 'tomorrow': {
      const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setHours(23, 59, 59, 999);
      return t >= start.getTime() && t <= end.getTime();
    }
    case 'weekend': {
      // Upcoming Saturday 00:00 → Sunday 23:59 (local). If already weekend, use
      // the current weekend.
      const d = new Date(now);
      const day = d.getDay(); // 0 Sun … 6 Sat
      const sat = new Date(d);
      const daysToSat = day === 6 ? 0 : day === 0 ? -1 : 6 - day;
      sat.setDate(d.getDate() + daysToSat); sat.setHours(0, 0, 0, 0);
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1); sun.setHours(23, 59, 59, 999);
      return t >= sat.getTime() && t <= sun.getTime();
    }
    default: return true;
  }
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
function classifyPreferred(m: SbMarket): { key: PreferredMarketKey; marketLabel: string; surfaceWhenLocked: boolean } | null {
  const group = ((m as any).group || '').toLowerCase();
  const desc = (m.desc || '').toLowerCase();

  // 1) Match by explicit id first (most reliable).
  for (const def of PREFERRED_MARKETS) {
    if (def.ids.includes(m.id)) {
      // For Win Either Half, refine the label to home/away from the desc.
      const label = refineLabel(def, desc);
      return { key: def.key, marketLabel: label, surfaceWhenLocked: !!def.surfaceWhenLocked };
    }
  }
  // 2) Fall back to desc/group matcher (survives id shifts).
  for (const def of PREFERRED_MARKETS) {
    if (def.match && def.match(desc, group)) {
      const label = refineLabel(def, desc);
      return { key: def.key, marketLabel: label, surfaceWhenLocked: !!def.surfaceWhenLocked };
    }
  }
  return null;
}

/** Sharpen a generic registry label using the market desc (e.g. Win Either Half). */
function refineLabel(def: PreferredMarketDef, descLower: string): string {
  if (def.key === 'win_either_half') {
    if (descLower.includes('home')) return 'Home Team to Win Either Half';
    if (descLower.includes('away')) return 'Away Team to Win Either Half';
  }
  return def.label;
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
    const tournaments = await fetchPageFor(region, PREFERRED_IDS_CSV, page, pageSize);
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
          const surfaceLocked = cls.surfaceWhenLocked;
          const marketLocked = !!(m.status && m.status !== 0);
          // Markets flagged surfaceWhenLocked (fouls) are shown even when the
          // whole market is suspended, because they typically stay locked until
          // a few hours before kickoff and we want them pre-staged. Others keep
          // the tight rule (skip suspended) since they're broadly available.
          if (marketLocked && !surfaceLocked) continue;
          for (const oc of m.outcomes || []) {
            const active = !!oc.isActive;
            const odds = parseFloat(oc.odds);
            const hasPrice = isFinite(odds) && odds >= 1.01;
            const locked = marketLocked || !active || !hasPrice;
            if (!surfaceLocked && locked) continue;
            if (surfaceLocked && !oc.desc) continue; // need at least the line label
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

// ─── Fixture list (clean) + on-demand per-fixture markets ────────────────────

/**
 * Fetch a CLEAN list of SportyBet fixtures — one row per event, NO market
 * expansion. This is the spine of the consolidated Markets tab: the user sees a
 * fixture list and clicks a fixture to open its preferred markets on demand.
 *
 * We query under the preferred-market id filter so `hasPreferred` reflects
 * whether the event carries at least one of the user's markets, but we do NOT
 * expand them here (that's fetchFixtureMarkets on click).
 *
 * @param opts.region    region path (default 'ng')
 * @param opts.maxPages   pages to pull (default 10)
 * @param opts.pageSize   events per page (default 30)
 * @param opts.window     time-window preset (default '' = all upcoming)
 * @param opts.onProgress progress callback
 */
export async function fetchSportyBetFixtures(opts?: {
  region?: SportyRegion;
  maxPages?: number;
  pageSize?: number;
  window?: TimeWindow;
  onProgress?: (msg: string) => void;
}): Promise<{ fixtures: SbFixture[]; leagues: string[] }> {
  const region = opts?.region ?? 'ng';
  const maxPages = opts?.maxPages ?? 10;
  const pageSize = opts?.pageSize ?? 30;
  const win = opts?.window ?? '';
  const onProgress = opts?.onProgress;

  const now = new Date();
  const byId = new Map<string, SbFixture>();

  for (let page = 1; page <= maxPages; page++) {
    onProgress?.(`Loading SportyBet fixtures — page ${page}/${maxPages}…`);
    const tournaments = await fetchPageFor(region, PREFERRED_IDS_CSV, page, pageSize);
    if (tournaments.length === 0) break;

    for (const t of tournaments) {
      for (const ev of t.events || []) {
        const kickoff = new Date(ev.estimateStartTime);
        if (isNaN(kickoff.getTime())) continue;
        if (!withinWindow(kickoff, win, now)) continue;
        if (byId.has(ev.eventId)) continue; // one row per event

        const country = ev.sport?.category?.name || '';
        const leagueName = ev.sport?.category?.tournament?.name || t.name || '';
        const league = country ? `${country}: ${leagueName}` : leagueName;

        // Does this event actually carry a preferred market? (returned under the
        // preferred-id filter, but confirm at least one classifies.)
        const hasPreferred = (ev.markets || []).some(m => !!classifyPreferred(m));

        byId.set(ev.eventId, {
          eventId: ev.eventId,
          gameId: ev.gameId || ev.eventId,
          homeTeam: ev.homeTeamName,
          awayTeam: ev.awayTeamName,
          country,
          leagueName,
          league,
          kickoff,
          date: `${pad2(kickoff.getDate())}/${pad2(kickoff.getMonth() + 1)}`,
          time: `${pad2(kickoff.getHours())}:${pad2(kickoff.getMinutes())}`,
          hasPreferred,
        });
      }
    }
  }

  const fixtures = Array.from(byId.values()).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const leagues = Array.from(new Set(fixtures.map(f => f.league))).filter(Boolean).sort();
  onProgress?.(`Loaded ${fixtures.length} SportyBet fixture(s).`);
  return { fixtures, leagues };
}

/**
 * Fetch the preferred markets for ONE fixture, on demand (when the user clicks
 * it). Uses the per-event catalog endpoint which returns the full market list,
 * then classifies + keeps only the user's preferred markets (locked ones too,
 * for pre-staging). Returns a PreferredFixture ready for the modal.
 */
export async function fetchFixtureMarkets(
  fx: SbFixture,
  opts?: { region?: SportyRegion; onProgress?: (msg: string) => void },
): Promise<PreferredFixture> {
  const region = opts?.region ?? 'ng';
  opts?.onProgress?.('Loading markets…');

  const url = `${BASE}/api/${region}/factsCenter/event?eventId=${encodeURIComponent(fx.eventId)}&productId=3`;
  let markets: SbMarket[] = [];
  try {
    const res = await httpGet(url) as any;
    const data = (res && res.data) ? res.data : (typeof res === 'string' ? (() => { try { return JSON.parse(res).data; } catch { return null; } })() : null);
    markets = (data && Array.isArray(data.markets)) ? data.markets as SbMarket[] : [];
  } catch {
    markets = [];
  }

  const rows: PreferredMarketRow[] = [];
  for (const m of markets) {
    const cls = classifyPreferred(m);
    if (!cls) continue;
    const surfaceLocked = cls.surfaceWhenLocked;
    // NOTE: m.status is NOT a lock flag. Live data shows the SAME market id
    // appearing under status 0 AND status 1, each carrying a different (main vs
    // alternative) line, both with active, priced outcomes. So locking must be
    // decided PER OUTCOME from isActive + a valid price — never from m.status.
    for (const oc of m.outcomes || []) {
      const active = !!oc.isActive;
      const odds = parseFloat(oc.odds);
      const hasPrice = isFinite(odds) && odds >= 1.01;
      const locked = !active || !hasPrice;
      if (!surfaceLocked && locked) continue;
      if (surfaceLocked && !oc.desc) continue;
      rows.push({
        key: cls.key,
        marketLabel: cls.marketLabel,
        line: (oc.desc || '').trim(),
        odds: hasPrice ? Math.round(odds * 100) / 100 : 0,
        locked,
      });
    }
  }
  rows.sort((a, b) => Number(a.locked) - Number(b.locked));

  return {
    eventId: fx.eventId,
    gameId: fx.gameId,
    homeTeam: fx.homeTeam,
    awayTeam: fx.awayTeam,
    league: fx.league,
    kickoff: fx.kickoff,
    date: fx.date,
    time: fx.time,
    markets: rows,
  };
}

// ─── Fouls-only confirmation (for the dedicated Fouls tab) ───────────────────

// The three fouls market ids we watch (home / away / match-total).
export const FOULS_MARKET_IDS = ['900544', '900545', '900342'];

export interface FoulsFixture {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;                  // "Country: League"
  leagueName: string;
  kickoff: Date;
  date: string;
  time: string;
  fouls: PreferredMarketRow[];     // only fouls rows (home/away/match O/U lines)
  anyOpen: boolean;                // at least one fouls outcome is live + priced
}

/**
 * Confirm which SportyBet fixtures actually OFFER fouls markets, and return
 * their live fouls lines/odds. This hits the per-event endpoint for each
 * candidate (fast — ~sub-second per event), so it is CAPPED and kickoff-sorted.
 *
 * Used only by the dedicated Fouls tab. It is intentionally separate from the
 * shared Scout/Markets store: the Fouls tab is a focused watchlist of games we
 * can actually play fouls on.
 */
export async function confirmFoulsFixtures(opts?: {
  region?: SportyRegion;
  window?: TimeWindow;
  maxPages?: number;
  pageSize?: number;
  cap?: number;                    // max fixtures to per-event confirm (default 40)
  onProgress?: (msg: string) => void;
}): Promise<FoulsFixture[]> {
  const region = opts?.region ?? 'ng';
  const cap = opts?.cap ?? 40;
  opts?.onProgress?.('Loading SportyBet fixtures…');

  const { fixtures } = await fetchSportyBetFixtures({
    region,
    maxPages: opts?.maxPages ?? 12,
    pageSize: opts?.pageSize ?? 30,
    window: opts?.window ?? '',
    onProgress: opts?.onProgress,
  });

  // Candidates first: prefer fixtures the list already flags as carrying a
  // preferred market, then fall back to all — sorted by soonest kickoff so the
  // capped set is the most relevant.
  const sorted = [...fixtures].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const preferredFirst = [
    ...sorted.filter(f => f.hasPreferred),
    ...sorted.filter(f => !f.hasPreferred),
  ];
  const candidates = preferredFirst.slice(0, cap);

  const out: FoulsFixture[] = [];
  let done = 0;
  for (const fx of candidates) {
    done++;
    opts?.onProgress?.(`Checking fouls markets ${done}/${candidates.length}…`);
    let pf: PreferredFixture;
    try {
      pf = await fetchFixtureMarkets(fx, { region });
    } catch {
      continue;
    }
    const fouls = pf.markets.filter(r => r.key === 'home_fouls' || r.key === 'away_fouls');
    if (fouls.length === 0) continue; // this fixture doesn't carry fouls — skip
    out.push({
      eventId: fx.eventId,
      homeTeam: fx.homeTeam,
      awayTeam: fx.awayTeam,
      league: fx.league,
      leagueName: fx.leagueName,
      kickoff: fx.kickoff,
      date: fx.date,
      time: fx.time,
      fouls,
      anyOpen: fouls.some(r => !r.locked),
    });
  }
  opts?.onProgress?.(`Found ${out.length} fixture(s) offering fouls.`);
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
