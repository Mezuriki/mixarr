import { describe, it, expect } from 'vitest';
import { FeedService } from '../../src/services/FeedService';

/**
 * FeedService Test Suite
 *
 * Edge Cases Documented:
 * - Empty array: returns empty array
 * - Single item: returns unchanged with linkedResultIds
 * - Multiple items same MBID: deduplicates into one
 * - Multiple items same name no MBID: deduplicates by normalized name
 * - Mixed MBID and no-MBID: groups correctly
 *
 * Test Priority:
 * 1. Edge cases (empty, single)
 * 2. Aggregation logic (MBID dedup, name dedup)
 * 3. Scoring (future task)
 */

describe('FeedService', () => {
  describe('aggregateResults', () => {
    it('returns empty array when no results', () => {
      const service = new FeedService();
      const result = service.aggregateResults([]);
      expect(result).toEqual([]);
    });

    it('returns single item unchanged when one result', () => {
      const service = new FeedService();
      const results = [{
        id: 1,
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        subscriptionId: 1,
        imageUrl: 'http://example.com/img.jpg',
        createdAt: new Date('2026-01-30'),
        status: 'pending',
        sources: ['lastfm'],
      }];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].artistName).toBe('Radiohead');
      expect(aggregated[0].linkedResultIds).toEqual([1]);
    });

    it('deduplicates by MBID when available', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
      expect(aggregated[0].linkedResultIds).toEqual([1, 2]);
    });

    it('deduplicates by normalized name when no MBID', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'The Beatles', artistMbid: null, subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Beatles', artistMbid: null, subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
    });

    it('collects unique source types across results', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['lastfm', 'spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toContain('lastfm');
      expect(aggregated[0].sourceTypes).toContain('spotify');
      expect(aggregated[0].sourceCount).toBe(2);
    });

    it('uses earliest createdAt from linked results', () => {
      const service = new FeedService();
      const early = new Date('2026-01-01');
      const late = new Date('2026-01-30');
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: late, status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['spotify'], createdAt: early, status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].earliestFound).toEqual(early);
    });

    it('handles same subscription with multiple results', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      // Same subscription counted once
      expect(aggregated[0].subscriptionCount).toBe(1);
      expect(aggregated[0].linkedResultIds).toEqual([1, 2]);
    });

    it('prefers result with MBID for display data', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'beatles', artistMbid: null, subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'The Beatles', artistMbid: 'beatles-mbid', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].artistMbid).toBe('beatles-mbid');
      expect(aggregated[0].artistName).toBe('The Beatles');
    });

    it('generates consistent feed IDs from linked result IDs', () => {
      const service = new FeedService();
      const results = [
        { id: 3, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      // IDs should be sorted for consistency
      expect(aggregated[0].id).toBe('feed-1-3');
    });

    it('handles JSON string sources', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: '["lastfm", "spotify"]', createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toContain('lastfm');
      expect(aggregated[0].sourceTypes).toContain('spotify');
    });

    it('handles null/undefined sources gracefully', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: null, createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toEqual([]);
      expect(aggregated[0].sourceCount).toBe(0);
    });

    it('keeps different artists with different MBIDs separate', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Radiohead', artistMbid: 'radiohead-mbid', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Coldplay', artistMbid: 'coldplay-mbid', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(2);
    });
  });

  describe('calculateScore', () => {
    it('weights subscription count at 40%', () => {
      const service = new FeedService();
      // 2 subscriptions × 40 = 80 (before normalization)
      const score = service.calculateScore({
        subscriptionCount: 2,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0), // old, no recency bonus
      });
      expect(score).toBeGreaterThan(0);
    });

    it('weights source count at 30%', () => {
      const service = new FeedService();
      const scoreWith1Source = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreWith3Sources = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 3,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreWith3Sources).toBeGreaterThan(scoreWith1Source);
    });

    it('caps subscription count at 10', () => {
      const service = new FeedService();
      const scoreAt10 = service.calculateScore({
        subscriptionCount: 10,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreAt20 = service.calculateScore({
        subscriptionCount: 20,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreAt20).toBe(scoreAt10);
    });

    it('caps source count at 5', () => {
      const service = new FeedService();
      const scoreAt5 = service.calculateScore({
        subscriptionCount: 0,
        sourceCount: 5,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreAt10 = service.calculateScore({
        subscriptionCount: 0,
        sourceCount: 10,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreAt10).toBe(scoreAt5);
    });

    it('gives recency bonus for items under 24 hours old', () => {
      const service = new FeedService();
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: hourAgo,
      });
      const oldScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: weekAgo,
      });
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('gives partial recency bonus for items under 7 days old', () => {
      const service = new FeedService();
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recentishScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: threeDaysAgo,
      });
      const oldScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: monthAgo,
      });
      expect(recentishScore).toBeGreaterThan(oldScore);
    });
  });

  describe('aggregateAndScore', () => {
    it('sorts results by score descending', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'LowScore', artistMbid: 'a', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date('2020-01-01'), status: 'pending' },
        { id: 2, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 3, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const feed = service.aggregateAndScore(results);
      expect(feed[0].artistName).toBe('HighScore');
      expect(feed[1].artistName).toBe('LowScore');
    });
  });
});
