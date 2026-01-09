// Mock SlskdService to return quickly (must be before worker import)
vi.mock('../../src/services/slskd-service');

import { QueueEvents } from 'bullmq';
import { slskdQueue, enqueueSlskdSearch } from '../../src/jobs/slskd-operations-queue';
import { prisma } from '../../src/lib/db';
import { createRedisConnection } from '../../src/lib/redis';
import { SlskdService } from '../../src/services/slskd-service';

// Import worker to start it (it starts automatically on import)
import '../../src/jobs/slskd-operations-worker';

describe('SLSKD Rate Limiting Integration', () => {
  let connection: any;
  let queueEvents: QueueEvents;
  
  beforeAll(async () => {
    // Clean up any existing test connections
    await prisma.connection.deleteMany({
      where: { name: 'Rate Limit Test Connection' },
    });
    
    // Create QueueEvents instance FIRST for waiting on job completion
    queueEvents = new QueueEvents(slskdQueue.name, {
      connection: createRedisConnection(),
    });
    
    // Wait for QueueEvents to be ready
    await queueEvents.waitUntilReady();
    
    // Create test connection
    connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Rate Limit Test Connection',
        userId: 1,
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
    await queueEvents.close();
    if (connection) {
      await prisma.connection.delete({ where: { id: connection.id } });
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
    
    const waitForCompletion = new Promise<void>((resolve) => {
      const handleJobDone = (eventName: 'completed' | 'failed') => ({ jobId }: { jobId: string }) => {
        if (jobIds.includes(jobId)) {
          completedJobs.add(jobId);
          if (completedJobs.size === jobs.length) {
            queueEvents.off('completed', handlers.completed);
            queueEvents.off('failed', handlers.failed);
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
    });
    
    await waitForCompletion;
    
    const duration = Date.now() - startTime;
    
    // 3 jobs with 5s spacing = at least 10s total
    // (job1 runs immediately, job2 after 5s, job3 after another 5s)
    expect(duration).toBeGreaterThan(10000);
    
    // Should complete in reasonable time (max 15s with overhead for queue operations)
    expect(duration).toBeLessThan(15000);
    
    // Cleanup: remove jobs from queue
    await Promise.all(jobs.map(job => job.remove()));
  }, 20000); // 20s timeout (test runs ~10s)
});
