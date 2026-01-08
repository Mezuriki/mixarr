# slskd Implementation Fixes - Design Document

**Date:** January 8, 2026  
**Status:** Approved  
**Scope:** 9 priority fixes for production-ready slskd integration

---

## Overview

Transform the partially-working slskd integration into production-ready code by addressing 9 critical issues identified in rubber duck analysis.

### Current State
- Backend infrastructure exists (services, routes, poll job, processor)
- UI components built (search modal, downloads page)
- 41 tests passing
- **Critical blocker:** No way to configure slskd connections (users can't use the feature)
- Security vulnerabilities (path traversal in webhook)
- Data integrity issues (inconsistent download records, missing completion tracking)
- Race conditions between poll job and webhook
- Performance issues (excessive polling)

### Target State
- Fully functional slskd configuration in Connections page
- Consistent per-file download tracking model
- Secure path handling with validation
- Transactional safety (no orphaned downloads)
- Race-free status updates
- Retry logic for transient failures (3 retries, 30s delay)
- Optimized polling with exponential backoff
- Complete status tracking (downloads show "completed")
- 100% test coverage for all fixes

### Effort Estimate
- Implementation: 2.5 hours
- Testing: 1 hour
- **Total: 3.5 hours**

---

## Design Decisions

### 1. Download Data Model: Per-File
**Decision:** Use per-file model (1 download record = 1 file)

**Rationale:**
- Simpler implementation - no join tables
- 1-to-1 mapping with slskd downloads
- Better error tracking (know which file failed)
- Retry granularity (can retry individual tracks)
- No complexity tax from join tables

**Alternative Considered:** Per-album model with join table
- **Rejected:** More complex, harder to track individual file progress

**Breaking Change:** Yes, but acceptable since slskd hasn't shipped yet

---

### 2. Webhook Security: Rate Limiting Only
**Decision:** Skip authentication, rely on existing rate limiting

**Rationale:**
- Self-hosted setup: slskd and Mixarr on same network
- Rate limiting already implemented in codebase
- Shared secret would require slskd configuration complexity
- IP allowlist brittle (container IPs change)

**Risk Accepted:** Webhook poisoning attacks (mitigated by rate limiting)

---

### 3. Search Retry Strategy: Moderate
**Decision:** 3 retries, 30s delay (4 total attempts)

**Rationale:**
- Balances reliability and speed
- Total max time: ~2.5 minutes per artist
- Network-friendly (not hammering Soulseek)
- Only retry transient failures (timeout, network), not "not found"

**Alternatives Considered:**
- Conservative (2 retries, 1 min): Too slow
- Aggressive (5 retries, exponential): Too long for subscriptions

---

### 4. Polling Optimization: Exponential Backoff
**Decision:** Start 2s, increase 1.5x each poll, max 10s

**Rationale:**
- Responsive early (catches quick searches)
- Efficient later (reduces load on long searches)
- Reduces API calls from 15 → ~8-9 per 30s search
- Simple to implement (no new infrastructure)

**Alternative Considered:** Server-Sent Events
- **Rejected:** Overkill, too much new infrastructure

---

## Task Structure (9 Fixes)

### Phase 1: Foundation (Must Do First)

#### Fix 1: Add slskd Connection UI
**Priority:** CRITICAL - Unblocks all manual testing

**Changes:**
- `apps/web/src/app/connections/page.tsx`:
  - Add slskd to `connectionTypes` array
  - Add form fields: URL (required), API Key (required), Download Dir (optional), Music Library Dir (optional)
  - Default directories: `/data/slskd/downloads`, `/data/plex/music`

**Tests:**
- User can add slskd connection
- Form validation (URL and API Key required)
- Test connection button works

---

### Phase 2: Data Model (Breaking Changes)

#### Fix 2: Normalize Download Records
**Priority:** HIGH - Data consistency

**Changes:**
- `apps/api/src/services/slskd-subscription-processor.ts`:
  - Change from creating 1 record per album to 1 record per file
  - Remove total-size aggregation
  - Create array of downloads using `Promise.all()`

**Before:**
```typescript
const download = await prisma.slskdDownload.create({
  data: {
    filename: filesToDownload[0]?.filename || '',
    fileSize: totalSize,  // Sum of all files
    // ...
  },
});
```

**After:**
```typescript
const downloads = await Promise.all(
  filesToDownload.map(file =>
    prisma.slskdDownload.create({
      data: {
        filename: file.filename,
        fileSize: file.size,  // Individual file
        // ... same other fields
      }
    })
  )
);
```

**Tests:**
- Subscription creates N records for N files
- Each record has correct individual file size
- Downloads queryable by artistName + albumName

---

### Phase 3: Security & Safety

#### Fix 3: Fix Path Traversal Vulnerability
**Priority:** HIGH - Security issue

**Changes:**
- `apps/api/src/routes/slskd.ts` (webhook handler):
  - Add `sanitizePathComponent()` utility function
  - Sanitize `username` and `directory` from webhook payload
  - Validate final path stays within `downloadDir`

**Implementation:**
```typescript
function sanitizePathComponent(component: string): string {
  return component
    .replace(/\.\./g, '')   // Remove ..
    .replace(/\//g, '')      // Remove /
    .replace(/\\/g, '')      // Remove \
    .trim();
}

const safeUsername = sanitizePathComponent(username);
const safeDirectory = sanitizePathComponent(directory);
const downloadPath = path.join(
  downloadDir,
  safeUsername,
  safeDirectory,
  path.basename(filename)
);

// Verify still within downloadDir
const resolvedDownloadDir = path.resolve(downloadDir);
const resolvedPath = path.resolve(downloadPath);
if (!resolvedPath.startsWith(resolvedDownloadDir)) {
  throw new Error('Path traversal detected');
}
```

**Tests:**
- Reject `username: "../../../etc"`
- Reject `directory: "../../sensitive"`
- Accept valid paths
- Verify path stays within downloadDir boundary

---

#### Fix 4: Transaction Safety for Download Queue
**Priority:** HIGH - Prevents orphaned downloads

**Changes:**
- `apps/api/src/routes/slskd.ts` (POST /download):
  - Create DB records FIRST with status `queued_locally`
  - Queue in slskd
  - Update to `pending` on success
  - Update to `failed` on error
- `apps/api/src/services/slskd-subscription-processor.ts`:
  - Same pattern in `processArtist()`

**Implementation:**
```typescript
// Create records first (easy to rollback)
const downloads = await Promise.all(
  files.map(file =>
    prisma.slskdDownload.create({
      data: {
        // ... all fields
        status: 'queued_locally',
      }
    })
  )
);

try {
  // Queue in slskd
  await slskd.service.queueDownload(username, files);
  
  // Mark as pending
  await prisma.slskdDownload.updateMany({
    where: { id: { in: downloads.map(d => d.id) } },
    data: { status: 'pending' }
  });
  
  return { success: true, downloads };
} catch (error) {
  // slskd failed - mark as failed
  await prisma.slskdDownload.updateMany({
    where: { id: { in: downloads.map(d => d.id) } },
    data: { status: 'failed', error: String(error) }
  });
  throw error;
}
```

**Tests:**
- DB record created before slskd queue
- Status updated to `pending` on success
- Status updated to `failed` if slskd.queueDownload() fails
- No orphaned downloads in either system

---

### Phase 4: Correctness

#### Fix 5: Fix Completion Tracking
**Priority:** MEDIUM - User-facing bug

**Changes:**
- `apps/api/src/services/slskd-organizer.ts`:
  - Update status to `completed` after successful file organization
  - Set `completedAt` timestamp

**Implementation:**
```typescript
async organizeFile(downloadId: number): Promise<string> {
  // ... existing organization logic ...
  
  // Update status to completed
  await prisma.slskdDownload.update({
    where: { id: downloadId },
    data: {
      finalPath,
      status: 'completed',
      completedAt: new Date()
    }
  });
  
  return finalPath;
}
```

**Tests:**
- Status set to `completed` after organization
- `completedAt` timestamp populated
- Downloads page shows "Completed" status
- Auto-refresh stops for completed downloads

---

#### Fix 6: Fix Poll/Webhook Race Condition
**Priority:** MEDIUM - Prevents duplicate organization

**Changes:**
- `apps/api/prisma/schema.prisma`:
  - Add `organizing` to `SlskdDownloadStatus` enum
- `apps/api/src/jobs/slskd-poll.ts`:
  - Use atomic update to transition `downloading` → `organizing`
  - Only organize if update succeeded
- `apps/api/src/routes/slskd.ts` (webhook):
  - Same atomic update pattern

**Schema Change:**
```prisma
enum SlskdDownloadStatus {
  queued_locally
  pending
  downloading
  organizing    // NEW
  completed
  failed
  cancelled
}
```

**Poll Job Implementation:**
```typescript
if (slskdStatus.state === 'Completed') {
  // Atomic: only update if still 'downloading'
  const updated = await prisma.slskdDownload.updateMany({
    where: {
      id: download.id,
      status: 'downloading'  // Condition
    },
    data: {
      status: 'organizing',
      downloadPath
    }
  });
  
  if (updated.count === 0) {
    return; // Another process beat us to it
  }
  
  // We won the race - organize
  await organizer.organizeFile(download.id);
}
```

**Tests:**
- Concurrent poll + webhook execution
- Only one process organizes the file
- organizeFile() called exactly once
- Both processes handle gracefully

---

### Phase 5: Reliability & Performance

#### Fix 7: Add Search Retry Logic
**Priority:** MEDIUM - Improves reliability

**Changes:**
- `apps/api/src/services/slskd-subscription-processor.ts`:
  - Add retry loop to `processArtist()`
  - 3 retries, 30s delay between attempts
  - Only retry timeouts and network errors
  - Do NOT retry "not found" (that's a valid result)

**Implementation:**
```typescript
async processArtist(artist, options): Promise<ProcessResult> {
  const maxRetries = 3;
  const retryDelay = 30000; // 30 seconds
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const search = await this.slskdService.search(searchQuery, { ... });
      const searchResult = await this.waitForSearch(search.id);
      
      if (searchResult.completed) {
        // Success - process results
        if (searchResult.responses.length === 0) {
          return { status: 'not_found', searchResultCount: 0 };
        }
        // ... existing queue logic
        return { status: 'queued', ... };
      }
      
      // Failed - retry if timeout and attempts remain
      if (searchResult.timedOut && attempt < maxRetries) {
        log.warn('Search timed out, retrying', {
          artist: artist.name,
          attempt: attempt + 1,
          maxRetries
        });
        await this.sleep(retryDelay);
        continue;
      }
      
      return {
        status: 'failed',
        error: searchResult.timedOut
          ? 'Search timed out after retries'
          : 'Search failed or cancelled'
      };
    } catch (error) {
      // Network error - retry if attempts remain
      if (attempt < maxRetries) {
        log.warn('Search error, retrying', {
          artist: artist.name,
          attempt: attempt + 1,
          error: String(error)
        });
        await this.sleep(retryDelay);
        continue;
      }
      
      return { status: 'failed', error: String(error) };
    }
  }
}
```

**Tests:**
- Retry on timeout (3 times)
- Retry on network error (3 times)
- Do NOT retry on "not found"
- Success on retry attempt 2
- Fail after max retries exceeded
- Log retry attempts

---

#### Fix 8: Optimize Search Modal Polling
**Priority:** LOW - Performance optimization

**Changes:**
- `apps/web/src/components/slskd/SearchModal.tsx`:
  - Replace fixed 2s interval with exponential backoff
  - Start 2s, multiply by 1.5 each iteration, max 10s
  - Stop immediately when search completes

**Implementation:**
```typescript
useEffect(() => {
  if (!searchId) return;
  
  let pollDelay = 2000;
  const maxDelay = 10000;
  const backoffMultiplier = 1.5;
  let timeoutId: NodeJS.Timeout;
  
  const poll = async () => {
    try {
      const { data, error } = await api.get<SlskdSearchResult>(
        `/api/slskd/search/${searchId}`
      );
      
      if (error) throw new Error(error);
      
      if (data) {
        setResults(data);
        
        // Stop if completed or errored
        if (data.state === 'Completed' || data.state === 'Errored') {
          setIsSearching(false);
          setSearchId(null);
          return; // Don't schedule next poll
        }
        
        // Schedule next poll with increased delay
        pollDelay = Math.min(pollDelay * backoffMultiplier, maxDelay);
        timeoutId = setTimeout(poll, pollDelay);
      }
    } catch (err) {
      console.error('Failed to poll search results:', err);
      // Continue polling even on error
      timeoutId = setTimeout(poll, pollDelay);
    }
  };
  
  // Start first poll
  timeoutId = setTimeout(poll, pollDelay);
  
  return () => clearTimeout(timeoutId);
}, [searchId]);
```

**Impact:**
- Reduces API calls from 15 → ~8-9 per 30s search
- More responsive for quick searches (still 2s initial)
- Less load on long searches (backs off to 10s)

**Tests:**
- Poll timing follows exponential backoff
- Stops polling when search completes
- Handles API errors gracefully

---

#### Fix 9: Rate Limit Webhook Endpoint
**Priority:** LOW - Defense in depth

**Changes:**
- `apps/api/src/routes/slskd.ts`:
  - Apply existing `rateLimit` middleware to webhook route
  - Use moderate limit (e.g., 60 requests/minute)

**Implementation:**
```typescript
import { rateLimit } from '../middleware/rate-limit.js';

// Webhook with rate limiting
router.post('/webhook', rateLimit({ max: 60, window: 60000 }), async (req, res) => {
  // ... existing webhook logic
});
```

**Tests:**
- Webhook accepts requests under limit
- Webhook rejects requests over limit (429 status)
- Rate limit resets after window

---

## Testing Strategy

### Test-Driven Development (TDD)
**All fixes follow RED → GREEN → REFACTOR:**
1. Write failing test that defines expected behavior
2. Run test, watch it fail (RED)
3. Write minimal code to pass test (GREEN)
4. Refactor if needed, tests still pass
5. Commit

### Test Categories

**Unit Tests:**
- Path sanitization (traversal attempts, valid paths)
- Retry logic (timeout retries, max retries, no retry on not found)
- Exponential backoff calculation
- Per-file download creation

**Integration Tests:**
- Connection UI form validation
- Download queue with transaction rollback
- Webhook path validation
- Poll/webhook race condition (concurrent execution)
- Completion tracking (status updates)

**Security Tests:**
- Path traversal attempts: `../../../etc/passwd`
- Webhook rate limiting
- Boundary validation (paths, filenames)

### Coverage Target
**100% coverage** for all modified code paths

### Estimated Test Count
- Existing slskd tests: 41
- New tests: ~25
- **Total: ~66 tests**

---

## Files Modified

### Backend
- `apps/api/prisma/schema.prisma` - Add `organizing` and `queued_locally` status
- `apps/api/src/routes/slskd.ts` - Webhook security, transaction safety, rate limiting
- `apps/api/src/services/slskd-subscription-processor.ts` - Per-file records, retry logic
- `apps/api/src/services/slskd-organizer.ts` - Completion tracking
- `apps/api/src/jobs/slskd-poll.ts` - Race condition fix

### Frontend
- `apps/web/src/app/connections/page.tsx` - Add slskd connection UI
- `apps/web/src/components/slskd/SearchModal.tsx` - Exponential backoff polling

### Tests
- `apps/api/tests/api/slskd-*.test.ts` - Integration tests
- `apps/api/tests/services/slskd-*.test.ts` - Unit tests
- `apps/api/tests/security/slskd-security.test.ts` - Security tests (new)

---

## Success Criteria

### Functional
- [ ] Users can configure slskd connections in UI
- [ ] All downloads create consistent per-file records
- [ ] Path traversal attacks blocked
- [ ] No orphaned downloads (DB or slskd)
- [ ] Downloads show "completed" status
- [ ] No duplicate file organization
- [ ] Transient search failures retry automatically
- [ ] Search modal reduces API calls by ~50%
- [ ] Webhook protected by rate limiting

### Quality
- [ ] All 66 tests passing
- [ ] TypeScript compiles with no errors
- [ ] No ESLint warnings
- [ ] 100% test coverage for modified code
- [ ] All changes committed with descriptive messages

### Non-Functional
- [ ] Implementation complete in ~2.5 hours
- [ ] No breaking changes to existing features
- [ ] Documentation updated (if needed)

---

## Risk Assessment

### Low Risk
- Connection UI (isolated, UI-only)
- Polling optimization (frontend-only)
- Rate limiting (defense in depth)
- Retry logic (improves reliability, no downside)

### Medium Risk
- Per-file normalization (data model change, but slskd not shipped yet)
- Transaction safety (changes control flow, but well-tested pattern)

### Mitigated Risks
- Path traversal: Comprehensive security tests
- Race conditions: Atomic updates, concurrent test coverage
- Orphaned downloads: Transaction rollback, status tracking

---

## Next Steps

1. **Save this design** to `docs/plans/2026-01-08-slskd-fixes-design.md`
2. **Create implementation plan** using writing-plans skill
3. **Set up git worktree** for isolated development
4. **Execute fixes** in order (Phase 1 → Phase 5)
5. **Verify all tests pass** before committing each fix
6. **Merge to dev branch** when complete
