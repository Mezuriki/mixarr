# Fix Missing Metadata Feature Design

**Date:** 2026-02-01  
**Status:** Approved  
**Branch:** `feature/fix-missing-metadata`

## Overview

Adds cache-warming-powered metadata repair to the Library Health page. Leverages the existing `SkyHookCacheWarmer` to pre-warm SkyHook's cache before triggering Lidarr's `RefreshArtist` command, dramatically improving success rates for artists whose metadata failed to load due to MusicBrainz 503 errors.

## Problem Statement

When artists are added to Lidarr during MusicBrainz outages or rate limiting, they end up with missing metadata (no poster, no bio, no genres). The existing "Refresh" functionality just re-triggers Lidarr's fetch, which fails again if SkyHook's cache is cold.

99% of missing metadata cases are due to failed initial fetches, not genuinely missing data in MusicBrainz.

## Solution

Two modes of operation:

### Single Artist Fix
1. User sees artist with issues in the table
2. Clicks "Fix" button on that row
3. Backend: warm SkyHook cache → trigger Lidarr RefreshArtist → wait for completion
4. Row updates with new status
5. Toast: success or "still missing"

### Fix All (Batch)
1. User clicks "Fix All" button in page header
2. Confirmation modal with count and time estimate
3. Background job starts (1 artist/second rate limit)
4. Progress bar shows status, polls every 2 seconds
5. User can navigate away and return — progress persists
6. Job is cancellable

## API Endpoints

### 1. Fix Single Artist
```
POST /api/search/lidarr/artists/:id/fix
```
Synchronous — waits for completion (~5-10 sec)

**Response:**
```json
{
  "success": true,
  "artist": { "id": 123, "name": "...", "hasPoster": true, "hasOverview": true, ... },
  "fixed": ["poster", "overview"],
  "stillMissing": ["genres"]
}
```

### 2. Start Batch Fix Job
```
POST /api/search/lidarr/artists/fix-all
```
Starts background job, returns immediately.

**Request Body (optional):**
```json
{ "issueType": "no_poster" | "no_overview" | "no_genres" | "any" }
```

**Response:**
```json
{
  "jobId": "fix-metadata-1706812345",
  "total": 847,
  "estimatedMinutes": 14
}
```

### 3. Get Job Status
```
GET /api/search/lidarr/artists/fix-all/status
```

**Response:**
```json
{
  "jobId": "fix-metadata-1706812345",
  "status": "running",
  "total": 847,
  "processed": 234,
  "fixed": 198,
  "failed": 36,
  "currentArtist": "Miles Davis"
}
```

### 4. Cancel Job
```
POST /api/search/lidarr/artists/fix-all/cancel
```

## Backend Implementation

### New Service: `MetadataFixService`

Location: `apps/api/src/services/metadata-fix.ts`

```typescript
class MetadataFixService {
  // Single artist - synchronous, returns when complete
  async fixArtist(lidarr: LidarrService, artistId: number, mbid: string): Promise<FixResult>
  
  // Batch - starts job, returns immediately  
  async startBatchFix(userId: number, issueType: string): Promise<JobInfo>
  
  // Status polling
  async getJobStatus(userId: number): Promise<JobStatus | null>
  
  // Cancel running job
  async cancelJob(userId: number): Promise<boolean>
}
```

### Redis Keys (per-user jobs)
```
metadata-fix:job:{userId}        → JSON job state
metadata-fix:cancel:{userId}     → "1" if cancel requested
```

### Batch Job Loop
```typescript
for (const artist of artistsToFix) {
  if (await this.isCancelled(userId)) break;
  
  await skyhookWarmer.warmArtist(artist.foreignArtistId);
  const cmd = await lidarr.refreshArtist(artist.id);
  await lidarr.waitForCommand(cmd.id, 30000);
  await this.updateProgress(userId, { processed: i + 1 });
  
  await sleep(1000);  // 1 artist/second rate limit
}
```

## Frontend UI Changes

### Library Page (`apps/web/src/app/library/page.tsx`)

**1. Page Header**
- Add "Fix All (N)" button next to "Refresh"
- Disabled when no artists have issues

