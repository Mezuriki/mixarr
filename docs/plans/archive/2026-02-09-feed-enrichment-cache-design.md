# Feed Enrichment Caching & DB Write-Back — Design Document

**Date:** 2026-02-09  
**Status:** Approved  
**Goal:** Speed up the Discovery Feed dashboard by caching external API calls (Deezer images, Last.fm stats) in Redis and persisting enrichment results back to the database.

---

## Problem

The `/api/feed` endpoint makes up to 50 external HTTP calls per page load:
- Deezer image search for items missing `imageUrl` (~100-300ms each)
- Last.fm artist stats for items missing `tags` and `listeners` (~100-200ms each)

These calls have **no caching** — the same artist is re-fetched on every page load. Worst case: 5-9 seconds of latency from external API calls alone.

## Solution

Two-layer caching strategy:

1. **Redis cache** (short-term, ~24h-7d) — Cache external API responses so repeat lookups skip the HTTP call
2. **DB write-back** (long-term, permanent) — Persist enrichment data to `SubscriptionResult` rows so future feed queries have the data already

## Architecture

### Cache Layer (Redis)

**New file:** `src/services/cache.ts` — generic Redis cache wrapper.

**Interface:**
```typescript
class CacheService {
  async get<T>(key: string): Promise<T | null | '__MISS__'>
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void>
  async setMiss(key: string, ttlSeconds: number): Promise<void>
}
```

**Cache keys:**
- `deezer:image:{normalizedArtistName}` → image URL string
- `lastfm:stats:{normalizedArtistName}` → JSON `{ listeners, playcount, tags }`

**TTLs:**
- Deezer images: **7 days** (artist images rarely change)
- Last.fm stats: **24 hours** (listener counts drift but don't need real-time accuracy)
- Cache misses (`__MISS__`): **1 hour** (retry sooner in case artist was just added)

**Key normalization:** Uses the same `normalizeName()` already in FeedService (lowercase, strip "The ", remove non-alphanumeric). "The Beatles", "the beatles", and "Beatles" share one cache entry.

**Error resilience:** If Redis is unavailable, all `get()` calls return `null` (cache miss) and all `set()` calls silently fail. Feed works exactly as today — just slower.

### Enrichment Flow (Updated)

**Previous:**
```
For each item missing data → call external API → return enriched item
```

**New:**
```
For each item missing data:
  1. Check Redis cache
  2. If HIT → use cached value, skip API call
  3. If __MISS__ → skip entirely (known no-result)
  4. If cache miss → call external API
     a. Store result in Redis
     b. Store __MISS__ if API returned nothing
     c. Fire-and-forget: write enrichment data back to DB
  5. Return enriched item
```

### DB Write-Back

After enrichment, persist results to `SubscriptionResult` rows:

```typescript
prisma.subscriptionResult.updateMany({
  where: { id: { in: linkedResultIds } },
  data: { imageUrl, tags, listeners }
})
```

**Fire-and-forget:** Not awaited in the response path. User gets their response immediately. Write-back happens in background.

**Idempotent:** Running the same update twice sets the same values. No conflict resolution needed.

**Stale data handling:** Redis cache expires (7d for images, 24h for stats), triggering a fresh API call that overwrites both Redis and DB.

### Dependency Injection

`CacheService` passed as optional constructor parameter to `FeedService`:
- Production: singleton Redis-backed instance
- Tests: mock with `vi.fn()`
- Null/undefined: enrichment works exactly as today (no cache)

## Migration Impact

**Zero.** No schema changes. No Prisma migrations. No env changes. No frontend changes. No docker config changes. Redis keys are new (additive). Existing data untouched. Users notice nothing except faster load times.

## Files Changed

| Action | File | Description |
|--------|------|-------------|
| Create | `src/services/cache.ts` | Generic Redis cache wrapper |
| Create | `tests/services/cache.test.ts` | CacheService unit tests |
| Modify | `src/services/FeedService.ts` | Add cache + write-back to enrichment methods |
| Modify | `tests/services/feed-service.test.ts` | Add cache integration tests |

## Testing Strategy

| Test | Type | Verifies |
|------|------|----------|
| `CacheService.get/set/setMiss` | Unit | Redis interactions, JSON serialization, TTL, miss sentinel |
| `CacheService` when Redis down | Unit | Graceful degradation, no throws |
| `enrichWithImages` with cache | Unit | Cache hit skips Deezer, miss calls Deezer + stores, `__MISS__` skips |
| `enrichWithLastfm` with cache | Unit | Same pattern for Last.fm |
| `persistEnrichment` | Unit | Correct `updateMany` calls, error handling |
| Existing FeedService tests | Regression | All pass unchanged |

## Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| First load (cold cache) | 5-9s (50 HTTP calls) | 5-9s (same, but caches results) |
| Second load (warm cache) | 5-9s (same 50 calls again) | ~200ms (Redis hits only) |
| Subsequent loads (DB populated) | 5-9s | ~100ms (data from DB, no cache needed) |
