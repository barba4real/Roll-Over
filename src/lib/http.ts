/**
 * HTTP utility — routes all API requests through Cloudflare Worker proxy if configured.
 * Falls back to direct request if no proxy URL is set.
 *
 * Usage: import { httpGet } from '../lib/http';
 *        const data = await httpGet(url, headers);
 */

import { invoke } from '@tauri-apps/api/core';

const PROXY_KEY = 'rollover_proxy_url';

/**
 * Get the configured proxy URL (or null for direct).
 */
export function getProxyUrl(): string | null {
  return localStorage.getItem(PROXY_KEY) || null;
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
 * Make an HTTP GET request — uses proxy if configured, direct otherwise.
 */
export async function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  const proxyUrl = getProxyUrl();

  if (proxyUrl) {
    // Route through Cloudflare Worker proxy
    return invoke('http_get_proxied', { url, headers, proxyUrl });
  }

  // Direct request
  return invoke('http_get', { url, headers });
}
