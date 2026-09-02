import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { httpGet, httpGetDirect, httpGetHtml, getProxyUrl, setProxyUrl, isProxyEnabled, setProxyEnabled } from '../lib/http';
import { setFootballDataKey } from '../engine/football-data-org';
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
  // ─── Free providers (no key needed) ────────────────────────────────────────
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
    needsKey: false,
    storageKey: '',
    description: 'Fixtures + live scores for 55 leagues via CDN endpoint. No geo-restrictions.',
    registerUrl: '',
    testEndpoint: 'https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=eng.1',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
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
    id: 'skysports',
    name: 'Sky Sports',
    needsKey: false,
    storageKey: '',
    description: 'Fixtures + kickoff times for major leagues worldwide. HTML, no key.',
    registerUrl: '',
    testEndpoint: 'https://www.skysports.com/football/fixtures',
    testHeaders: () => ({ 'Accept': 'text/html' }),
    rateLimit: 'Unlimited',
  },
  {
    id: 'oddsmeter',
    name: 'OddsMeter',
    needsKey: false,
    storageKey: '',
    description: 'Market 1X2 odds + implied win probabilities. Cross-checks your picks. No key.',
    registerUrl: '',
    testEndpoint: 'https://oddsmeter.com/today-odds-list.aspx',
    testHeaders: () => ({ 'Accept': 'text/html' }),
    rateLimit: 'Unlimited',
  },
  {
    id: 'flashscore',
    name: 'Flashscore',
    needsKey: false,
    storageKey: '',
    description: 'Fixtures, H2H, results across 1000+ leagues. Auto-mirrors (.mobi/.ng/.au). No key.',
    registerUrl: '',
    testEndpoint: 'https://www.flashscore.mobi/?d=0&s=1',
    testHeaders: () => ({ 'Accept': 'text/html' }),
    rateLimit: 'Unlimited',
  },
  {
    id: 'openfootball',
    name: 'OpenFootball',
    needsKey: false,
    storageKey: '',
    description: 'Current season fixtures + results from GitHub. 16 leagues, JSON format.',
    registerUrl: '',
    testEndpoint: 'https://raw.githubusercontent.com/openfootball/football.json/master/2024-25/en.1.json',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
  },
  {
    id: 'footballdatauk',
    name: 'Football-Data UK',
    needsKey: false,
    storageKey: '',
    description: '30 years historical results (CSV). 17 leagues. Powers the prediction engine.',
    registerUrl: '',
    testEndpoint: 'https://www.football-data.co.uk/mmz4281/2526/E0.csv',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
  },
  {
    id: 'statsbomb',
    name: 'StatsBomb',
    needsKey: false,
    storageKey: '',
    description: 'xG data, advanced match events. La Liga, UCL, Bundesliga, EPL (select seasons).',
    registerUrl: '',
    testEndpoint: 'https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json',
    testHeaders: () => ({}),
    rateLimit: 'Unlimited',
  },
  // ─── Key-based providers ───────────────────────────────────────────────────
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
    id: 'allsportdb',
    name: 'AllSportDB',
    needsKey: true,
    storageKey: 'rollover_allsportdb_key',
    description: 'Event discovery worldwide. 10,000 calls/month free. Auto-renewable key.',
    registerUrl: 'https://allsportdb.com/Api',
    testEndpoint: '', // Built dynamically with key
    testHeaders: () => ({ 'Accept': 'application/json' }),
    rateLimit: '10K req/month',
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
    loaded._proxyEnabled = isProxyEnabled() ? 'true' : 'false';
    // Load Telegram config
    loaded._telegramToken = localStorage.getItem('rollover_telegram_bot_token') || '';
    loaded._telegramChat = localStorage.getItem('rollover_telegram_chat_id') || '';
    setKeys(loaded);

    // Load cached test results
    try {
      const cached = localStorage.getItem('rollover_api_test_results');
      if (cached) setTestResults(JSON.parse(cached));
    } catch {}
  }, [open]);

  function handleSave() {
    // Save global proxy URL and enabled state
    setProxyUrl(keys._proxy || '');
    setProxyEnabled(keys._proxyEnabled === 'true');

    // Save Football-Data.org
    if (keys.footballdata) {
      setFootballDataKey(keys.footballdata);
      localStorage.setItem('rollover_footballdata_key', keys.footballdata);
    } else {
      localStorage.removeItem('rollover_footballdata_key');
    }

    // Save Sportmonks
    if (keys.sportmonks) {
      setSportmonksToken(keys.sportmonks);
      localStorage.setItem('rollover_sportmonks_token', keys.sportmonks);
    } else {
      localStorage.removeItem('rollover_sportmonks_token');
    }

    // Save AllSportDB
    if (keys.allsportdb) {
      localStorage.setItem('rollover_allsportdb_key', keys.allsportdb);
    } else {
      localStorage.removeItem('rollover_allsportdb_key');
    }

    // Save Telegram config
    if (keys._telegramToken) localStorage.setItem('rollover_telegram_bot_token', keys._telegramToken);
    else localStorage.removeItem('rollover_telegram_bot_token');
    if (keys._telegramChat) localStorage.setItem('rollover_telegram_chat_id', keys._telegramChat);
    else localStorage.removeItem('rollover_telegram_chat_id');

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestConnection(provider: ProviderConfig) {
    setTestResults(prev => ({ ...prev, [provider.id]: { status: 'testing' } }));

    const startTime = Date.now();
    try {
      let url = provider.testEndpoint;
      let headers = provider.testHeaders(keys[provider.id] || '');

      // Special case: AllSportDB uses Bearer token auth
      if (provider.id === 'allsportdb') {
        const key = keys.allsportdb || localStorage.getItem('rollover_allsportdb_key') || '';
        if (!key) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'No API key configured. Sign up at allsportdb.com/Api' },
          }));
          return;
        }
        url = 'https://api.allsportdb.com/v3/sports?name=Football';
        headers = { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' };
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

      // For key-based providers without a key, fail early
      if (provider.needsKey && provider.id !== 'allsportdb' && provider.id !== 'sportmonks') {
        const key = keys[provider.id] || '';
        if (!key) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'No API key configured' },
          }));
          return;
        }
      }

      // Special case: football-data.co.uk returns CSV, not JSON — use text fetch
      if (provider.id === 'footballdatauk') {
        try {
          const { httpGetText } = await import('../lib/http');
          const textResult = await httpGetText(url, {});
          const latency = Date.now() - startTime;
          if (textResult.text && textResult.text.length > 100 && textResult.text.includes('HomeTeam')) {
            setTestResults(prev => ({
              ...prev,
              [provider.id]: { status: 'success', latency, testedAt: Date.now() },
            }));
          } else {
            setTestResults(prev => ({
              ...prev,
              [provider.id]: { status: 'failed', error: 'Unexpected response format', latency, testedAt: Date.now() },
            }));
          }
        } catch (e: any) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: e?.message || 'Connection failed', latency: Date.now() - startTime, testedAt: Date.now() },
          }));
        }
        return;
      }

      // HTML-scraping providers: test via httpGetHtml (returns { text, status })
      const htmlProviders = ['skysports', 'oddsmeter', 'flashscore'];
      if (htmlProviders.includes(provider.id)) {
        const htmlRes = await httpGetHtml(url, headers);
        const latency = Date.now() - startTime;
        if (htmlRes.text && htmlRes.length > 500) {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'success', latency, testedAt: Date.now() },
          }));
        } else {
          setTestResults(prev => ({
            ...prev,
            [provider.id]: { status: 'failed', error: 'Empty or blocked response', latency, testedAt: Date.now() },
          }));
        }
        return;
      }

      // Free providers use direct request (bypass proxy — these all work directly)
      // AllSportDB also uses direct (api.allsportdb.com works directly)
      const useDirectRequest = !provider.needsKey || provider.id === 'allsportdb';
      const result: any = useDirectRequest
        ? await httpGetDirect(url, headers)
        : await httpGet(url, headers);
      const latency = Date.now() - startTime;

      // Check if result indicates an error
      // Be careful: some APIs return { errors: {} } on success (API-Football)
      // Only flag as error if there's a clear failure signal
      const errorMessage = 
        (typeof result?.error === 'string' && result.error) ||
        (result?.message && (
          result.message.toLowerCase().includes('unauthorized') ||
          result.message.toLowerCase().includes('forbidden') ||
          result.message.toLowerCase().includes('invalid') ||
          result.message.toLowerCase().includes('denied')
        ) ? result.message : null) ||
        (typeof result === 'string' && result.includes('Access Denied') ? 'Access Denied' : null);

      if (errorMessage) {
        setTestResults(prev => ({
          ...prev,
          [provider.id]: { status: 'failed', error: errorMessage, latency, testedAt: Date.now() },
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
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <h3 className="text-sm font-medium text-blue-400">Cloudflare Worker Proxy</h3>
              </div>
              {/* Enable/Disable Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-gray-400">{keys._proxyEnabled ? 'Enabled' : 'Disabled'}</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={keys._proxyEnabled === 'true' || (keys._proxyEnabled === undefined && !!keys._proxy)}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setKeys(prev => ({ ...prev, _proxyEnabled: enabled ? 'true' : 'false' }));
                      setProxyEnabled(enabled);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-700 peer-checked:bg-blue-600 rounded-full transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-gray-300 peer-checked:translate-x-4 rounded-full transition-transform"></div>
                </div>
              </label>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Routes API requests through Cloudflare's global network. Bypasses geo-restrictions and ISP blocks.
              ESPN works directly without proxy. Toggle off if other providers also work directly.
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

          {/* Telegram Bot Section */}
          <div className="mt-6 p-4 bg-indigo-900/20 border border-indigo-800 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              <h3 className="text-sm font-medium text-indigo-400">Telegram Bot (Send Daily Picks)</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Send your top predictions to a Telegram channel. Create a bot via @BotFather, get the token, and add the bot to your channel.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Bot Token (from @BotFather)"
                value={keys._telegramToken || ''}
                onChange={(e) => setKeys(prev => ({ ...prev, _telegramToken: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-gray-300 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <input
                type="text"
                placeholder="Chat ID or @channel_name"
                value={keys._telegramChat || ''}
                onChange={(e) => setKeys(prev => ({ ...prev, _telegramChat: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-gray-300 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const { setTelegramConfig, testConnection } = await import('../engine/telegram-bot');
                    setTelegramConfig(keys._telegramToken || '', keys._telegramChat || '');
                    const result = await testConnection();
                    if (result.ok) {
                      setTestResults(prev => ({ ...prev, _telegram: { status: 'success', testedAt: Date.now() } }));
                    } else {
                      setTestResults(prev => ({ ...prev, _telegram: { status: 'failed', error: result.error } }));
                    }
                  }}
                  className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 rounded text-xs font-medium text-white"
                >
                  Test Bot
                </button>
                {testResults._telegram?.status === 'success' && <span className="text-xs text-green-400 self-center">Connected</span>}
                {testResults._telegram?.status === 'failed' && <span className="text-xs text-red-400 self-center">{testResults._telegram.error}</span>}
              </div>
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
