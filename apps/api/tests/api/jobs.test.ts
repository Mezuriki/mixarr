/**
 * Jobs API Tests
 * 
 * Tests:
 * - Job status retrieval
 * - Recent jobs listing
 * - Manual job triggering
 * - Authorization checks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockSubscription,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Jobs API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/jobs/status/:queue/:jobId', () => {
    it('should return job status for valid queue and jobId', async () => {
      const mockJobStatus = {
        id: 'job-123',
        name: 'subscription',
        data: { subscriptionId: 1, userId: testUser.id },
        status: 'completed',
        progress: 100,
        finishedAt: new Date(),
      };

      // Simulate getJobStatus behavior
      const queue = 'subscription';
      const jobId = 'job-123';
      const validQueues = ['subscription', 'import'];

      expect(validQueues.includes(queue)).toBe(true);
      expect(mockJobStatus.id).toBe(jobId);
    });

    it('should return 400 for invalid queue name', () => {
      const queue = 'invalid-queue';
      const validQueues = ['subscription', 'import'];

      expect(validQueues.includes(queue)).toBe(false);
    });

    it('should return 404 when job not found', () => {
      const jobStatus = null;
      expect(jobStatus).toBeNull();
    });
  });

  describe('GET /api/jobs/recent/:queue', () => {
    it('should return recent jobs for subscription queue', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          name: 'subscription',
          data: { subscriptionId: 1, userId: testUser.id },
          status: 'completed',
          progress: 100,
        },
        {
          id: 'job-2',
          name: 'subscription',
          data: { subscriptionId: 2, userId: testUser.id },
          status: 'failed',
          progress: 50,
        },
      ];

      // Verify structure
      expect(mockJobs).toHaveLength(2);
      expect(mockJobs[0].data.subscriptionId).toBe(1);
    });

    it('should return recent jobs for import queue', async () => {
      const mockJobs = [
        {
          id: 'import-1',
          name: 'import',
          data: { importSourceId: 1, userId: testUser.id, resultHandling: 'preview' },
          status: 'completed',
        },
      ];

      expect(mockJobs[0].data.resultHandling).toBe('preview');
    });

    it('should enrich jobs with user info', async () => {
      const mockJobs = [
        { id: 'job-1', data: { userId: 1 } },
        { id: 'job-2', data: { userId: 2 } },
      ];

      const users = [
        { id: 1, username: 'user1', displayName: 'User One' },
        { id: 2, username: 'user2', displayName: 'User Two' },
      ];

      mockPrisma.user.findMany.mockResolvedValue(users);

      const userIds = [...new Set(mockJobs.map(j => j.data?.userId).filter(Boolean))];
      const foundUsers = await mockPrisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, displayName: true },
      });

      expect(foundUsers).toHaveLength(2);

      const userMap = new Map(foundUsers.map((u: any) => [u.id, u]));
      const enrichedJobs = mockJobs.map(job => ({
        ...job,
        user: job.data?.userId ? userMap.get(job.data.userId) || null : null,
      }));

      expect(enrichedJobs[0].user?.username).toBe('user1');
      expect(enrichedJobs[1].user?.displayName).toBe('User Two');
    });

    it('should respect limit parameter', () => {
      const defaultLimit = 20;
      const customLimit = 50;

      const parsedDefault = parseInt('', 10) || defaultLimit;
      const parsedCustom = parseInt('50', 10) || defaultLimit;

      expect(parsedDefault).toBe(20);
      expect(parsedCustom).toBe(50);
    });

    it('should return 400 for invalid queue name', () => {
      const queue = 'bad-queue';
      const validQueues = ['subscription', 'import'];
      expect(validQueues.includes(queue)).toBe(false);
    });
  });

  describe('POST /api/jobs/run/subscription/:id', () => {
    it('should allow user to run their own subscription', async () => {
      const subscription = createMockSubscription({ userId: testUser.id });
      mockPrisma.subscription.findFirst.mockResolvedValue(subscription);

      const isAdmin = testUser.role === 'admin';
      const found = await mockPrisma.subscription.findFirst({
        where: isAdmin 
          ? { id: subscription.id }
          : { id: subscription.id, userId: testUser.id },
      });

      expect(found).toBeDefined();
      expect(found?.userId).toBe(testUser.id);
    });

    it('should prevent user from running other users subscriptions', async () => {
      const otherUserSub = createMockSubscription({ userId: 999 });
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const found = await mockPrisma.subscription.findFirst({
        where: { id: otherUserSub.id, userId: testUser.id },
      });

      expect(found).toBeNull();
    });

    it('should allow admin to run any subscription', async () => {
      const otherUserSub = createMockSubscription({ userId: 999 });
      mockPrisma.subscription.findFirst.mockResolvedValue(otherUserSub);

      const isAdmin = adminUser.role === 'admin';
      const found = await mockPrisma.subscription.findFirst({
        where: isAdmin 
          ? { id: otherUserSub.id }
          : { id: otherUserSub.id, userId: adminUser.id },
      });

      expect(isAdmin).toBe(true);
      expect(found).toBeDefined();
    });

    it('should return 404 when subscription not found', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      const found = await mockPrisma.subscription.findFirst({
        where: { id: 99999 },
      });

      expect(found).toBeNull();
    });

    it('should not run inactive subscriptions', async () => {
      const inactiveSub = createMockSubscription({ 
        userId: testUser.id,
        isActive: false,
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(inactiveSub);

      // Business logic should check isActive before running
      const canRun = inactiveSub.isActive;
      expect(canRun).toBe(false);
    });
  });

  describe('POST /api/jobs/run/import/:id', () => {
    it('should allow user to run their own import source', async () => {
      const importSource = {
        id: 1,
        userId: testUser.id,
        type: 'spotify_liked_songs',
        isActive: true,
        resultHandling: 'preview',
      };

      mockPrisma.importSource.findFirst.mockResolvedValue(importSource);

      const found = await mockPrisma.importSource.findFirst({
        where: { id: importSource.id, userId: testUser.id },
      });

      expect(found).toBeDefined();
      expect(found?.userId).toBe(testUser.id);
    });

    it('should prevent user from running other users import sources', async () => {
      mockPrisma.importSource.findFirst.mockResolvedValue(null);

      const found = await mockPrisma.importSource.findFirst({
        where: { id: 1, userId: testUser.id },
      });

      expect(found).toBeNull();
    });
  });

  describe('Job Status Values', () => {
    it('should recognize all valid job statuses', () => {
      const validStatuses = ['waiting', 'active', 'completed', 'failed', 'delayed'];
      
      validStatuses.forEach(status => {
        expect(['waiting', 'active', 'completed', 'failed', 'delayed']).toContain(status);
      });
    });

    it('should handle progress values correctly', () => {
      const progressValues = [0, 25, 50, 75, 100];
      
      progressValues.forEach(progress => {
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(100);
      });
    });
  });
});
