# Feed Enrichment Caching & DB Write-Back — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Redis caching for Deezer/Last.fm API calls and persist enrichment data to SubscriptionResult rows, reducing feed load time from 5-9s to <200ms on repeat loads.

**Architecture:** Redis cache-aside pattern wrapping external API calls in FeedService enrichment methods. After successful API calls, results are written back to SubscriptionResult rows (fire-and-forget). CacheService injected into FeedService via constructor for testability.

**Tech Stack:** Redis (ioredis, already in project), Prisma (existing), Vitest (existing)

**Design Doc:** `docs/plans/2026-02-09-feed-enrichment-cache-design.md`

**Requirements:**
- Edge Cases: Redis unavailable (graceful degradation), empty/null artist names, Deezer/Last.fm returning no results, partial enrichment failures
- Security: No user data in cache keys (only artist names), no sensitive data cached
- Data Integrity: Write-back is fire-and-forget but idempotent; DB write failures don't affect response
- Error Handling: Redis errors → treat as cache miss; API errors → return null as today; DB write errors → log warning

---

## Task 1: Create CacheService with Tests

**Quality Requirements:**
- Edge Cases: Redis down, null/undefined values, JSON parse errors, expired keys
- Attack Vectors: None (no user input in cache keys directly)
- AI Slop Watch: Specific error messages, no TODOs, descriptive test names

**Files:**
- Create: `apps/api/src/services/cache.ts`
- Create: `apps/api/tests/services/cache.test.ts`

### Step 1: Write failing tests for CacheService

