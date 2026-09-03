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
 * Fetch one page of upcoming football events with odds.
 */
async function fetchPage(region: SportyRegion, pageNum: number, pageSize: number): Promise<SbTournament[]> {
  const url = `${BASE}/api/${region}/factsCenter/pcUpcomingEvents`
    + `?sportId=sr:sport:1&marketId=${MARKET_IDS}`
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
