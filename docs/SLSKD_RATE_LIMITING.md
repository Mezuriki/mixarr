# Slskd Rate Limiting

## Overview

This document describes the slskd rate limiting feature, which prevents Soulseek network bans caused by excessive search and download operations.

**Problem:** Soulseek bans applications that send too many operations in a short time period (typically 30-minute bans).

**Solution:** All slskd operations (searches and downloads) are queued through a BullMQ rate-limited queue that enforces:
- **1 search per 5 seconds**
- **1 download per 2 seconds** (via 5-second worker processing)

---

## Feature Flag

The rate limiting feature is controlled by a database setting:

**Setting Key:** `slskd_rate_limiting_enabled`  
**Type:** Boolean (JSON)  
**Default:** `false` (disabled)

### Enabling Rate Limiting

```sql
-- Enable rate limiting
UPDATE global_settings 
SET value = 'true' 
WHERE `key` = 'slskd_rate_limiting_enabled';
```

### Disabling Rate Limiting

```sql
-- Disable rate limiting (fallback to direct calls)
UPDATE global_settings 
SET value = 'false' 
WHERE `key` = 'slskd_rate_limiting_enabled';
```

### Checking Current State

```sql
-- Check current setting
SELECT * FROM global_settings 
WHERE `key` = 'slskd_rate_limiting_enabled';
```

---

## How It Works

### Architecture

1. **Feature Flag Check**: Before any slskd operation, code checks if rate limiting is enabled
2. **Queue Path (enabled)**: Operations are enqueued in BullMQ `slskd-operations` queue
3. **Worker Processing**: Dedicated worker processes jobs sequentially with 5-second spacing
4. **Legacy Path (disabled)**: Direct calls to slskd service (backward compatible)

### Code Flow

```
User Action (e.g., subscription run, manual search)
    ↓
Check: isSlskdRateLimitingEnabled()
    ↓
IF ENABLED:
    enqueueSlskdSearch/Download()
        ↓
    Wait for job to complete (with timeout)
        ↓
    Return result
ELSE:
    Direct slskdService call (legacy)
```

### Queue Configuration

- **Queue Name:** `slskd-operations`
- **Max Size:** 1000 jobs (configurable via `MAX_SLSKD_QUEUE_SIZE` env var)
- **Job Types:** `search`, `queue-download`
- **Rate Limit:** 1 job per 5 seconds (enforced by BullMQ limiter)
- **Retries:** 3 attempts with exponential backoff (5s)
- **Timeout:** 60s per job (includes queue wait time)

---

## Monitoring

### Queue Metrics

The worker logs queue statistics every 60 seconds:

```
[INFO] Queue metrics {
  "queue": "slskd-operations",
  "waiting": 5,
  "active": 1,
  "failed": 0,
  "total": 6
}
```

### Alerts

**Queue Backed Up (>100 jobs):**
```
[WARN] Queue length exceeds threshold {
  "queue": "slskd-operations",
  "count": 120,
  "threshold": 100
}
```

**Slow Jobs (>30s):**
```
[WARN] Slow job detected {
  "jobId": "12345",
  "type": "search",
  "duration": 35000
}
```

### Job Completion Logs

```
[INFO] Job completed {
  "jobId": "123",
  "type": "search",
  "duration": 3200
}
```

---

## Rollout Strategy

### Phase 1: Deploy with Flag Disabled (Zero-Downtime)

1. Merge feature branch to `dev`
2. Deploy to production
3. Feature flag defaults to `false` → no behavior change
4. Verify deployment successful

### Phase 2: Enable for Testing

```sql
UPDATE global_settings SET value = 'true' WHERE `key` = 'slskd_rate_limiting_enabled';
```

### Phase 3: Monitor for Issues

**What to watch:**
- No Soulseek bans (30-minute timeouts)
- Queue metrics logs (every 60s)
- Search/download response times (may be slower)
- Queue length stays below 100

**Expected Behavior:**
- Searches take 5+ seconds (queued)
- Downloads are spaced 5 seconds apart
- No "too many operations" errors from Soulseek

### Phase 4: Rollback if Needed

```sql
UPDATE global_settings SET value = 'false' WHERE `key` = 'slskd_rate_limiting_enabled';
```

API will immediately switch to direct calls (no restart required).

### Phase 5: Remove Feature Flag (Future)

After 1-2 weeks of successful operation:
- Remove feature flag logic
- Remove direct call paths
- Make rate limiting mandatory

---

## Troubleshooting

### Issue: Queue Backing Up (>100 jobs)

**Symptoms:**
- Queue metrics show `waiting + active > 100`
- Alert logs: "Queue length exceeds threshold"

**Possible Causes:**
1. **Slskd outage** - Worker can't process jobs
2. **Slow slskd responses** - Timeouts causing jobs to retry
3. **Too many subscriptions** - More operations than queue can handle

**Solutions:**
1. Check slskd health: `curl http://localhost:5030/api/v0/system/health`
2. Check worker is running: Look for "SlskdOperationsWorker started" log
3. Temporarily disable subscriptions or reduce frequency
4. Increase `MAX_SLSKD_QUEUE_SIZE` if needed (default: 1000)

---

### Issue: Jobs Timing Out

**Symptoms:**
- Logs: "Search job timed out after 60s"
- Downloads fail with timeout errors

**Possible Causes:**
1. Queue is full → job waits too long
2. Slskd is slow to respond
3. Network issues between API and slskd

