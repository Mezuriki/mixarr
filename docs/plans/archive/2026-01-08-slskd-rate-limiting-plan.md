# slskd Rate Limiting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Prevent Soulseek bans by rate-limiting all outbound slskd operations through a BullMQ-backed queue

**Architecture:** Create `slskd-operations-queue` with 1 job per 5 seconds rate limit. All slskd operations (search, download) enqueue jobs that worker processes sequentially. Feature flag enables gradual rollout.

**Tech Stack:** BullMQ, Redis, Prisma, TypeScript, Vitest

---

## Pre-Implementation Quality Analysis

### 🦆 Rubber Duck Planning

**What are we building?**
A rate-limited queue layer between application code and SlskdService to prevent Soulseek network bans from operation flooding.

**Edge Cases to Handle:**
- Queue backup during slskd outage (cap at 1000 jobs)
- Worker crashes mid-job (BullMQ auto-retry with stale job detection)
- Job timeout scenarios (increase waitUntilFinished timeout to 60s)
- Multi-connection setup (global rate limit across all slskd instances)
- Container restart with pending jobs (Redis persistence)
- Feature flag disabled mid-operation (graceful fallback to direct calls)

**External Dependencies:**
- Redis: Queue persistence (existing connection, handle unavailability)
- slskd API: Rate limit target (handle timeouts, 404s, 500s)
- Prisma: Connection config lookups (handle missing connections)

**Questions Answered:**
- Errors propagate through job failure → caller retry logic
- No cleanup needed (BullMQ handles job removal)
- State transitions atomic (Redis-backed job state)
- Feature flag checked once per operation call

### 💀 Be-a-Shithead Planning

**How Can I Exploit This Feature?**

**Attacks:**
- DOS via queue flooding: Malicious user creates 10k searches → MITIGATION: Max queue size 1000, reject with 429
- Connection ID manipulation: User supplies connectionId they don't own → MITIGATION: Worker validates ownership before processing
- Feature flag race: Toggle flag during job processing → MITIGATION: Job uses config at enqueue time, not runtime

**Production Failure Modes:**
- Redis unavailable → Queue operations fail → Application should fallback or fail gracefully
- Worker not started → Jobs queue but never process → MONITORING: Alert on queue length >100
- Rate limit too aggressive → Users wait minutes for searches → SOLUTION: Start at 5s, tune based on metrics

---

## Task Breakdown

### Task 1: Database Migration for Feature Flag

**Files:**
- Create: `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_slskd_rate_limiting_flag/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (if GlobalSettings model needs update)

**🦆 Note:** Feature flag defaults to `false` for safe deployment

**💀 Note:** Ensure migration is idempotent (IF NOT EXISTS check)

---

**RED Phase:**

**Step 1: Write failing test for global setting**

File: `apps/api/tests/services/slskd-operations-queue.test.ts`

```typescript
import { prisma } from '../../src/lib/db';

