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

  constructor(prismaInstance?: PrismaClient) {
    this.prismaClient = (prismaInstance || prisma) as PrismaClient;
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
      items: paginated,
      total,
      stats: { pending, addedToday },
    };
  }
}
