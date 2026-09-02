/**
 * Unified League Registry — Single source of truth for all football leagues.
 *
 * Maps every league across all providers:
 *   - ESPN CDN slug (scoreboard)
 *   - TheSportsDB league ID (form, H2H)
 *   - Football-Data.org competition code (standings, fixtures — key required)
 *   - API-Football league ID (predictions — key required)
 *   - KickoffAPI league ID (H2H, stats — key required)
 *   - Odds-API sport key (market odds — key required)
 *
 * Null means "this provider doesn't cover this league".
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type LeagueTier = 1 | 2 | 3;

export type LeagueRegion =
  | 'England'
  | 'Spain'
  | 'Germany'
  | 'Italy'
  | 'France'
  | 'Netherlands'
  | 'Portugal'
  | 'Scotland'
  | 'Belgium'
  | 'Turkey'
  | 'Greece'
  | 'Austria'
  | 'Scandinavia'
  | 'Eastern Europe'
  | 'USA & Canada'
  | 'Mexico'
  | 'South America'
  | 'Africa'
  | 'Middle East'
  | 'Asia'
  | 'Oceania'
  | 'Europe (Cups)'
  | 'International';

export interface LeagueEntry {
  id: string;                        // Unique internal ID (kebab-case)
  name: string;                      // Display name
  region: LeagueRegion;              // Geographic group
  tier: LeagueTier;                  // 1=top, 2=secondary, 3=cups/international
  // Provider IDs (null = not covered by this provider)
  espnSlug: string | null;           // ESPN CDN league slug
  sportsDbId: string | null;         // TheSportsDB numeric league ID
  footballDataCode: string | null;   // Football-Data.org competition code
  apiFootballId: number | null;      // API-Football league ID (same as KickoffAPI)
  oddsApiKey: string | null;         // The Odds API sport key
}

// ─── Regional Presets ────────────────────────────────────────────────────────

export interface RegionalPreset {
  id: string;
  name: string;
  description: string;
  leagueIds: string[];
}

export const REGIONAL_PRESETS: RegionalPreset[] = [
  {
    id: 'europe-top5',
    name: 'Europe Top 5',
    description: 'EPL, La Liga, Bundesliga, Serie A, Ligue 1',
    leagueIds: ['eng-premier-league', 'esp-la-liga', 'ger-bundesliga', 'ita-serie-a', 'fra-ligue-1'],
  },
  {
    id: 'england-all',
    name: 'All England',
    description: 'Premier League, Championship, League One, FA Cup, Carabao Cup',
    leagueIds: ['eng-premier-league', 'eng-championship', 'eng-league-one', 'eng-fa-cup', 'eng-carabao-cup'],
  },
  {
    id: 'europe-cups',
    name: 'European Cups',
    description: 'Champions League, Europa League, Conference League',
    leagueIds: ['uefa-champions-league', 'uefa-europa-league', 'uefa-conference-league'],
  },
  {
    id: 'south-america',
    name: 'South America',
    description: 'Brazil, Argentina, Colombia, Libertadores, Sudamericana',
    leagueIds: ['bra-serie-a', 'arg-liga-profesional', 'col-primera-a', 'conmebol-libertadores', 'conmebol-sudamericana'],
  },
  {
    id: 'scandinavia',
    name: 'Scandinavia',
    description: 'Denmark, Norway, Sweden',
    leagueIds: ['den-superliga', 'nor-eliteserien', 'swe-allsvenskan'],
  },
  {
    id: 'africa',
    name: 'Africa',
    description: 'South Africa, CAF Champions League, AFCON',
    leagueIds: ['rsa-premiership', 'caf-champions-league', 'caf-nations'],
  },
  {
    id: 'asia-middle-east',
    name: 'Asia & Middle East',
    description: 'Saudi Pro League, J-League, AFC Champions League',
    leagueIds: ['ksa-pro-league', 'jpn-j-league', 'ind-super-league', 'afc-champions-league'],
  },
  {
    id: 'americas',
    name: 'Americas',
    description: 'MLS, Liga MX, Concacaf Champions Cup',
    leagueIds: ['usa-mls', 'mex-liga-mx', 'concacaf-champions-cup'],
  },
  {
    id: 'world-cups',
    name: 'World & Continental',
    description: 'World Cup, Euros, Copa America, AFCON, Nations League',
    leagueIds: ['fifa-world-cup', 'uefa-euro', 'conmebol-copa-america', 'caf-nations', 'uefa-nations-league', 'concacaf-gold-cup'],
  },
  {
    id: 'all-tier1',
    name: 'All Top Leagues',
    description: 'All Tier 1 leagues worldwide',
    leagueIds: [], // Dynamically filled
  },
];

// ─── League Data ─────────────────────────────────────────────────────────────

export const LEAGUE_REGISTRY: LeagueEntry[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1 — Major Leagues (always fetch, full provider coverage)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'eng-premier-league',
    name: 'Premier League',
    region: 'England',
    tier: 1,
    espnSlug: 'eng.1',
    sportsDbId: '4328',
    footballDataCode: 'PL',
    apiFootballId: 39,
    oddsApiKey: 'soccer_epl',
  },
  {
    id: 'esp-la-liga',
    name: 'La Liga',
    region: 'Spain',
    tier: 1,
    espnSlug: 'esp.1',
    sportsDbId: '4335',
    footballDataCode: 'PD',
    apiFootballId: 140,
    oddsApiKey: 'soccer_spain_la_liga',
  },
  {
    id: 'ger-bundesliga',
    name: 'Bundesliga',
    region: 'Germany',
    tier: 1,
    espnSlug: 'ger.1',
    sportsDbId: '4331',
    footballDataCode: 'BL1',
    apiFootballId: 78,
    oddsApiKey: 'soccer_germany_bundesliga',
  },
  {
    id: 'ita-serie-a',
    name: 'Serie A',
    region: 'Italy',
    tier: 1,
    espnSlug: 'ita.1',
    sportsDbId: '4332',
    footballDataCode: 'SA',
    apiFootballId: 135,
    oddsApiKey: 'soccer_italy_serie_a',
  },
  {
    id: 'fra-ligue-1',
    name: 'Ligue 1',
    region: 'France',
    tier: 1,
    espnSlug: 'fra.1',
    sportsDbId: '4334',
    footballDataCode: 'FL1',
    apiFootballId: 61,
    oddsApiKey: 'soccer_france_ligue_one',
  },
  {
    id: 'ned-eredivisie',
    name: 'Eredivisie',
    region: 'Netherlands',
    tier: 1,
    espnSlug: 'ned.1',
    sportsDbId: '4337',
    footballDataCode: 'DED',
    apiFootballId: 88,
    oddsApiKey: 'soccer_netherlands_eredivisie',
  },
  {
    id: 'por-primeira-liga',
    name: 'Primeira Liga',
    region: 'Portugal',
    tier: 1,
    espnSlug: 'por.1',
    sportsDbId: '4344',
    footballDataCode: 'PPL',
    apiFootballId: 94,
    oddsApiKey: 'soccer_portugal_primeira_liga',
  },
  {
    id: 'usa-mls',
    name: 'MLS',
    region: 'USA & Canada',
    tier: 1,
    espnSlug: 'usa.1',
    sportsDbId: '4346',
    footballDataCode: null,
    apiFootballId: 253,
    oddsApiKey: 'soccer_usa_mls',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2 — Secondary Leagues (good coverage, key enhances)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'eng-championship',
    name: 'Championship',
    region: 'England',
    tier: 2,
    espnSlug: 'eng.2',
    sportsDbId: '4329',
    footballDataCode: 'ELC',
    apiFootballId: 40,
    oddsApiKey: 'soccer_efl_champ',
  },
  {
    id: 'eng-league-one',
    name: 'League One',
    region: 'England',
    tier: 2,
    espnSlug: 'eng.3',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 41,
    oddsApiKey: null,
  },
  {
    id: 'esp-la-liga-2',
    name: 'La Liga 2',
    region: 'Spain',
    tier: 2,
    espnSlug: 'esp.2',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 141,
    oddsApiKey: null,
  },
  {
    id: 'ger-2-bundesliga',
    name: '2. Bundesliga',
    region: 'Germany',
    tier: 2,
    espnSlug: 'ger.2',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 79,
    oddsApiKey: 'soccer_germany_bundesliga2',
  },
  {
    id: 'ita-serie-b',
    name: 'Serie B',
    region: 'Italy',
    tier: 2,
    espnSlug: 'ita.2',
    sportsDbId: '4394',
    footballDataCode: null,
    apiFootballId: 136,
    oddsApiKey: null,
  },
  {
    id: 'fra-ligue-2',
    name: 'Ligue 2',
    region: 'France',
    tier: 2,
    espnSlug: 'fra.2',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 62,
    oddsApiKey: null,
  },
  {
    id: 'sco-premiership',
    name: 'Scottish Premiership',
    region: 'Scotland',
    tier: 2,
    espnSlug: 'sco.1',
    sportsDbId: '4330',
    footballDataCode: null,
    apiFootballId: 179,
    oddsApiKey: 'soccer_spl',
  },
  {
    id: 'bel-pro-league',
    name: 'Belgian Pro League',
    region: 'Belgium',
    tier: 2,
    espnSlug: 'bel.1',
    sportsDbId: '4355',
    footballDataCode: null,
    apiFootballId: 144,
    oddsApiKey: 'soccer_belgium_first_div',
  },
  {
    id: 'tur-super-lig',
    name: 'Turkish Super Lig',
    region: 'Turkey',
    tier: 2,
    espnSlug: 'tur.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 203,
    oddsApiKey: 'soccer_turkey_super_league',
  },
  {
    id: 'gre-super-league',
    name: 'Greek Super League',
    region: 'Greece',
    tier: 2,
    espnSlug: 'gre.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 197,
    oddsApiKey: 'soccer_greece_super_league',
  },
  {
    id: 'aut-bundesliga',
    name: 'Austrian Bundesliga',
    region: 'Austria',
    tier: 2,
    espnSlug: 'aut.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 218,
    oddsApiKey: null,
  },
  {
    id: 'den-superliga',
    name: 'Danish Superliga',
    region: 'Scandinavia',
    tier: 2,
    espnSlug: 'den.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 119,
    oddsApiKey: 'soccer_denmark_superliga',
  },
  {
    id: 'nor-eliteserien',
    name: 'Norwegian Eliteserien',
    region: 'Scandinavia',
    tier: 2,
    espnSlug: 'nor.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 103,
    oddsApiKey: 'soccer_norway_eliteserien',
  },
  {
    id: 'swe-allsvenskan',
    name: 'Swedish Allsvenskan',
    region: 'Scandinavia',
    tier: 2,
    espnSlug: 'swe.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 113,
    oddsApiKey: 'soccer_sweden_allsvenskan',
  },
  {
    id: 'rus-premier-league',
    name: 'Russian Premier League',
    region: 'Eastern Europe',
    tier: 2,
    espnSlug: 'rus.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 235,
    oddsApiKey: null,
  },
  {
    id: 'ksa-pro-league',
    name: 'Saudi Pro League',
    region: 'Middle East',
    tier: 2,
    espnSlug: 'ksa.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 307,
    oddsApiKey: null,
  },
  {
    id: 'jpn-j-league',
    name: 'J.League',
    region: 'Asia',
    tier: 2,
    espnSlug: 'jpn.1',
    sportsDbId: '4350',
    footballDataCode: null,
    apiFootballId: 98,
    oddsApiKey: 'soccer_japan_j_league',
  },
  {
    id: 'aus-a-league',
    name: 'A-League Men',
    region: 'Oceania',
    tier: 2,
    espnSlug: 'aus.1',
    sportsDbId: '4356',
    footballDataCode: null,
    apiFootballId: 188,
    oddsApiKey: 'soccer_australia_aleague',
  },
  {
    id: 'arg-liga-profesional',
    name: 'Liga Profesional',
    region: 'South America',
    tier: 2,
    espnSlug: 'arg.1',
    sportsDbId: '4406',
    footballDataCode: null,
    apiFootballId: 128,
    oddsApiKey: 'soccer_argentina_primera_division',
  },
  {
    id: 'bra-serie-a',
    name: 'Serie A Brazil',
    region: 'South America',
    tier: 2,
    espnSlug: 'bra.1',
    sportsDbId: '4351',
    footballDataCode: 'BSA',
    apiFootballId: 71,
    oddsApiKey: 'soccer_brazil_serie_a',
  },
  {
    id: 'mex-liga-mx',
    name: 'Liga MX',
    region: 'Mexico',
    tier: 2,
    espnSlug: 'mex.1',
    sportsDbId: '4350',
    footballDataCode: null,
    apiFootballId: 262,
    oddsApiKey: 'soccer_mexico_ligamx',
  },
  {
    id: 'col-primera-a',
    name: 'Primera A',
    region: 'South America',
    tier: 2,
    espnSlug: 'col.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 239,
    oddsApiKey: null,
  },
  {
    id: 'rsa-premiership',
    name: 'SA Premiership',
    region: 'Africa',
    tier: 2,
    espnSlug: 'rsa.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 288,
    oddsApiKey: null,
  },
  {
    id: 'ind-super-league',
    name: 'Indian Super League',
    region: 'Asia',
    tier: 2,
    espnSlug: 'ind.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 323,
    oddsApiKey: null,
  },
  {
    id: 'chn-super-league',
    name: 'Chinese Super League',
    region: 'Asia',
    tier: 2,
    espnSlug: 'chn.1',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 169,
    oddsApiKey: null,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3 — Cups, International, Qualifiers
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'uefa-champions-league',
    name: 'Champions League',
    region: 'Europe (Cups)',
    tier: 3,
    espnSlug: 'uefa.champions',
    sportsDbId: '4480',
    footballDataCode: 'CL',
    apiFootballId: 2,
    oddsApiKey: 'soccer_uefa_champs_league',
  },
  {
    id: 'uefa-europa-league',
    name: 'Europa League',
    region: 'Europe (Cups)',
    tier: 3,
    espnSlug: 'uefa.europa',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 3,
    oddsApiKey: 'soccer_uefa_europa_league',
  },
  {
    id: 'uefa-conference-league',
    name: 'Conference League',
    region: 'Europe (Cups)',
    tier: 3,
    espnSlug: 'uefa.europa.conf',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 848,
    oddsApiKey: null,
  },
  {
    id: 'conmebol-libertadores',
    name: 'Copa Libertadores',
    region: 'South America',
    tier: 3,
    espnSlug: 'conmebol.libertadores',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 13,
    oddsApiKey: 'soccer_conmebol_copa_libertadores',
  },
  {
    id: 'conmebol-sudamericana',
    name: 'Copa Sudamericana',
    region: 'South America',
    tier: 3,
    espnSlug: 'conmebol.sudamericana',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 11,
    oddsApiKey: null,
  },
  {
    id: 'concacaf-champions-cup',
    name: 'Concacaf Champions Cup',
    region: 'USA & Canada',
    tier: 3,
    espnSlug: 'concacaf.champions',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 16,
    oddsApiKey: null,
  },
  {
    id: 'afc-champions-league',
    name: 'AFC Champions League',
    region: 'Asia',
    tier: 3,
    espnSlug: 'afc.champions',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 17,
    oddsApiKey: null,
  },
  {
    id: 'caf-champions-league',
    name: 'CAF Champions League',
    region: 'Africa',
    tier: 3,
    espnSlug: 'caf.champions',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 14,
    oddsApiKey: null,
  },
  {
    id: 'eng-fa-cup',
    name: 'FA Cup',
    region: 'England',
    tier: 3,
    espnSlug: 'eng.fa',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 45,
    oddsApiKey: 'soccer_fa_cup',
  },
  {
    id: 'eng-carabao-cup',
    name: 'Carabao Cup',
    region: 'England',
    tier: 3,
    espnSlug: 'eng.league_cup',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 48,
    oddsApiKey: null,
  },
  {
    id: 'esp-copa-del-rey',
    name: 'Copa del Rey',
    region: 'Spain',
    tier: 3,
    espnSlug: 'esp.copa_del_rey',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 143,
    oddsApiKey: null,
  },
  {
    id: 'ger-dfb-pokal',
    name: 'DFB-Pokal',
    region: 'Germany',
    tier: 3,
    espnSlug: 'ger.dfb_pokal',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 81,
    oddsApiKey: null,
  },
  {
    id: 'ita-coppa-italia',
    name: 'Coppa Italia',
    region: 'Italy',
    tier: 3,
    espnSlug: 'ita.coppa_italia',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 137,
    oddsApiKey: null,
  },
  {
    id: 'fra-coupe-de-france',
    name: 'Coupe de France',
    region: 'France',
    tier: 3,
    espnSlug: 'fra.coupe_de_france',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 66,
    oddsApiKey: null,
  },
  {
    id: 'fifa-world-cup',
    name: 'FIFA World Cup',
    region: 'International',
    tier: 3,
    espnSlug: 'fifa.world',
    sportsDbId: '4429',
    footballDataCode: 'WC',
    apiFootballId: 1,
    oddsApiKey: 'soccer_fifa_world_cup',
  },
  {
    id: 'uefa-euro',
    name: 'UEFA Euro',
    region: 'International',
    tier: 3,
    espnSlug: 'uefa.euro',
    sportsDbId: null,
    footballDataCode: 'EC',
    apiFootballId: 4,
    oddsApiKey: 'soccer_uefa_european_championship',
  },
  {
    id: 'conmebol-copa-america',
    name: 'Copa America',
    region: 'International',
    tier: 3,
    espnSlug: 'conmebol.america',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 9,
    oddsApiKey: 'soccer_conmebol_copa_america',
  },
  {
    id: 'caf-nations',
    name: 'Africa Cup of Nations',
    region: 'International',
    tier: 3,
    espnSlug: 'caf.nations',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 6,
    oddsApiKey: null,
  },
  {
    id: 'concacaf-gold-cup',
    name: 'Concacaf Gold Cup',
    region: 'International',
    tier: 3,
    espnSlug: 'concacaf.gold',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 22,
    oddsApiKey: null,
  },
  {
    id: 'uefa-nations-league',
    name: 'UEFA Nations League',
    region: 'International',
    tier: 3,
    espnSlug: 'uefa.nations',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 5,
    oddsApiKey: 'soccer_uefa_nations_league',
  },
  {
    id: 'fifa-wcq-uefa',
    name: 'WCQ - UEFA',
    region: 'International',
    tier: 3,
    espnSlug: 'fifa.worldq.uefa',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 32,
    oddsApiKey: null,
  },
  {
    id: 'fifa-wcq-conmebol',
    name: 'WCQ - CONMEBOL',
    region: 'International',
    tier: 3,
    espnSlug: 'fifa.worldq.conmebol',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 34,
    oddsApiKey: null,
  },
  {
    id: 'usa-nwsl',
    name: 'NWSL',
    region: 'USA & Canada',
    tier: 3,
    espnSlug: 'usa.nwsl',
    sportsDbId: null,
    footballDataCode: null,
    apiFootballId: 254,
    oddsApiKey: null,
  },
];

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Get all leagues, optionally filtered by tier.
 */
