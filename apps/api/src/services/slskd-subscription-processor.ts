/**
 * SlskdSubscriptionProcessor - Process subscription results and queue downloads
 * Implements per-file download model with transaction safety
 */

import { PrismaClient } from "@prisma/client";
import { SlskdService, SlskdFile } from "./slskd-service.js";
import { logger as log } from "../lib/logger.js";
import { enqueueSlskdSearch, SLSKD_QUEUE_NAME } from "../jobs/slskd-operations-queue.js";
import { isSlskdRateLimitingEnabled } from "../lib/settings.js";
import { QueueEvents } from "bullmq";
import { createRedisConnection } from "../lib/redis.js";

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
  status: "queued" | "no_results" | "error";
  downloadId?: number;
  searchResultCount?: number;
  error?: string;
}

export class SlskdSubscriptionProcessor {
  private readonly maxRetries = 3;
  private readonly retryDelay = 30000; // 30 seconds
  private queueEvents: QueueEvents;

  constructor(
    private prisma: PrismaClient,
    private slskdService: SlskdService,
    options?: { maxRetries?: number; retryDelay?: number },
  ) {
    if (options?.maxRetries !== undefined) {
      this.maxRetries = options.maxRetries;
    }
    if (options?.retryDelay !== undefined) {
      this.retryDelay = options.retryDelay;
    }
    this.queueEvents = new QueueEvents(SLSKD_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }

  async close() {
    await this.queueEvents.close();
  }

  async processArtist(
    artist: ProcessArtistRequest,
    context: ProcessContext,
  ): Promise<ProcessResult> {
    const { connectionId, preferences } = context;
    const searchText = `${artist.name} ${artist.album}`;

    try {
      // Retry loop for transient errors
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Check feature flag - fall back to direct call on error
          let useQueue = false;
          try {
            useQueue = await isSlskdRateLimitingEnabled();
          } catch (error) {
            log.warn("Failed to read rate limiting flag, falling back to direct call", { error });
          }

          let searchId: number;

          if (useQueue) {
            // Enqueue search and wait for completion
            log.info("Using rate-limited queue for search", {
              artist: artist.name,
              album: artist.album,
            });

            const searchJob = await enqueueSlskdSearch({
              searchText,
              searchTimeout: 30000,
              connectionId,
            });

            // Wait for job to complete (60s timeout includes queue wait + execution)
            const searchResult = await searchJob.waitUntilFinished(
              this.queueEvents,
              60000,
            );

            searchId = searchResult.searchId;
          } else {
            // Direct call (legacy path)
            log.info("Using direct slskd call (rate limiting disabled)", {
              artist: artist.name,
              album: artist.album,
            });

            const search = await this.slskdService.createSearch({
              searchText,
              searchTimeout: 30000,
            });

            searchId = search.id;
          }

          // Poll for results (simplified for testing)
          const searchResult = await this.slskdService.getSearch(searchId);

          if (searchResult.state === "Errored") {
            throw new Error("Search failed");
          }

          // No results is a valid response - do NOT retry
          if (!searchResult.responses.length) {
            return { status: "no_results", searchResultCount: 0 };
          }

          // Find best result (simplified scoring)
          const bestResult = this.selectBestResult(
            searchResult.responses,
            preferences,
          );
          if (!bestResult) {
            return {
              status: "no_results",
              searchResultCount: searchResult.responses.length,
            };
          }

          // Filter files
          const filesToDownload = this.filterFiles(
            bestResult.files,
            preferences,
          );
          if (!filesToDownload.length) {
            return {
              status: "no_results",
              searchResultCount: searchResult.responses.length,
            };
          }

          // Phase 1: Create download records with queued_locally status
          const downloads = await this.prisma.$transaction(
            filesToDownload.map((file) =>
              this.prisma.slskdDownload.create({
                data: {
                  connectionId,
                  artistName: artist.name,
                  albumName: artist.album,
                  username: bestResult.username,
                  filename: file.filename,
                  fileSize: BigInt(file.size),
                  searchId: searchId,
                  status: "queued_locally",
                },
              }),
            ),
          );

          // Phase 2: Queue files to slskd
          try {
            for (const file of filesToDownload) {
              await this.slskdService.queueDownload({
                username: bestResult.username,
                filename: file.filename,
              });
            }

            // Phase 3: Update status to pending on success
            await this.prisma.slskdDownload.updateMany({
              where: { id: { in: downloads.map((d) => d.id) } },
              data: { status: "pending" },
            });

            log.info("Queued slskd downloads", {
              artist: artist.name,
              album: artist.album,
              username: bestResult.username,
              fileCount: filesToDownload.length,
              downloadIds: downloads.map((d) => d.id),
            });

            return {
              status: "queued",
              downloadId: downloads[0]?.id,
              searchResultCount: searchResult.responses.length,
            };
          } catch (error) {
            // Queue failed - mark downloads as failed
            await this.prisma.slskdDownload.updateMany({
              where: { id: { in: downloads.map((d) => d.id) } },
              data: {
                status: "failed",
                error: error instanceof Error ? error.message : "Queue failed",
              },
            });

            log.error("Failed to queue downloads", {
              artist: artist.name,
              downloadIds: downloads.map((d) => d.id),
              error,
            });

            return {
              status: "error",
              error: error instanceof Error ? error.message : "Queue failed",
              searchResultCount: searchResult.responses.length,
            };
          }
        } catch (error) {
          // Retry on transient errors (timeout, network, slskd errors)
          if (attempt < this.maxRetries - 1) {
            log.warn("Search failed, retrying", {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              artist: artist.name,
              album: artist.album,
              error: error instanceof Error ? error.message : "Unknown error",
            });

            // Wait before retrying
            await new Promise((resolve) =>
              setTimeout(resolve, this.retryDelay),
            );
            continue;
          }

          // Max retries exceeded - throw error
          throw error;
        }
      }

      // This should never be reached, but TypeScript requires it
      throw new Error("Max retries exceeded without successful result");
    } catch (error) {
      log.error("Failed to process artist", { artist, error });
      throw error;
    }
  }

  private selectBestResult(
    responses: Array<{
      username: string;
      files: SlskdFile[];
      uploadSpeed: number;
    }>,
    _preferences: { preferLossless?: boolean },
  ) {
    if (!responses.length) return null;

    // Simplified: return first result with files
    return responses.find((r) => r.files.length > 0) || null;
  }

  private filterFiles(
    files: SlskdFile[],
    preferences: { preferLossless?: boolean; minBitrate?: number },
  ): SlskdFile[] {
    let filtered = files;

    if (preferences.preferLossless) {
      const lossless = files.filter((f) => f.extension === ".flac");
      if (lossless.length) filtered = lossless;
    }

    if (preferences.minBitrate) {
      filtered = filtered.filter(
        (f) => (f.bitRate || 0) >= (preferences.minBitrate || 0),
      );
    }

    return filtered;
  }
}