Create `apps/api/tests/services/cache.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redis before importing
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { redis } from '../../src/lib/redis.js';
import { CacheService, CACHE_MISS_SENTINEL } from '../../src/services/cache.js';

const mockRedis = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new CacheService();
  });

  describe('get', () => {
    it('returns parsed JSON value on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ listeners: 5000, tags: ['rock'] }));
      const result = await cache.get<{ listeners: number; tags: string[] }>('lastfm:stats:radiohead');
      expect(result).toEqual({ listeners: 5000, tags: ['rock'] });
    });

    it('returns string value on cache hit for simple strings', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify('https://cdn.deezer.com/img.jpg'));
      const result = await cache.get<string>('deezer:image:radiohead');
      expect(result).toBe('https://cdn.deezer.com/img.jpg');
    });

    it('returns null on cache miss (key not found)', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cache.get('deezer:image:unknownartist');
      expect(result).toBeNull();
    });

    it('returns CACHE_MISS_SENTINEL when miss was cached', async () => {
      mockRedis.get.mockResolvedValue(CACHE_MISS_SENTINEL);
      const result = await cache.get('deezer:image:noartist');
      expect(result).toBe(CACHE_MISS_SENTINEL);
    });

    it('returns null when Redis throws (graceful degradation)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));
      const result = await cache.get('deezer:image:radiohead');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores JSON-serialized value with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await cache.set('lastfm:stats:radiohead', { listeners: 5000 }, 86400);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lastfm:stats:radiohead',
        JSON.stringify({ listeners: 5000 }),
        'EX',
        86400
      );
    });

    it('stores simple string values with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await cache.set('deezer:image:radiohead', 'https://cdn.deezer.com/img.jpg', 604800);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'deezer:image:radiohead',
        JSON.stringify('https://cdn.deezer.com/img.jpg'),
        'EX',
        604800
      );
    });

    it('does not throw when Redis is unavailable', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection refused'));
      await expect(cache.set('key', 'value', 60)).resolves.toBeUndefined();
    });
  });

  describe('setMiss', () => {
    it('stores miss sentinel with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await cache.setMiss('deezer:image:noartist', 3600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'deezer:image:noartist',
        CACHE_MISS_SENTINEL,
        'EX',
        3600
      );
    });

    it('does not throw when Redis is unavailable', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection refused'));
      await expect(cache.setMiss('key', 60)).resolves.toBeUndefined();
    });
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd apps/api && npx vitest run tests/services/cache.test.ts
```
Expected: FAIL (module not found — `cache.ts` doesn't exist yet)

### Step 3: Implement CacheService

Create `apps/api/src/services/cache.ts`:

```typescript
/**
 * CacheService - Generic Redis cache wrapper for external API responses.
 *
 * Features:
 * - JSON serialization/deserialization
 * - TTL-based expiration
 * - Cache miss sentinel for confirmed no-results
 * - Graceful degradation when Redis is unavailable
 */

import { redis } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CacheService');

/** Sentinel value stored for confirmed API misses (no result found) */
export const CACHE_MISS_SENTINEL = '__MISS__';

/** Cache TTL constants (in seconds) */
export const CACHE_TTLS = {
  /** Deezer artist images — 7 days (images rarely change) */
  DEEZER_IMAGE: 7 * 24 * 60 * 60,
  /** Last.fm artist stats — 24 hours (listener counts drift) */
  LASTFM_STATS: 24 * 60 * 60,
  /** Confirmed miss — 1 hour (retry sooner in case artist was added) */
  MISS: 60 * 60,
} as const;

/** Cache key prefix builders */
export const CACHE_KEYS = {
  deezerImage: (normalizedName: string) => `deezer:image:${normalizedName}`,
  lastfmStats: (normalizedName: string) => `lastfm:stats:${normalizedName}`,
} as const;

export class CacheService {
  private redisClient: typeof redis;

  constructor(redisInstance?: typeof redis) {
    this.redisClient = redisInstance || redis;
  }

  /**
   * Get a cached value.
   * Returns null on cache miss (key not found) or Redis error.
   * Returns CACHE_MISS_SENTINEL if a miss was previously cached.
   * Returns parsed JSON value on hit.
   */
  async get<T>(key: string): Promise<T | null | typeof CACHE_MISS_SENTINEL> {
    try {
      const raw = await this.redisClient.get(key);
      if (raw === null) return null;
      if (raw === CACHE_MISS_SENTINEL) return CACHE_MISS_SENTINEL;
      return JSON.parse(raw) as T;
    } catch (error) {
      log.warn('Cache get failed', { key, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Store a value in cache with TTL.
   * Silently fails if Redis is unavailable.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      log.warn('Cache set failed', { key, error: (error as Error).message });
    }
  }

  /**
   * Store a miss sentinel in cache with TTL.
   * Used to avoid re-fetching artists with no results.
   */
  async setMiss(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redisClient.set(key, CACHE_MISS_SENTINEL, 'EX', ttlSeconds);
    } catch (error) {
      log.warn('Cache setMiss failed', { key, error: (error as Error).message });
    }
  }
}

/** Singleton instance for production use */
export const cacheService = new CacheService();
```

### Step 4: Run tests to verify they pass

```bash
cd apps/api && npx vitest run tests/services/cache.test.ts
```
Expected: ALL PASS

### Step 5: Commit

```bash
git add apps/api/src/services/cache.ts apps/api/tests/services/cache.test.ts
git commit -m "feat: add CacheService for Redis-backed API response caching

- Generic get/set/setMiss with JSON serialization
- Graceful degradation when Redis unavailable
- TTL constants for Deezer (7d), Last.fm (24h), misses (1h)
- Cache key prefix builders for consistent key structure
- Full test coverage including error resilience"
```

---

## Task 2: Add Cache to enrichWithImages

**Quality Requirements:**
- Edge Cases: All items have images (no-op), all items need images (full cache pass), mixed cache hits/misses, Deezer returns undefined
- Attack Vectors: None (artist names normalized before key use)
- AI Slop Watch: Don't break existing test expectations, keep method signature compatible

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (constructor + `enrichWithImages`)
- Modify: `apps/api/tests/services/feed.test.ts` (add cache tests)

### Step 1: Write failing tests for cached enrichWithImages

Add to `apps/api/tests/services/feed.test.ts` — new describe block within the FeedService describe:

```typescript
// Add after the enrichWithLastfm describe block, inside the FeedService describe

describe('enrichWithImages (cached)', () => {
  it('uses cached image URL and skips Deezer call', async () => {
    const mockCache = {
      get: vi.fn().mockResolvedValue('https://cached.deezer.com/img.jpg'),
      set: vi.fn(),
      setMiss: vi.fn(),
    };
    const service = new FeedService(undefined, undefined, undefined, mockCache as any);
    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];
    const result = await service.enrichWithImages(items);
    expect(result[0].imageUrl).toBe('https://cached.deezer.com/img.jpg');
    expect(mockCache.get).toHaveBeenCalledWith('deezer:image:radiohead');
  });

  it('skips Deezer call when miss is cached', async () => {
    const { CACHE_MISS_SENTINEL } = await import('../../src/services/cache.js');
    const mockCache = {
      get: vi.fn().mockResolvedValue(CACHE_MISS_SENTINEL),
      set: vi.fn(),
      setMiss: vi.fn(),
    };
    const service = new FeedService(undefined, undefined, undefined, mockCache as any);
    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'No Image Artist',
        artistMbid: null,
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 30,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];
    const result = await service.enrichWithImages(items);
    expect(result[0].imageUrl).toBeNull();
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('skips items that already have imageUrl', async () => {
    const mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      setMiss: vi.fn(),
    };
    const service = new FeedService(undefined, undefined, undefined, mockCache as any);
    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Has Image',
        artistMbid: null,
        imageUrl: 'https://existing.com/img.jpg',
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 30,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];
    const result = await service.enrichWithImages(items);
    expect(result[0].imageUrl).toBe('https://existing.com/img.jpg');
    expect(mockCache.get).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: FAIL (FeedService constructor doesn't accept cache parameter yet)

### Step 3: Implement cache support in FeedService constructor and enrichWithImages

Modify `apps/api/src/services/FeedService.ts`:

**Constructor changes:**
- Add optional `cacheService` parameter (4th argument)
- Store as `private cacheService: CacheService | null`
- Import `CacheService`, `CACHE_MISS_SENTINEL`, `CACHE_TTLS`, `CACHE_KEYS` from `./cache.js`

**enrichWithImages changes:**
- Make method `public` (was `private`) so tests can call it directly
- For each item needing an image:
  1. Build cache key: `CACHE_KEYS.deezerImage(this.normalizeName(item.artistName))`
  2. Check cache → if hit, use value; if `__MISS__`, skip; if null, call Deezer
  3. On Deezer success → `cache.set()` with `CACHE_TTLS.DEEZER_IMAGE`
  4. On Deezer no-result → `cache.setMiss()` with `CACHE_TTLS.MISS`
- If no cacheService, call Deezer directly (existing behavior)

### Step 4: Run tests to verify they pass

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: ALL PASS (including existing tests — they use `new FeedService()` with no cache, so behavior unchanged)

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed.test.ts
git commit -m "feat: add Redis cache to Deezer image enrichment

- FeedService constructor accepts optional CacheService
- enrichWithImages checks cache before calling Deezer API
- Caches successful results (7d TTL) and misses (1h TTL)
- Existing behavior unchanged when no cache provided
- Tests verify cache hit, miss sentinel, and skip behavior"
```

---

## Task 3: Add Cache to enrichWithLastfm

**Quality Requirements:**
- Edge Cases: lastfmService is null (unchanged), all items have metadata (no-op), Last.fm returns null stats, empty tags array
- Attack Vectors: None
- AI Slop Watch: Mirror the same pattern as enrichWithImages for consistency

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (`enrichWithLastfm`)
- Modify: `apps/api/tests/services/feed.test.ts` (add cache tests)

### Step 1: Write failing tests for cached enrichWithLastfm

Add to `apps/api/tests/services/feed.test.ts`:

```typescript
describe('enrichWithLastfm (cached)', () => {
  it('uses cached stats and skips Last.fm call', async () => {
    const mockCache = {
      get: vi.fn().mockResolvedValue({ listeners: 5000000, playcount: 100000000, tags: ['rock', 'alternative', 'british'] }),
      set: vi.fn(),
      setMiss: vi.fn(),
    };
    const mockLastfm = { getArtistStats: vi.fn() };
    const service = new FeedService(undefined, undefined, undefined, mockCache as any);
    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];
    const result = await service.enrichWithLastfm(items, mockLastfm as any);
    expect(result[0].listeners).toBe(5000000);
    expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
    expect(mockLastfm.getArtistStats).not.toHaveBeenCalled();
  });

  it('skips Last.fm call when miss is cached', async () => {
    const { CACHE_MISS_SENTINEL } = await import('../../src/services/cache.js');
    const mockCache = {
      get: vi.fn().mockResolvedValue(CACHE_MISS_SENTINEL),
      set: vi.fn(),
      setMiss: vi.fn(),
    };
    const mockLastfm = { getArtistStats: vi.fn() };
    const service = new FeedService(undefined, undefined, undefined, mockCache as any);
    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Unknown',
        artistMbid: null,
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 30,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];
    const result = await service.enrichWithLastfm(items, mockLastfm as any);
    expect(result[0].tags).toBeNull();
    expect(result[0].listeners).toBeNull();
    expect(mockLastfm.getArtistStats).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: FAIL (enrichWithLastfm doesn't check cache yet)

### Step 3: Implement cache in enrichWithLastfm

Same pattern as enrichWithImages:
- For each item needing enrichment, check `CACHE_KEYS.lastfmStats(normalized)` first
- On cache hit → use cached `{ listeners, tags }` 
- On `__MISS__` → skip
- On cache miss → call Last.fm API → cache result with `CACHE_TTLS.LASTFM_STATS` or miss with `CACHE_TTLS.MISS`

### Step 4: Run tests to verify they pass

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: ALL PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed.test.ts
git commit -m "feat: add Redis cache to Last.fm stats enrichment

- enrichWithLastfm checks cache before calling Last.fm API
- Caches successful results (24h TTL) and misses (1h TTL)
- Existing behavior unchanged when no cache provided
- Tests verify cache hit and miss sentinel behavior"
```

---

## Task 4: Add DB Write-Back for Enrichment Results

**Quality Requirements:**
- Edge Cases: No items enriched (no-op), partial enrichment (some succeeded, some failed), linkedResultIds empty
- Attack Vectors: None (writing to own rows with known IDs)
- AI Slop Watch: Fire-and-forget must still log errors, not silently swallow

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (add `persistEnrichment` + wire into `getFeedForUser`)
- Modify: `apps/api/tests/services/feed.test.ts` (add persistence tests)

### Step 1: Write failing tests for persistEnrichment

Add to `apps/api/tests/services/feed.test.ts`:

```typescript
describe('persistEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates SubscriptionResult rows with enriched image data', async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockPrismaInstance = {
      subscriptionResult: { updateMany: mockUpdateMany },
    };
    const service = new FeedService(mockPrismaInstance as any);

    const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1-2',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1, 2],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];

    const after = [{ ...before[0], imageUrl: 'https://cdn.deezer.com/img.jpg' }];

    await service.persistEnrichment(before, after);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { imageUrl: 'https://cdn.deezer.com/img.jpg' },
    });
  });

  it('updates SubscriptionResult rows with enriched tags and listeners', async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockPrismaInstance = {
      subscriptionResult: { updateMany: mockUpdateMany },
    };
    const service = new FeedService(mockPrismaInstance as any);

    const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: 'https://existing.com/img.jpg',
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];

    const after = [{ ...before[0], tags: ['rock', 'alternative'], listeners: 5000000 }];

    await service.persistEnrichment(before, after);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { tags: JSON.stringify(['rock', 'alternative']), listeners: 5000000 },
    });
  });

  it('does nothing when no items were enriched', async () => {
    const mockUpdateMany = vi.fn();
    const mockPrismaInstance = {
      subscriptionResult: { updateMany: mockUpdateMany },
    };
    const service = new FeedService(mockPrismaInstance as any);

    const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];

    // Before and after identical — no enrichment happened
    await service.persistEnrichment(items, items);

    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('does not throw when DB update fails', async () => {
    const mockUpdateMany = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    const mockPrismaInstance = {
      subscriptionResult: { updateMany: mockUpdateMany },
    };
    const service = new FeedService(mockPrismaInstance as any);

    const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
      {
        id: 'feed-1',
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        imageUrl: null,
        subscriptionCount: 1,
        sourceTypes: ['lastfm'],
        sourceCount: 1,
        linkedResultIds: [1],
        earliestFound: new Date(),
        score: 50,
        tags: null,
        listeners: null,
        subscriptionName: null,
      },
    ];

    const after = [{ ...before[0], imageUrl: 'https://cdn.deezer.com/img.jpg' }];

    // Should not throw — errors are logged, not propagated
    await expect(service.persistEnrichment(before, after)).resolves.toBeUndefined();
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: FAIL (`persistEnrichment` method doesn't exist)

### Step 3: Implement persistEnrichment

Add to `apps/api/src/services/FeedService.ts`:

```typescript
/**
 * Persist enrichment data back to SubscriptionResult rows.
 * Compares before/after items and writes changed fields.
 * Fire-and-forget — errors are logged but don't propagate.
 */
async persistEnrichment(
  before: AggregatedFeedItem[],
  after: AggregatedFeedItem[]
): Promise<void> {
  const beforeMap = new Map(before.map(item => [item.id, item]));

  for (const afterItem of after) {
    const beforeItem = beforeMap.get(afterItem.id);
    if (!beforeItem) continue;

    const data: Record<string, unknown> = {};

    // Check if imageUrl was enriched
    if (!beforeItem.imageUrl && afterItem.imageUrl) {
      data.imageUrl = afterItem.imageUrl;
    }

    // Check if tags were enriched
    if (beforeItem.tags === null && afterItem.tags !== null) {
      data.tags = JSON.stringify(afterItem.tags);
    }

    // Check if listeners were enriched
    if (beforeItem.listeners === null && afterItem.listeners !== null) {
      data.listeners = afterItem.listeners;
    }

    if (Object.keys(data).length === 0) continue;

    try {
      await this.prismaClient.subscriptionResult.updateMany({
        where: { id: { in: afterItem.linkedResultIds } },
        data,
      });
    } catch (error) {
      log.warn('Enrichment write-back failed', {
        artistName: afterItem.artistName,
        error: (error as Error).message,
      });
    }
  }
}
```

### Step 4: Run tests to verify they pass

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts
```
Expected: ALL PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed.test.ts
git commit -m "feat: add enrichment write-back to SubscriptionResult rows

- persistEnrichment compares before/after items for changes
- Writes imageUrl, tags, listeners to DB when enriched
- Fire-and-forget: errors logged but don't propagate
- Idempotent: same update can run multiple times safely
- Tests verify image, stats, no-op, and error resilience"
```

---

## Task 5: Wire Cache and Write-Back into getFeedForUser

**Quality Requirements:**
- Edge Cases: Empty feed (no items to enrich), all items already have all data (nothing to persist)
- Attack Vectors: None
- AI Slop Watch: Don't break existing getFeedForUser tests

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (`getFeedForUser`)
- Modify: `apps/api/src/routes/feed.ts` (pass cacheService to FeedService)

### Step 1: Wire write-back into getFeedForUser

In `apps/api/src/services/FeedService.ts`, modify `getFeedForUser()`:

```typescript
// BEFORE (current):
const imageEnrichedItems = await this.enrichWithImages(paginated);
const enrichedItems = await this.enrichWithLastfm(imageEnrichedItems, lastfmService || null);

// AFTER:
const preEnrichment = paginated.map(item => ({ ...item })); // snapshot before
const imageEnrichedItems = await this.enrichWithImages(paginated);
const enrichedItems = await this.enrichWithLastfm(imageEnrichedItems, lastfmService || null);

// Fire-and-forget: persist enrichment data to DB
this.persistEnrichment(preEnrichment, enrichedItems).catch(err =>
  log.warn('Background enrichment write-back failed', { error: (err as Error).message })
);
```

### Step 2: Wire cacheService into feed route

In `apps/api/src/routes/feed.ts`:

```typescript
// Add import:
import { cacheService } from '../services/cache.js';

// Change service initialization:
const service = feedService || new FeedService(undefined, undefined, undefined, cacheService);
```

### Step 3: Run all feed-related tests

```bash
cd apps/api && npx vitest run tests/services/feed.test.ts tests/api/feed.test.ts
```
Expected: ALL PASS

### Step 4: Run full test suite to check for regressions

```bash
cd apps/api && npx vitest run
```
Expected: ALL PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/src/routes/feed.ts
git commit -m "feat: wire cache and write-back into feed pipeline

- getFeedForUser snapshots items before enrichment
- Fires background persistEnrichment after enrichment
- Feed route passes cacheService to FeedService
- No behavior change for existing tests (cache is optional)"
```

---

## Task 6: Final Verification

### Step 1: Run full test suite

```bash
cd apps/api && npx vitest run
```
Expected: ALL PASS, no regressions

### Step 2: Type check

```bash
cd apps/api && npx tsc --noEmit
```
Expected: No errors

### Step 3: Manual smoke test (optional, with dev stack)

```bash
# Start dev stack
./scripts/start-dev.sh

# Check Redis keys populate after loading feed
sudo docker exec mixarr-redis redis-cli KEYS 'deezer:*'
sudo docker exec mixarr-redis redis-cli KEYS 'lastfm:*'

# Reload feed — should be fast (cache hits)
# Check SubscriptionResult rows have imageUrl/tags/listeners populated
```

### Step 4: Commit any final adjustments

```bash
git add -A
git commit -m "chore: final verification — all tests pass, types clean"
```
