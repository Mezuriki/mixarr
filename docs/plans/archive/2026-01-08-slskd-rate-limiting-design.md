# slskd Rate Limiting Design

**Date:** 2026-01-08  
**Status:** Approved  
**Problem:** Mixarr spams slskd with too many operations, resulting in 30-minute Soulseek bans

---

## Problem Statement

The app currently has no rate limiting for outbound requests to slskd. When subscriptions run or users perform multiple searches, the app floods slskd with rapid operations:

- Multiple searches in quick succession
- Repeated download queue requests
- No spacing between operations

This triggers Soulseek's automatic ban system:
> "You have been banned for 30 minutes. This is usually the result of doing too many operations at once."

**Task 9 (webhook rate limiting) does NOT fix this** - it only limits inbound requests to our API, not outbound requests to slskd.

---

## Solution Overview

Implement smart throttling with BullMQ-backed queuing for all slskd operations. All requests go through a rate-limited queue that enforces safe spacing between operations.

**Architecture Decision:** BullMQ queue (vs in-memory) for:
- Production reliability (survives restarts)
- Observability (inspect queued operations)
- Built-in rate limiter
- Consistent with existing subscription/import workers

**Rate Limits (Moderate approach):**
- Search: 1 per 5 seconds
- Download queue: 1 per 2 seconds
- Implementation: Single queue with 5s global rate limit (simpler, still safe)

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Application Layer                                           │
│  • SlskdSubscriptionProcessor                              │
│  • Manual search from UI                                    │
│  • Webhook handlers                                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ enqueueSlskdSearch()
                 │ enqueueSlskdDownload()
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ SlskdOperationsQueue (BullMQ)                              │
│  • Rate limiter: 1 job per 5000ms                          │
│  • Concurrency: 1                                           │
│  • Retries: 3 attempts, exponential backoff                │
│  • Redis-backed, survives restarts                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Job processed when rate limit allows
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ SlskdOperationsWorker                                       │
│  • Routes to handleSearch() or handleQueueDownload()       │
│  • Fetches connection config per job                       │
│  • Calls SlskdService methods                              │
│  • Returns results via job completion                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ SlskdService                                                │
│  • createSearch()                                           │
│  • getSearch()                                              │
│  • queueDownload()                                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼ HTTP requests (safely rate-limited)
            ┌─────────┐
            │  slskd  │
            └─────────┘
```

---

## Implementation Details

### 1. Queue Setup (`jobs/slskd-operations-queue.ts`)

**Job Types:**
```typescript
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
```

**Queue Configuration:**
```typescript
export const slskdQueue = new Queue<SlskdJobData>(SLSKD_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100, // Keep for debugging
    removeOnFail: 500,
  },
});
```

**Enqueue Helpers:**
```typescript
export async function enqueueSlskdSearch(data: Omit<SlskdSearchJobData, 'type'>) {
  return slskdQueue.add('search', { type: 'search', ...data });
}

export async function enqueueSlskdDownload(data: Omit<SlskdQueueDownloadJobData, 'type'>) {
  return slskdQueue.add('queue-download', { type: 'queue-download', ...data });
}
```

---

### 2. Worker Implementation (`jobs/slskd-operations-worker.ts`)

**Worker Setup:**
```typescript
const worker = new Worker<SlskdJobData>(
  SLSKD_QUEUE_NAME,
  async (job: Job<SlskdJobData>) => {
    const { connectionId } = job.data;
    
    // Get connection config
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });
    
    if (!connection || !isSlskdConfig(connection.config)) {
      throw new Error('Invalid slskd connection');
    }
    
    const { url, apiKey } = connection.config;
    const slskdService = new SlskdService(url, apiKey);
    
    // Route to handler
    if (job.data.type === 'search') {
      return await handleSearch(slskdService, job.data);
    } else {
      return await handleQueueDownload(slskdService, job.data);
    }
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
```

**Handlers:**
```typescript
async function handleSearch(service: SlskdService, data: SlskdSearchJobData) {
  const response = await service.createSearch({
    searchText: data.searchText,
    searchTimeout: data.searchTimeout,
  });
  return { searchId: response.id };
}

