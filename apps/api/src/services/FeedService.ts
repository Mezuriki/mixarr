/**
 * FeedService - Aggregates subscription results into deduplicated feed items.
 *
 * Deduplication strategy:
 * 1. Group by MBID when available (most reliable)
 * 2. Fall back to normalized artist name when no MBID
 *
 * Normalization: lowercase, strip "The " prefix, remove non-alphanumeric chars
 */

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

interface SubscriptionResultInput {
  id: number;
  artistName: string;
  artistMbid: string | null;
  subscriptionId: number;
  imageUrl?: string | null;
  sources: string[] | string | null | unknown;
  createdAt: Date;
  status: string;
}

export class FeedService {
  /**
   * Normalize artist name for deduplication.
   * Lowercase, remove "The " prefix, strip non-alphanumeric.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^the\s+/i, '')
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
        score: 0, // Calculated in scoring task
      });
    }

    return aggregated;
  }
}
