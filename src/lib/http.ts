/**
 * HTTP utility — routes all API requests through Cloudflare Worker proxy if configured.
 * Falls back to direct request if no proxy URL is set.
 *
 * Usage: import { httpGet } from '../lib/http';
 *        const data = await httpGet(url, headers);
 *        const data = await httpGetDirect(url, headers); // bypass proxy
 */

import { invoke } from '@tauri-apps/api/core';

const PROXY_KEY = 'rollover_proxy_url';
const PROXY_ENABLED_KEY = 'rollover_proxy_enabled';

/**
 * Get the configured proxy URL (or null for direct).
 */
export function getProxyUrl(): string | null {
  return localStorage.getItem(PROXY_KEY) || null;
}

/**
 * Check if proxy is enabled (separate from having a URL set).
 */
export function isProxyEnabled(): boolean {
  const val = localStorage.getItem(PROXY_ENABLED_KEY);
  // Default: enabled if a proxy URL is set
  if (val === null) return !!getProxyUrl();
  return val === 'true';
}

/**
 * Enable or disable the proxy without removing the URL.
 */
export function setProxyEnabled(enabled: boolean) {
  localStorage.setItem(PROXY_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * Set the global proxy URL.
 */
export function setProxyUrl(url: string) {
  if (url) {
    localStorage.setItem(PROXY_KEY, url.replace(/\/$/, ''));
  } else {
    localStorage.removeItem(PROXY_KEY);
  }
}

/**
 * Make an HTTP GET request — uses proxy if configured AND enabled, direct otherwise.
 * Includes request-level logging for debugging connection issues.
 */
export async function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  const proxyUrl = getProxyUrl();
  const proxyActive = proxyUrl && isProxyEnabled();

  try {
    if (proxyActive) {
      // Route through Cloudflare Worker proxy
      const result = await invoke('http_get_proxied', { url, headers, proxyUrl });
      return result;
    }

    // Direct request
    const result = await invoke('http_get', { url, headers });
    return result;
  } catch (e: any) {
    // Enhance error with request context for debugging
    const mode = proxyActive ? `proxied via ${proxyUrl}` : 'direct';
    const errMsg = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    console.error(`[HTTP] Failed (${mode}): ${url} → ${errMsg}`);
    throw new Error(errMsg);
  }
}

/**
 * Make a DIRECT HTTP GET request — always bypasses the proxy.
 * Used for endpoints known to work directly (e.g., ESPN CDN).
 */
export async function httpGetDirect(url: string, headers: Record<string, string> = {}): Promise<any> {
  try {
    const result = await invoke('http_get', { url, headers });
    return result;
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    console.error(`[HTTP-Direct] Failed: ${url} → ${errMsg}`);
    throw new Error(errMsg);
  }
}

/**
 * Fetch raw text content from a URL (bypasses proxy, no JSON parsing).
 * Used for CSV downloads and non-JSON endpoints.
 * Returns { text: string, status: number, length: number }
 */
export async function httpGetText(url: string, headers: Record<string, string> = {}): Promise<{ text: string; status: number; length: number }> {
  try {
    const result = await invoke('http_get_text', { url, headers }) as { text: string; status: number; length: number };
    return result;
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    console.error(`[HTTP-Text] Failed: ${url} → ${errMsg}`);
    throw new Error(errMsg);
  }
}

/**
 * Fetch raw HTML/text, routing through the Cloudflare Worker proxy when active.
 * The Worker wraps non-JSON responses as { _raw: "<html>..." }, which we unwrap.
 * Falls back to direct text fetch when the proxy isn't configured/enabled.
 *
 * Use this for HTML-scraping sources (flashscore, skysports, oddsmeter) so they
 * bypass regional blocks the same way the JSON APIs do.
 */
export async function httpGetHtml(url: string, headers: Record<string, string> = {}): Promise<{ text: string; status: number; length: number }> {
  const proxyUrl = getProxyUrl();
  const proxyActive = proxyUrl && isProxyEnabled();

  if (proxyActive) {
    try {
      const result: any = await invoke('http_get_proxied', { url, headers, proxyUrl });
      // Worker returns { _raw: "<html>" } for non-JSON, or an { error, body } wrapper
      if (result && typeof result._raw === 'string') {
        return { text: result._raw, status: 200, length: result._raw.length };
      }
      // If proxy reported a target error but included the raw body
      if (result && result.body && typeof result.body._raw === 'string') {
        return { text: result.body._raw, status: result.status || 200, length: result.body._raw.length };
      }
      // Some responses may already be a string
      if (typeof result === 'string') {
        return { text: result, status: 200, length: result.length };
      }
      // Fall through to direct if proxy gave nothing usable
    } catch (e) {
      // Proxy failed — fall back to direct below
      console.warn(`[HTTP-Html] Proxy failed for ${url}, trying direct.`);
    }
  }

  // Direct text fetch
  return httpGetText(url, headers);
}