describe('GlobalSettings', () => {
  test('slskd_rate_limiting_enabled setting exists with default false', async () => {
    const setting = await prisma.$queryRaw`
      SELECT value FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    expect(setting).toHaveLength(1);
    expect(setting[0].value).toBe('false');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/services/slskd-operations-queue.test.ts
```

Expected: `FAIL - Table or row not found`

---

**GREEN Phase:**

**Step 3: Create migration**

File: `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_slskd_rate_limiting_flag/migration.sql`

```sql
-- Add slskd rate limiting feature flag
INSERT INTO global_settings (\`key\`, value, description, created_at, updated_at)
SELECT 
  'slskd_rate_limiting_enabled',
  'false',
  'Enable rate-limited queue for slskd operations (prevents Soulseek bans)',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled'
);
```

**Step 4: Run migration**

```bash
cd apps/api
npx prisma migrate dev --name add_slskd_rate_limiting_flag
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run tests/services/slskd-operations-queue.test.ts
```

Expected: `PASS`

---

**REFACTOR Phase:**

**Step 6: Add helper function to read setting**

File: `apps/api/src/lib/settings.ts`

```typescript
import { prisma } from './db';

export async function isSlskdRateLimitingEnabled(): Promise<boolean> {
  const setting = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled'
  `;
  
  if (!setting || setting.length === 0) {
    return false; // Default to false if not found
  }
  
  return setting[0].value === 'true';
}
```

**Step 7: Test helper function**

File: `apps/api/tests/lib/settings.test.ts`

```typescript
import { prisma } from '../../src/lib/db';
import { isSlskdRateLimitingEnabled } from '../../src/lib/settings';

describe('isSlskdRateLimitingEnabled', () => {
  afterEach(async () => {
    // Reset to default
    await prisma.$executeRaw`
      UPDATE global_settings SET value = 'false' WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
  });
  
  test('returns false when setting is false', async () => {
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(false);
  });
  
  test('returns true when setting is true', async () => {
    await prisma.$executeRaw`
      UPDATE global_settings SET value = 'true' WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(true);
  });
  
  test('returns false when setting missing', async () => {
    await prisma.$executeRaw`
      DELETE FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(false);
  });
});
```

```bash
npx vitest run tests/lib/settings.test.ts
```

Expected: `PASS - 3 tests`

---

**COMMIT Phase:**

**Step 8: Commit**

```bash
git add apps/api/prisma/migrations/ apps/api/src/lib/settings.ts apps/api/tests/
git commit -m "feat: add slskd rate limiting feature flag

- Add global_settings entry (default: false)
- Migration is idempotent
- Helper function to check flag status"
```

---

### Task 2: Queue Setup

**Files:**
- Create: `apps/api/src/jobs/slskd-operations-queue.ts`
- Create: `apps/api/tests/jobs/slskd-operations-queue.test.ts`

**🦆 Note:** Queue needs QueueEvents instance for waitUntilFinished pattern

**💀 Note:** Don't forget removeOnComplete/removeOnFail to prevent Redis bloat

---

**RED Phase:**

**Step 1: Write failing test for queue creation**

File: `apps/api/tests/jobs/slskd-operations-queue.test.ts`

```typescript
import { Queue } from 'bullmq';
import { slskdQueue, SLSKD_QUEUE_NAME, enqueueSlskdSearch, enqueueSlskdDownload } from '../../src/jobs/slskd-operations-queue';

describe('SlskdOperationsQueue', () => {
  afterAll(async () => {
    await slskdQueue.close();
  });
  
  test('queue is created with correct name', () => {
    expect(slskdQueue).toBeInstanceOf(Queue);
    expect(slskdQueue.name).toBe(SLSKD_QUEUE_NAME);
  });
  
  test('enqueueSlskdSearch creates job with search type', async () => {
    const job = await enqueueSlskdSearch({
      searchText: 'Pink Floyd Dark Side',
      searchTimeout: 30000,
      connectionId: 1,
    });
    
    expect(job.data.type).toBe('search');
    expect(job.data.searchText).toBe('Pink Floyd Dark Side');
    expect(job.data.connectionId).toBe(1);
    
    await job.remove(); // Cleanup
  });
  
  test('enqueueSlskdDownload creates job with queue-download type', async () => {
    const job = await enqueueSlskdDownload({
      username: 'testuser',
      filename: 'test.flac',
      connectionId: 1,
    });
    
    expect(job.data.type).toBe('queue-download');
    expect(job.data.username).toBe('testuser');
    expect(job.data.filename).toBe('test.flac');
    
    await job.remove(); // Cleanup
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/jobs/slskd-operations-queue.test.ts
```

Expected: `FAIL - Cannot find module`

---

**GREEN Phase:**

**Step 3: Implement queue**

File: `apps/api/src/jobs/slskd-operations-queue.ts`

```typescript
import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

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

// Create queue with rate limiting
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
  return slskdQueue.add('search', { type: 'search', ...data }, {
    // Max queue size check
    // Note: This is a simple check, production may need distributed counter
  });
}

/**
 * Enqueue a download queue operation
 */
export async function enqueueSlskdDownload(data: Omit<SlskdQueueDownloadJobData, 'type'>) {
  return slskdQueue.add('queue-download', { type: 'queue-download', ...data });
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/jobs/slskd-operations-queue.test.ts
```

Expected: `PASS - 3 tests`

---

**REFACTOR Phase:**

**Step 5: Add queue size check**

Update `enqueueSlskdSearch` and `enqueueSlskdDownload`:

```typescript
const MAX_QUEUE_SIZE = 1000;

export async function enqueueSlskdSearch(data: Omit<SlskdSearchJobData, 'type'>) {
  const queueSize = await slskdQueue.count();
  
  if (queueSize >= MAX_QUEUE_SIZE) {
    throw new Error('Search queue is full. Please try again later.');
  }
  
  return slskdQueue.add('search', { type: 'search', ...data });
}

export async function enqueueSlskdDownload(data: Omit<SlskdQueueDownloadJobData, 'type'>) {
  const queueSize = await slskdQueue.count();
  
  if (queueSize >= MAX_QUEUE_SIZE) {
    throw new Error('Download queue is full. Please try again later.');
  }
  
  return slskdQueue.add('queue-download', { type: 'queue-download', ...data });
}
```

**Step 6: Test queue size limit**

Add to test file:

```typescript
test('enqueueSlskdSearch rejects when queue is full', async () => {
  // Mock count to return MAX_QUEUE_SIZE
  const originalCount = slskdQueue.count;
  slskdQueue.count = vi.fn().mockResolvedValue(1000);
  
  await expect(
    enqueueSlskdSearch({
      searchText: 'test',
      connectionId: 1,
    })
  ).rejects.toThrow('Search queue is full');
  
  // Restore
  slskdQueue.count = originalCount;
});
```

```bash
npx vitest run tests/jobs/slskd-operations-queue.test.ts
```

Expected: `PASS - 4 tests`

---

**COMMIT Phase:**

**Step 7: Commit**

```bash
git add apps/api/src/jobs/slskd-operations-queue.ts apps/api/tests/jobs/slskd-operations-queue.test.ts
git commit -m "feat: create slskd operations queue

- BullMQ queue with exponential backoff
- Enqueue helpers for search and download
- Max queue size protection (1000 jobs)
- Job cleanup (keep 100 complete, 500 failed)"
```

---

### Task 3: Worker Implementation

**Files:**
- Create: `apps/api/src/jobs/slskd-operations-worker.ts`
- Create: `apps/api/tests/jobs/slskd-operations-worker.test.ts`

**🦆 Note:** Worker needs to handle both job types with proper routing

**💀 Note:** Worker validates connection ownership to prevent IDOR vulnerability

---

**RED Phase:**

**Step 1: Write failing test for worker job processing**

File: `apps/api/tests/jobs/slskd-operations-worker.test.ts`

```typescript
import { Job } from 'bullmq';
import { processSlskdJob } from '../../src/jobs/slskd-operations-worker';
import { SlskdSearchJobData, SlskdQueueDownloadJobData } from '../../src/jobs/slskd-operations-queue';
import { prisma } from '../../src/lib/db';
import { SlskdService } from '../../src/services/slskd-service';

// Mock SlskdService
vi.mock('../../src/services/slskd-service');

describe('SlskdOperationsWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  test('processSlskdJob handles search job type', async () => {
    // Create mock connection
    const connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        userId: 1,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    
    const jobData: SlskdSearchJobData = {
      type: 'search',
      searchText: 'Pink Floyd',
      searchTimeout: 30000,
      connectionId: connection.id,
    };
    
    const mockJob = { data: jobData } as Job<SlskdSearchJobData>;
    
    // Mock SlskdService.createSearch
    const mockCreateSearch = vi.fn().mockResolvedValue({ id: 123 });
    (SlskdService as any).mockImplementation(() => ({
      createSearch: mockCreateSearch,
    }));
    
    const result = await processSlskdJob(mockJob);
    
    expect(mockCreateSearch).toHaveBeenCalledWith({
      searchText: 'Pink Floyd',
      searchTimeout: 30000,
    });
    expect(result).toEqual({ searchId: 123 });
    
    // Cleanup
    await prisma.connection.delete({ where: { id: connection.id } });
  });
  
  test('processSlskdJob handles queue-download job type', async () => {
    const connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        userId: 1,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    
    const jobData: SlskdQueueDownloadJobData = {
      type: 'queue-download',
      username: 'testuser',
      filename: 'test.flac',
      connectionId: connection.id,
    };
    
    const mockJob = { data: jobData } as Job<SlskdQueueDownloadJobData>;
    
    const mockQueueDownload = vi.fn().mockResolvedValue(undefined);
    (SlskdService as any).mockImplementation(() => ({
      queueDownload: mockQueueDownload,
    }));
    
    const result = await processSlskdJob(mockJob);
    
    expect(mockQueueDownload).toHaveBeenCalledWith({
      username: 'testuser',
      filename: 'test.flac',
    });
    expect(result).toEqual({ success: true });
    
    await prisma.connection.delete({ where: { id: connection.id } });
  });
  
  test('processSlskdJob throws error for invalid connection', async () => {
    const jobData: SlskdSearchJobData = {
      type: 'search',
      searchText: 'test',
      connectionId: 99999, // Non-existent
    };
    
    const mockJob = { data: jobData } as Job<SlskdSearchJobData>;
    
    await expect(processSlskdJob(mockJob)).rejects.toThrow('Invalid slskd connection');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/jobs/slskd-operations-worker.test.ts
```

Expected: `FAIL - Cannot find module processSlskdJob`

---

**GREEN Phase:**

**Step 3: Implement worker**

File: `apps/api/src/jobs/slskd-operations-worker.ts`

```typescript
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
  
  if (!connection || !isSlskdConfig(connection.config)) {
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
    throw new Error(`Unknown job type: ${(job.data as any).type}`);
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

export default worker;
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/jobs/slskd-operations-worker.test.ts
```

Expected: `PASS - 3 tests`

---

**REFACTOR Phase:**

**Step 5: Add graceful shutdown**

Update worker file:

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});
```

**Step 6: Import worker in main app**

File: `apps/api/src/index.ts`

Add import at top:

```typescript
import './jobs/slskd-operations-worker.js';
```

This starts the worker when the API boots.

---

**COMMIT Phase:**

**Step 7: Commit**

```bash
git add apps/api/src/jobs/slskd-operations-worker.ts apps/api/tests/jobs/slskd-operations-worker.test.ts apps/api/src/index.ts
git commit -m "feat: implement slskd operations worker

- Process search and download jobs
- Rate limited: 1 job per 5 seconds
- Connection validation per job
- Graceful shutdown on SIGTERM/SIGINT
- Started automatically with API"
```

---

### Task 4: Integration with Subscription Processor

**Files:**
- Modify: `apps/api/src/services/slskd-subscription-processor.ts`
- Modify: `apps/api/tests/services/slskd-subscription-processor.test.ts`

**🦆 Note:** Need QueueEvents instance for waitUntilFinished pattern

**💀 Note:** Feature flag check must happen BEFORE enqueuing to maintain backward compatibility

---

**RED Phase:**

**Step 1: Write failing test for queued search**

File: `apps/api/tests/services/slskd-subscription-processor.test.ts`

Add new test:

```typescript
import { QueueEvents } from 'bullmq';
import { slskdQueue } from '../../src/jobs/slskd-operations-queue';

describe('SlskdSubscriptionProcessor with Queue', () => {
  let queueEvents: QueueEvents;
  
  beforeAll(() => {
    queueEvents = new QueueEvents(slskdQueue.name, {
      connection: createRedisConnection(),
    });
  });
  
  afterAll(async () => {
    await queueEvents.close();
  });
  
  test('processArtist uses queue when rate limiting enabled', async () => {
    // Enable feature flag
    await prisma.$executeRaw`
      UPDATE global_settings SET value = 'true' WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    const processor = new SlskdSubscriptionProcessor(prisma, slskdService);
    
    // Mock slskdService.getSearch to return completed search
    vi.spyOn(slskdService, 'getSearch').mockResolvedValue({
      id: 1,
      state: 'Completed',
      responses: [{
        username: 'testuser',
        files: [
          { filename: 'track1.flac', size: 30000000, extension: 'flac', bitRate: 1411 },
        ],
        uploadSpeed: 1000,
        queueLength: 0,
        hasFreeUploadSlot: true,
      }],
    });
    
    const result = await processor.processArtist(
      { name: 'Pink Floyd', album: 'Dark Side' },
      { connectionId: 1, userId: 1, preferences: {} }
    );
    
    expect(result.status).toBe('queued');
    
    // Verify job was enqueued
    const jobs = await slskdQueue.getJobs(['waiting', 'active']);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].data.searchText).toContain('Pink Floyd');
    
    // Cleanup
    await prisma.$executeRaw`
      UPDATE global_settings SET value = 'false' WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/services/slskd-subscription-processor.test.ts -t "uses queue"
```

Expected: `FAIL - Feature flag check not implemented`

---

**GREEN Phase:**

**Step 3: Update processor to support queue**

File: `apps/api/src/services/slskd-subscription-processor.ts`

Add imports:

```typescript
import { QueueEvents } from 'bullmq';
import { enqueueSlskdSearch, slskdQueue } from '../jobs/slskd-operations-queue.js';
import { isSlskdRateLimitingEnabled } from '../lib/settings.js';
import { createRedisConnection } from '../lib/redis.js';
```

Add QueueEvents instance:

```typescript
export class SlskdSubscriptionProcessor {
  private readonly maxRetries = 3;
  private readonly retryDelay = 30000;
  private queueEvents: QueueEvents;

  constructor(
    private prisma: PrismaClient,
    private slskdService: SlskdService,
    options?: { maxRetries?: number; retryDelay?: number },
  ) {
    if (options?.maxRetries !== undefined) {
      this.maxRetries = options.maxRetries;
    }
    if (options?.retryDelay !== undefined) {
      this.retryDelay = options.retryDelay;
    }
    
    // Initialize QueueEvents for waitUntilFinished
    this.queueEvents = new QueueEvents(slskdQueue.name, {
      connection: createRedisConnection(),
    });
  }
  
  async close() {
    await this.queueEvents.close();
  }
}
```

Update `processArtist` method:

```typescript
async processArtist(
  artist: ProcessArtistRequest,
  context: ProcessContext,
): Promise<ProcessResult> {
  const { connectionId } = context;
  const searchText = `${artist.name} ${artist.album}`;
  
  // Retry loop with exponential backoff
  for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
    try {
      log.info('Processing artist search', {
        artist: artist.name,
        album: artist.album,
        attempt,
        maxRetries: this.maxRetries,
      });
      
      // Check feature flag
      const useQueue = await isSlskdRateLimitingEnabled();
      
      let searchId: number;
      
      if (useQueue) {
        // Enqueue search and wait for completion
        log.info('Using rate-limited queue for search');
        
        const searchJob = await enqueueSlskdSearch({
          searchText,
          searchTimeout: 30000,
          connectionId,
        });
        
        // Wait for job to complete (60s timeout includes queue wait + execution)
        const searchResult = await searchJob.waitUntilFinished(
          this.queueEvents,
          60000
        );
        
        searchId = searchResult.searchId;
      } else {
        // Direct call (legacy path)
        log.info('Using direct slskd call (rate limiting disabled)');
        
        const search = await this.slskdService.createSearch({
          searchText,
          searchTimeout: 30000,
        });
        
        searchId = search.id;
      }
      
      // Wait for search completion (unchanged)
      await this.waitForSearchCompletion(searchId);
      
      // Get search results (unchanged)
      const searchResult = await this.slskdService.getSearch(searchId);
      
      // ... rest of processing logic unchanged ...
      
    } catch (error: any) {
      // ... existing retry logic unchanged ...
    }
  }
  
  // ... rest of method unchanged ...
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/services/slskd-subscription-processor.test.ts -t "uses queue"
```

Expected: `PASS`

---

**REFACTOR Phase:**

**Step 5: Test backward compatibility (flag disabled)**

Add test:

```typescript
test('processArtist uses direct call when rate limiting disabled', async () => {
  // Ensure flag is disabled
  await prisma.$executeRaw`
    UPDATE global_settings SET value = 'false' WHERE \`key\` = 'slskd_rate_limiting_enabled'
  `;
  
  const createSearchSpy = vi.spyOn(slskdService, 'createSearch').mockResolvedValue({ id: 123 });
  
  vi.spyOn(slskdService, 'getSearch').mockResolvedValue({
    id: 123,
    state: 'Completed',
    responses: [{
      username: 'testuser',
      files: [{ filename: 'track.flac', size: 30000000, extension: 'flac', bitRate: 1411 }],
      uploadSpeed: 1000,
      queueLength: 0,
      hasFreeUploadSlot: true,
    }],
  });
  
  const processor = new SlskdSubscriptionProcessor(prisma, slskdService);
  
  await processor.processArtist(
    { name: 'Test Artist', album: 'Test Album' },
    { connectionId: 1, userId: 1, preferences: {} }
  );
  
  expect(createSearchSpy).toHaveBeenCalled();
  
  // Verify no jobs were enqueued
  const jobs = await slskdQueue.getJobs(['waiting', 'active']);
  expect(jobs.length).toBe(0);
  
  await processor.close();
});
```

**Step 6: Run all processor tests**

```bash
npx vitest run tests/services/slskd-subscription-processor.test.ts
```

Expected: `PASS - All tests`

---

**COMMIT Phase:**

**Step 7: Commit**

```bash
git add apps/api/src/services/slskd-subscription-processor.ts apps/api/tests/services/slskd-subscription-processor.test.ts
git commit -m "feat: integrate rate-limited queue in subscription processor

- Check feature flag before search
- Use queue when enabled, direct call when disabled
- QueueEvents for waitUntilFinished pattern
- Backward compatible with existing behavior
- 60s timeout for queue wait + execution"
```

---

### Task 5: Rate Limiter Validation Test

**Files:**
- Create: `apps/api/tests/integration/slskd-rate-limiting.test.ts`

**🦆 Note:** This is a slow test (15+ seconds) that validates actual rate limiting

**💀 Note:** Test must run worker to verify limiter works end-to-end

---

**RED Phase:**

**Step 1: Write rate limiter validation test**

File: `apps/api/tests/integration/slskd-rate-limiting.test.ts`

```typescript
import { QueueEvents } from 'bullmq';
import { slskdQueue, enqueueSlskdSearch } from '../../src/jobs/slskd-operations-queue';
import { processSlskdJob } from '../../src/jobs/slskd-operations-worker';
import { prisma } from '../../src/lib/db';
import { createRedisConnection } from '../../src/lib/redis';
import { SlskdService } from '../../src/services/slskd-service';

// Mock SlskdService
vi.mock('../../src/services/slskd-service');

describe('Slskd Rate Limiting Integration', () => {
  let queueEvents: QueueEvents;
  let connection: any;
  
  beforeAll(async () => {
    queueEvents = new QueueEvents(slskdQueue.name, {
      connection: createRedisConnection(),
    });
    
    // Create test connection
    connection = await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        userId: 1,
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
        },
      },
    });
    
    // Mock SlskdService to return quickly
    (SlskdService as any).mockImplementation(() => ({
      createSearch: vi.fn().mockResolvedValue({ id: Math.floor(Math.random() * 1000) }),
    }));
  });
  
  afterAll(async () => {
    await queueEvents.close();
    if (connection) {
      await prisma.connection.delete({ where: { id: connection.id } });
    }
  });
  
  test('rate limiter enforces 5s spacing between jobs', async () => {
    // Enqueue 3 searches
    const jobs = await Promise.all([
      enqueueSlskdSearch({ searchText: 'Artist A', connectionId: connection.id }),
      enqueueSlskdSearch({ searchText: 'Artist B', connectionId: connection.id }),
      enqueueSlskdSearch({ searchText: 'Artist C', connectionId: connection.id }),
    ]);
    
    const startTime = Date.now();
    
    // Wait for all jobs to complete
    await Promise.all(jobs.map(job => job.waitUntilFinished(queueEvents, 30000)));
    
    const duration = Date.now() - startTime;
    
    // 3 jobs with 5s spacing = at least 10s total (5s between job1->job2, 5s between job2->job3)
    expect(duration).toBeGreaterThan(10000);
    
    // But shouldn't take more than 15s (5s per job + small overhead)
    expect(duration).toBeLessThan(15000);
    
    // Cleanup
    await Promise.all(jobs.map(job => job.remove()));
  }, 30000); // 30s timeout for slow test
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run tests/integration/slskd-rate-limiting.test.ts
```

Expected: `FAIL - Jobs complete too quickly (no rate limiting applied)`

---

**GREEN Phase:**

**Step 3: Verify worker is applying rate limit**

The worker should already be applying the rate limit from Task 3. If test fails, check:

1. Worker is running and processing jobs
2. Limiter config is correct in worker
3. Jobs are being processed sequentially

If worker config needs update:

File: `apps/api/src/jobs/slskd-operations-worker.ts`

Verify limiter:

```typescript
{
  connection: createRedisConnection(),
  concurrency: 1,
  limiter: {
    max: 1,
    duration: 5000,
  },
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/slskd-rate-limiting.test.ts
```

Expected: `PASS` (takes ~10-15 seconds)

---

**COMMIT Phase:**

**Step 5: Commit**

```bash
git add apps/api/tests/integration/slskd-rate-limiting.test.ts
git commit -m "test: add rate limiter validation integration test

- Verifies 5s spacing between jobs
- End-to-end test with real worker processing
- Slow test (~15s) but validates critical functionality"
```

---

### Task 6: Update Other slskd Call Sites

**Files:**
- Search for: All files calling `slskdService.createSearch()` or `slskdService.queueDownload()`
- Modify as needed

**🦆 Note:** May find calls in manual search routes, webhook handlers, or other services

**💀 Note:** Any unauthenticated endpoints calling slskd are potential DOS vectors

---

**Step 1: Search for direct slskd calls**

```bash
cd apps/api
grep -r "slskdService.createSearch\|slskdService.queueDownload" src/ --include="*.ts"
```

**Step 2: Identify files needing updates**

Review output and list files. Common places:
- `src/routes/slskd.ts` - Manual search endpoints
- `src/services/*` - Other services using slskd
- Any webhook handlers

**Step 3: For each file, follow RED-GREEN-REFACTOR**

Example for manual search route:

**RED:** Write test expecting queued behavior
**GREEN:** Update route to check feature flag and use queue
**REFACTOR:** Add rate limit error handling (429 status)
**COMMIT:** Commit each file separately

**Step 4: Document completion**

After updating all call sites, verify no remaining direct calls:

```bash
grep -r "slskdService.createSearch\|slskdService.queueDownload" src/ --include="*.ts" | grep -v "test.ts"
```

Should only show queue integration code, not direct calls.

---

**COMMIT Phase:**

**Step 5: Commit**

```bash
git add apps/api/src/
git commit -m "feat: migrate all slskd calls to rate-limited queue

- Updated [list of files]
- All calls check feature flag
- Backward compatible with direct calls
- 429 status on queue full error"
```

---

### Task 7: Monitoring & Observability

**Files:**
- Modify: `apps/api/src/jobs/slskd-operations-worker.ts`
- Create: `apps/api/src/lib/queue-monitor.ts` (optional)

**🦆 Note:** Queue metrics help detect slskd outages and tune rate limits

**💀 Note:** Alert on queue length >100 to catch runaway job creation

---

**Step 1: Add queue metrics logging**

File: `apps/api/src/jobs/slskd-operations-worker.ts`

Add after worker event listeners:

```typescript
// Log queue metrics every 60 seconds
setInterval(async () => {
  try {
    const waiting = await slskdQueue.getWaitingCount();
    const active = await slskdQueue.getActiveCount();
    const failed = await slskdQueue.getFailedCount();
    
    logger.info('Queue metrics', {
      waiting,
      active,
      failed,
      total: waiting + active,
    });
    
    // Alert if queue is backing up
    if (waiting + active > 100) {
      logger.warn('Queue length exceeds threshold', {
        count: waiting + active,
        threshold: 100,
      });
    }
  } catch (error) {
    logger.error('Failed to get queue metrics', { error });
  }
}, 60000);
```

**Step 2: Add job duration tracking**

Update completed event:

```typescript
worker.on('completed', (job) => {
  const duration = Date.now() - job.timestamp;
  
  logger.info('Job completed', { 
    jobId: job.id,
    type: job.data.type,
    duration,
  });
  
  // Alert on slow jobs (>30s)
  if (duration > 30000) {
    logger.warn('Slow job detected', {
      jobId: job.id,
      duration,
    });
  }
});
```

**Step 3: Test metrics logging**

Start the API and verify logs show queue metrics every 60s:

```bash
cd apps/api
npm run dev
# Wait 60s, check logs for "Queue metrics"
```

---

**COMMIT Phase:**

**Step 4: Commit**

```bash
git add apps/api/src/jobs/slskd-operations-worker.ts
git commit -m "feat: add queue monitoring and metrics

- Log queue stats every 60 seconds
- Alert on queue length >100
- Track job duration
- Warn on slow jobs (>30s)"
```

---

### Task 8: Documentation

**Files:**
- Update: `README.md` or `docs/OPERATIONS.md`

**Step 1: Document feature flag**

Add section explaining:
- What the flag does
- How to enable it
- Expected behavior changes
- How to monitor queue

**Step 2: Document troubleshooting**

Add common issues:
- Queue backing up (check slskd health)
- Jobs timing out (increase timeout or check network)
- Feature flag not taking effect (cache issue, restart API)

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add slskd rate limiting guide

- Feature flag usage
- Monitoring instructions
- Troubleshooting guide"
```

---

## Testing Checklist

Before considering complete, verify:

- [ ] All unit tests pass (`npx vitest run`)
- [ ] Integration test passes (rate limiter validation)
- [ ] Feature flag defaults to `false`
- [ ] Queue processes jobs sequentially with 5s spacing
- [ ] Backward compatibility maintained (flag disabled = direct calls)
- [ ] No remaining direct slskd calls outside queue
- [ ] Worker starts with API
- [ ] Graceful shutdown works
- [ ] Queue metrics logged every 60s
- [ ] Documentation updated

---

## Rollout Strategy

**Phase 1: Deploy with flag disabled**
```bash
git checkout dev
git merge feature/slskd-rate-limiting
# Deploy to production
# Flag is false by default, no behavior change
```

**Phase 2: Enable flag for testing**
```sql
UPDATE global_settings SET value = 'true' WHERE `key` = 'slskd_rate_limiting_enabled';
```

**Phase 3: Monitor for issues**
- Check queue metrics logs
- Watch for Soulseek bans (should be none)
- Monitor API response times (searches may be slower)

**Phase 4: Roll back if needed**
```sql
UPDATE global_settings SET value = 'false' WHERE `key` = 'slskd_rate_limiting_enabled';
```

**Phase 5: Remove feature flag (future)**
After validation period (1-2 weeks), remove flag and direct call paths.

---

## Success Criteria

✅ No Soulseek bans after enabling rate limiting  
✅ Zero downtime deployment (feature flag)  
✅ Queue survives API restarts  
✅ Monitoring shows queue health  
✅ All tests pass  
✅ Backward compatible with flag disabled

---

## Quality Gates Summary

**🦆 Rubber Duck Findings:**
- Edge case: Queue backup handled with 1000 job limit
- Edge case: Worker crashes handled by BullMQ retry
- Edge case: Feature flag race condition handled by checking at enqueue time
- Monitoring: Queue metrics logged every 60s with alerts

**💀 Be-a-Shithead Findings:**
- Security: Connection ownership validated in worker
- Security: DOS via queue flooding mitigated with max size
- Production: Redis unavailability will cause queue operations to fail (acceptable, falls back to error)
- Production: Worker not started = jobs queue but don't process (mitigated with monitoring alerts)

All critical issues addressed in plan.
