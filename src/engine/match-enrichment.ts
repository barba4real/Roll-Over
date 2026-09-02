/**
 * Match Enrichment Engine
 * 
 * Fetches detailed match stats from Flashscore match detail pages:
 * - HT/FT scores
 * - Goal scorers with minutes
 * - Cards (yellow/red) with minutes
 * - Possession, corners, shots, xG
 * 
 * Results are cached in localStorage for instant tooltip access.
 */

import { httpGetText } from '../lib/http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoalEvent {
  minute: string;       // "70'" or "45+2'"
  scorer: string;       // "Lee Kang-In"
  assist: string | null; // "Hancko D." or null
  team: 'home' | 'away';
}

export interface CardEvent {
  minute: string;
  player: string;
  type: 'yellow' | 'red';
  team: 'home' | 'away';
}

export interface MatchStats {
  possession: [number, number] | null;       // [home%, away%]
  shots: [number, number] | null;            // [home, away] total
  shotsOnTarget: [number, number] | null;
  corners: [number, number] | null;
  fouls: [number, number] | null;
  xG: [number, number] | null;
  passes: [string, string] | null;           // ["88% (455/520)", "85% (395/467)"]
  offsides: [number, number] | null;
}

export interface EnrichedMatchData {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  ftScore: [number, number];                 // [home, away]
  htScore: [number, number] | null;          // [home, away] at half-time
  goals: GoalEvent[];
  cards: CardEvent[];
  stats: MatchStats;
  firstGoalMinute: number | null;            // Minute of first goal in match
  fetchedAt: number;                         // Timestamp
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_KEY = 'rollover_match_enrichment';
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

let memoryCache: Map<string, EnrichedMatchData> = new Map();
let cacheLoaded = false;

function loadCache(): void {
  if (cacheLoaded) return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const entries: EnrichedMatchData[] = JSON.parse(raw);
      const now = Date.now();
      for (const entry of entries) {
        if (now - entry.fetchedAt < CACHE_MAX_AGE) {
          memoryCache.set(entry.matchId, entry);
        }
      }
    }
  } catch { /* corrupt cache, ignore */ }
  cacheLoaded = true;
}

function saveCache(): void {
  try {
    const entries = Array.from(memoryCache.values());
    // Keep only last 500 matches to prevent localStorage bloat
    const sorted = entries.sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 500);
    localStorage.setItem(CACHE_KEY, JSON.stringify(sorted));
  } catch { /* storage full, ignore */ }
}

/**
 * Get cached enrichment data for a match.
 */
export function getCachedEnrichment(matchId: string): EnrichedMatchData | null {
  loadCache();
  return memoryCache.get(matchId) || null;
}

/**
 * Get cached enrichment data by team names (fuzzy match).
 */
