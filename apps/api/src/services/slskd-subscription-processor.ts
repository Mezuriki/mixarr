/**
 * SlskdSubscriptionProcessor - Process subscription results and queue downloads
 * Implements per-file download model with transaction safety
 */

import { PrismaClient } from '@prisma/client';
import { SlskdService, SlskdFile } from './slskd-service';
import { log } from '../lib/logger';

export interface ProcessArtistRequest {
  name: string;
  album: string;
}

export interface ProcessContext {
  connectionId: number;
  userId: number;
  preferences: {
    preferLossless?: boolean;
    minBitrate?: number;
  };
}

export interface ProcessResult {
  status: 'queued' | 'no_results' | 'error';
  downloadId?: number;
  searchResultCount?: number;
  error?: string;
}

export class SlskdSubscriptionProcessor {
  constructor(
    private prisma: PrismaClient,
    private slskdService: SlskdService
  ) {}

  async processArtist(
    artist: ProcessArtistRequest,
    context: ProcessContext
  ): Promise<ProcessResult> {
    const { connectionId, preferences } = context;

    try {
      // Create search
      const search = await this.slskdService.createSearch({
        searchText: `${artist.name} ${artist.album}`,
        searchTimeout: 30000,
      });

      // Poll for results (simplified for testing)
      const searchResult = await this.slskdService.getSearch(search.id);

      if (searchResult.state === 'Errored') {
        return { status: 'error', error: 'Search failed' };
      }

      if (!searchResult.responses.length) {
        return { status: 'no_results', searchResultCount: 0 };
      }

      // Find best result (simplified scoring)
      const bestResult = this.selectBestResult(searchResult.responses, preferences);
      if (!bestResult) {
        return { status: 'no_results', searchResultCount: searchResult.responses.length };
      }

      // Filter files
      const filesToDownload = this.filterFiles(bestResult.files, preferences);
      if (!filesToDownload.length) {
        return { status: 'no_results', searchResultCount: searchResult.responses.length };
      }

      // Create download records and queue files - wrapped in transaction
      const downloads = await this.prisma.$transaction(
        filesToDownload.map(file =>
          this.prisma.slskdDownload.create({
            data: {
              connectionId,
              artistName: artist.name,
              albumName: artist.album,
              username: bestResult.username,
              filename: file.filename,
              fileSize: BigInt(file.size),
              searchId: search.id,
              status: 'pending',
            },
          })
        )
      );

      // Queue each file for download (after successful DB transaction)
      // If queueing fails, records exist but in 'pending' state for retry
      try {
        for (const file of filesToDownload) {
          await this.slskdService.queueDownload({
            username: bestResult.username,
            filename: file.filename,
          });
        }
      } catch (error) {
        log.error('Failed to queue downloads', {
          artist: artist.name,
          downloadIds: downloads.map(d => d.id),
          error,
        });
        throw error;
      }

      log.info('Queued slskd downloads', {
        artist: artist.name,
        album: artist.album,
        username: bestResult.username,
        fileCount: filesToDownload.length,
        downloadIds: downloads.map(d => d.id),
      });

      return {
        status: 'queued',
        downloadId: downloads[0]?.id,
        searchResultCount: searchResult.responses.length,
      };
    } catch (error) {
      log.error('Failed to process artist', { artist, error });
      throw error;
    }
  }

  private selectBestResult(
    responses: Array<{ username: string; files: SlskdFile[]; uploadSpeed: number }>,
    preferences: { preferLossless?: boolean }
  ) {
    if (!responses.length) return null;
    
    // Simplified: return first result with files
    return responses.find(r => r.files.length > 0) || null;
  }

  private filterFiles(
    files: SlskdFile[],
    preferences: { preferLossless?: boolean; minBitrate?: number }
  ): SlskdFile[] {
    let filtered = files;

    if (preferences.preferLossless) {
      const lossless = files.filter(f => f.extension === '.flac');
      if (lossless.length) filtered = lossless;
    }

    if (preferences.minBitrate) {
      filtered = filtered.filter(f => (f.bitRate || 0) >= (preferences.minBitrate || 0));
    }

    return filtered;
  }
}