export function getLeagues(tier?: LeagueTier): LeagueEntry[] {
  if (tier) return LEAGUE_REGISTRY.filter(l => l.tier === tier);
  return [...LEAGUE_REGISTRY];
}

/**
 * Get leagues by region.
 */
export function getLeaguesByRegion(region: LeagueRegion): LeagueEntry[] {
  return LEAGUE_REGISTRY.filter(l => l.region === region);
}

/**
 * Get all unique regions in order.
 */
export function getAllRegions(): LeagueRegion[] {
  const regions = new Set<LeagueRegion>();
  for (const league of LEAGUE_REGISTRY) regions.add(league.region);
  return Array.from(regions);
}

/**
 * Get leagues that have coverage from a specific provider.
 */
export function getLeaguesWithProvider(provider: 'espn' | 'sportsDb' | 'footballData' | 'apiFootball' | 'oddsApi'): LeagueEntry[] {
  switch (provider) {
    case 'espn': return LEAGUE_REGISTRY.filter(l => l.espnSlug !== null);
    case 'sportsDb': return LEAGUE_REGISTRY.filter(l => l.sportsDbId !== null);
    case 'footballData': return LEAGUE_REGISTRY.filter(l => l.footballDataCode !== null);
    case 'apiFootball': return LEAGUE_REGISTRY.filter(l => l.apiFootballId !== null);
    case 'oddsApi': return LEAGUE_REGISTRY.filter(l => l.oddsApiKey !== null);
  }
}

