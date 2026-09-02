/**
 * Provider Orchestrator — Unified Multi-Provider Fetch with Fallback
 *
 * Queries all available providers in priority order with automatic fallback.
 * If a provider fails, the next one in the chain is tried.
 * Results from all successful providers are merged via fixture-store.
 *
 * Provider tiers:
 *   TIER 1 (Primary — always try first):
 *     - Football-Data.org: Fixtures, standings (key required, 10 req/min)
 *     - TheSportsDB: Fixtures, past events for stats (no key, unlimited)
 *
 *   TIER 2 (Enrichment — add data when available):
 *     - KickoffAPI: Team stats, H2H, predictions (key, 100/day)
 *     - API-Football: Fixtures, predictions, team stats (key, 100/day)
 *
 *   TIER 3 (Supplementary — specific data):
 *     - ESPN: Fixtures, live scores (no key)
 *     - Odds-API: Market odds for value detection (key, 500/month)
 *
 * Strategy: Cast a wide net, merge everything, let scoring sort quality.
 */

import { ProviderFixture, mergeFixtures, UnifiedFixture } from './fixture-store';
import { getAllUpcomingMatches, getFootballDataKey } from './football-data-org';
import { getAllUpcomingEvents as getSportsDbEvents, SPORTSDB_LEAGUES } from './thesportsdb';
import { getAllUpcomingEvents as getEspnEvents } from './espn';
import { getFixturesForDays, getApiKey as getApiFootballKey, TOP_LEAGUES } from './api-football';
import { getUpcomingFixtures, getKickoffApiKey, KICKOFF_LEAGUES } from './kickoff-api';
import { fetchLeagueStats, getCachedTeamStats } from './stats-calculator';
import { fetchSkySportsFixtures } from './skysports';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  fixtures: UnifiedFixture[];
  providersUsed: string[];
  providersFailed: string[];
  errors: Record<string, string>;
  fetchedAt: string;
  totalFromEach: Record<string, number>;
}

export interface OrchestratorConfig {
  days: number;             // How many days ahead to search
  leagueCodes?: string[];   // Filter to specific leagues (Football-Data.org codes)
  useFootballData: boolean;
  useTheSportsDb: boolean;
  useEspn: boolean;
  useApiFootball: boolean;
  useKickoffApi: boolean;
  useSkySports?: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  days: 7,
  useFootballData: true,
  useTheSportsDb: true,
  useEspn: true,
  useApiFootball: true,
  useKickoffApi: true,
  useSkySports: true,
};

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Fetch fixtures from all available providers, merge with dedup, return unified list.
 * Never throws — always returns what it could get, with error details.
 */