export function getCachedEnrichmentByTeams(homeTeam: string, awayTeam: string): EnrichedMatchData | null {
  loadCache();
  const homeNorm = homeTeam.toLowerCase();
  const awayNorm = awayTeam.toLowerCase();
  for (const data of memoryCache.values()) {
    const h = data.homeTeam.toLowerCase();
    const a = data.awayTeam.toLowerCase();
    if ((h.includes(homeNorm) || homeNorm.includes(h) || h.includes(homeNorm.split(' ')[0])) &&
        (a.includes(awayNorm) || awayNorm.includes(a) || a.includes(awayNorm.split(' ')[0]))) {
      return data;
    }
  }
  return null;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.flashscore.mobi';

/**
 * Fetch and parse detailed match data from Flashscore.
 * Fetches both the summary page (goals, cards, HT score) and stats page (possession, corners, etc.)
 */
export async function fetchMatchEnrichment(matchId: string): Promise<EnrichedMatchData | null> {
  // Check cache first
  const cached = getCachedEnrichment(matchId);
  if (cached) return cached;

  try {
    // Fetch summary page (goals, cards, HT/FT)
    const summaryRes = await httpGetText(`${BASE_URL}/match/${matchId}/`, {});
    if (!summaryRes.text || summaryRes.text.length < 1000) return null;

    const summary = parseSummaryPage(summaryRes.text, matchId);
    if (!summary) return null;

    // Fetch stats page (possession, corners, shots)
    let stats: MatchStats = {
      possession: null, shots: null, shotsOnTarget: null,
      corners: null, fouls: null, xG: null, passes: null, offsides: null
    };
    try {
      const statsRes = await httpGetText(`${BASE_URL}/match/${matchId}/?t=stats`, {});
      if (statsRes.text && statsRes.text.length > 1000) {
        stats = parseStatsPage(statsRes.text);
      }
    } catch { /* stats are optional */ }

    const enriched: EnrichedMatchData = {
      ...summary,
      stats,
      fetchedAt: Date.now(),
    };

    // Cache it
    memoryCache.set(matchId, enriched);
    saveCache();

    return enriched;
  } catch (e) {
    console.warn(`[Enrichment] Failed for match ${matchId}:`, e);
    return null;
  }
}

/**
 * Batch fetch enrichment for multiple matches.
 * Delays between requests to avoid rate limiting.
 */
export async function batchFetchEnrichment(matchIds: string[]): Promise<Map<string, EnrichedMatchData>> {
  const results = new Map<string, EnrichedMatchData>();

  for (const id of matchIds) {
    // Skip if already cached
    const cached = getCachedEnrichment(id);
    if (cached) {
      results.set(id, cached);
      continue;
    }

    const data = await fetchMatchEnrichment(id);
    if (data) results.set(id, data);

    // 500ms delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseSummaryPage(html: string, matchId: string): Omit<EnrichedMatchData, 'stats' | 'fetchedAt'> | null {
  // Extract teams from <h3>
  const teamsMatch = html.match(/<h3>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?\s*-\s*(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/h3>/);
  if (!teamsMatch) return null;
  const homeTeam = teamsMatch[1].trim();
  const awayTeam = teamsMatch[2].trim();

  // Extract FT score and HT from: <div class="detail"><b>2-0</b>  (0-0,2-0)</div>
  const scoreMatch = html.match(/<div class="detail"><b>(\d+)-(\d+)<\/b>\s*\((\d+)-(\d+),(\d+)-(\d+)\)<\/div>/);
  let ftScore: [number, number] = [0, 0];
  let htScore: [number, number] | null = null;

  if (scoreMatch) {
    ftScore = [parseInt(scoreMatch[1]), parseInt(scoreMatch[2])];
    htScore = [parseInt(scoreMatch[3]), parseInt(scoreMatch[4])];
  } else {
    // Try simpler format: <b>2-0</b>
    const simpleScore = html.match(/<div class="detail"><b>(\d+)-(\d+)<\/b>/);
    if (simpleScore) {
      ftScore = [parseInt(simpleScore[1]), parseInt(simpleScore[2])];
    }
  }

  // Try to get HT from half headers: <h4>1st Half: <b>0-0</b></h4>
  if (!htScore) {
    const htMatch = html.match(/1st Half:\s*<b>(\d+)-(\d+)<\/b>/);
    if (htMatch) {
      htScore = [parseInt(htMatch[1]), parseInt(htMatch[2])];
    }
  }

  // Parse goals: <p class="i-field icon ball">&nbsp;</p>PlayerName (Assist) () [TEAM]
  const goalRegex = /<p class="i-field time(?:-wide)?">(\d+'?\+?\d*'?)<\/p><p class="i-field icon ball">&nbsp;<\/p>([^(]+?)(?:\s*\(([^)]*)\))?\s*(?:\([^)]*\))?\s*\[([A-Z]+)\]/g;
  let goalMatch;
  // First pass: collect all goals with their team codes
  const rawGoals: { minute: string; scorer: string; assist: string | null; teamCode: string }[] = [];
  while ((goalMatch = goalRegex.exec(html)) !== null) {
    rawGoals.push({
      minute: goalMatch[1],
      scorer: goalMatch[2].trim(),
      assist: goalMatch[3]?.trim() && goalMatch[3].trim().length > 0 ? goalMatch[3].trim() : null,
      teamCode: goalMatch[4],
    });
  }

  // Determine which team code is home vs away
  // Strategy: count goals per code and match against FT score
  const teamCodes = [...new Set(rawGoals.map(g => g.teamCode))];
  let homeCode = '';
  let awayCode = '';

  if (teamCodes.length === 2) {
    const code1Count = rawGoals.filter(g => g.teamCode === teamCodes[0]).length;
    const code2Count = rawGoals.filter(g => g.teamCode === teamCodes[1]).length;
    // Match counts to FT score
    if (code1Count === ftScore[0] && code2Count === ftScore[1]) {
      homeCode = teamCodes[0];
      awayCode = teamCodes[1];
    } else if (code2Count === ftScore[0] && code1Count === ftScore[1]) {
      homeCode = teamCodes[1];
      awayCode = teamCodes[0];
    } else {
      // Fallback: first code encountered is likely home (appears first in page)
      homeCode = teamCodes[0];
      awayCode = teamCodes[1];
    }
  } else if (teamCodes.length === 1) {
    // All goals from one team
    const codeCount = rawGoals.length;
    if (codeCount === ftScore[0]) homeCode = teamCodes[0];
    else if (codeCount === ftScore[1]) awayCode = teamCodes[0];
    else homeCode = teamCodes[0]; // fallback
  }

  // Also try to extract team codes from card events (broader coverage)
  const cardCodesRegex = /\[([A-Z]{2,5})\]/g;
  let codeMatch;
  const allCodes = new Set<string>();
  while ((codeMatch = cardCodesRegex.exec(html)) !== null) {
    allCodes.add(codeMatch[1]);
  }
  // If we only found one code from goals, try to find the other from all events
  if (homeCode && !awayCode) {
    for (const code of allCodes) {
      if (code !== homeCode) { awayCode = code; break; }
    }
  } else if (!homeCode && awayCode) {
    for (const code of allCodes) {
      if (code !== awayCode) { homeCode = code; break; }
    }
  } else if (!homeCode && !awayCode && allCodes.size >= 2) {
    const codesArr = [...allCodes];
    homeCode = codesArr[0];
    awayCode = codesArr[1];
  }

  // Convert raw goals to GoalEvents with correct team assignment
  const goals: GoalEvent[] = rawGoals.map(g => ({
    minute: g.minute,
    scorer: g.scorer,
    assist: g.assist,
    team: g.teamCode === homeCode ? 'home' : 'away',
  }));

  // Parse cards: <p class="i-field icon y-card">&nbsp;</p>PlayerName [TEAM]
  const cards: CardEvent[] = [];
  const cardRegex = /<p class="i-field time(?:-wide)?">(\d+'?\+?\d*'?)<\/p><p class="i-field icon (y-card|r-card|yr-card)">&nbsp;<\/p>([^\[]+)\[([A-Z]+)\]/g;
  let cardMatch;
  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const minute = cardMatch[1];
    const cardType = cardMatch[2];
    const player = cardMatch[3].trim();
    const teamCode = cardMatch[4];

    cards.push({
      minute,
      player,
      type: cardType.includes('r-card') || cardType === 'yr-card' ? 'red' : 'yellow',
      team: teamCode === homeCode ? 'home' : (teamCode === awayCode ? 'away' : 'home'),
    });
  }

  // First goal minute
  const firstGoalMinute = goals.length > 0
    ? parseInt(goals[0].minute.replace(/['+]/g, '')) || null
    : null;

  return {
    matchId,
    homeTeam,
    awayTeam,
    ftScore,
    htScore,
    goals,
    cards,
    firstGoalMinute,
  };
}

function parseStatsPage(html: string): MatchStats {
  const stats: MatchStats = {
    possession: null,
    shots: null,
    shotsOnTarget: null,
    corners: null,
    fouls: null,
    xG: null,
    passes: null,
    offsides: null,
  };

  // Extract stat values: pattern is [homeValue, categoryName, awayValue] repeating
  const valueRegex = /wcl-scores-simple-text-01">([^<]+)<\/span>/g;
  const values: string[] = [];
  let m;
  while ((m = valueRegex.exec(html)) !== null) {
    values.push(m[1].trim());
  }

  // Process in triplets: [home, category, away]
  for (let i = 0; i < values.length - 2; i += 3) {
    const homeVal = values[i];
    const category = values[i + 1];
    const awayVal = values[i + 2];

    switch (category) {
      case 'Ball possession':
        stats.possession = [parseInt(homeVal), parseInt(awayVal)];
        break;
      case 'Total shots':
        stats.shots = [parseInt(homeVal), parseInt(awayVal)];
        break;
      case 'Shots on target':
        stats.shotsOnTarget = [parseInt(homeVal), parseInt(awayVal)];
        break;
      case 'Corner kicks':
        stats.corners = [parseInt(homeVal), parseInt(awayVal)];
        break;
      case 'Fouls':
        stats.fouls = [parseInt(homeVal), parseInt(awayVal)];
        break;
      case 'Expected goals (xG)':
        stats.xG = [parseFloat(homeVal), parseFloat(awayVal)];
        break;
      case 'Passes':
        stats.passes = [homeVal, awayVal];
        break;
      case 'Offsides':
        stats.offsides = [parseInt(homeVal), parseInt(awayVal)];
        break;
    }

    // Only take first occurrence of each stat (avoid duplicates from detailed sections)
    if (category === 'Expected goals (xG)' && stats.xG) {
      // Skip subsequent xG entries (detailed breakdown)
    }
  }

  return stats;
}
