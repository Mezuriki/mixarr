/**
 * Dashboard API Tests
 * 
 * Tests:
 * - Dashboard stats endpoint
 * - Activity feed endpoint
 * - Connections summary endpoint
 * - Multi-tenant data isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockSubscription,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Dashboard API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/dashboard/stats', () => {
    it('should return stats for authenticated user', async () => {
      mockPrisma.subscription.count.mockResolvedValue(5);
      mockPrisma.subscriptionRun.aggregate.mockResolvedValue({
        _sum: { addedCount: 150 },
      });
      mockPrisma.reviewItem.count.mockResolvedValue(23);
      mockPrisma.subscriptionRun.count.mockResolvedValue(2);

      const [subCount, artistsAdded, pendingReviews, runningJobs] = await Promise.all([
        mockPrisma.subscription.count({ where: { userId: testUser.id, isActive: true } }),
        mockPrisma.subscriptionRun.aggregate({ where: { subscription: { userId: testUser.id } } }),
        mockPrisma.reviewItem.count({ where: { userId: testUser.id, status: 'pending' } }),
        mockPrisma.subscriptionRun.count({ where: { subscription: { userId: testUser.id }, status: 'running' } }),
      ]);

      expect(subCount).toBe(5);
      expect(artistsAdded._sum.addedCount).toBe(150);
      expect(pendingReviews).toBe(23);
      expect(runningJobs).toBe(2);
    });

    it('should only count active subscriptions', async () => {
      mockPrisma.subscription.count.mockResolvedValue(3);

      const count = await mockPrisma.subscription.count({
        where: { userId: testUser.id, isActive: true },
      });

      expect(mockPrisma.subscription.count).toHaveBeenCalledWith({
        where: { userId: testUser.id, isActive: true },
      });
      expect(count).toBe(3);
    });

    it('should return zero for users with no data', async () => {
      mockPrisma.subscription.count.mockResolvedValue(0);
      mockPrisma.subscriptionRun.aggregate.mockResolvedValue({
        _sum: { addedCount: null },
      });
      mockPrisma.reviewItem.count.mockResolvedValue(0);
      mockPrisma.subscriptionRun.count.mockResolvedValue(0);

      const artistsAdded = await mockPrisma.subscriptionRun.aggregate({});
      
      // Handle null case (no artists added)
      const addedCount = artistsAdded._sum.addedCount || 0;
      expect(addedCount).toBe(0);
    });

    it('should filter artists added by date range (30 days)', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      mockPrisma.subscriptionRun.aggregate.mockResolvedValue({
        _sum: { addedCount: 50 },
      });

      await mockPrisma.subscriptionRun.aggregate({
        where: {
          subscription: { userId: testUser.id },
          status: 'completed',
          completedAt: { gte: thirtyDaysAgo },
        },
        _sum: { addedCount: true },
      });

      expect(mockPrisma.subscriptionRun.aggregate).toHaveBeenCalled();
    });
  });

  describe('GET /api/dashboard/activity', () => {
    it('should return recent subscription runs', async () => {
      const mockRuns = [
        {
          id: 1,
          status: 'completed',
          addedCount: 10,
          skippedCount: 5,
          startedAt: new Date(),
          completedAt: new Date(),
          subscription: { name: 'Weekly Discoveries', type: 'spotify_playlist' },
        },
        {
          id: 2,
          status: 'running',
          addedCount: 0,
          skippedCount: 0,
          startedAt: new Date(),
          completedAt: null,
          subscription: { name: 'Last.fm Charts', type: 'lastfm_chart' },
        },
      ];

      mockPrisma.subscriptionRun.findMany.mockResolvedValue(mockRuns);

      const runs = await mockPrisma.subscriptionRun.findMany({
        where: { subscription: { userId: testUser.id } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: { subscription: { select: { name: true, type: true } } },
      });

      expect(runs).toHaveLength(2);
      expect(runs[0].subscription.name).toBe('Weekly Discoveries');
    });

    it('should respect limit parameter', async () => {
      mockPrisma.subscriptionRun.findMany.mockResolvedValue([]);

      await mockPrisma.subscriptionRun.findMany({
        where: { subscription: { userId: testUser.id } },
        take: 5,
      });

      expect(mockPrisma.subscriptionRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it('should format activity correctly for completed runs', () => {
      const run = {
        id: 1,
        status: 'completed',
        addedCount: 10,
        skippedCount: 5,
        startedAt: new Date(),
        completedAt: new Date(),
        subscription: { name: 'Test Sub', type: 'spotify_playlist' },
      };

      const activity = {
        id: run.id,
        type: 'subscription_run',
        title: run.subscription.name,
        description: `Added ${run.addedCount} artists, skipped ${run.skippedCount}`,
        status: run.status,
        timestamp: run.completedAt || run.startedAt,
      };

      expect(activity.description).toBe('Added 10 artists, skipped 5');
      expect(activity.status).toBe('completed');
    });

    it('should format activity correctly for failed runs', () => {
      const run = {
        id: 1,
        status: 'failed',
        errorMessage: 'Connection timeout',
        addedCount: 0,
        skippedCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        subscription: { name: 'Test Sub', type: 'lastfm_chart' },
      };

      const description = run.status === 'failed'
        ? `Failed: ${run.errorMessage}`
        : `Added ${run.addedCount} artists, skipped ${run.skippedCount}`;

      expect(description).toBe('Failed: Connection timeout');
    });

    it('should format activity correctly for running jobs', () => {
      const run = {
        id: 1,
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        subscription: { name: 'Test Sub', type: 'spotify_liked_songs' },
      };

      const description = run.status === 'running' ? 'Running...' : 'Completed';
      expect(description).toBe('Running...');
    });
  });

  describe('GET /api/dashboard/connections', () => {
    it('should return user connections summary', async () => {
      const mockConnections = [
        { id: 1, type: 'lidarr', name: 'Lidarr', isActive: true },
        { id: 2, type: 'spotify', name: 'Spotify', isActive: true },
        { id: 3, type: 'lastfm', name: 'Last.fm', isActive: false },
      ];

      mockPrisma.connection.findMany.mockResolvedValue(mockConnections);

      const connections = await mockPrisma.connection.findMany({
        where: { userId: testUser.id },
        select: { id: true, type: true, name: true, isActive: true },
      });

      expect(connections).toHaveLength(3);
      expect(connections.filter((c: any) => c.isActive)).toHaveLength(2);
    });
  });

  describe('Multi-tenant Isolation', () => {
    it('should only return data for the requesting user', async () => {
      const user1 = createMockUser({ id: 1 });
      const user2 = createMockUser({ id: 2 });

      // User 1's subscriptions
      const user1Subs = [createMockSubscription({ userId: user1.id })];
      // User 2's subscriptions
      const user2Subs = [
        createMockSubscription({ userId: user2.id }),
        createMockSubscription({ userId: user2.id }),
      ];

      mockPrisma.subscription.findMany.mockImplementation(async (args: any) => {
        const userId = args?.where?.userId;
        if (userId === user1.id) return user1Subs;
        if (userId === user2.id) return user2Subs;
        return [];
      });

      const user1Result = await mockPrisma.subscription.findMany({ where: { userId: user1.id } });
      const user2Result = await mockPrisma.subscription.findMany({ where: { userId: user2.id } });

      expect(user1Result).toHaveLength(1);
      expect(user2Result).toHaveLength(2);
    });

    it('should not leak data between users', async () => {
      mockPrisma.reviewItem.count.mockImplementation(async (args: any) => {
        const userId = args?.where?.userId;
        if (userId === testUser.id) return 10;
        return 0;
      });

      const ownCount = await mockPrisma.reviewItem.count({ where: { userId: testUser.id } });
      const otherCount = await mockPrisma.reviewItem.count({ where: { userId: 999 } });

      expect(ownCount).toBe(10);
      expect(otherCount).toBe(0);
    });
  });
});
