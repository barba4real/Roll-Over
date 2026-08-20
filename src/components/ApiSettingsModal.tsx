import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { httpGet, getProxyUrl, setProxyUrl } from '../lib/http';
import { setFootballDataKey } from '../engine/football-data-org';
import { setApiKey } from '../engine/api-football';
import { setOddsApiKey } from '../engine/odds-api';
import { setKickoffApiKey } from '../engine/kickoff-api';
import { setSportmonksToken } from '../engine/sportmonks';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ProviderConfig {
  id: string;
  name: string;
  needsKey: boolean;
  storageKey: string;
  description: string;
  registerUrl: string;
  testEndpoint: string;
  testHeaders: (key: string) => Record<string, string>;
  rateLimit: string;
}

interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'failed';
  latency?: number;
  error?: string;
  testedAt?: number;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'thesportsdb',
    name: 'TheSportsDB',
    needsKey: false,
    storageKey: '',
    description: 'Fixtures + past events for stats calculation. Unlimited requests.',
    registerUrl: '',
    testEndpoint: 'https://www.thesportsdb.com/api/v1/json/3/all_sports.php',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
  },
  {
    id: 'espn',
    name: 'ESPN',
    needsKey: true,
    storageKey: 'rollover_espn_proxy_url',
    description: 'Fixtures + live scores. Geo-restricted directly. Set your Cloudflare Worker proxy URL to bypass.',
    registerUrl: '',
    testEndpoint: '', // Built dynamically
    testHeaders: () => ({ 'Accept': 'application/json' }),
    rateLimit: 'Unlimited (via proxy)',
  },
  {
    id: 'openligadb',
    name: 'OpenLigaDB',
    needsKey: false,
    storageKey: '',
    description: 'German Bundesliga + European leagues. Community-driven, no key.',
    registerUrl: '',
    testEndpoint: 'https://api.openligadb.de/getavailableleagues',
    testHeaders: () => ({ 'Accept': 'application/json' }),
    rateLimit: 'Unlimited',
  },
  {
    id: 'sportscore',
    name: 'SportScore',
    needsKey: false,
    storageKey: '',
    description: 'Live scores fallback via Football-Data enrichment. No key needed.',
    registerUrl: '',
    testEndpoint: 'https://www.thesportsdb.com/api/v1/json/3/all_sports.php',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
  },
  {
    id: 'footballdata',
    name: 'Football-Data.org',
    needsKey: true,
    storageKey: 'rollover_footballdata_key',
    description: 'Standings, fixtures, and results. 12 leagues covered.',
    registerUrl: 'https://www.football-data.org/client/register',
    testEndpoint: 'https://api.football-data.org/v4/competitions',
    testHeaders: (key) => ({ 'X-Auth-Token': key, 'Accept': 'application/json' }),
    rateLimit: '10 req/min',
  },
  {
    id: 'apifootball',
    name: 'API-Football',
    needsKey: true,
    storageKey: 'rollover_api_football_key',
    description: 'AI predictions + team statistics. Most comprehensive paid source.',
    registerUrl: 'https://dashboard.api-football.com/register',
    testEndpoint: 'https://v3.football.api-sports.io/status',
    testHeaders: (key) => ({ 'x-apisports-key': key, 'Accept': 'application/json' }),
    rateLimit: '100 req/day',
  },
  {
    id: 'kickoffapi',
    name: 'KickoffAPI',
    needsKey: true,
    storageKey: 'rollover_kickoff_api_key',
    description: 'Team stats + H2H + predictions. Good for head-to-head data.',
    registerUrl: 'https://kickoffapi.com/',
    testEndpoint: 'https://api.kickoffapi.com/api/v1/sports',
    testHeaders: (key) => ({ 'x-api-key': key, 'Accept': 'application/json' }),
    rateLimit: '100 req/day',
  },
  {
    id: 'sportmonks',
    name: 'Sportmonks',
    needsKey: true,
    storageKey: 'rollover_sportmonks_token',
    description: 'Danish + Scottish leagues, xG predictions. Free forever plan available.',
    registerUrl: 'https://www.sportmonks.com/football-api/free-plan/',
    testEndpoint: 'https://api.sportmonks.com/v3/football/leagues',
    testHeaders: () => ({ 'Accept': 'application/json' }),
    rateLimit: 'Free tier',
  },
  {
    id: 'oddsapi',
    name: 'The Odds API',
    needsKey: true,
    storageKey: 'rollover_odds_api_key',
    description: 'Market odds from 40+ bookmakers. Value detection engine.',
    registerUrl: 'https://the-odds-api.com/',
    testEndpoint: '', // Built dynamically with key
    testHeaders: () => ({ 'Accept': 'application/json' }),
    rateLimit: '500 req/month',
  },
];

