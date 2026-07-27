/**
 * Navidrome Service
 *
 * A Subsonic-compatible client for Navidrome. It exposes two families of calls:
 *   1. Subsonic API (read-only) for enumerating the library — getArtists,
 *      getAlbum, getAlbumList2. Auth uses the standard token+salt scheme.
 *   2. Navidrome's native /api/* API for AI orchestration — login (to obtain a
 *      JWT) then POST /api/ai/lyrics/fetch and GET /api/ai/lyrics/status.
 *
 * The native AI endpoints share the same URL/user/password as Subsonic, so a
 * single NavidromeConfig is enough. The service mirrors LidarrService's
 * rate-limit / fetchWithTimeout / retry skeleton for consistency.
 */

import { randomBytes, createHash } from 'node:crypto';
import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { createLogger } from '../lib/logger.js';
import { validateServiceUrl } from '../lib/validate-service-url.js';

const log = createLogger('Navidrome');

export interface NavidromeConfig {
  url: string;
  username: string;
  password: string;
}

// ---- Subsonic response types (only the fields we use) ----------------------

interface SubsonicResponse<T> {
  'subsonic-response': {
    status: string;
    version?: string;
    error?: { code: number; message: string };
  } & T;
}

export interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  songCount?: number;
  year?: number;
}

export interface SubsonicSong {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  duration?: number;
  year?: number;
}

// ---- Navidrome native AI API types -----------------------------------------

interface NavidromeLoginResponse {
  token?: string;
  error?: string;
}

export interface NavidromeLyricsStatus {
  status: string; // queued | running | done | error
  step?: string; // lyrics | translation
  error?: string;
  updatedAt?: number;
  lyricsHit?: boolean;
}

export interface NavidromeMissingItem {
  mediaFileId: string;
  title: string;
  artist: string;
  hasLyrics: boolean;
}

// Throttling for Gemini free-tier: space out requests to stay under ~5 RPM.
const DEFAULT_INTER_TRACK_DELAY_MS = 15_000;
const MAX_POLL_ATTEMPTS = 60; // up to ~2 minutes per track at 2s poll
const POLL_INTERVAL_MS = 2_000;

