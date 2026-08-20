/**
 * Cloudflare Worker — ESPN API Proxy
 * 
 * Deploys on Cloudflare's global edge network, bypassing geo-restrictions.
 * Free tier: 100,000 requests/day.
 *
 * DEPLOYMENT:
 * 1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 * 2. Paste this entire file as the worker code
 * 3. Click "Deploy"
 * 4. Copy your worker URL (e.g., https://espn-proxy.your-name.workers.dev)
 * 5. Paste that URL in Roll-Over → API Settings → ESPN Proxy URL
 *
 * USAGE:
 *   GET https://your-worker.workers.dev/eng.1/scoreboard?dates=20260817
 *   → Proxies to: https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260817
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // CORS headers for local app
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        service: 'espn-proxy',
        version: '1.0.0',
        usage: 'GET /{league}/scoreboard?dates=YYYYMMDD'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build ESPN URL from path
    // Input:  /eng.1/scoreboard?dates=20260817
    // Output: https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260817
    const espnBase = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
    const targetUrl = `${espnBase}${url.pathname}${url.search}`;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ 
          error: `ESPN returned ${response.status}`,
          url: targetUrl 
        }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300', // Cache 5 min at edge
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
