/**
 * FeedService - Aggregates subscription results into deduplicated feed items.
 *
 * Deduplication strategy:
 * 1. Group by MBID when available (most reliable)
 * 2. Fall back to normalized artist name when no MBID
 *
 * Normalization: lowercase, strip "The " prefix, remove non-alphanumeric chars
 */

import prisma from '../lib/db.js';
import type { PrismaClient } from '@prisma/client';
import type { LidarrService } from './lidarr.js';
import type { LidarrConnectionConfig } from '../types/connections.js';
import { createLogger } from '../lib/logger.js';
import { fetchDeezerArtistImage } from './deezer.js';

const log = createLogger('FeedService');

/**
 * Error thrown when a feed item is not found
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when user is not authorized to access a resource
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AggregatedFeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  subscriptionCount: number;
  sourceTypes: string[];
  sourceCount: number;
  linkedResultIds: number[];
  earliestFound: Date;
  score: number;
}

export interface SubscriptionResultInput {
  id: number;
  artistName: string;
  artistMbid: string | null;
  subscriptionId: number;
  imageUrl?: string | null;
  sources: string[] | string | null | unknown;
  createdAt: Date;
  status: string;
}

export interface ScoreInput {
  subscriptionCount: number;
  sourceCount: number;
  librarySimilarity: number;
  earliestFound: Date;
}

export interface FeedResponse {
  items: AggregatedFeedItem[];
  total: number;
  stats: {
    pending: number;
    addedToday: number;
  };
}

export interface FeedOptions {
  limit: number;
  offset: number;
  includeActedOn?: boolean;
}

export class FeedService {
  private prismaClient: PrismaClient;
  private lidarrService?: LidarrService;
  private lidarrConfig?: LidarrConnectionConfig;

  constructor(
    prismaInstance?: PrismaClient,
    lidarrService?: LidarrService,
    lidarrConfig?: LidarrConnectionConfig
  ) {
    this.prismaClient = (prismaInstance || prisma) as PrismaClient;
    this.lidarrService = lidarrService;
    this.lidarrConfig = lidarrConfig;
  }

  /**
   * Normalize artist name for deduplication.
   * Lowercase, remove "The " prefix, strip non-alphanumeric.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Parse sources from various formats (JSON array, string, null, etc.)
   */
  private parseSources(sources: unknown): string[] {
    if (sources === null || sources === undefined) {
      return [];
    }
    if (Array.isArray(sources)) {
      return sources.filter((s): s is string => typeof s === 'string');
    }
    if (typeof sources === 'string') {
      try {
        const parsed = JSON.parse(sources);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Enrich feed items with images from Deezer for items missing imageUrl.
   * Fetches images in parallel for efficiency.
   */
  private async enrichWithImages(items: AggregatedFeedItem[]): Promise<AggregatedFeedItem[]> {
    const itemsNeedingImages = items.filter((item) => !item.imageUrl);
    if (itemsNeedingImages.length === 0) {
      return items;
    }

    // Fetch images in parallel
    const imagePromises = itemsNeedingImages.map(async (item) => {
      try {
        const imageUrl = await fetchDeezerArtistImage(item.artistName);
        return { id: item.id, imageUrl: imageUrl || null };
      } catch {
        return { id: item.id, imageUrl: null };
      }
    });

    const results = await Promise.all(imagePromises);
    const imageMap = new Map(results.map((r) => [r.id, r.imageUrl]));

    // Update items with fetched images
    return items.map((item) => {
      if (!item.imageUrl && imageMap.has(item.id)) {
        return { ...item, imageUrl: imageMap.get(item.id) || null };
      }
      return item;
    });
  }

  /**
   * Generate a synthetic feed item ID from linked result IDs.
   * Sorted for consistency.
   */
  private generateFeedId(linkedIds: number[]): string {
    const sorted = [...linkedIds].sort((a, b) => a - b);
    return `feed-${sorted.join('-')}`;
  }

  /**
   * Aggregate subscription results into deduplicated feed items.
   *
   * Groups results by MBID (preferred) or normalized artist name (fallback).
   * When an MBID match is found, also merges name-based matches into that group.
   * Collects source types, counts subscriptions, and tracks earliest found date.
   */
  aggregateResults(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
    if (results.length === 0) {
      return [];
    }

    // First pass: build MBID to normalized-name mapping
    const mbidToName = new Map<string, string>();
    const nameToMbid = new Map<string, string>();

    for (const result of results) {
      if (result.artistMbid) {
        const normalizedName = this.normalizeName(result.artistName);
        mbidToName.set(result.artistMbid, normalizedName);
        nameToMbid.set(normalizedName, result.artistMbid);
      }
    }

    // Group by canonical key (prefer MBID, but link name-based to existing MBID groups)
    const groups = new Map<string, SubscriptionResultInput[]>();

    for (const result of results) {
      let key: string;
      if (result.artistMbid) {
        key = result.artistMbid;
      } else {
        const normalizedName = this.normalizeName(result.artistName);
        // Check if we have an MBID for this normalized name
        key = nameToMbid.get(normalizedName) || normalizedName;
      }
      const existing = groups.get(key) || [];
      existing.push(result);
      groups.set(key, existing);
    }

    // Convert groups to aggregated items
    const aggregated: AggregatedFeedItem[] = [];

    for (const [, groupResults] of groups) {
      const linkedResultIds = groupResults.map((r) => r.id);
      const subscriptionIds = new Set(groupResults.map((r) => r.subscriptionId));

      // Collect all unique source types
      const allSources = new Set<string>();
      for (const r of groupResults) {
        const sources = this.parseSources(r.sources);
        sources.forEach((s) => allSources.add(s));
      }

      // Find earliest date
      const earliestFound = groupResults.reduce((earliest, r) => {
        return r.createdAt < earliest ? r.createdAt : earliest;
      }, groupResults[0].createdAt);

      // Prefer result with MBID for display data (better quality)
      const primary = groupResults.find((r) => r.artistMbid) || groupResults[0];

      aggregated.push({
        id: this.generateFeedId(linkedResultIds),
        artistName: primary.artistName,
        artistMbid: primary.artistMbid,
        imageUrl: primary.imageUrl || null,
        subscriptionCount: subscriptionIds.size,
        sourceTypes: Array.from(allSources),
        sourceCount: allSources.size,
        linkedResultIds,
        earliestFound,
        score: 0, // Calculated in aggregateAndScore
      });
    }

    return aggregated;
  }

  /**
   * Calculate value score for a feed item.
   * Formula: (subscriptionCount × 40) + (sourceCount × 30) + (librarySimilarity × 20) + (recencyBonus × 10)
   * Caps: subscriptionCount at 10, sourceCount at 5, librarySimilarity at 20
   */
  calculateScore(input: ScoreInput): number {
    const SUB_WEIGHT = 40;
    const SOURCE_WEIGHT = 30;
    const LIBRARY_WEIGHT = 20;
    const RECENCY_WEIGHT = 10;

    const subScore = Math.min(input.subscriptionCount, 10) * (SUB_WEIGHT / 10);
    const sourceScore = Math.min(input.sourceCount, 5) * (SOURCE_WEIGHT / 5);
    const libraryScore = Math.min(input.librarySimilarity, 20) * (LIBRARY_WEIGHT / 20);

    // Recency bonus
    const now = Date.now();
    const age = now - input.earliestFound.getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;

    let recencyBonus = 0;
    if (age < ONE_DAY) {
      recencyBonus = RECENCY_WEIGHT;
    } else if (age < ONE_WEEK) {
      recencyBonus = RECENCY_WEIGHT * 0.5;
    }

    return Math.round(subScore + sourceScore + libraryScore + recencyBonus);
  }

  /**
   * Aggregate results and calculate scores, sorted by score descending.
   */
  aggregateAndScore(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
    const aggregated = this.aggregateResults(results);

    // Calculate scores
    for (const item of aggregated) {
      item.score = this.calculateScore({
        subscriptionCount: item.subscriptionCount,
        sourceCount: item.sourceCount,
        librarySimilarity: 0, // MVP: not implemented
        earliestFound: item.earliestFound,
      });
    }

    // Sort by score descending
    return aggregated.sort((a, b) => b.score - a.score);
  }

  /**
   * Get feed for a specific user.
   * Queries SubscriptionResult records where status='pending' or 'queued',
   * joins with Subscription to filter by userId,
   * aggregates and scores results, then paginates.
   */
  async getFeedForUser(userId: number, options: FeedOptions): Promise<FeedResponse> {
    const { limit, offset, includeActedOn = false } = options;

    // Get user's subscription IDs
    const subscriptions = await this.prismaClient.subscription.findMany({
      where: { userId },
      select: { id: true },
    });

    if (subscriptions.length === 0) {
      return { items: [], total: 0, stats: { pending: 0, addedToday: 0 } };
    }

    const subscriptionIds = subscriptions.map((s) => s.id);

    // Filter statuses
    const statusFilter = includeActedOn
      ? ['pending', 'queued', 'added', 'rejected']
      : ['pending', 'queued'];

    // Fetch all matching results (artist type only for MVP)
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        itemType: 'artist',
        status: { in: statusFilter },
      },
      select: {
        id: true,
        name: true,
        artistName: true,
        mbid: true,
        subscriptionId: true,
        imageUrl: true,
        sources: true,
        createdAt: true,
        status: true,
        itemType: true,
      },
    });

    // Map Prisma result to SubscriptionResultInput format
    const mappedResults: SubscriptionResultInput[] = results.map((r) => ({
      id: r.id,
      // For artists, 'name' is the artist name; 'artistName' is used for albums
      artistName: r.name,
      artistMbid: r.mbid,
      subscriptionId: r.subscriptionId,
      imageUrl: r.imageUrl,
      sources: r.sources,
      createdAt: r.createdAt,
      status: r.status,
    }));

    // Aggregate and score
    const aggregated = this.aggregateAndScore(mappedResults);

    const total = aggregated.length;

    // Paginate
    const paginated = aggregated.slice(offset, offset + limit);

    // Enrich items missing images from Deezer
    const enrichedItems = await this.enrichWithImages(paginated);

    // Calculate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const addedToday = await this.prismaClient.subscriptionResult.count({
      where: {
        subscriptionId: { in: subscriptionIds },
        status: 'added',
        createdAt: { gte: today },
      },
    });

    const pending = await this.prismaClient.subscriptionResult.count({
      where: {
        subscriptionId: { in: subscriptionIds },
        status: { in: ['pending', 'queued'] },
      },
    });

    return {
      items: enrichedItems,
      total,
      stats: { pending, addedToday },
    };
  }

  /**
   * Parse linked result IDs from synthetic feed ID.
   * Feed IDs are in format "feed-1-2-3" where 1, 2, 3 are result IDs.
   */
  private parseFeedId(feedId: string): number[] {
    const match = feedId.match(/^feed-(.+)$/);
    if (!match) return [];
    return match[1].split('-').map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
  }

  /**
   * Approve a feed item: update status to 'added', remove from ReviewItem.
   * All linked SubscriptionResults are updated atomically.
   */
  async approve(feedId: string, userId: number): Promise<{ artistName: string }> {
    const resultIds = this.parseFeedId(feedId);
    if (resultIds.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Fetch results with subscription to verify ownership
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: { id: { in: resultIds } },
      include: { subscription: { select: { userId: true } } },
    });

    if (results.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Verify all belong to this user
    if (results.some((r) => r.subscription.userId !== userId)) {
      throw new ForbiddenError('Not authorized');
    }

    const artistName = results[0].name;
    const artistMbid = results[0].mbid;

    // Wrap in transaction
    await this.prismaClient.$transaction(async (tx) => {
      // Update all linked results
      await tx.subscriptionResult.updateMany({
        where: { id: { in: resultIds } },
        data: { status: 'added' },
      });

      // Delete matching ReviewItems (by MBID or name)
      const orConditions: { mbid?: string; artistName?: string }[] = [];
      if (artistMbid) {
        orConditions.push({ mbid: artistMbid });
      }
      orConditions.push({ artistName });

      await tx.reviewItem.deleteMany({
        where: { OR: orConditions },
      });
    });

    // Add to Lidarr (non-blocking) - happens after transaction completes
    if (
      artistMbid &&
      this.lidarrService &&
      this.lidarrConfig?.qualityProfileId &&
      this.lidarrConfig?.metadataProfileId &&
      this.lidarrConfig?.rootFolderPath
    ) {
      try {
        // Use addArtistWithCacheWarm like all other add operations in the codebase
        await this.lidarrService.addArtistWithCacheWarm(
          artistMbid,
          this.lidarrConfig.qualityProfileId,
          this.lidarrConfig.metadataProfileId,
          this.lidarrConfig.rootFolderPath,
          true,  // monitored
          true,  // searchForMissingAlbums
          false, // waitForRefresh (deprecated)
          this.lidarrConfig.monitorOption || 'all',
          this.lidarrConfig.monitorNewItems || 'all'
        );
        log.info(`Added artist to Lidarr: ${artistName} (${artistMbid})`);
      } catch (error) {
        // Non-blocking - Lidarr failure shouldn't fail the approve action
        log.warn(`Failed to add artist to Lidarr: ${artistMbid}`, error);
      }
    }

    return { artistName };
  }

  /**
   * Dismiss a feed item: update status to 'rejected', remove from ReviewItem.
   * All linked SubscriptionResults are updated atomically.
   */
  async dismiss(feedId: string, userId: number): Promise<{ artistName: string }> {
    const resultIds = this.parseFeedId(feedId);
    if (resultIds.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Fetch results with subscription to verify ownership
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: { id: { in: resultIds } },
      include: { subscription: { select: { userId: true } } },
    });

    if (results.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Verify all belong to this user
    if (results.some((r) => r.subscription.userId !== userId)) {
      throw new ForbiddenError('Not authorized');
    }

    const artistName = results[0].name;
    const artistMbid = results[0].mbid;

    // Wrap in transaction
    await this.prismaClient.$transaction(async (tx) => {
      // Update all linked results
      await tx.subscriptionResult.updateMany({
        where: { id: { in: resultIds } },
        data: { status: 'rejected' },
      });

      // Delete matching ReviewItems (by MBID or name)
      const orConditions: { mbid?: string; artistName?: string }[] = [];
      if (artistMbid) {
        orConditions.push({ mbid: artistMbid });
      }
      orConditions.push({ artistName });

      await tx.reviewItem.deleteMany({
        where: { OR: orConditions },
      });
    });

    return { artistName };
  }
}