**Solutions:**
1. Check queue length (should be <100)
2. Verify slskd is responding: `curl -H "X-API-Key: YOUR_KEY" http://localhost:5030/api/v0/searches`
3. Check network latency
4. Temporarily disable rate limiting to test direct calls

---

### Issue: Feature Flag Not Taking Effect

**Symptoms:**
- Changed flag in database, but behavior unchanged
- Still seeing Soulseek bans after enabling

**Possible Causes:**
1. Feature flag cached in processor instance
2. Database connection issue
3. Wrong setting key or value format

**Solutions:**
1. Restart API to clear processor cache
2. Verify setting: `SELECT * FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled';`
3. Ensure value is valid JSON: `'true'` or `'false'` (with quotes)
4. Check logs for "Using rate-limited queue for search" vs "Using direct slskd call"

---

### Issue: "Queue is full" Errors

**Symptoms:**
- HTTP 429 responses
- Logs: "Queue is full. Please try again later."

**Possible Causes:**
1. `MAX_SLSKD_QUEUE_SIZE` reached (default: 1000)
2. Worker stopped processing jobs
3. Too many operations enqueued at once

**Solutions:**
1. Check worker is running
2. Check queue metrics to see if jobs are being processed
3. Increase `MAX_SLSKD_QUEUE_SIZE` environment variable
4. Reduce subscription frequency or number of simultaneous operations

---

### Issue: Slow Search/Download Response Times

**Symptoms:**
- Searches take 10+ seconds
- Downloads feel sluggish

**Expected Behavior:**
This is **normal** with rate limiting enabled. Operations are intentionally slowed to prevent bans.

**If Unacceptable:**
- Temporarily disable rate limiting: `UPDATE global_settings SET value = 'false' WHERE \`key\` = 'slskd_rate_limiting_enabled';`
- Adjust rate limits in code (requires code change and deploy)
- Consider adaptive rate limiting (future enhancement)

---

## Testing

### Manual Testing

**1. Enable rate limiting:**
```sql
UPDATE global_settings SET value = 'true' WHERE `key` = 'slskd_rate_limiting_enabled';
```

**2. Trigger multiple searches:**
```bash
# Via API (requires auth token)
curl -X POST http://localhost:3333/api/slskd/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "Artist A"}' &

curl -X POST http://localhost:3333/api/slskd/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "Artist B"}' &

curl -X POST http://localhost:3333/api/slskd/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "Artist C"}' &
```

**3. Check logs:**
```bash
# Should see jobs enqueued and processed with 5s spacing
grep "Queue metrics" logs/api.log
grep "Job completed" logs/api.log
```

### Integration Test

**Run the rate limiter validation test:**
```bash
cd apps/api
npx vitest run tests/integration/slskd-rate-limiting.test.ts
```

**Expected:** Test takes ~10-15 seconds (proves 5s spacing works)

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SLSKD_QUEUE_SIZE` | `1000` | Maximum number of jobs in queue before rejecting new operations |

### Setting Environment Variables

**Development (docker-compose.dev.yml):**
```yaml
api:
  environment:
    - MAX_SLSKD_QUEUE_SIZE=2000
```

**Production (docker-compose.yml):**
```yaml
api:
  environment:
    - MAX_SLSKD_QUEUE_SIZE=2000
```

---

## Success Criteria

✅ **No Soulseek bans** after enabling rate limiting  
✅ **Zero-downtime deployment** via feature flag  
✅ **Queue survives API restarts** (Redis persistence)  
✅ **Monitoring shows queue health** (metrics every 60s)  
✅ **All tests pass** (unit + integration)  
✅ **Backward compatible** (flag disabled = direct calls)

---

## Related Files

**Implementation:**
- `apps/api/src/jobs/slskd-operations-queue.ts` - Queue setup and enqueue helpers
- `apps/api/src/jobs/slskd-operations-worker.ts` - Worker with rate limiting
- `apps/api/src/lib/settings.ts` - Feature flag helper
- `apps/api/src/services/slskd-subscription-processor.ts` - Subscription integration
- `apps/api/src/routes/slskd.ts` - Manual search/download routes

**Tests:**
- `apps/api/tests/integration/slskd-rate-limiting.test.ts` - Rate limiter validation
- `apps/api/tests/jobs/slskd-operations-queue.test.ts` - Queue unit tests
- `apps/api/tests/jobs/slskd-operations-worker.test.ts` - Worker unit tests
- `apps/api/tests/lib/settings.test.ts` - Feature flag tests

**Database:**
- `apps/api/prisma/migrations/20260108235509_add_slskd_rate_limiting_flag/migration.sql` - Feature flag migration

**Documentation:**
- `docs/plans/2026-01-08-slskd-rate-limiting-design.md` - Design document
- `docs/plans/2026-01-08-slskd-rate-limiting-plan.md` - Implementation plan
- `docs/SLSKD_RATE_LIMITING.md` - Operations guide (this file)

---

## Future Enhancements

1. **Adaptive Rate Limiting**: Adjust rate based on Soulseek feedback
2. **Configurable Rates**: Allow admin to tune limits via UI
3. **Per-User Limits**: Rate limit by user instead of globally
4. **Priority Queue**: High-priority searches processed faster
5. **Queue Dashboard**: Web UI showing queue status and metrics
6. **Remove Feature Flag**: Make rate limiting mandatory after validation period
