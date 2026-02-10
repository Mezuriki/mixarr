# SkyHook Cache Warmer Design

**Date:** 2026-02-01  
**Status:** Approved  
**Problem:** Lidarr artist adds fail because SkyHook (api.lidarr.audio) cache is not warmed

## Background

### The Problem
- Lidarr uses SkyHook (`api.lidarr.audio`) as a caching proxy to MusicBrainz
- SkyHook's cache was rebuilt ~7 months ago and many artists aren't cached
- Text searches return empty, MBID searches return 503/empty
- Artists that exist in MusicBrainz can't be added to Lidarr

### How SkyHook Works
```
Lidarr search → api.lidarr.audio (SkyHook) → [cache] or [fetch from MusicBrainz]
                      ↓
              If not cached: 503 / empty / timeout
              If cached: returns artist data
```

### The Solution
Pre-flight cache warming: Before adding an artist to Lidarr, hit SkyHook directly to trigger caching.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mixarr Add Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Resolve MBID (existing MusicBrainzService)                  │
│                     ↓                                           │
│  2. [NEW] Warm SkyHook cache                                    │
│     └─► Hit api.lidarr.audio/api/v0.4/artist/{mbid}            │
│     └─► Retry with backoff until 200 OK (max 30s)              │
│                     ↓                                           │
│  3. Add to Lidarr (existing LidarrService.addArtist)           │
│     └─► Now succeeds because SkyHook has cached data           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## New Service: SkyHookCacheWarmer

**File:** `apps/api/src/services/skyhook-cache-warmer.ts`

```typescript
const SKYHOOK_API = 'https://api.lidarr.audio/api/v0.4';

class SkyHookCacheWarmer {
  /**
   * Warm the SkyHook cache for an artist MBID.
   * Retries until success or timeout (default 30s).
   * 
   * @returns true if cache was warmed, false if timeout/artist not found
   */
  async warmArtist(mbid: string, timeoutMs = 30000): Promise<{
    success: boolean;
    attempts: number;
    cached: boolean;  // true if was already cached (fast path)
  }>;

  /**
   * Warm cache for an album/release-group MBID.
   */
  async warmAlbum(mbid: string, timeoutMs = 30000): Promise<{
    success: boolean;
    attempts: number;
    cached: boolean;
  }>;
}
```

### Retry Strategy
- Initial delay: 1 second
- Backoff: exponential (1s, 2s, 4s, 8s...)
- Max timeout: 30 seconds (configurable per-call)
- Success: HTTP 200 with valid JSON
- Retry on: 503, 504, timeout, empty response
- Fail fast on: 404 (artist doesn't exist in MusicBrainz)

### Logging
```
[SkyHook] Warming cache for artist abc123...
[SkyHook] Attempt 1: 503 (cache miss), retrying in 1s
[SkyHook] Attempt 2: 503 (cache miss), retrying in 2s  
[SkyHook] Attempt 3: 200 OK - cache warmed (3.2s total)
```

## Integration Points

### LidarrService Enhancement

New method wrapping existing `addArtist` with cache warming:

```typescript
async addArtistWithCacheWarm(
  foreignArtistId: string,
  qualityProfileId: number,
  metadataProfileId: number,
  rootFolderPath: string,
  options?: { ... }
): Promise<{ artist: LidarrArtist; cacheWarmed: boolean }> {
  // 1. Warm SkyHook cache first
  const warmResult = await skyhookWarmer.warmArtist(foreignArtistId);
  
  // 2. Proceed with add (now more likely to succeed)
  const artist = await this.addArtist(...);
  
  return { artist, cacheWarmed: warmResult.success };
}
```

### Routes to Update

| Route | Current Method | New Method |
|-------|----------------|------------|
| `POST /search/discover/add` | `addArtistWithRefresh` | `addArtistWithCacheWarm` |
| `POST /search/artists/add` | `addArtistWithRefresh` | `addArtistWithCacheWarm` |
| `POST /subscriptions/:id/results/:resultId/approve` | `addArtistWithRefresh` | `addArtistWithCacheWarm` |
| `POST /imports/review/:id/approve` | `addArtistWithRefresh` | `addArtistWithCacheWarm` |

### User Experience

- **Fast path (already cached):** ~100ms overhead (single 200 OK response)
- **Slow path (cache miss):** 5-30s with progress logged
- **Failure:** Proceeds with add anyway (might still work, might fail with better error)

No UI changes needed - warming happens transparently before add.

## What This Solves

✅ Artist exists in MusicBrainz but SkyHook hasn't cached it yet  
✅ Adds that previously failed due to 503/empty responses  
✅ Incomplete metadata due to partial cache misses  

## What This Does NOT Solve

❌ Artist doesn't exist in MusicBrainz (need to add them there first)  
❌ SkyHook API completely down (will timeout and proceed anyway)  

## Implementation Status

**Completed on 2026-02-01** - All tasks implemented and merged.

### Files Created/Modified

1. **Created:** `apps/api/src/services/skyhook-cache-warmer.ts` (158 lines)
   - `SkyHookCacheWarmer` class with `warmArtist()` and `warmAlbum()` methods
   - UUID validation to prevent injection
   - Exponential backoff retry (1s, 2s, 4s, 8s max)
   - 30s total timeout
   - Returns `{ success, attempts, cached, error? }`

2. **Created:** `apps/api/tests/services/skyhook-cache-warmer.test.ts` (165 lines)
   - 10 tests covering validation, 404, 503 retry, timeout, success

3. **Created:** `apps/api/tests/services/lidarr-cache-warm.test.ts` (139 lines)
   - 3 tests for `addArtistWithCacheWarm` method

4. **Modified:** `apps/api/src/services/lidarr.ts`
   - Added `addArtistWithCacheWarm()` method
   - Warms cache before calling `addArtistWithRefresh()`
   - Returns `{ artist, cacheWarmed, wasAlreadyCached }`

5. **Modified:** 8 locations across 4 route files:
   - `apps/api/src/routes/search.ts` (3 locations)
   - `apps/api/src/routes/imports.ts` (3 locations)
   - `apps/api/src/routes/discover.ts` (1 location)
   - `apps/api/src/routes/subscriptions.ts` (1 location)

### Test Coverage

- 13/13 tests passing
- Cache warmer service: 100% coverage (all branches tested)
- LidarrService integration: covered by 3 new tests

### Commits

1. `test(skyhook): add failing tests for SkyHookCacheWarmer service` (5965474)
2. `feat(skyhook): implement SkyHookCacheWarmer service` (de1733d)
3. `feat(lidarr): add addArtistWithCacheWarm method` (034c850)
4. `feat(routes): integrate SkyHook cache warming into all add flows` (c6adc51)
6. **Create:** `apps/api/tests/services/skyhook-cache-warmer.test.ts` - Tests
