/**
 * Roll-Over Universal API Proxy — Cloudflare Worker
 * 
 * Routes ALL sport data API requests through Cloudflare's global edge network.
 * Bypasses geo-restrictions, ISP blocks, and CDN denials.
 * Free tier: 100,000 requests/day.
 *
 * DEPLOYMENT:
 * 1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 * 2. Name it "rollover-proxy" → click Deploy
 * 3. Click "Edit Code" → paste this entire file → Deploy
 * 4. Copy your worker URL (e.g., https://rollover-proxy.your-name.workers.dev)
 * 5. In Roll-Over app → API Settings → set "Proxy URL" to your worker URL
 *
 * USAGE:
 *   POST https://rollover-proxy.your-name.workers.dev/proxy
 *   Body: { "url": "https://api.football-data.org/v4/competitions", "headers": { "X-Auth-Token": "..." } }
 *   → Worker fetches from that URL and returns the response
 *
 * SECURITY:
 * - Only allows GET requests to known sport API domains
 * - Rate-limited by Cloudflare's free tier (100k/day)
 * - No secrets stored in the Worker — keys come from the client
 */

// Allowed API domains (prevents abuse of the proxy)
const ALLOWED_DOMAINS = [
  'site.api.espn.com',
  'api.football-data.org',
  'v3.football.api-sports.io',
  'api.kickoffapi.com',
  'api.sportmonks.com',
  'api.the-odds-api.com',
  'www.thesportsdb.com',
  'api.openligadb.de',
];

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'rollover-proxy',
        version: '2.0.0',
        usage: 'POST /proxy with { url, headers }',
        allowed: ALLOWED_DOMAINS,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Main proxy endpoint
    if (url.pathname === '/proxy' && request.method === 'POST') {
      try {
        const body = await request.json();
        const targetUrl = body.url;
        const targetHeaders = body.headers || {};

        if (!targetUrl) {
          return new Response(JSON.stringify({ error: 'Missing "url" in request body' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Validate domain is allowed
        const targetHost = new URL(targetUrl).hostname;
        if (!ALLOWED_DOMAINS.some(d => targetHost === d || targetHost.endsWith('.' + d))) {
          return new Response(JSON.stringify({ error: `Domain not allowed: ${targetHost}` }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Fetch from target API
        const response = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...targetHeaders,
          },
        });

        const responseText = await response.text();

        // Try to parse as JSON, return raw if not
        let responseBody;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = { _raw: responseText };
        }

        return new Response(JSON.stringify(responseBody), {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Proxy-Status': response.status.toString(),
            'X-Proxy-Target': targetHost,
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Legacy ESPN-style path proxy (backward compat)
    if (url.pathname.startsWith('/espn/')) {
      const espnPath = url.pathname.replace('/espn/', '');
      const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnPath}${url.search}`;
      
      try {
        const response = await fetch(espnUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found. Use POST /proxy' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