/**
 * Find a league by any provider ID.
 */
export function findLeague(query: {
  espnSlug?: string;
  sportsDbId?: string;
  footballDataCode?: string;
  apiFootballId?: number;
  id?: string;
}): LeagueEntry | undefined {
  if (query.id) return LEAGUE_REGISTRY.find(l => l.id === query.id);
  if (query.espnSlug) return LEAGUE_REGISTRY.find(l => l.espnSlug === query.espnSlug);
  if (query.sportsDbId) return LEAGUE_REGISTRY.find(l => l.sportsDbId === query.sportsDbId);
  if (query.footballDataCode) return LEAGUE_REGISTRY.find(l => l.footballDataCode === query.footballDataCode);
  if (query.apiFootballId) return LEAGUE_REGISTRY.find(l => l.apiFootballId === query.apiFootballId);
  return undefined;
}

/**
 * Search leagues by name or region (case-insensitive).
 */
export function searchLeagues(query: string): LeagueEntry[] {
  const q = query.toLowerCase();
  return LEAGUE_REGISTRY.filter(l =>
    l.name.toLowerCase().includes(q) ||
    l.region.toLowerCase().includes(q) ||
    l.id.includes(q)
  );
}

/**
 * Get leagues for a regional preset.
 */
export function getPresetLeagues(presetId: string): LeagueEntry[] {
  const preset = REGIONAL_PRESETS.find(p => p.id === presetId);
  if (!preset) return [];

  // Special case: "all-tier1" dynamically returns all tier 1 leagues
  if (presetId === 'all-tier1') return getLeagues(1);

  return LEAGUE_REGISTRY.filter(l => preset.leagueIds.includes(l.id));
}

