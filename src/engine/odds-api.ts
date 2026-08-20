/**
 * The Odds API client
 * Correct host: https://api.the-odds-api.com/v4
 * Free plan: 500 requests/month
 * Provides: pre-match odds from 40+ bookmakers
 *
 * Sport keys for soccer:
 *   soccer_epl, soccer_spain_la_liga, soccer_germany_bundesliga,
 *   soccer_italy_serie_a, soccer_france_ligue_one, soccer_uefa_champs_league
 *
 * https://the-odds-api.com/liveapi/guides/v4/
 */

import { httpGet } from '../lib/http';

const API_HOST = 'https://api.the-odds-api.com/v4';

let apiKey: string | null = null;

export function setOddsApiKey(key: string) {
  apiKey = key;
  localStorage.setItem('rollover_odds_api_key', key);
}

export function getOddsApiKey(): string | null {
  if (!apiKey) {
    apiKey = localStorage.getItem('rollover_odds_api_key');
  }
  return apiKey;
}

// Soccer sport keys on The Odds API
export const ODDS_SPORT_KEYS = [
  { key: 'soccer_epl', name: 'Premier League' },
  { key: 'soccer_spain_la_liga', name: 'La Liga' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga' },
  { key: 'soccer_italy_serie_a', name: 'Serie A' },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1' },
  { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
  { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League' },
  { key: 'soccer_efl_champ', name: 'Championship' },
];

async function apiFetch(endpoint: string): Promise<any> {
  const key = getOddsApiKey();
  if (!key) throw new Error('Odds API key not set. Get free key at the-odds-api.com');

  const url = `${API_HOST}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${key}`;
  const result: any = await httpGet(url, { 'Accept': 'application/json' });
  return result;
}

/**
 * Get upcoming events with odds for a sport
 * Returns events with bookmaker odds attached
 */
export async function getOdds(sportKey: string, markets: string = 'h2h'): Promise<OddsEvent[]> {
  try {
    const data = await apiFetch(`/sports/${sportKey}/odds?regions=uk,eu&markets=${markets}&oddsFormat=decimal`);
    if (!Array.isArray(data)) return [];
    return data.map(parseOddsEvent);
  } catch (e) {
    console.error(`Odds API failed for ${sportKey}:`, e);
    return [];
  }
}

/**
 * Get all soccer odds across major leagues
 */
export async function getAllSoccerOdds(sportKeys?: string[]): Promise<OddsEvent[]> {
  const keys = sportKeys || ODDS_SPORT_KEYS.map(s => s.key);
  
  // Fetch in parallel (each counts as 1 request toward monthly quota)
  const results = await Promise.allSettled(
    keys.map(key => getOdds(key))
  );

  const allEvents: OddsEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }
  return allEvents;
}

/**
 * Get events (fixtures) only, without odds (uses less quota)
 */
export async function getEvents(sportKey: string): Promise<OddsEvent[]> {
  try {
    const data = await apiFetch(`/sports/${sportKey}/events`);
    if (!Array.isArray(data)) return [];
    return data.map((e: any) => ({
      id: e.id,
      sportKey: e.sport_key,
      homeTeam: e.home_team || '',
      awayTeam: e.away_team || '',
      kickOff: e.commence_time || '',
      league: ODDS_SPORT_KEYS.find(s => s.key === e.sport_key)?.name || e.sport_title || '',
      bookmakers: [],
      bestOdds: null,
    }));
  } catch (e) {
    console.error(`Odds API events failed for ${sportKey}:`, e);
    return [];
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OddsEvent {
  id: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  kickOff: string; // ISO date
  league: string;
  bookmakers: BookmakerOdds[];
  bestOdds: { home: number; draw: number; away: number } | null;
}

export interface BookmakerOdds {
  name: string;
  home: number;
  draw: number;
  away: number;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseOddsEvent(raw: any): OddsEvent {
  const bookmakers: BookmakerOdds[] = [];
  let bestHome = 0, bestDraw = 0, bestAway = 0;

  for (const bookie of raw.bookmakers || []) {
    const h2hMarket = bookie.markets?.find((m: any) => m.key === 'h2h');
    if (!h2hMarket) continue;

    let home = 0, draw = 0, away = 0;
    for (const outcome of h2hMarket.outcomes || []) {
      const price = outcome.price || 0;
      if (outcome.name === raw.home_team) { home = price; if (price > bestHome) bestHome = price; }
      else if (outcome.name === raw.away_team) { away = price; if (price > bestAway) bestAway = price; }
      else if (outcome.name === 'Draw') { draw = price; if (price > bestDraw) bestDraw = price; }
    }
    bookmakers.push({ name: bookie.title || bookie.key, home, draw, away });
  }

  return {
    id: raw.id,
    sportKey: raw.sport_key,
    homeTeam: raw.home_team || '',
    awayTeam: raw.away_team || '',
    kickOff: raw.commence_time || '',
    league: ODDS_SPORT_KEYS.find(s => s.key === raw.sport_key)?.name || raw.sport_title || '',
    bookmakers,
    bestOdds: (bestHome > 0 || bestAway > 0) ? { home: bestHome, draw: bestDraw, away: bestAway } : null,
  };
}

// ─── Value Detection ─────────────────────────────────────────────────────────

/**
 * Find odds for a specific match by team names (fuzzy match)
 */
export function findMatchOdds(
  events: OddsEvent[],
  homeTeam: string,
  awayTeam: string
): { home: number; draw: number; away: number } | null {
  const homeLower = homeTeam.toLowerCase();
  const awayLower = awayTeam.toLowerCase();

  const event = events.find(e => {
    const h = e.homeTeam.toLowerCase();
    const a = e.awayTeam.toLowerCase();
    return (h.includes(homeLower) || homeLower.includes(h)) &&
           (a.includes(awayLower) || awayLower.includes(a));
  });

  return event?.bestOdds || null;
}

/**
 * Detect value: when model confidence implies lower odds than market offers.
 * Value = market offers better price than what your confidence says is fair.
 */
export function detectValue(
  confidence: number,
  marketOdds: number
): { isValue: boolean; edge: number } {
  // Convert confidence (0-100) to implied fair odds
  const fairOdds = 100 / Math.max(confidence, 1);
  // Edge = how much better market odds are vs fair odds (%)
  const edge = ((marketOdds - fairOdds) / fairOdds) * 100;
  return {
    isValue: edge >= 5, // 5%+ edge = value
    edge: Math.round(edge * 10) / 10,
  };
}
