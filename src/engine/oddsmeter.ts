/**
 * OddsMeter Integration — Market Odds + Implied Probabilities
 *
 * Data source: https://oddsmeter.com/today-odds-list.aspx
 * Public page, server-rendered HTML, no API key needed.
 *
 * Provides, per match: bookmaker 1X2 odds AND pre-computed implied win/draw/loss
 * probabilities. This is the market "second opinion" — a consensus cross-check
 * for pasted picks, feeding the win-probability model.
 *
 * HTML structure (per match block):
 *   "Avispa Fukuoka - Urawa Red Diamonds   12:00  JAPAN J League Division 1"
 *   "2,47 3,24 3,24"   (Home / Draw / Away decimal odds, comma decimals)
 *   "39 % 29 % 32 %"   (implied Home / Draw / Away probabilities)
 */

import { httpGetHtml } from '../lib/http';

export interface OddsMeterMatch {
  homeTeam: string;
  awayTeam: string;
  kickOffText: string;   // "12:00"
  league: string;        // "JAPAN J League Division 1"
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  probHome: number | null; // 0-100
  probDraw: number | null;
  probAway: number | null;
}

const ODDS_URL = 'https://oddsmeter.com/today-odds-list.aspx';

/**
 * Fetch today's matches with market odds + implied probabilities.
 */
export async function fetchOddsMeter(): Promise<OddsMeterMatch[]> {
  try {
    const res = await httpGetHtml(ODDS_URL, { 'Accept': 'text/html' });
    if (!res.text || res.text.length < 500) return [];
    return parseOddsMeter(res.text);
  } catch (e) {
    console.warn('[OddsMeter] fetch failed:', e);
    return [];
  }
}

/**
 * Look up a specific fixture's market odds by team names (fuzzy contains match).
 * Used to cross-check a pasted pick against the market consensus.
 */
export function findOddsForMatch(
  matches: OddsMeterMatch[],
  homeTeam: string,
  awayTeam: string
): OddsMeterMatch | null {
  const h = homeTeam.toLowerCase();
  const a = awayTeam.toLowerCase();
  // Exact-ish first
  let hit = matches.find(m =>
    m.homeTeam.toLowerCase() === h && m.awayTeam.toLowerCase() === a
  );
  if (hit) return hit;
  // Fuzzy contains (handles minor naming differences)
  hit = matches.find(m => {
    const mh = m.homeTeam.toLowerCase();
    const ma = m.awayTeam.toLowerCase();
    return (mh.includes(h) || h.includes(mh)) && (ma.includes(a) || a.includes(ma));
  });
  return hit || null;
}

/**
 * Parse the OddsMeter HTML.
 *
 * The page renders each match as a text block. After stripping tags we get lines
 * like:
 *   "Avispa Fukuoka - Urawa Red Diamonds"
 *   "12:00  JAPAN J League Division 1"
 *   "2,47 3,24 3,24"          (odds, comma decimals — sometimes concatenated)
 *   "39 % 29 % 32 %"          (implied probabilities)
 *
 * We walk the text, detect a "Home - Away" line, then look ahead for the time/league,
 * odds triple, and percentage triple.
 */
function parseOddsMeter(html: string): OddsMeterMatch[] {
  const matches: OddsMeterMatch[] = [];

  // Collapse tags to newlines so text blocks become discrete lines
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A fixture line: "Home Team - Away Team" (letters both sides of " - ")
    const teamMatch = line.match(/^([A-Za-z][A-Za-z0-9.'&\- ]{1,45}?)\s+-\s+([A-Za-z][A-Za-z0-9.'&\- ]{1,45})$/);
    if (!teamMatch) continue;

    const homeTeam = teamMatch[1].trim();
    const awayTeam = teamMatch[2].trim();
    if (homeTeam.toLowerCase() === awayTeam.toLowerCase()) continue;

    // Look ahead up to ~8 lines for time/league, odds triple, percentage triple
    let kickOffText = '';
    let league = '';
    let odds: number[] = [];
    let probs: number[] = [];

    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      const l = lines[j];

      // Time + league: "12:00  JAPAN J League Division 1"
      const tm = l.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
      if (tm && !kickOffText) {
        kickOffText = tm[1];
        league = tm[2].trim();
        continue;
      }

      // Percentages: "39 %" repeated, or "39 % 29 % 32 %"
      const pctAll = l.match(/(\d{1,3})\s*%/g);
      if (pctAll && pctAll.length >= 1 && probs.length < 3) {
        for (const p of pctAll) {
          const n = parseInt(p, 10);
          if (!isNaN(n) && probs.length < 3) probs.push(n);
        }
        continue;
      }

      // Odds: comma-decimal numbers, possibly concatenated ("2,473,243,24")
      if (odds.length === 0) {
        const parsed = parseOddsTriple(l);
        if (parsed.length >= 2) odds = parsed;
      }
    }

    // Only record if we found at least odds or probabilities
    if (odds.length >= 2 || probs.length >= 2) {
      matches.push({
        homeTeam,
        awayTeam,
        kickOffText,
        league,
        oddsHome: odds[0] ?? null,
        oddsDraw: odds[1] ?? null,
        oddsAway: odds[2] ?? null,
        probHome: probs[0] ?? null,
        probDraw: probs[1] ?? null,
        probAway: probs[2] ?? null,
      });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return matches.filter(m => {
    const key = `${m.homeTeam.toLowerCase()}|${m.awayTeam.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse an odds triple from a line. OddsMeter uses comma decimals and sometimes
 * concatenates them with no separator, e.g. "2,473,243,24" → [2.47, 3.24, 3.24].
 * We split on the pattern "<digit>,<2 digits>" boundaries.
 */
function parseOddsTriple(line: string): number[] {
  // Normalise: keep only digits, commas, spaces
  const cleaned = line.replace(/[^\d,\s]/g, ' ').trim();
  if (!cleaned) return [];

  // If already space-separated (e.g. "2,47 3,24 3,24")
  if (/\s/.test(cleaned)) {
    const parts = cleaned.split(/\s+/).map(p => parseFloat(p.replace(',', '.'))).filter(n => !isNaN(n) && n >= 1 && n <= 100);
    if (parts.length >= 2) return parts.slice(0, 3);
  }

  // Concatenated form "2,473,243,24" — split into "d,dd" chunks
  const chunks = cleaned.match(/\d,\d{2}/g);
  if (chunks && chunks.length >= 2) {
    return chunks.map(c => parseFloat(c.replace(',', '.'))).filter(n => !isNaN(n)).slice(0, 3);
  }

  return [];
}