/**
 * Get the ESPN slugs for a set of league IDs (for fetching fixtures).
 */
export function getEspnSlugs(leagueIds: string[]): string[] {
  return LEAGUE_REGISTRY
    .filter(l => leagueIds.includes(l.id) && l.espnSlug !== null)
    .map(l => l.espnSlug!);
}

/**
 * Get the Football-Data.org codes for a set of league IDs.
 */
export function getFootballDataCodes(leagueIds: string[]): string[] {
  return LEAGUE_REGISTRY
    .filter(l => leagueIds.includes(l.id) && l.footballDataCode !== null)
    .map(l => l.footballDataCode!);
}

/**
 * Get TheSportsDB IDs for a set of league IDs.
 */
export function getSportsDbIds(leagueIds: string[]): string[] {
  return LEAGUE_REGISTRY
    .filter(l => leagueIds.includes(l.id) && l.sportsDbId !== null)
    .map(l => l.sportsDbId!);
}

/**
 * Get API-Football IDs for a set of league IDs.
 */
export function getApiFootballIds(leagueIds: string[]): number[] {
  return LEAGUE_REGISTRY
    .filter(l => leagueIds.includes(l.id) && l.apiFootballId !== null)
    .map(l => l.apiFootballId!);
}

/**
 * Get Odds-API sport keys for a set of league IDs.
 */
export function getOddsApiKeys(leagueIds: string[]): string[] {
  return LEAGUE_REGISTRY
    .filter(l => leagueIds.includes(l.id) && l.oddsApiKey !== null)
    .map(l => l.oddsApiKey!);
}

/**
 * Count how many providers cover a league (useful for showing data quality).
 */
export function getProviderCount(league: LeagueEntry): number {
  let count = 0;
  if (league.espnSlug) count++;
  if (league.sportsDbId) count++;
  if (league.footballDataCode) count++;
  if (league.apiFootballId) count++;
  if (league.oddsApiKey) count++;
  return count;
}

/**
 * Get a display-friendly provider coverage summary.
 */
export function getProviderCoverage(league: LeagueEntry): string[] {
  const providers: string[] = [];
  if (league.espnSlug) providers.push('ESPN');
  if (league.sportsDbId) providers.push('TheSportsDB');
  if (league.footballDataCode) providers.push('Football-Data');
  if (league.apiFootballId) providers.push('API-Football');
  if (league.oddsApiKey) providers.push('Odds-API');
  return providers;
}
