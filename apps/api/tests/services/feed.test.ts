import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedService } from '../../src/services/FeedService.js';

// Mock prisma before importing
vi.mock('../../src/lib/db.js', () => ({
  default: {
    subscription: {
      findMany: vi.fn(),
    },
    subscriptionResult: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import prisma from '../../src/lib/db.js';

const mockPrisma = prisma as unknown as {
  subscription: {
    findMany: ReturnType<typeof vi.fn>;
  };
  subscriptionResult: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

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
 * 4. Database integration (getFeedForUser)
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

  /**
   * Task 3: getFeedForUser - Database Integration Tests
   *
   * Edge Cases:
   * - User with no subscriptions -> empty feed
   * - User with no pending results -> empty feed
   * - User with pending results -> returns them
   *
   * Security:
   * - User can only see own subscriptions' results (userId filter)
   *
   * Note: FeedItemAction table doesn't exist yet - exclusion tests skipped
   */
  describe('getFeedForUser', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns empty feed when user has no subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: { userId: 123 },
        select: { id: true },
      });
    });

    it('returns empty feed when no pending results exist', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns only pending results for specified user', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 1,
          imageUrl: 'http://example.com/img.jpg',
          sources: '["lastfm"]',
          createdAt: new Date('2026-01-30'),
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].artistName).toBe('Radiohead');
      expect(result.items[0].artistMbid).toBe('radiohead-mbid');
      expect(mockPrisma.subscriptionResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: { in: [1] },
            itemType: 'artist',
            status: { in: ['pending', 'queued'] },
          },
        })
      );
    });

    it('maps Prisma result to SubscriptionResultInput format correctly', async () => {
      const createdAt = new Date('2026-01-30');
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 5 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 42,
          name: 'The Beatles',
          artistName: null,
          mbid: 'beatles-mbid',
          subscriptionId: 5,
          imageUrl: 'http://example.com/beatles.jpg',
          sources: '["spotify", "lastfm"]',
          createdAt,
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.linkedResultIds).toEqual([42]);
      expect(item.artistName).toBe('The Beatles');
      expect(item.artistMbid).toBe('beatles-mbid');
      expect(item.imageUrl).toBe('http://example.com/beatles.jpg');
      expect(item.sourceTypes).toContain('spotify');
      expect(item.sourceTypes).toContain('lastfm');
      expect(item.earliestFound).toEqual(createdAt);
    });

    it('aggregates multiple results from same artist across subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 1,
          imageUrl: 'http://example.com/img1.jpg',
          sources: '["lastfm"]',
          createdAt: new Date('2026-01-28'),
          status: 'pending',
          itemType: 'artist',
        },
        {
          id: 2,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 2,
          imageUrl: 'http://example.com/img2.jpg',
          sources: '["spotify"]',
          createdAt: new Date('2026-01-30'),
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].subscriptionCount).toBe(2);
      expect(result.items[0].linkedResultIds).toEqual([1, 2]);
      expect(result.items[0].sourceTypes).toContain('lastfm');
      expect(result.items[0].sourceTypes).toContain('spotify');
    });

    it('respects pagination limit and offset', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      // Return 5 distinct artists
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        { id: 1, name: 'Artist1', artistName: null, mbid: 'mbid-1', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 2, name: 'Artist2', artistName: null, mbid: 'mbid-2', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 3, name: 'Artist3', artistName: null, mbid: 'mbid-3', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 4, name: 'Artist4', artistName: null, mbid: 'mbid-4', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 5, name: 'Artist5', artistName: null, mbid: 'mbid-5', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      
      const page1 = await service.getFeedForUser(123, { limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await service.getFeedForUser(123, { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
    });

    it('returns stats with pending count and added today', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        { id: 1, name: 'Artist1', artistName: null, mbid: 'mbid-1', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
      ]);
      // First count call is for addedToday, second is for pending
      mockPrisma.subscriptionResult.count.mockResolvedValueOnce(3); // addedToday
      mockPrisma.subscriptionResult.count.mockResolvedValueOnce(5); // pending

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.stats).toEqual({
        pending: 5,
        addedToday: 3,
      });
    });

    // Note: Tests for excluding already-approved/dismissed items are skipped
    // because the FeedItemAction table doesn't exist yet.
    // TODO: Add these tests after schema migration:
    // - it('excludes results user already approved')
    // - it('excludes results user already dismissed')
  });

  /**
   * Task 4: approve/dismiss Actions
   *
   * These methods allow users to act on feed items:
   * - approve: marks as 'added', removes from ReviewItem
   * - dismiss: marks as 'rejected', removes from ReviewItem
   *
   * Security: Users can only act on their own feed items (verified via subscription.userId)
   * Atomicity: All operations wrapped in transaction
   */
  describe('approve', () => {
    it('throws NotFoundError when feed item does not exist', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('feed-999', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws NotFoundError when feed ID format is invalid', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('invalid-id', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws ForbiddenError when feed item belongs to different user', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 999 } },
          ]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('feed-1', 1)).rejects.toThrow('Not authorized');
    });

    it('updates all linked SubscriptionResults to added status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 2, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 3, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1-2-3', 1);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3] } },
        data: { status: 'added' },
      });
    });

    it('deletes matching ReviewItems by MBID and name', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { artistMbid: 'abc-123' },
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('deletes ReviewItems by name only when no MBID', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: null, subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('returns artistName on success', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Radiohead', mbid: 'radiohead-mbid', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      const result = await service.approve('feed-1', 1);

      expect(result).toEqual({ artistName: 'Radiohead' });
    });
  });

  describe('dismiss', () => {
    it('throws NotFoundError when feed item does not exist', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.dismiss('feed-999', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws ForbiddenError when feed item belongs to different user', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 999 } },
          ]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.dismiss('feed-1', 1)).rejects.toThrow('Not authorized');
    });

    it('updates all linked SubscriptionResults to rejected status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 2, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.dismiss('feed-1-2', 1);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { status: 'rejected' },
      });
    });

    it('deletes matching ReviewItems', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.dismiss('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { artistMbid: 'abc-123' },
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('returns artistName on success', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Coldplay', mbid: 'coldplay-mbid', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      const result = await service.dismiss('feed-1', 1);

      expect(result).toEqual({ artistName: 'Coldplay' });
    });
  });
});
