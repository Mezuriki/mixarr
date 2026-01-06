/**
 * slskd Subscription Processor
 * 
 * Handles searching slskd and queueing downloads as part of subscription processing.
 * Includes rate limiting and quality scoring for result selection.
 */

import { prisma } from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { SlskdService, SlskdSearchResponse, SlskdFile } from './slskd.js';

const log = createLogger('SlskdSubscriptionProcessor');

// Delay between searches to avoid hammering Soulseek network
export const SEARCH_DELAY_MS = 30000; // 30 seconds

// Maximum artists to process per subscription run
export const MAX_ARTISTS_PER_RUN = 25;

// How long to wait for search to complete (polling)
const SEARCH_TIMEOUT_MS = 60000; // 60 seconds
const SEARCH_POLL_INTERVAL_MS = 2000; // 2 seconds

export interface QualityPreferences {
  preferLossless: boolean;
  minBitrate?: number;
  preferVerifiedUploaders?: boolean;
}

export interface ProcessOptions {
  connectionId: number;
  userId: number;
  preferences: QualityPreferences;
  subscriptionId?: number;
  runId?: number;
}

export interface ProcessResult {
  status: 'queued' | 'not_found' | 'failed' | 'skipped';
  downloadId?: number;
  error?: string;
  searchResultCount?: number;
}

export class SlskdSubscriptionProcessor {
  constructor(private slskdService: SlskdService) {}

  /**
   * Score a search result based on quality preferences
   * Higher score = better match
   */
  scoreResult(result: SlskdSearchResponse, preferences: QualityPreferences): number {
    let score = 0;

    // Format scoring
    const hasLossless = result.files.some(f => 
      f.filename.toLowerCase().endsWith('.flac') ||
      f.filename.toLowerCase().endsWith('.wav') ||
      f.filename.toLowerCase().endsWith('.alac')
    );
    
    if (preferences.preferLossless && hasLossless) {
      score += 100;
    }

    // Check for high-quality MP3 if not lossless
    if (!hasLossless) {
      const hasHighBitrate = result.files.some(f => 
        f.bitRate && f.bitRate >= (preferences.minBitrate || 320)
      );
      if (hasHighBitrate) {
        score += 50;
      }
    }

    // Upload speed bonus (normalize to 0-50 points)
    if (result.uploadSpeed) {
      // 1 MB/s = 50 points, scale linearly
      score += Math.min(50, Math.floor(result.uploadSpeed / 20000));
    }

    // Free slot bonus
    if (result.hasFreeUploadSlot) {
      score += 30;
    }

    // File count (more files = more complete album)
    score += Math.min(20, result.files.length * 2);

    // Penalize if user has large queue
    if (result.queueLength && result.queueLength > 100) {
      score -= 20;
    }

    return score;
  }

  /**
   * Select the best result from search responses
   */
  selectBestResult(
    results: SlskdSearchResponse[], 
    preferences: QualityPreferences
  ): SlskdSearchResponse | null {
    if (results.length === 0) {
      return null;
    }

    let bestResult: SlskdSearchResponse | null = null;
    let bestScore = -1;

    for (const result of results) {
      const score = this.scoreResult(result, preferences);
      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }

    return bestResult;
  }

  /**
   * Wait for search to complete with polling
   */
  private async waitForSearch(searchId: string): Promise<{ 
    completed: boolean; 
    timedOut: boolean;
    responses: SlskdSearchResponse[];
  }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < SEARCH_TIMEOUT_MS) {
      const result = await this.slskdService.getSearchResults(searchId);
      
      if (result.state === 'Completed') {
        return { 
          completed: true, 
          timedOut: false, 
          responses: result.responses || [],
        };
      }
      
      if (result.state === 'TimedOut' || result.state === 'Errored' || result.state === 'Cancelled') {
        return { 
          completed: false, 
          timedOut: result.state === 'TimedOut', 
          responses: [],
        };
      }
      
      // Wait before polling again
      await this.sleep(SEARCH_POLL_INTERVAL_MS);
    }
    
    // Our own timeout
    return { completed: false, timedOut: true, responses: [] };
  }

  /**
   * Process a single artist - search slskd and optionally queue download
   */
  async processArtist(
    artist: { name: string; mbid?: string; album?: string },
    options: ProcessOptions
  ): Promise<ProcessResult> {
    const { connectionId, preferences } = options;
    const searchQuery = artist.album 
      ? `${artist.name} ${artist.album}`
      : artist.name;

    log.debug('Processing artist via slskd', { artist: artist.name, query: searchQuery });

    try {
      // Start search
      const search = await this.slskdService.search(searchQuery, {
        filterResponses: true,
        minimumResponseFileCount: 3, // At least a few tracks
      });

      // Wait for results
      const searchResult = await this.waitForSearch(search.id);

      if (!searchResult.completed) {
        if (searchResult.timedOut) {
          log.warn('Search timed out', { artist: artist.name });
          return { 
            status: 'failed', 
            error: 'Search timeout - no results within time limit',
            searchResultCount: 0,
          };
        }
        return { 
          status: 'failed', 
          error: 'Search failed or was cancelled',
          searchResultCount: 0,
        };
      }

      if (searchResult.responses.length === 0) {
        log.debug('No results found', { artist: artist.name });
        return { 
          status: 'not_found', 
          searchResultCount: 0,
        };
      }

      // Select best result
      const bestResult = this.selectBestResult(searchResult.responses, preferences);
      
      if (!bestResult) {
        return { 
          status: 'not_found', 
          searchResultCount: searchResult.responses.length,
        };
      }

      // Queue download
      const filesToDownload: Pick<SlskdFile, 'filename' | 'size'>[] = bestResult.files.map(f => ({
        filename: f.filename,
        size: f.size,
      }));

      await this.slskdService.queueDownload(bestResult.username, filesToDownload);

      // Calculate total size
      const totalSize = filesToDownload.reduce((sum, f) => sum + f.size, 0);

      // Track in database
      const download = await prisma.slskdDownload.create({
        data: {
          connectionId,
          artistName: artist.name,
          albumName: artist.album,
          username: bestResult.username,
          filename: filesToDownload[0]?.filename || '',
          fileSize: totalSize,
          searchId: search.id,
          status: 'pending',
        },
      });

      log.info('Queued slskd download', { 
        artist: artist.name, 
        username: bestResult.username,
        fileCount: filesToDownload.length,
        downloadId: download.id,
      });

      return { 
        status: 'queued', 
        downloadId: download.id,
        searchResultCount: searchResult.responses.length,
      };

    } catch (error) {
      log.error('Failed to process artist via slskd', { 
        artist: artist.name, 
        error: error instanceof Error ? error.message : String(error),
      });
      return { 
        status: 'failed', 
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process multiple artists with rate limiting
   */
  async processArtistBatch(
    artists: Array<{ name: string; mbid?: string; album?: string }>,
    options: ProcessOptions
  ): Promise<Map<string, ProcessResult>> {
    const results = new Map<string, ProcessResult>();
    const toProcess = artists.slice(0, MAX_ARTISTS_PER_RUN);

    log.info('Processing artist batch via slskd', { 
      total: artists.length, 
      processing: toProcess.length,
    });

    for (let i = 0; i < toProcess.length; i++) {
      const artist = toProcess[i];
      
      // Rate limit between searches
      if (i > 0) {
        log.debug('Rate limiting - waiting before next search', { 
          delayMs: SEARCH_DELAY_MS,
          progress: `${i + 1}/${toProcess.length}`,
        });
        await this.sleep(SEARCH_DELAY_MS);
      }

      const result = await this.processArtist(artist, options);
      results.set(artist.name, result);
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
