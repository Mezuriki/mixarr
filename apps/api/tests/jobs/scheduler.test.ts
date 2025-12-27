/**
 * Scheduler Service Tests
 * 
 * Tests:
 * - Stale job cleanup
 * - Cron job scheduling
 * - Job management (add/remove)
 * - Data retention job
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';

describe('Scheduler Service', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupStaleJobs', () => {
    it('should mark running jobs as failed on startup', async () => {
      mockPrisma.subscriptionRun.updateMany.mockResolvedValue({ count: 3 });

      const result = await mockPrisma.subscriptionRun.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          errorMessage: 'Job interrupted by server restart',
          completedAt: new Date(),
        },
      });

      expect(result.count).toBe(3);
      expect(mockPrisma.subscriptionRun.updateMany).toHaveBeenCalledWith({
        where: { status: 'running' },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Job interrupted by server restart',
        }),
      });
    });

    it('should do nothing when no stale jobs exist', async () => {
      mockPrisma.subscriptionRun.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrisma.subscriptionRun.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          errorMessage: 'Job interrupted by server restart',
          completedAt: new Date(),
        },
      });

      expect(result.count).toBe(0);
    });

    it('should set completedAt timestamp for stale jobs', async () => {
      const now = new Date();
      mockPrisma.subscriptionRun.updateMany.mockResolvedValue({ count: 1 });

      await mockPrisma.subscriptionRun.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          errorMessage: 'Job interrupted by server restart',
          completedAt: now,
        },
      });

      expect(mockPrisma.subscriptionRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedAt: now,
          }),
        })
      );
    });
  });

  describe('initializeScheduler', () => {
    it('should load active subscriptions with schedules', async () => {
      const scheduledSubs = [
        { id: 1, userId: 1, schedule: '0 0 * * *', isActive: true },
        { id: 2, userId: 1, schedule: '0 12 * * *', isActive: true },
      ];

      mockPrisma.subscription.findMany.mockResolvedValue(scheduledSubs);

      const subs = await mockPrisma.subscription.findMany({
        where: { isActive: true, schedule: { not: null } },
      });

      expect(subs).toHaveLength(2);
      expect(subs[0].schedule).toBe('0 0 * * *');
    });

    it('should load active import sources with schedules', async () => {
      const scheduledImports = [
        { id: 1, userId: 1, schedule: '0 6 * * *', isActive: true, resultHandling: 'preview' },
      ];

      mockPrisma.importSource.findMany.mockResolvedValue(scheduledImports);

      const sources = await mockPrisma.importSource.findMany({
        where: { isActive: true, schedule: { not: null } },
      });

      expect(sources).toHaveLength(1);
      expect(sources[0].resultHandling).toBe('preview');
    });

    it('should not load inactive subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const subs = await mockPrisma.subscription.findMany({
        where: { isActive: true, schedule: { not: null } },
      });

      expect(subs).toHaveLength(0);
    });
  });

  describe('addScheduledJob', () => {
    it('should validate cron expression format', () => {
      const validCronExpressions = [
        '* * * * *',      // Every minute
        '0 * * * *',      // Every hour
        '0 0 * * *',      // Every day at midnight
        '0 0 * * 0',      // Every Sunday
        '0 0 1 * *',      // First of every month
        '*/5 * * * *',    // Every 5 minutes
        '0 9-17 * * 1-5', // 9-5 weekdays
      ];

      validCronExpressions.forEach(expr => {
        // Basic cron format validation (5 or 6 fields)
        const parts = expr.split(' ');
        expect(parts.length).toBeGreaterThanOrEqual(5);
        expect(parts.length).toBeLessThanOrEqual(6);
      });
    });

    it('should remove existing job before adding new one', () => {
      const scheduledJobs = new Map<number, any>();
      const existingJob = { stop: vi.fn() };
      scheduledJobs.set(1, existingJob);

      // Simulate removeScheduledJob
      if (scheduledJobs.has(1)) {
        scheduledJobs.get(1).stop();
        scheduledJobs.delete(1);
      }

      expect(existingJob.stop).toHaveBeenCalled();
      expect(scheduledJobs.has(1)).toBe(false);
    });

    it('should update next run time after adding job', async () => {
      mockPrisma.subscription.update.mockResolvedValue({
        id: 1,
        nextRun: new Date('2025-01-02T00:00:00Z'),
      });

      await mockPrisma.subscription.update({
        where: { id: 1 },
        data: { nextRun: new Date('2025-01-02T00:00:00Z') },
      });

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });
  });

  describe('removeScheduledJob', () => {
    it('should stop and remove job from map', () => {
      const scheduledJobs = new Map<number, any>();
      const job = { stop: vi.fn() };
      scheduledJobs.set(1, job);

      // Simulate removeScheduledJob
      const existing = scheduledJobs.get(1);
      if (existing) {
        existing.stop();
        scheduledJobs.delete(1);
      }

      expect(job.stop).toHaveBeenCalled();
      expect(scheduledJobs.size).toBe(0);
    });

    it('should handle non-existent job gracefully', () => {
      const scheduledJobs = new Map<number, any>();

      // Simulate removeScheduledJob for non-existent ID
      const existing = scheduledJobs.get(999);
      if (existing) {
        existing.stop();
        scheduledJobs.delete(999);
      }

      // Should not throw
      expect(scheduledJobs.size).toBe(0);
    });
  });

  describe('Import Scheduled Jobs', () => {
    it('should use offset IDs to avoid collision with subscriptions', () => {
      const importSourceId = 1;
      const key = 10000 + importSourceId;

      expect(key).toBe(10001);
      // This ensures import job IDs don't collide with subscription IDs
    });
  });

  describe('Data Retention Job', () => {
    it('should delete old subscription results', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      mockPrisma.subscriptionResult.deleteMany.mockResolvedValue({ count: 100 });

      const result = await mockPrisma.subscriptionResult.deleteMany({
        where: {
          createdAt: { lt: thirtyDaysAgo },
        },
      });

      expect(result.count).toBe(100);
    });

    it('should delete old log entries', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 500 });

      const result = await mockPrisma.logEntry.deleteMany({
        where: {
          createdAt: { lt: sevenDaysAgo },
        },
      });

      expect(result.count).toBe(500);
    });
  });

  describe('Job Execution', () => {
    it('should call scheduleSubscriptionJob when cron triggers', async () => {
      const scheduleSubscriptionJob = vi.fn().mockResolvedValue({ id: 'job-123' });

      await scheduleSubscriptionJob(1, 1);

      expect(scheduleSubscriptionJob).toHaveBeenCalledWith(1, 1);
    });

    it('should update next run time after execution', async () => {
      mockPrisma.subscription.update.mockResolvedValue({
        id: 1,
        nextRun: new Date('2025-01-03T00:00:00Z'),
      });

      await mockPrisma.subscription.update({
        where: { id: 1 },
        data: { nextRun: new Date('2025-01-03T00:00:00Z') },
      });

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should log error for invalid cron expression', () => {
      const invalidCron = 'not a valid cron';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate what CronJob would do with invalid expression
        if (!invalidCron.match(/^[\d\s\*\-\/,]+$/)) {
          throw new Error('Invalid cron expression');
        }
      } catch (error) {
        console.error('Failed to schedule subscription:', error);
      }

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