async function handleQueueDownload(service: SlskdService, data: SlskdQueueDownloadJobData) {
  await service.queueDownload({
    username: data.username,
    filename: data.filename,
  });
  return { success: true };
}
```

**Key Points:**
- `concurrency: 1` + `limiter` ensures operations never overlap AND are spaced 5s apart
- Worker fetches connection config per job (handles multi-user scenarios)
- Returns results through job completion (caller can await)
- BullMQ handles retries automatically

---

### 3. Integration with SlskdSubscriptionProcessor

**Before (direct call):**
```typescript
const search = await this.slskdService.createSearch({
  searchText: `${artist.name} ${artist.album}`,
  searchTimeout: 30000,
});
```

**After (queued call):**
```typescript
const searchJob = await enqueueSlskdSearch({
  searchText: `${artist.name} ${artist.album}`,
  searchTimeout: 30000,
  connectionId: context.connectionId,
});

// Wait for job to complete (blocks until worker processes it)
const searchResult = await searchJob.waitUntilFinished(
  queueEvents, // BullMQ QueueEvents instance
  30000 // timeout
);

const searchId = searchResult.searchId;
```

**How It Works:**
- Job enters queue immediately
- `waitUntilFinished()` returns promise that resolves when worker completes
- If 20 jobs queued, blocks until it's your turn
- Worker enforces 5s spacing automatically

**Retry Logic:**
- Subscription processor's existing retry logic (Task 6) stays intact
- If `waitUntilFinished` times out or job fails, throws error
- Processor retries entire `processArtist()` call

---

### 4. Other Integration Points

**Files that call slskdService and need updates:**
1. `slskd-subscription-processor.ts` - Search operations
2. Manual search API routes (if any)
3. Webhook handlers (if they queue downloads)

**Search for:**
```bash
grep -r "slskdService.createSearch\|slskdService.queueDownload" apps/api/src/
```

All direct calls must be replaced with enqueue operations.

---

## Migration Strategy

**Zero-Downtime Deployment:**

Since the app is released publicly, we need safe migration:

1. **Phase 1: Deploy with feature flag**
   - Add to `global_settings`: `slskd_rate_limiting_enabled` (default: false)
   - Code checks flag: if true, use queue; if false, direct call
   - Deploy to production

2. **Phase 2: Enable flag**
   - Admin enables flag via UI/DB
   - Monitor queue metrics for issues
   - Can disable flag instantly if problems occur

3. **Phase 3: Remove flag** (after validation)
   - Remove feature flag code
   - Remove direct call paths
   - Queue is now the only path

**Migration SQL:**
```sql
INSERT INTO global_settings (key, value, description)
VALUES (
  'slskd_rate_limiting_enabled',
  'false',
  'Enable rate-limited queue for slskd operations (prevents Soulseek bans)'
);
```

---

## Testing Strategy

### Unit Tests

**Queue Operations (`tests/jobs/slskd-operations-queue.test.ts`):**
```typescript
describe('SlskdOperationsQueue', () => {
  test('enqueueSlskdSearch creates job with correct data', async () => {
    const job = await enqueueSlskdSearch({
      searchText: 'Pink Floyd Dark Side',
      connectionId: 1,
    });
    expect(job.data.type).toBe('search');
    expect(job.data.searchText).toBe('Pink Floyd Dark Side');
  });
  
  test('rate limiter enforces 5s spacing', async () => {
    // Queue 3 searches
    const jobs = await Promise.all([
      enqueueSlskdSearch({ searchText: 'A', connectionId: 1 }),
      enqueueSlskdSearch({ searchText: 'B', connectionId: 1 }),
      enqueueSlskdSearch({ searchText: 'C', connectionId: 1 }),
    ]);
    
    // Jobs complete with 5s gaps
    const start = Date.now();
    await Promise.all(jobs.map(j => j.waitUntilFinished(queueEvents)));
    const duration = Date.now() - start;
    
    expect(duration).toBeGreaterThan(10000); // At least 10s for 3 jobs
  });
});
```

**Worker Tests (`tests/jobs/slskd-operations-worker.test.ts`):**
- Mock SlskdService to avoid hitting real slskd
- Test routing (search vs download)
- Test error handling and retries
- Test connection config fetching

### Integration Tests

**Subscription Processor:**
- Existing tests should pass with minimal changes
- Mock the queue/worker for unit tests
- Add integration test with real queue for end-to-end validation

### Testing Challenges

- Rate limiter tests are slow (need to wait real time)
- Could use fake timers, but risks missing real timing bugs
- **Recommendation:** One slow test for rate limiting (15-20s), rest can mock

---

## Edge Cases & Error Handling

### 1. Queue Backup During Outage

**Problem:** slskd down for hours, queue fills with failed jobs

**Solution:**
- Set max queue size: 1000 jobs
- Reject new searches with user-friendly error: "Search queue is full, please try again later"
- Alert admin when queue >100 jobs

### 2. Stuck Jobs

**Problem:** Worker crashes mid-job

**Solution:**
- BullMQ auto-retries stalled jobs after 30s timeout
- Job marked as failed after 3 attempts
- Caller receives error and can retry at higher level

### 3. Multi-Connection Scenario

**Problem:** User has 2 slskd instances

**Solution:**
- Rate limit is global across all connections (safer for Soulseek network ban)
- Could implement per-connection limiters if needed, but YAGNI for now

### 4. Manual UI Searches During Subscription Run

**Problem:** User searches while subscription is processing

**Solution:**
- Both add to same queue, naturally throttled together
- UI shows "Search queued" message if queue has pending jobs
- Position in queue displayed: "Your search is #5 in queue"

### 5. Job Timeout

**Problem:** `waitUntilFinished()` times out after 30s

**Solution:**
- Increase timeout to 60s (queue wait + search execution)
- If still times out, error bubbles up to subscription processor
- Processor's retry logic handles it

---

## Monitoring & Observability

**Queue Metrics to Log:**
- Queue length (alert if >100)
- Average wait time per job
- Failed job count (hourly)
- Rate limit hits (jobs delayed)

**Logging Example:**
```typescript
logger.info('slskd operation queued', {
  jobId: job.id,
  type: job.data.type,
  queueLength: await slskdQueue.count(),
});

