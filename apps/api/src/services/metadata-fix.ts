/**
 * MetadataFixService
 * 
 * Fixes missing metadata for artists in Lidarr by:
 * 1. Warming the SkyHook cache (to ensure metadata is available)
 * 2. Triggering a refresh in Lidarr
 * 3. Reporting what was fixed and what's still missing
 * 
 * This service is useful for artists that were added before the cache
 * warmer was implemented, or where the initial add failed to get metadata.
 */

import { createLogger } from '../lib/logger.js';
import type { SkyHookCacheWarmer } from './skyhook-cache-warmer.js';
import type { LidarrService, LidarrArtist, LidarrCommand } from './lidarr.js';

const log = createLogger('MetadataFix');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FixResult {
  success: boolean;
  artist: {
    id: number;
    name: string;
    hasPoster: boolean;
    hasOverview: boolean;
    hasGenres: boolean;
  };
  fixed: string[];
  stillMissing: string[];
}

interface MetadataState {
  hasPoster: boolean;
  hasOverview: boolean;
  hasGenres: boolean;
}

export class MetadataFixService {
  private warmer: SkyHookCacheWarmer;

  constructor(warmer: SkyHookCacheWarmer) {
    this.warmer = warmer;
  }

  /**
   * Fix missing metadata for a single artist.
   * 
   * @param lidarr - The Lidarr service instance to use
   * @param artistId - The Lidarr artist ID (must be a positive integer)
   * @param mbid - The MusicBrainz ID for the artist
   * @returns FixResult with details of what was fixed
   * @throws Error if inputs are invalid, artist not found, or Lidarr operations fail
   */
  async fixArtist(
    lidarr: LidarrService,
    artistId: number,
    mbid: string
  ): Promise<FixResult> {
    // Validate inputs
    this.validateArtistId(artistId);
    this.validateMbid(mbid);

    log.info(`Starting metadata fix for artist ${artistId} (MBID: ${mbid})`);

    // Fetch current artist state
    const artistBefore = await this.fetchArtist(lidarr, artistId);
    const stateBefore = this.extractMetadataState(artistBefore);

    log.debug(`Artist "${artistBefore.artistName}" current state:`, stateBefore);

    // Warm the SkyHook cache
    const warmResult = await this.warmer.warmArtist(mbid);
    const cacheWarmed = warmResult.success;
    
    if (!cacheWarmed) {
      log.warn(`Cache warm failed for ${mbid}: ${warmResult.error}`);
    } else {
      log.debug(`Cache warmed successfully for ${mbid}`);
    }

    // Trigger Lidarr refresh
    await this.refreshArtistWithTimeout(lidarr, artistId);

    // Fetch updated artist state
    const artistAfter = await this.fetchArtist(lidarr, artistId);
    const stateAfter = this.extractMetadataState(artistAfter);

    log.debug(`Artist "${artistAfter.artistName}" new state:`, stateAfter);

    // Determine what changed
    const fixed = this.determineFixed(stateBefore, stateAfter);
    const stillMissing = this.determineStillMissing(stateAfter);

    // Success is true only if cache warmed AND no missing metadata remains
    const success = cacheWarmed && stillMissing.length === 0;

    if (fixed.length > 0) {
      log.info(`Fixed metadata for "${artistAfter.artistName}": ${fixed.join(', ')}`);
    }
    if (stillMissing.length > 0) {
      log.warn(`Still missing for "${artistAfter.artistName}": ${stillMissing.join(', ')}`);
    }

    return {
      success,
      artist: {
        id: artistAfter.id,
        name: artistAfter.artistName,
        hasPoster: stateAfter.hasPoster,
        hasOverview: stateAfter.hasOverview,
        hasGenres: stateAfter.hasGenres,
      },
      fixed,
      stillMissing,
    };
  }

  private validateArtistId(artistId: number): void {
    if (!Number.isInteger(artistId) || artistId <= 0) {
      throw new Error('Artist ID must be a positive integer');
    }
  }

  private validateMbid(mbid: string): void {
    if (!mbid) {
      throw new Error('MBID is required');
    }
    if (!UUID_REGEX.test(mbid)) {
      throw new Error(`Invalid MBID format: ${mbid}`);
    }
  }

  private async fetchArtist(lidarr: LidarrService, artistId: number): Promise<LidarrArtist> {
    const artist = await lidarr.getArtist(artistId);
    if (!artist) {
      throw new Error(`Artist with ID ${artistId} not found in Lidarr`);
    }
    return artist;
  }

  private extractMetadataState(artist: LidarrArtist): MetadataState {
    return {
      hasPoster: this.hasPoster(artist),
      hasOverview: this.hasOverview(artist),
      hasGenres: this.hasGenres(artist),
    };
  }

  private hasPoster(artist: LidarrArtist): boolean {
    return Boolean(
      artist.images &&
      artist.images.length > 0 &&
      artist.images.some(img => img.coverType === 'poster' && img.url)
    );
  }

  private hasOverview(artist: LidarrArtist): boolean {
    return Boolean(artist.overview && artist.overview.trim().length > 0);
  }

  private hasGenres(artist: LidarrArtist): boolean {
    return Boolean(artist.genres && artist.genres.length > 0);
  }

  private async refreshArtistWithTimeout(
    lidarr: LidarrService,
    artistId: number
  ): Promise<LidarrCommand> {
    const command = await lidarr.refreshArtist(artistId);
    log.debug(`Refresh command ${command.id} started for artist ${artistId}`);

    try {
      const result = await lidarr.waitForCommand(command.id);
      
      if (result.status === 'failed') {
        throw new Error(`Lidarr refresh command failed: ${result.message || 'Unknown error'}`);
      }
      
      if (result.status === 'aborted') {
        throw new Error('Lidarr refresh command was aborted');
      }
      
      return result;
    } catch (error) {
      // Check if it's a timeout error from waitForCommand
      if (error instanceof Error && error.message.includes('did not complete within')) {
        throw new Error('Lidarr refresh command timed out');
      }
      throw error;
    }
  }

  private determineFixed(before: MetadataState, after: MetadataState): string[] {
    const fixed: string[] = [];
    
    if (!before.hasPoster && after.hasPoster) {
      fixed.push('poster');
    }
    if (!before.hasOverview && after.hasOverview) {
      fixed.push('overview');
    }
    if (!before.hasGenres && after.hasGenres) {
      fixed.push('genres');
    }
    
    return fixed;
  }

  private determineStillMissing(state: MetadataState): string[] {
    const missing: string[] = [];
    
    if (!state.hasPoster) {
      missing.push('poster');
    }
    if (!state.hasOverview) {
      missing.push('overview');
    }
    if (!state.hasGenres) {
      missing.push('genres');
    }
    
    return missing;
  }
}
