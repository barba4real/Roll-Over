import React, { useState } from 'react';
import { setFootballDataKey } from '../engine/football-data-org';
import { setApiKey } from '../engine/api-football';
import { setOddsApiKey } from '../engine/odds-api';
import { setKickoffApiKey } from '../engine/kickoff-api';
import { setSportmonksToken } from '../engine/sportmonks';
import { getProviderStatus } from '../engine/provider-orchestrator';

/**
 * API Settings Page — Manage all provider API keys in one place.
 * Keys are optional — the system works with 4 no-key providers out of the box.
 * Adding keys unlocks more data sources for richer predictions.
 */
export default function ApiSettings() {
  const [keys, setKeys] = useState({
    footballData: localStorage.getItem('rollover_footballdata_key') || '',
    apiFootball: localStorage.getItem('rollover_api_key') || '',
    kickoffApi: localStorage.getItem('rollover_kickoff_api_key') || '',
    sportmonks: localStorage.getItem('rollover_sportmonks_token') || '',
    oddsApi: localStorage.getItem('rollover_odds_api_key') || '',
  });
  const [saved, setSaved] = useState(false);

  const status = getProviderStatus();

  function handleSave() {
    if (keys.footballData) { setFootballDataKey(keys.footballData); localStorage.setItem('rollover_footballdata_key', keys.footballData); }
    else localStorage.removeItem('rollover_footballdata_key');

    if (keys.apiFootball) { setApiKey(keys.apiFootball); localStorage.setItem('rollover_api_key', keys.apiFootball); }
    else localStorage.removeItem('rollover_api_key');

    if (keys.kickoffApi) { setKickoffApiKey(keys.kickoffApi); localStorage.setItem('rollover_kickoff_api_key', keys.kickoffApi); }
    else localStorage.removeItem('rollover_kickoff_api_key');

    if (keys.sportmonks) { setSportmonksToken(keys.sportmonks); localStorage.setItem('rollover_sportmonks_token', keys.sportmonks); }
    else localStorage.removeItem('rollover_sportmonks_token');

    if (keys.oddsApi) { setOddsApiKey(keys.oddsApi); localStorage.setItem('rollover_odds_api_key', keys.oddsApi); }
    else localStorage.removeItem('rollover_odds_api_key');

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const providers = [
    { key: 'TheSportsDB', needsKey: false, status: 'always', desc: 'Fixtures + past events for stats. Unlimited, no key.', url: '' },
    { key: 'ESPN', needsKey: false, status: 'always', desc: 'Fixtures + live scores. Unlimited, no key.', url: '' },
    { key: 'OpenLigaDB', needsKey: false, status: 'always', desc: 'German/European leagues. Unlimited, no key.', url: '' },
    { key: 'Football-Data.org', needsKey: true, field: 'footballData' as const, status: status['Football-Data.org'], desc: 'Standings + fixtures. 10 req/min, 12 leagues.', url: 'https://www.football-data.org/client/register' },
    { key: 'API-Football', needsKey: true, field: 'apiFootball' as const, status: status['API-Football'], desc: 'AI predictions + team stats. 100 req/day.', url: 'https://dashboard.api-football.com/register' },
    { key: 'KickoffAPI', needsKey: true, field: 'kickoffApi' as const, status: status['KickoffAPI'], desc: 'Team stats + H2H + predictions. 100 req/day.', url: 'https://kickoffapi.com/' },
    { key: 'Sportmonks', needsKey: true, field: 'sportmonks' as const, status: status['Odds-API'], desc: 'Danish + Scottish leagues, xG predictions. Free forever.', url: 'https://www.sportmonks.com/football-api/free-plan/' },
    { key: 'The Odds API', needsKey: true, field: 'oddsApi' as const, status: status['Odds-API'], desc: 'Market odds from 40+ bookmakers. Value detection. 500 req/month.', url: 'https://the-odds-api.com/' },
  ];

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="text-lg font-bold mb-2 text-blue-400">API Settings</h2>
      <p className="text-xs text-gray-500 mb-4">
        The system works immediately with 3 no-key providers. Add keys below to unlock more data sources for richer predictions.
      </p>

      <div className="space-y-3">
        {providers.map(p => (
          <div key={p.key} className={`p-3 rounded-lg border ${
            !p.needsKey ? 'bg-green-900/10 border-green-900' :
            (p.status as any)?.available ? 'bg-green-900/10 border-green-900' : 'bg-gray-800 border-gray-700'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-200">{p.key}</span>
                {!p.needsKey ? (
                  <span className="text-xs bg-green-800 text-green-300 px-1.5 py-0.5 rounded">Always Active</span>
                ) : (p.status as any)?.available ? (
                  <span className="text-xs bg-green-800 text-green-300 px-1.5 py-0.5 rounded">Connected</span>
                ) : (
                  <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">No Key</span>
                )}
              </div>
              {p.url && (
                <span className="text-xs text-blue-400">{p.url.replace('https://', '').split('/')[0]}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-2">{p.desc}</p>
            {p.needsKey && p.field && (
              <input
                type="text"
                placeholder={`Enter ${p.key} API key...`}
                value={keys[p.field]}
                onChange={(e) => setKeys({ ...keys, [p.field!]: e.target.value })}
                className="w-full px-3 py-1.5 bg-gray-900 border border-gray-600 rounded text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        className={`w-full mt-4 py-2 rounded text-sm font-medium ${
          saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {saved ? '✓ Saved' : 'Save All Keys'}
      </button>

      <p className="text-xs text-gray-600 text-center mt-2">
        Keys are stored locally. Never sent anywhere except the respective API provider.
      </p>
    </div>
  );
}
