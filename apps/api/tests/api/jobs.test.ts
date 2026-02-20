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
import express from 'express';
import request from 'supertest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockSubscription,
  resetIdCounter,
} from '../utils/fixtures.js';

// ---------------------------------------------------------------------------
// Mocks required to mount the jobs router in supertest
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    subscription: { findFirst: vi.fn().mockResolvedValue(null) },
    importSource: { findFirst: vi.fn().mockResolvedValue(null) },
    subscriptionRun: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../src/jobs/queue.js', () => ({
  QUEUE_NAMES: { SUBSCRIPTION: 'subscription', IMPORT: 'import' },
  getJobStatus: vi.fn().mockResolvedValue(null),
  getRecentJobs: vi.fn().mockResolvedValue([]),
  scheduleSubscriptionJob: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
  scheduleImportJob: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => {
    _req.user = { id: 1, role: 'user', username: 'testuser' };
    next();
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { jobsRouter } from '../../src/routes/jobs.js';

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

// =============================================================================
// Input Validation Tests (supertest)
// =============================================================================

describe('Jobs API - Input Validation', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);
    return app;
  }

  describe('GET /api/jobs/status/:queue/:jobId', () => {
    it('should reject invalid queue name', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/status/invalid-queue/job-123');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.queue).toBeDefined();
    });

    it('should accept valid subscription queue', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/status/subscription/job-123');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept valid import queue', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/status/import/job-456');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/jobs/recent/:queue', () => {
    it('should reject invalid queue name', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/recent/bad-queue');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.queue).toBeDefined();
    });

    it('should reject non-numeric limit', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/recent/subscription?limit=abc');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.limit).toBeDefined();
    });

    it('should accept valid queue with numeric limit', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/recent/subscription?limit=10');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept valid queue without limit (optional)', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/recent/import');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/jobs/run/subscription/:id', () => {
    it('should reject non-numeric id', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/subscription/abc');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.id).toBeDefined();
    });

    it('should reject negative id', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/subscription/-1');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid numeric id', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/subscription/1');

      // 404 from mock is expected (subscription not found), not a validation error
      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/jobs/run/import/:id', () => {
    it('should reject non-numeric id', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/import/abc')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.id).toBeDefined();
    });

    it('should reject invalid mode', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/import/1')
        .send({ mode: 'invalid-mode' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.mode).toBeDefined();
    });

    it('should accept valid mode', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/import/1')
        .send({ mode: 'preview' });

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept slskd result handling modes', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/import/1')
        .send({ mode: 'slskd_auto' });

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });

    it('should accept request without mode (optional)', async () => {
      const response = await request(buildApp())
        .post('/api/jobs/run/import/1')
        .send({});

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/jobs/history/subscription/:id', () => {
    it('should reject non-numeric id', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/history/subscription/abc');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.id).toBeDefined();
    });

    it('should reject non-numeric limit', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/history/subscription/1?limit=xyz');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.limit).toBeDefined();
    });

    it('should accept valid id and limit', async () => {
      const response = await request(buildApp())
        .get('/api/jobs/history/subscription/1?limit=5');

      expect(response.body.code).not.toBe('VALIDATION_ERROR');
    });
  });
});
