/**
 * iTunes Search Service
 * Documentation: https://developer.apple.com/library/archive/documentation/AcercaDe/ContactOfCulture/ITunesSearchAPI/ITunesSearchAPI.pdf
 * No auth required. Rate limit guidance: ~20 requests/minute — keep calls
 * sparse and always through the cache layer.
 */
import { cacheService, CACHE_KEYS, CACHE_MISS_SENTINEL } from './cache.js';

const ITUNES_API_BASE = 'https://itunes.apple.com/search';
const API_TIMEOUT = 8000;

interface ITunesArtwork {
  artworkUrl100?: string;
  artworkUrl60?: string;
}

interface ITunesSearchResponse {
  results: Array<ITunesArtwork & { wrapperType?: string; collectionName?: string }>;
}

/** Upgrade the 100px artwork to the largest size iTunes serves. */
function upscaleArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.$1');
}

/**
 * Fetch album cover art from iTunes (fallback when Deezer has none).
 * Returns the 600x600 artwork URL or undefined.
 */
export async function fetchItunesArtwork(artist: string, album?: string): Promise<string | undefined> {
  const term = album ? `${artist} ${album}` : artist;
  const cacheKey = CACHE_KEYS.itunesArtwork(term);
  const cached = await cacheService.get<string>(cacheKey);
  if (cached !== null && cached !== CACHE_MISS_SENTINEL) return cached || undefined;

  try {
    const response = await fetchWithTimeout(
      `${ITUNES_API_BASE}?term=${encodeURIComponent(term)}&entity=album&limit=8`,
      { timeout: API_TIMEOUT, headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return undefined;

    const data = await response.json() as ITunesSearchResponse;
    const hit = (data.results || []).find((r) => r.artworkUrl100);
    const url = hit ? upscaleArtwork(hit.artworkUrl100!) : undefined;
    await cacheService.set(cacheKey, url || '', 30 * 24 * 3600); // empty result cached too, 30d
    return url;
  } catch {
    // Network or parse error — behave like "no artwork"
    return undefined;
  }
}

// Small local helper so this file has no import cycle with utils
async function fetchWithTimeout(url: string, init: RequestInit & { timeout: number }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Multiple album cover candidates from iTunes (up to 6, 600x600).
 */
export async function fetchItunesCandidates(artist: string, album?: string): Promise<string[]> {
  const term = album ? `${artist} ${album}` : artist;
  try {
    const response = await fetchWithTimeout(
      `${ITUNES_API_BASE}?term=${encodeURIComponent(term)}&entity=album&limit=12`,
      { timeout: API_TIMEOUT, headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return [];
    const data = await response.json() as ITunesSearchResponse;
    const urls = (data.results || [])
      .map((r) => (r.artworkUrl100 ? upscaleArtwork(r.artworkUrl100) : undefined))
      .filter((u): u is string => !!u);
    return [...new Set(urls)].slice(0, 6);
  } catch {
    return [];
  }
}