export async function fetchAllProviders(
  config: OrchestratorConfig = DEFAULT_ORCHESTRATOR_CONFIG
): Promise<OrchestratorResult> {
  const providerResults: { provider: string; fixtures: ProviderFixture[] }[] = [];
  const providersUsed: string[] = [];
  const providersFailed: string[] = [];
  const errors: Record<string, string> = {};
  const totalFromEach: Record<string, number> = {};

  // Launch all provider fetches in parallel
  const fetches: Promise<void>[] = [];

  // ─── TIER 1: Primary Providers ─────────────────────────────────────────────

  if (config.useTheSportsDb) {
    fetches.push((async () => {
      try {
        const leagueIds = config.leagueCodes
          ? SPORTSDB_LEAGUES.filter(l =>
              config.leagueCodes!.some(code =>
                l.name.toLowerCase().includes(code.toLowerCase()) || code === l.id
              )
            ).map(l => l.id)
          : SPORTSDB_LEAGUES.map(l => l.id);

        const events = await getSportsDbEvents(leagueIds);
        const fixtures: ProviderFixture[] = events.map(e => ({
          homeTeam: e.strHomeTeam || e.homeTeam || '',
          awayTeam: e.strAwayTeam || e.awayTeam || '',
          kickOff: e.strTimestamp || e.dateEvent || '',
          league: e.leagueName || e.strLeague || '',
          leagueCode: e.leagueId || '',
        })).filter(f => f.homeTeam && f.awayTeam);

        if (fixtures.length > 0) {
          providerResults.push({ provider: 'TheSportsDB', fixtures });
          providersUsed.push('TheSportsDB');
          totalFromEach['TheSportsDB'] = fixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('TheSportsDB');
        errors['TheSportsDB'] = e.message || 'Unknown error';
      }
    })());
  }

  if (config.useSkySports !== false) {
    fetches.push((async () => {
      try {
        const sky = await fetchSkySportsFixtures();
        const fixtures: ProviderFixture[] = sky.map(f => ({
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickOff: f.kickOffDate ? f.kickOffDate.toISOString() : '',
          league: f.league,
          leagueCode: '',
        })).filter(f => f.homeTeam && f.awayTeam);

        if (fixtures.length > 0) {
          providerResults.push({ provider: 'SkySports', fixtures });
          providersUsed.push('SkySports');
          totalFromEach['SkySports'] = fixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('SkySports');
        errors['SkySports'] = e.message || 'Unknown error';
      }
    })());
  }

  if (config.useFootballData && getFootballDataKey()) {
    fetches.push((async () => {
      try {
        const matches = await getAllUpcomingMatches(config.days, config.leagueCodes);
        const fixtures: ProviderFixture[] = matches.map((m: any) => ({
          homeTeam: m.homeTeam?.name || m.homeTeam?.shortName || '',
          awayTeam: m.awayTeam?.name || m.awayTeam?.shortName || '',
          homeTeamId: m.homeTeam?.id,
          awayTeamId: m.awayTeam?.id,
          kickOff: m.utcDate || '',
          league: m.competitionName || m.competition?.name || '',
          leagueCode: m.competitionCode || '',
        })).filter(f => f.homeTeam && f.awayTeam);

        if (fixtures.length > 0) {
          providerResults.push({ provider: 'Football-Data.org', fixtures });
          providersUsed.push('Football-Data.org');
          totalFromEach['Football-Data.org'] = fixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('Football-Data.org');
        errors['Football-Data.org'] = e.message || 'Unknown error';
      }
    })());
  }

  // ─── TIER 2: Enrichment Providers ──────────────────────────────────────────

  if (config.useApiFootball && getApiFootballKey()) {
    fetches.push((async () => {
      try {
        const leagueIds = config.leagueCodes
          ? TOP_LEAGUES.filter(l =>
              config.leagueCodes!.some(code => l.name.toLowerCase().includes(code.toLowerCase()))
            ).map(l => l.id)
          : TOP_LEAGUES.map(l => l.id).slice(0, 5); // Limit to 5 to save quota

        const raw = await getFixturesForDays(Math.min(config.days, 3), leagueIds);
        const fixtures: ProviderFixture[] = raw.map((f: any) => ({
          homeTeam: f.teams?.home?.name || '',
          awayTeam: f.teams?.away?.name || '',
          homeTeamId: f.teams?.home?.id,
          awayTeamId: f.teams?.away?.id,
          kickOff: f.fixture?.date || '',
          league: f.league?.name || '',
          leagueCode: f.league?.id?.toString() || '',
        })).filter(f => f.homeTeam && f.awayTeam);

        if (fixtures.length > 0) {
          providerResults.push({ provider: 'API-Football', fixtures });
          providersUsed.push('API-Football');
          totalFromEach['API-Football'] = fixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('API-Football');
        errors['API-Football'] = e.message || 'Unknown error';
      }
    })());
  }

  if (config.useKickoffApi && getKickoffApiKey()) {
    fetches.push((async () => {
      try {
        const leagueIds = config.leagueCodes
          ? Object.entries(KICKOFF_LEAGUES)
              .filter(([code]) => config.leagueCodes!.includes(code))
              .map(([, id]) => id)
          : Object.values(KICKOFF_LEAGUES).slice(0, 3); // Limit to save quota

        const allFixtures: ProviderFixture[] = [];
        for (const leagueId of leagueIds) {
          const raw = await getUpcomingFixtures(leagueId, config.days);
          allFixtures.push(...raw.map(f => ({
            homeTeam: f.homeTeam.name,
            awayTeam: f.awayTeam.name,
            homeTeamId: f.homeTeam.id,
            awayTeamId: f.awayTeam.id,
            kickOff: f.date,
            league: '', // KickoffAPI doesn't include league name in fixture response
            leagueCode: leagueId.toString(),
          })));
        }

        if (allFixtures.length > 0) {
          providerResults.push({ provider: 'KickoffAPI', fixtures: allFixtures });
          providersUsed.push('KickoffAPI');
          totalFromEach['KickoffAPI'] = allFixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('KickoffAPI');
        errors['KickoffAPI'] = e.message || 'Unknown error';
      }
    })());
  }

  // ─── TIER 3: Supplementary Providers ───────────────────────────────────────

  if (config.useEspn) {
    fetches.push((async () => {
      try {
        // Limit ESPN to Tier 1 leagues and max 3 days for speed
        const espnDays = Math.min(config.days, 3);
        const events = await getEspnEvents(undefined, espnDays);
        const fixtures: ProviderFixture[] = events.map((e: any) => ({
          homeTeam: e.homeTeam || '',
          awayTeam: e.awayTeam || '',
          kickOff: e.kickOff || '',
          league: e.leagueName || '',
          leagueCode: e.leagueSlug || '',
        })).filter(f => f.homeTeam && f.awayTeam);

        if (fixtures.length > 0) {
          providerResults.push({ provider: 'ESPN', fixtures });
          providersUsed.push('ESPN');
          totalFromEach['ESPN'] = fixtures.length;
        }
      } catch (e: any) {
        providersFailed.push('ESPN');
        errors['ESPN'] = e.message || 'Unknown error';
      }
    })());
  }

  // Wait for all providers to complete (or fail)
  await Promise.allSettled(fetches);

  // ─── Enrich with stats from TheSportsDB cache ──────────────────────────────

  // Try to load cached stats for enrichment
  for (const pr of providerResults) {
    for (const fixture of pr.fixtures) {
      const homeStats = getCachedTeamStats(fixture.homeTeam);
      const awayStats = getCachedTeamStats(fixture.awayTeam);
      if (homeStats) {
        fixture.homeForm = homeStats.form?.join('');
        fixture.homeWinRate = homeStats.homeWinPct;
        fixture.homeAvgGoals = homeStats.avgGoalsScored;
      }
      if (awayStats) {
        fixture.awayForm = awayStats.form?.join('');
        fixture.awayWinRate = awayStats.awayWinPct;
        fixture.awayAvgGoals = awayStats.avgGoalsScored;
      }
      if (homeStats && awayStats) {
        fixture.over25Pct = Math.round((homeStats.over25Pct + awayStats.over25Pct) / 2);
        fixture.bttsPct = Math.round((homeStats.bttsPct + awayStats.bttsPct) / 2);
      }
    }
  }

  // ─── Merge all provider results ────────────────────────────────────────────

  const merged = mergeFixtures(providerResults);

  return {
    fixtures: merged,
    providersUsed,
    providersFailed,
    errors,
    fetchedAt: new Date().toISOString(),
    totalFromEach,
  };
}

/**
 * Quick status check: which providers are configured and available?
 */
export function getProviderStatus(): Record<string, { available: boolean; reason?: string }> {
  return {
    'Football-Data.org': {
      available: !!getFootballDataKey(),
      reason: !getFootballDataKey() ? 'API key not set' : undefined,
    },
    'TheSportsDB': { available: true }, // Always available (no key needed)
    'ESPN': { available: true }, // Always available (no key needed)
    'SkySports': { available: true }, // HTML scrape, no key
    'OddsMeter': { available: true }, // HTML scrape, odds + implied %, no key
    'Flashscore': { available: true }, // HTML scrape (mirrors), no key
    'API-Football': {
      available: !!getApiFootballKey(),
      reason: !getApiFootballKey() ? 'API key not set' : undefined,
    },
    'KickoffAPI': {
      available: !!getKickoffApiKey(),
      reason: !getKickoffApiKey() ? 'API key not set' : undefined,
    },
    'Odds-API': {
      available: !!localStorage.getItem('rollover_odds_api_key'),
      reason: !localStorage.getItem('rollover_odds_api_key') ? 'API key not set' : undefined,
    },
  };
}

/**
 * Pre-warm: fetch stats for common leagues so enrichment works on subsequent calls.
 * Call this on app start or before a search session.
 */
export async function preWarmStats(leagueCodes?: string[]): Promise<void> {
  const leagueIds = leagueCodes
    ? SPORTSDB_LEAGUES.filter(l =>
        leagueCodes.some(code => l.name.toLowerCase().includes(code.toLowerCase()) || code === l.id)
      ).map(l => l.id)
    : SPORTSDB_LEAGUES.slice(0, 5).map(l => l.id); // Top 5 leagues by default

  await Promise.allSettled(leagueIds.map(id => fetchLeagueStats(id)));
}