**2. Progress Bar (when job running)**
- Below health score card
- Shows: progress bar, count, current artist, estimated time
- Cancel button

**3. Artist Table**
- New "Actions" column
- "Fix" button for artists with issues
- Spinner during fix operation

### UI States
```
Normal:           [Refresh] [Fix All (847)]

Job Running:      [Refresh] [Cancel Fix]
                  ┌──────────────────────────────────┐
                  │ Fixing metadata: 234/847 (28%)   │
                  │ [████████░░░░░░░░░░░░░░░░] ~10m  │
                  │ Currently: Miles Davis           │
                  └──────────────────────────────────┘

Table Row:        Artist Name | Albums | Status | Issues | Actions
                  Miles Davis  |    0   | ✗✗✓   |   2    | [Fix]
```

## Test Coverage

### MetadataFixService Tests
- `fixArtist` - success path
- `fixArtist` - still missing after fix
- `fixArtist` - Lidarr command times out
- `startBatchFix` - starts job, returns job ID
- `startBatchFix` - rejects if job already running
- `getJobStatus` - returns current progress
- `getJobStatus` - returns null when no job
- `cancelJob` - sets cancel flag, job stops

### API Route Tests
- `POST /artists/:id/fix` - success
- `POST /artists/:id/fix` - invalid ID returns 400
- `POST /artists/fix-all` - starts job
- `POST /artists/fix-all` - 409 if job already running
- `GET /artists/fix-all/status` - returns progress
- `POST /artists/fix-all/cancel` - cancels job

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User navigates away during batch | Job continues, status resumes on return |
| Server restarts during batch | Job state lost, user can restart |
| Artist deleted in Lidarr mid-batch | Skip, log warning, continue |
| SkyHook repeatedly 503s | Job continues, counts as "failed" |
| User starts new job while one running | Reject with 409 |
| Job completes while user away | Next poll shows "completed" |

## Dependencies

- Existing `SkyHookCacheWarmer` service
- Existing `LidarrService.refreshArtist()` and `waitForCommand()`
- Redis for job state persistence

## Rate Limiting

Conservative approach: 1 artist per second. This respects MusicBrainz rate limits and ensures reliable operation. For 1000 artists, expect ~17 minutes.

## Known Limitations

### What This Fixes ✅
- **Cold cache (503 errors)**: When SkyHook hasn't fetched an artist yet, warming triggers the fetch and metadata populates successfully.
- **Recent adds during MusicBrainz outages**: Artists added during downtime that got 503s on initial fetch.

### What This Cannot Fix ❌
- **Stale cached incomplete data**: If SkyHook already has a cached entry with `overview: null` or empty `images`, our cache warming request returns 200 immediately (cache hit) and doesn't trigger a re-fetch from Wikipedia/Fanart.tv. SkyHook caches responses for 30 days.
- **Genuinely missing upstream data**: If Wikipedia has no bio or Fanart.tv has no images for an artist, no amount of warming will create that data.
- **MusicBrainz doesn't have the artist**: 404 responses indicate the artist doesn't exist in MusicBrainz.

### Technical Details
SkyHook (api.lidarr.audio) is a caching proxy that aggregates data from:
- **MusicBrainz**: Artist names, albums, release dates
- **Wikipedia**: Artist biographies (via Wikidata links)
- **Fanart.tv**: Artist images (posters, logos, banners)

Once SkyHook caches an artist (returns HTTP 200), that cache entry is served for up to 30 days (`max-age=2592000`). If the initial cache was incomplete, subsequent requests return the same incomplete data.

### User Expectations
The "Fix" feature works best for:
- Artists added in the last few weeks during MusicBrainz issues
- Artists showing 503 errors in Lidarr logs

It may not help for:
- Artists with long-standing incomplete metadata
- Lesser-known artists without Wikipedia bios or Fanart.tv images

## Files to Create/Modify

### New Files
- `apps/api/src/services/metadata-fix.ts` — MetadataFixService
- `apps/api/tests/api/metadata-fix.test.ts` — Service tests

### Modified Files
- `apps/api/src/routes/search.ts` — Add 4 new endpoints
- `apps/web/src/app/library/page.tsx` — Add Fix All button, progress bar, row Fix buttons
