import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SlskdQueue');

export const SLSKD_QUEUE_NAME = 'slskd-operations';

export type SlskdJobType = 'search' | 'queue-download';

export interface SlskdSearchJobData {
  type: 'search';
  searchText: string;
  searchTimeout?: number;
  connectionId: number;
}

export interface SlskdQueueDownloadJobData {
  type: 'queue-download';
  username: string;
  filename: string;
  connectionId: number;
}

export type SlskdJobData = SlskdSearchJobData | SlskdQueueDownloadJobData;

const MAX_QUEUE_SIZE = parseInt(process.env.MAX_SLSKD_QUEUE_SIZE || '1000', 10);

// BullMQ manages Redis connection lifecycle internally
export const slskdQueue = new Queue<SlskdJobData>(SLSKD_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100, // Keep last 100 for debugging
    removeOnFail: 500, // Keep failed jobs for analysis
  },
});

/**
 * Enqueue a search operation
 */
export async function enqueueSlskdSearch(data: Omit<SlskdSearchJobData, 'type'>) {
  // Note: This is a soft limit - race conditions between count() and add() 
  // are acceptable as MAX_QUEUE_SIZE is a safety threshold, not a hard cap
  const queueSize = await slskdQueue.count();
  
  if (queueSize >= MAX_QUEUE_SIZE) {
    logger.warn('Queue full', { queueSize, maxSize: MAX_QUEUE_SIZE });
    throw new Error('SLSKD operations queue is full. Please try again later.');
  }
  
  return slskdQueue.add('search', { type: 'search', ...data });
}

/**
 * Enqueue a download queue operation
 */
export async function enqueueSlskdDownload(data: Omit<SlskdQueueDownloadJobData, 'type'>) {
  const queueSize = await slskdQueue.count();
  
  if (queueSize >= MAX_QUEUE_SIZE) {
    logger.warn('Queue full', { queueSize, maxSize: MAX_QUEUE_SIZE });
    throw new Error('SLSKD operations queue is full. Please try again later.');
  }
  
  return slskdQueue.add('queue-download', { type: 'queue-download', ...data });
}