logger.info('slskd operation completed', {
  jobId: job.id,
  duration: Date.now() - job.timestamp,
  success: true,
});
```

**Alert Thresholds:**
- Queue length > 100: Warning (possible slskd outage)
- Queue length > 500: Critical (stop accepting new jobs)
- Failed jobs > 10/hour: Warning (investigate slskd connection)

---

## Future Enhancements (YAGNI for now)

1. **Priority Queue**
   - Manual UI searches higher priority than automated subscriptions
   - Requires separate queues or BullMQ priority option

2. **Per-Connection Rate Limits**
   - If user has multiple slskd instances, rate limit each separately
   - More complex, minimal benefit

3. **Adaptive Rate Adjustment**
   - Detect Soulseek bans from error messages
   - Automatically increase delays when banned
   - Gradually decrease after successful operations

4. **Search Deduplication**
   - Cache recent searches for 5 minutes
   - If same query comes in, return cached results
   - Reduces slskd load further

5. **Queue UI**
   - Admin dashboard showing queued operations
   - Ability to clear queue or pause processing
   - Useful for debugging

---

## Files to Create/Modify

### New Files
1. `apps/api/src/jobs/slskd-operations-queue.ts` - Queue setup and helpers
2. `apps/api/src/jobs/slskd-operations-worker.ts` - Worker implementation
3. `apps/api/tests/jobs/slskd-operations-queue.test.ts` - Queue tests
4. `apps/api/tests/jobs/slskd-operations-worker.test.ts` - Worker tests

### Modified Files
1. `apps/api/src/services/slskd-subscription-processor.ts` - Use queue instead of direct calls
2. `apps/api/src/index.ts` - Import worker to start it
3. `apps/api/prisma/schema.prisma` - Add global_settings entry (if not exists)
4. `apps/api/prisma/migrations/` - Migration for feature flag
5. Any other files calling `slskdService.createSearch()` or `slskdService.queueDownload()`

---

## Success Criteria

✅ **No more Soulseek bans** - Operations spaced safely  
✅ **Zero downtime deployment** - Feature flag allows safe rollout  
✅ **Survives restarts** - Queue persists in Redis  
✅ **Observable** - Queue metrics logged  
✅ **Testable** - Unit and integration tests pass  
✅ **Maintains UX** - Users see queued status, no silent failures

---

## Implementation Plan

Ready to proceed with detailed implementation plan using the `writing-plans` skill.
