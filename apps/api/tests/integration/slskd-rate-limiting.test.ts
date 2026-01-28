// Mock SlskdService to return quickly (must be before worker import)
vi.mock('../../src/services/slskd-service');

import { QueueEvents, Worker } from 'bullmq';
import { slskdQueue, enqueueSlskdSearch } from '../../src/jobs/slskd-operations-queue';
import { prisma } from '../../src/lib/db';
import { createRedisConnection } from '../../src/lib/redis';
import { SlskdService } from '../../src/services/slskd-service';

describe('SLSKD Rate Limiting Integration', () => {
  let connection: any;
  let queueEvents: QueueEvents;
  let worker: Worker;
  let testUser: any;
  
  beforeAll(async () => {
    // Create or find test user for FK constraint (CRITICAL #4)
    testUser = await prisma.user.upsert({
      where: { email: 'test-rate-limit@mixarr.local' },
      update: {},
      create: {
        username: 'test-rate-limit',
        email: 'test-rate-limit@mixarr.local',
        passwordHash: 'test-hash',
        displayName: 'Rate Limit Test',
      },
    });

    // Clean up any existing test connections
    await prisma.connection.deleteMany({
      where: { name: 'Rate Limit Test Connection' },
    });
    
    // Create QueueEvents instance FIRST for waiting on job completion (CRITICAL #3)
    queueEvents = new QueueEvents(slskdQueue.name, {
      connection: createRedisConnection(),
    });
    
    // Wait for QueueEvents to be ready before proceeding (CRITICAL #3)
    await queueEvents.waitUntilReady();
    
    // Import and start worker AFTER QueueEvents is ready (CRITICAL #1, #8)
    // This ensures event listeners are attached before jobs start processing
    // Note: This test assumes a single worker instance for deterministic rate limiting behavior
    const { slskdWorker } = await import('../../src/jobs/slskd-operations-worker');
    worker = slskdWorker;
    
    // Create test connection
    connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Rate Limit Test Connection',
        userId: testUser.id,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    
    // Mock SlskdService to return quickly
    vi.mocked(SlskdService).mockImplementation(function(this: any) {
      this.createSearch = vi.fn().mockResolvedValue({ 
        id: Math.floor(Math.random() * 1000) 
      });
      return this;
    } as any);
  });
  
  afterAll(async () => {
    // Use try-finally to ensure cleanup even on test failure (CRITICAL #2, #6)
    try {
      // Close worker first to stop processing (CRITICAL #1)
      if (worker) {
        await worker.close();
      }
    } finally {
      try {
        // Close QueueEvents connection (CRITICAL #2)
        if (queueEvents) {
          await queueEvents.close();
        }
      } finally {
        // Clean up test data
        if (connection) {
          await prisma.connection.delete({ where: { id: connection.id } }).catch(() => {});
        }
        if (testUser) {
          await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
        }
      }
    }
  });
  
  test('rate limiter enforces 5s spacing between jobs', async () => {
    // Enqueue 3 searches in parallel
    const jobs = await Promise.all([
      enqueueSlskdSearch({ searchText: 'Artist A', connectionId: connection.id }),
      enqueueSlskdSearch({ searchText: 'Artist B', connectionId: connection.id }),
      enqueueSlskdSearch({ searchText: 'Artist C', connectionId: connection.id }),
    ]);
    
    const jobIds = jobs.map(j => j.id!);
    const startTime = Date.now();
    
    // Wait for all jobs to complete by listening to QueueEvents
    // This approach is more reliable than Job.waitUntilFinished() for integration tests
    const completedJobs = new Set<string>();
    let handlersRegistered = false;
    
    try {
      const waitForCompletion = new Promise<void>((resolve) => {
        const handleJobDone = (eventName: 'completed' | 'failed') => ({ jobId }: { jobId: string }) => {
          if (jobIds.includes(jobId)) {
            completedJobs.add(jobId);
            if (completedJobs.size === jobs.length) {
              queueEvents.off('completed', handlers.completed);
              queueEvents.off('failed', handlers.failed);
              handlersRegistered = false;
              resolve();
            }
          }
        };
        
        const handlers = {
          completed: handleJobDone('completed'),
          failed: handleJobDone('failed'),
        };
        
        queueEvents.on('completed', handlers.completed);
        queueEvents.on('failed', handlers.failed);
        handlersRegistered = true;
      });
      
      await waitForCompletion;
      
      const duration = Date.now() - startTime;
      
      // 3 jobs with 5s spacing = at least 10s total
      // (job1 runs immediately, job2 after 5s, job3 after another 5s)
      // Widened range for CI/real-world conditions (IMPORTANT #5)
      expect(duration).toBeGreaterThan(9500); // 9.5s for some variance
      
      // Should complete in reasonable time (max 20s with overhead for queue operations)
      expect(duration).toBeLessThan(20000);
    } finally {
      // Ensure cleanup happens even if test fails (IMPORTANT #6, #7)
      try {
        // Remove event listeners if still registered (IMPORTANT #7)
        if (handlersRegistered) {
          queueEvents.removeAllListeners('completed');
          queueEvents.removeAllListeners('failed');
        }
      } finally {
        // Cleanup: remove jobs from queue even on failure (IMPORTANT #6)
        await Promise.allSettled(jobs.map(job => job.remove()));
      }
    }
  }, 25000); // 25s timeout for wider timing tolerance (IMPORTANT #5)
});
