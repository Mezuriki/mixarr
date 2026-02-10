/**
 * SkyHook Cache Warmer Service
 * 
 * Warms the SkyHook (api.lidarr.audio) cache for artists/albums
 * before adding them to Lidarr. This ensures metadata is available
 * in SkyHook's cache, dramatically improving add success rates.
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('SkyHook');

const SKYHOOK_API = 'https://api.lidarr.audio/api/v0.4';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WarmResult {
  success: boolean;
  attempts: number;
  cached: boolean;
  error?: string;
}

export interface WarmOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
}

export class SkyHookCacheWarmer {
  /**
   * Warm the SkyHook cache for an artist MBID.
   * Retries with exponential backoff until success or timeout.
   */
  async warmArtist(mbid: string, options: WarmOptions = {}): Promise<WarmResult> {
    return this.warm(`${SKYHOOK_API}/artist/${mbid}`, mbid, 'artist', options);
  }

  /**
   * Warm the SkyHook cache for an album/release-group MBID.
   */
  async warmAlbum(mbid: string, options: WarmOptions = {}): Promise<WarmResult> {
    return this.warm(`${SKYHOOK_API}/album/${mbid}`, mbid, 'album', options);
  }

  private async warm(
    url: string,
    mbid: string,
    type: 'artist' | 'album',
    options: WarmOptions
  ): Promise<WarmResult> {
    // Validate MBID
    if (!mbid) {
      throw new Error('MBID is required');
    }
    if (!UUID_REGEX.test(mbid)) {
      throw new Error(`Invalid MBID format: ${mbid}`);
    }

    const timeoutMs = options.timeoutMs ?? 30000;
    const initialDelayMs = options.initialDelayMs ?? 1000;
    
    const startTime = Date.now();
    let attempts = 0;
    let delay = initialDelayMs;

    log.debug(`Warming cache for ${type} ${mbid}...`);

    while (Date.now() - startTime < timeoutMs) {
      attempts++;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mixarr/1.0 (SkyHook Cache Warmer)',
          },
        });

        // 404 = doesn't exist in MusicBrainz, fail fast
        if (response.status === 404) {
          log.warn(`${type} ${mbid} not found in MusicBrainz (404)`);
          return {
            success: false,
            attempts,
            cached: false,
            error: `${type} not found in MusicBrainz`,
          };
        }

        // 503/504 = cache miss, retry
        if (response.status === 503 || response.status === 504) {
          log.debug(`Attempt ${attempts}: ${response.status} (cache miss), retrying in ${delay}ms`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, 8000); // Cap at 8s
          continue;
        }

        // Other errors
        if (!response.ok) {
          log.warn(`Attempt ${attempts}: HTTP ${response.status}, retrying in ${delay}ms`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, 8000);
          continue;
        }

        // Success - validate JSON response
        try {
          await response.json();
        } catch {
          log.warn(`Attempt ${attempts}: Invalid JSON response, retrying in ${delay}ms`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, 8000);
          continue;
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const wasCached = attempts === 1;
        
        if (wasCached) {
          log.debug(`${type} ${mbid} was already cached (${totalTime}s)`);
        } else {
          log.info(`${type} ${mbid} cache warmed after ${attempts} attempts (${totalTime}s)`);
        }

        return {
          success: true,
          attempts,
          cached: wasCached,
        };

      } catch (error) {
        // Network error - retry
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.debug(`Attempt ${attempts}: Network error (${message}), retrying in ${delay}ms`);
        await this.sleep(delay);
        delay = Math.min(delay * 2, 8000);
      }
    }

    // Timeout
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    log.warn(`${type} ${mbid} cache warm timeout after ${attempts} attempts (${totalTime}s)`);
    
    return {
      success: false,
      attempts,
      cached: false,
      error: `Cache warm timeout after ${attempts} attempts`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const skyhookWarmer = new SkyHookCacheWarmer();
