import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import prisma from '../lib/db.js';
import { SlskdService } from '../services/slskd-service.js';
import { isSlskdConfig } from '../types/connections.js';
import { 
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
  const slskdService = new SlskdService(url, apiKey);
  
  // Route to appropriate handler
  if (job.data.type === 'search') {
    return await handleSearch(slskdService, job.data);
  } else if (job.data.type === 'queue-download') {
    return await handleQueueDownload(slskdService, job.data);
  } else {
    const jobType = 'type' in job.data ? job.data.type : 'unknown';
    throw new Error(`Unknown job type: ${jobType}`);
  }
}

async function handleSearch(
  service: SlskdService, 
  data: SlskdSearchJobData
): Promise<{ searchId: number }> {
  const response = await service.createSearch({
    searchText: data.searchText,
    searchTimeout: data.searchTimeout,
  });
  
  logger.info('Search created', { searchId: response.id });
  
  return { searchId: response.id };
}

async function handleQueueDownload(
  service: SlskdService, 
  data: SlskdQueueDownloadJobData
): Promise<{ success: true }> {
  await service.queueDownload({
    username: data.username,
    filename: data.filename,
  });
  
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
  logger.info('Job completed', { jobId: job.id });
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

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received, closing worker...`);
  worker.removeAllListeners();
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Named export for testing
export const slskdWorker = worker;

export default worker;