/**
 * ApiSettingsModal — Floating overlay modal for managing all 8 API provider keys.
 * Features: collapsible sections, Test Connection button per provider, status indicators.
 */
export default function ApiSettingsModal({ open, onClose }: Props) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load keys from localStorage on open
  useEffect(() => {
    if (!open) return;
    const loaded: Record<string, string> = {};
    for (const p of PROVIDERS) {
      if (p.needsKey && p.storageKey) {
        loaded[p.id] = localStorage.getItem(p.storageKey) || '';
      }
    }
    // Load global proxy URL
    loaded._proxy = getProxyUrl() || '';
    setKeys(loaded);

    // Load cached test results
    try {
      const cached = localStorage.getItem('rollover_api_test_results');
      if (cached) setTestResults(JSON.parse(cached));
    } catch {}
  }, [open]);

  function handleSave() {
    // Save global proxy URL
    setProxyUrl(keys._proxy || '');

    // Save ESPN proxy URL
    if (keys.espn) {
      localStorage.setItem('rollover_espn_proxy_url', keys.espn);
    } else {
      localStorage.removeItem('rollover_espn_proxy_url');
    }

    // Save Football-Data.org
    if (keys.footballdata) {
      setFootballDataKey(keys.footballdata);
      localStorage.setItem('rollover_footballdata_key', keys.footballdata);
    } else {
      localStorage.removeItem('rollover_footballdata_key');
    }

    // Save API-Football
    if (keys.apifootball) {
      setApiKey(keys.apifootball);
      localStorage.setItem('rollover_api_football_key', keys.apifootball);
    } else {
      localStorage.removeItem('rollover_api_football_key');
    }

    // Save KickoffAPI
    if (keys.kickoffapi) {
      setKickoffApiKey(keys.kickoffapi);
      localStorage.setItem('rollover_kickoff_api_key', keys.kickoffapi);
    } else {
      localStorage.removeItem('rollover_kickoff_api_key');
    }

    // Save Sportmonks
    if (keys.sportmonks) {
      setSportmonksToken(keys.sportmonks);
      localStorage.setItem('rollover_sportmonks_token', keys.sportmonks);
    } else {
      localStorage.removeItem('rollover_sportmonks_token');
    }

    // Save Odds-API
    if (keys.oddsapi) {
      setOddsApiKey(keys.oddsapi);
      localStorage.setItem('rollover_odds_api_key', keys.oddsapi);
    } else {
      localStorage.removeItem('rollover_odds_api_key');
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestConnection(provider: ProviderConfig) {
    setTestResults(prev => ({ ...prev, [provider.id]: { status: 'testing' } }));

    const startTime = Date.now();
    try {
      let url = provider.testEndpoint;
      let headers = provider.testHeaders(keys[provider.id] || '');

      // Special case: ESPN — test via proxy if configured, otherwise direct
      if (provider.id === 'espn') {
        const proxyUrl = keys.espn || localStorage.getItem('rollover_espn_proxy_url') || '';
        if (proxyUrl) {
          url = `${proxyUrl.replace(/\/$/, '')}/eng.1/scoreboard`;
        } else {
          url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard';
        }
      }

      // Special case: Odds-API needs key in URL
      if (provider.id === 'oddsapi') {
        const key = keys.oddsapi || localStorage.getItem('rollover_odds_api_key') || '';
        if (!key) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'No API key configured' },
          }));
          return;
        }
        url = `https://api.the-odds-api.com/v4/sports?apiKey=${key}`;
      }

      // Special case: Sportmonks uses token as query param
      if (provider.id === 'sportmonks') {
        const key = keys.sportmonks || localStorage.getItem('rollover_sportmonks_token') || '';
        if (!key) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'No API key configured' },
          }));
          return;
        }
        url = `https://api.sportmonks.com/v3/football/leagues?api_token=${key}`;
      }

      // For key-based providers without a key, fail early (except ESPN and Odds-API which handle keys differently)
      if (provider.needsKey && provider.id !== 'oddsapi' && provider.id !== 'sportmonks' && provider.id !== 'espn') {
        const key = keys[provider.id] || '';
        if (!key) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'No API key configured' },
          }));
          return;
        }
      }

      const result: any = await httpGet(url, headers);
      const latency = Date.now() - startTime;

      // Check if result indicates an error
      const isError =
        result?.error ||
        result?.message?.toLowerCase().includes('unauthorized') ||
        result?.message?.toLowerCase().includes('forbidden') ||
        (typeof result === 'string' && result.includes('error'));

      if (isError) {
        const errorMsg = result?.error || result?.message || 'Authentication failed';
        setTestResults(prev => ({
          ...prev,
          [provider.id]: { status: 'failed', error: errorMsg, latency, testedAt: Date.now() },
        }));
      } else {
        setTestResults(prev => ({
          ...prev,
          [provider.id]: { status: 'success', latency, testedAt: Date.now() },
        }));
      }
    } catch (e: any) {
      const latency = Date.now() - startTime;
      setTestResults(prev => ({
        ...prev,
        [provider.id]: { status: 'failed', error: e?.message || 'Connection failed', latency, testedAt: Date.now() },
      }));
    }

    // Cache test results
    setTimeout(() => {
      try {
        const current = { ...testResults };
        localStorage.setItem('rollover_api_test_results', JSON.stringify(current));
      } catch {}
    }, 100);
  }

  async function handleTestAll() {
    for (const provider of PROVIDERS) {
      await handleTestConnection(provider);
    }
  }

  function getStatusBadge(provider: ProviderConfig) {
    const result = testResults[provider.id];
    if (!provider.needsKey) {
      return <span className="text-xs bg-green-800 text-green-300 px-2 py-0.5 rounded font-medium">Always Active</span>;
    }
    if (result?.status === 'success') {
      return <span className="text-xs bg-green-800 text-green-300 px-2 py-0.5 rounded font-medium">Connected ({result.latency}ms)</span>;
    }
    if (result?.status === 'failed') {
      return <span className="text-xs bg-red-800 text-red-300 px-2 py-0.5 rounded font-medium">Failed</span>;
    }
    if (result?.status === 'testing') {
      return <span className="text-xs bg-yellow-800 text-yellow-300 px-2 py-0.5 rounded font-medium animate-pulse">Testing...</span>;
    }
    // Check if key exists
    const hasKey = provider.storageKey && localStorage.getItem(provider.storageKey);
    if (hasKey) {
      return <span className="text-xs bg-blue-800 text-blue-300 px-2 py-0.5 rounded font-medium">Key Set</span>;
    }
    return <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded font-medium">No Key</span>;
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-x-16 md:inset-y-8 z-50 bg-gray-900 rounded-xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚙</span>
            <h2 className="text-lg font-bold text-blue-400">API Settings</h2>
            <span className="text-xs text-gray-500">
              {PROVIDERS.filter(p => !p.needsKey).length} free + {PROVIDERS.filter(p => p.needsKey && localStorage.getItem(p.storageKey)).length} configured
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestAll}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium"
            >
              Test All
            </button>
            <button
              onClick={handleSave}
              className={`px-4 py-1.5 rounded text-xs font-medium ${
                saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {saved ? '✓ Saved' : 'Save All Keys'}
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Global Proxy URL */}
          <div className="mb-6 p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <h3 className="text-sm font-medium text-blue-400">Cloudflare Worker Proxy (Recommended)</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Routes ALL API requests through Cloudflare's global network. Bypasses geo-restrictions and ISP blocks.
              Deploy the worker from <span className="font-mono text-blue-300">worker/api-proxy.js</span> to your Cloudflare account.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://rollover-proxy.your-name.workers.dev"
                value={keys._proxy || ''}
                onChange={(e) => setKeys(prev => ({ ...prev, _proxy: e.target.value }))}
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={async () => {
                  const proxyUrl = keys._proxy || '';
                  if (!proxyUrl) return;
                  setTestResults(prev => ({ ...prev, _proxy: { status: 'testing' } }));
                  try {
                    const result: any = await invoke('http_get', { url: `${proxyUrl.replace(/\/$/, '')}/health`, headers: { 'Accept': 'application/json' } });
                    if (result?.status === 'ok') {
                      setTestResults(prev => ({ ...prev, _proxy: { status: 'success', latency: 0, testedAt: Date.now() } }));
                    } else {
                      setTestResults(prev => ({ ...prev, _proxy: { status: 'failed', error: 'Unexpected response' } }));
                    }
                  } catch (e: any) {
                    setTestResults(prev => ({ ...prev, _proxy: { status: 'failed', error: e?.message || 'Connection failed' } }));
                  }
                }}
                className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded text-xs font-medium text-white"
              >
                Test
              </button>
            </div>
            {testResults._proxy?.status === 'success' && (
              <p className="text-xs text-green-400 mt-2">✓ Proxy connected. All API requests will route through it.</p>
            )}
            {testResults._proxy?.status === 'failed' && (
              <p className="text-xs text-red-400 mt-2">✗ {testResults._proxy.error}</p>
            )}
            {testResults._proxy?.status === 'testing' && (
              <p className="text-xs text-yellow-400 mt-2 animate-pulse">Testing...</p>
            )}
            {getProxyUrl() && (
              <p className="text-xs text-green-600 mt-1">Active proxy: {getProxyUrl()}</p>
            )}
          </div>

          <p className="text-xs text-gray-500 mb-4">
            The system works immediately with free providers. Add keys below for more data. With proxy set, all providers bypass geo-restrictions.
          </p>

          {/* Free providers section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-green-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Always Active (No Key Required)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PROVIDERS.filter(p => !p.needsKey).map(provider => (
                <div key={provider.id} className="p-3 bg-gray-800 rounded-lg border border-green-900/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-200">{provider.name}</span>
                    {getStatusBadge(provider)}
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{provider.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600">{provider.rateLimit}</span>
                    <button
                      onClick={() => handleTestConnection(provider)}
                      disabled={testResults[provider.id]?.status === 'testing'}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-gray-300"
                    >
                      {testResults[provider.id]?.status === 'testing' ? '...' : 'Test'}
                    </button>
                  </div>
                  {testResults[provider.id]?.status === 'success' && (
                    <p className="text-xs text-green-400 mt-1">
                      ✓ Connected ({testResults[provider.id].latency}ms)
                    </p>
                  )}
                  {testResults[provider.id]?.status === 'failed' && (
                    <p className="text-xs text-red-400 mt-1">
                      ✗ {testResults[provider.id].error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Key-based providers section */}
          <div>
            <h3 className="text-sm font-medium text-blue-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              Key-Based Providers (Optional — adds more data)
            </h3>
            <div className="space-y-2">
              {PROVIDERS.filter(p => p.needsKey).map(provider => {
                const isExpanded = expandedProvider === provider.id;
                return (
                  <div key={provider.id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    {/* Collapsed header */}
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-750"
                      onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">{isExpanded ? '▼' : '▶'}</span>
                        <span className="text-sm font-medium text-gray-200">{provider.name}</span>
                        {getStatusBadge(provider)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">{provider.rateLimit}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTestConnection(provider); }}
                          disabled={testResults[provider.id]?.status === 'testing'}
                          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-gray-300"
                        >
                          {testResults[provider.id]?.status === 'testing' ? '...' : 'Test'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t border-gray-700 p-4 bg-gray-850">
                        <p className="text-xs text-gray-400 mb-3">{provider.description}</p>

                        <div className="flex gap-2 mb-3">
                          <input
                            type="text"
                            placeholder={`Enter ${provider.name} API key...`}
                            value={keys[provider.id] || ''}
                            onChange={(e) => setKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
                          />
                          <button
                            onClick={() => handleTestConnection(provider)}
                            disabled={testResults[provider.id]?.status === 'testing' || !keys[provider.id]}
                            className="px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs font-medium text-white"
                          >
                            Test Connection
                          </button>
                        </div>

                        {/* Test result display */}
                        {testResults[provider.id]?.status === 'success' && (
                          <div className="p-2 bg-green-900/30 border border-green-900 rounded text-xs text-green-300 mb-2">
                            ✓ Connected successfully ({testResults[provider.id].latency}ms)
                            {testResults[provider.id].testedAt && (
                              <span className="text-green-600 ml-2">
                                {new Date(testResults[provider.id].testedAt!).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        )}
                        {testResults[provider.id]?.status === 'failed' && (
                          <div className="p-2 bg-red-900/30 border border-red-900 rounded text-xs text-red-300 mb-2">
                            ✗ {testResults[provider.id].error}
                            {testResults[provider.id].latency && (
                              <span className="text-red-600 ml-2">({testResults[provider.id].latency}ms)</span>
                            )}
                          </div>
                        )}

                        {/* Registration link */}
                        {provider.registerUrl && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-500">Get a free key:</span>
                            <span className="text-blue-400 font-mono">
                              {provider.registerUrl.replace('https://', '').split('/')[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer info */}
          <div className="mt-6 p-3 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-xs text-gray-500 text-center">
              Keys are stored locally in your browser. Never sent anywhere except the respective API provider.
              All HTTP requests go through the Rust backend for security and CORS bypass.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