export class NavidromeService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private maxRetries = 3;
  private baseDelay = 1000;
  private clientName = 'Mixarr';
  private apiVersion = '1.16.1';

  constructor(config: NavidromeConfig) {
    this.baseUrl = validateServiceUrl(config.url, 'Navidrome');
    this.username = config.username;
    this.password = config.password;
  }

  // ---- low-level helpers ---------------------------------------------------

  private isRetryableError(status: number): boolean {
    return status >= 500 || status === 429;
  }

  /**
   * Subsonic auth query string: u=<user>&t=<md5(pwd+salt)>&s=<salt>&v=...&c=...&f=json
   * The salt+token scheme avoids sending the raw password on every request.
   */
  private subsonicAuthParams(): string {
    const salt = randomBytes(8).toString('hex');
    const token = createHash('md5').update(this.password + salt).digest('hex');
    const params = new URLSearchParams({
      u: this.username,
      t: token,
      s: salt,
      v: this.apiVersion,
      c: this.clientName,
      f: 'json',
    });
    return params.toString();
  }

  /**
   * Subsonic GET request with retry/backoff. Unwraps the "subsonic-response"
   * envelope and throws on a non-ok status. The endpoint may already carry
   * query params (e.g. "getArtist?id=..."); the auth params are appended with
   * the correct separator to avoid a double "?".
   */
  private async subsonicGet<T>(endpoint: string): Promise<T> {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}/rest/${endpoint}${sep}${this.subsonicAuthParams()}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await rateLimit('navidrome');
      try {
        const resp = await fetchWithTimeout(url, { method: 'GET' });
        if (this.isRetryableError(resp.status) && attempt < this.maxRetries) {
          const delay = this.baseDelay * 2 ** attempt + Math.random() * 500;
          log.warn(`Retryable status ${resp.status}, retrying in ${Math.round(delay)}ms`);
          await this.sleep(delay);
          continue;
        }
        if (!resp.ok) {
          throw new Error(`Navidrome returned status ${resp.status}`);
        }
        const body = (await resp.json()) as SubsonicResponse<T>;
        const sr = body['subsonic-response'];
        if (!sr || sr.status !== 'ok') {
          const msg = sr?.error?.message || 'unknown Subsonic error';
          throw new Error(`Navidrome Subsonic error: ${msg}`);
        }
        // Strip the envelope keys and return the payload.
        const { status: _s, version: _v, error: _e, ...payload } = sr as any;
        return payload as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message.toLowerCase();
        const networkError = msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('etimedout');
        if ((this.isRetryableError(0) || networkError) && attempt < this.maxRetries) {
          const delay = this.baseDelay * 2 ** attempt + Math.random() * 500;
          await this.sleep(delay);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError || new Error('Navidrome request failed');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- Subsonic library methods -------------------------------------------

  async testConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const res = await this.subsonicGet<{ version?: string }>('ping.view');
      return { success: true, version: res.version };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  async getArtists(): Promise<SubsonicArtist[]> {
    const res = await this.subsonicGet<{ artists?: { index?: Array<{ artist?: SubsonicArtist[] }> } }>('getArtists');
    const indexes = res.artists?.index || [];
    const artists: SubsonicArtist[] = [];
    for (const idx of indexes) {
      if (idx.artist) artists.push(...idx.artist);
    }
    return artists;
  }

  async getAlbumsByArtist(artistId: string): Promise<SubsonicAlbum[]> {
    const res = await this.subsonicGet<{ artist?: { album?: SubsonicAlbum[] } }>(`getArtist?id=${artistId}`);
    return res.artist?.album || [];
  }

  async getAlbum(albumId: string): Promise<{ album?: SubsonicAlbum; songs: SubsonicSong[] }> {
    const res = await this.subsonicGet<{ album?: SubsonicAlbum & { song?: SubsonicSong[] } }>(`getAlbum?id=${albumId}`);
    return { album: res.album, songs: res.album?.song || [] };
  }

  // ---- Navidrome native AI API --------------------------------------------

  /**
   * Log in to Navidrome's native API and return a JWT bearer token. The token
   * is short-lived but sufficient for a batch run; callers should re-login if
   * they hit a 401 mid-run.
   */
  async login(): Promise<string> {
    const resp = await fetchWithTimeout(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!resp.ok) {
      throw new Error(`Navidrome login failed: status ${resp.status}`);
    }
    const body = (await resp.json()) as NavidromeLoginResponse;
    if (!body.token) {
      throw new Error(body.error || 'Navidrome login returned no token');
    }
    return body.token;
  }

  /**
   * Trigger a background lyrics fetch for a track in Navidrome. Returns once
   * the job is queued; use pollLyricsStatus to wait for completion.
   */
  async startLyricsFetch(token: string, mediaFileId: string): Promise<void> {
    const resp = await fetchWithTimeout(`${this.baseUrl}/api/ai/lyrics/fetch`, {
      method: 'POST',
      headers: this.nativeHeaders(token),
      body: JSON.stringify({ mediaFileId }),
    });
    if (!resp.ok) {
      throw new Error(`Navidrome lyrics fetch failed: status ${resp.status}`);
    }
  }

  async getLyricsStatus(token: string, mediaFileId: string): Promise<NavidromeLyricsStatus> {
    const resp = await fetchWithTimeout(
      `${this.baseUrl}/api/ai/lyrics/status?mediaFileId=${encodeURIComponent(mediaFileId)}`,
      { method: 'GET', headers: this.nativeHeaders(token) },
    );
    if (!resp.ok) {
      throw new Error(`Navidrome lyrics status failed: status ${resp.status}`);
    }
    return (await resp.json()) as NavidromeLyricsStatus;
  }

  /**
   * Returns the tracks of an artist/album that do not yet have a synced lyrics
   * sidecar. Used to scope a batch run to only the tracks that need work.
   */
  async getMissingLyrics(
    token: string,
    params: { artistId?: string; albumId?: string },
  ): Promise<NavidromeMissingItem[]> {
    const qs = new URLSearchParams();
    if (params.albumId) qs.set('albumId', params.albumId);
    if (params.artistId) qs.set('artistId', params.artistId);
    const resp = await fetchWithTimeout(`${this.baseUrl}/api/ai/lyrics/missing?${qs.toString()}`, {
      method: 'GET',
      headers: this.nativeHeaders(token),
    });
    if (!resp.ok) {
      throw new Error(`Navidrome missing-lyrics failed: status ${resp.status}`);
    }
    const body = (await resp.json()) as { items?: NavidromeMissingItem[] };
    return body.items || [];
  }

  /**
   * Returns the tracks of an artist/album that do not yet have a meaning-decode
   * sidecar (.ai.decode.md). Mirrors getMissingLyrics for the decode mode.
   */
  async getMissingDecode(
    token: string,
    params: { artistId?: string; albumId?: string },
  ): Promise<NavidromeMissingItem[]> {
    const qs = new URLSearchParams();
    if (params.albumId) qs.set('albumId', params.albumId);
    if (params.artistId) qs.set('artistId', params.artistId);
    const resp = await fetchWithTimeout(`${this.baseUrl}/api/ai/decode/missing?${qs.toString()}`, {
      method: 'GET',
      headers: this.nativeHeaders(token),
    });
    if (!resp.ok) {
      throw new Error(`Navidrome missing-decode failed: status ${resp.status}`);
    }
    const body = (await resp.json()) as { items?: NavidromeMissingItem[] };
    return body.items || [];
  }

  /**
   * Run a synchronous meaning-decode for a track. Navidrome generates the
   * Markdown interpretation via Gemini and persists it to .ai.decode.md.
   * Returns once the response is ready (the body text is not needed here).
   */
  async decodeTrack(token: string, mediaFileId: string, title: string, artist?: string): Promise<void> {
    const resp = await fetchWithTimeout(`${this.baseUrl}/api/ai/decode`, {
      method: 'POST',
      headers: this.nativeHeaders(token),
      body: JSON.stringify({ title, artist: artist || '', mediaFileId }),
    });
    if (!resp.ok) {
      // Surface the body so quota/region errors are visible to the orchestrator.
      const text = await resp.text().catch(() => '');
      throw new Error(`Navidrome decode failed: status ${resp.status} ${text.slice(0, 200)}`);
    }
  }

  private nativeHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-nd-authorization': `Bearer ${token}`,
    };
  }

  /**
   * Wait for a single track's lyrics fetch to reach a terminal state. Resolves
   * to true on "done", false on "error"/timeout/cancelled. Quota (429) errors
   * are surfaced via status.error so callers can apply backoff.
   *
   * `isCancelled` is polled alongside the status so a queue cancel takes effect
   * promptly instead of blocking for the full poll window.
   */
  async waitForLyrics(
    token: string,
    mediaFileId: string,
    isCancelled?: () => Promise<boolean>,
  ): Promise<{ done: boolean; error?: string }> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      if (isCancelled && (await isCancelled())) {
        return { done: false, error: 'cancelled' };
      }
      await this.sleep(POLL_INTERVAL_MS);
      if (isCancelled && (await isCancelled())) {
        return { done: false, error: 'cancelled' };
      }
      const st = await this.getLyricsStatus(token, mediaFileId);
      if (st.status === 'done') return { done: true };
      if (st.status === 'error') return { done: false, error: st.error || 'unknown error' };
      // queued/running -> keep polling
    }
    return { done: false, error: 'timed out waiting for lyrics' };
  }

  /** Inter-track delay used by the batch orchestrator to respect Gemini quota. */
  static interTrackDelayMs(): number {
    return DEFAULT_INTER_TRACK_DELAY_MS;
  }
}
