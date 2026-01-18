import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import prisma from '../lib/db.js';
import { SlskdService } from '../services/slskd.js';
import { isSlskdConfig } from '../types/connections.js';
import { 
  slskdQueue,
  SLSKD_QUEUE_NAME, 
  SlskdJobData, 
  SlskdSearchJobData, 
  SlskdQueueDownloadJobData 
} from './slskd-operations-queue.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SlskdOperationsWorker');

/**
 * Process a single slskd operation job
 * Exported for testing
 */
export async function processSlskdJob(job: Job<SlskdJobData>): Promise<any> {
  const { connectionId } = job.data;
  
  logger.info('Processing slskd job', {
    jobId: job.id,
    type: job.data.type,
    connectionId,
  });
  
  // Get connection config
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  
  if (!connection || connection.type !== 'slskd' || !isSlskdConfig(connection.config)) {
    throw new Error('Invalid slskd connection');
  }
  
  const { url, apiKey } = connection.config;
  const slskdService = new SlskdService({ url, apiKey });
  
  // Route to appropriate handler
  if (job.data.type === 'search') {
    return await handleSearch(slskdService, job.data);
  } else if (job.data.type === 'queue-download') {
    return await handleQueueDownload(slskdService, job.data);
  } else {
    throw new Error(`Unknown job type: ${String(job.data)}`);
  }
}

async function handleSearch(
  service: SlskdService, 
  data: SlskdSearchJobData
): Promise<{ searchId: string }> {
  const response = await service.search(data.searchText);
  
  logger.info('Search created', { searchId: response.id });
  
  return { searchId: response.id };
}

async function handleQueueDownload(
  service: SlskdService, 
  data: SlskdQueueDownloadJobData
): Promise<{ success: true }> {
  await service.queueDownload(data.username, [{
    filename: data.filename,
    size: 0,  // Size not needed for queueing
  }]);
  
  logger.info('Download queued', { 
    username: data.username, 
    filename: data.filename 
  });
  
  return { success: true };
}

// Create worker
const worker = new Worker<SlskdJobData>(
  SLSKD_QUEUE_NAME,
  async (job: Job<SlskdJobData>) => {
    return await processSlskdJob(job);
  },
  {
    connection: createRedisConnection(),
    concurrency: 1, // Process one at a time
    limiter: {
      max: 1,           // 1 job
      duration: 5000,   // per 5 seconds
    },
    lockDuration: 60000, // 60 second timeout
  }
);

worker.on('completed', (job) => {
  if (!job) return;
  
  const duration = job.finishedOn ? job.finishedOn - job.timestamp : 0;
  const jobType = job.data && 'type' in job.data ? job.data.type : 'unknown';
  
  logger.info('Job completed', { 
    jobId: job.id,
    type: jobType,
    duration,
  });
  
  // Alert on slow jobs (>30s)
  if (duration > 30000) {
    logger.warn('Slow job detected', {
      jobId: job.id,
      type: jobType,
      duration,
    });
  }
});

worker.on('failed', (job, err) => {
  logger.error('Job failed', { 
    jobId: job?.id, 
    error: err.message,
    stack: err.stack,
  });
});

logger.info('SlskdOperationsWorker started', {
  concurrency: 1,
  rateLimitDuration: '5000ms',
});

// Log queue metrics every 60 seconds
let metricsIntervalId: NodeJS.Timeout | null = null;
metricsIntervalId = setInterval(async () => {
  try {
    const waiting = await slskdQueue.getWaitingCount();
    const active = await slskdQueue.getActiveCount();
    const failed = await slskdQueue.getFailedCount();
    
    logger.info('Queue metrics', {
      queue: SLSKD_QUEUE_NAME,
      waiting,
      active,
      failed,
      total: waiting + active,
    });
    
    // Alert if queue is backing up
    if (waiting + active > 100) {
      logger.warn('Queue length exceeds threshold', {
        queue: SLSKD_QUEUE_NAME,
        count: waiting + active,
        threshold: 100,
      });
    }
  } catch (error) {
    logger.error('Failed to get queue metrics', { error: error instanceof Error ? error.message : error });
  }
}, 60000);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received, closing worker...`);
  
  // Clear metrics interval to prevent memory leak
  if (metricsIntervalId) {
    clearInterval(metricsIntervalId);
    metricsIntervalId = null;
  }
  
  worker.removeAllListeners();
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Named export for testing
export const slskdWorker = worker;

export default worker;
