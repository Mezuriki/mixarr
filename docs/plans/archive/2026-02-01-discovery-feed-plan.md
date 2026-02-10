# Discovery Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Dashboard with a curated recommendation feed that aggregates subscription results, ranks by value score, and provides simple approve/dismiss actions.

**Architecture:** New FeedService computes aggregated feed from SubscriptionResult table at query time (no new schema). Feed routes expose GET/POST endpoints. New React page replaces Dashboard with card grid and infinite scroll.

**Tech Stack:** Express routes, Prisma queries, Vitest tests, React/Next.js frontend, TailwindCSS, IntersectionObserver for infinite scroll.

**Design Doc:** `docs/plans/2026-02-01-discovery-feed-design.md`

---

## Requirements

**Edge Cases:**
- Empty feed (no results) → show empty state
- Single result → still works, score calculated
- 10+ subscriptions find same artist → score capped
- Artist without MBID → fallback to normalized name dedup
- Missing image → placeholder
- No subscriptions → empty state with setup link

**Security:**
- All endpoints require authentication
- User sees only their own subscriptions' results
- Approve/dismiss scoped to user's feed items

**Data Integrity:**
- Approve/dismiss wrapped in transaction
- All linked SubscriptionResults updated atomically
- ReviewItem deletion in same transaction

**Error Handling:**
- Lidarr unavailable → 503 with message
- Feed item not found → 404
- Invalid pagination → 400

---

## Task 1: FeedService Core - Aggregation Logic

**Quality Requirements:**
- Edge Cases: empty results, single result, no MBID, duplicate names
- Attack Vectors: none (internal service, no user input)
- AI Slop Watch: specific method names, typed return values

**Files:**
- Create: `apps/api/src/services/FeedService.ts`
- Test: `apps/api/tests/services/feed.test.ts`

### Step 1: Planning Phase - Quality Gate

Document in test file comments:
- Edge cases: empty array, single item, multiple items same MBID, multiple items same name no MBID
- Test priority: edge cases first, then aggregation logic, then scoring

### Step 2: Write failing tests (RED)

```typescript
// apps/api/tests/services/feed.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedService } from '../../src/services/FeedService';

describe('FeedService', () => {
  describe('aggregateResults', () => {
    it('returns empty array when no results', () => {
      const service = new FeedService();
      const result = service.aggregateResults([]);
      expect(result).toEqual([]);
    });

    it('returns single item unchanged when one result', () => {
      const service = new FeedService();
      const results = [{
        id: 1,
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        subscriptionId: 1,
        imageUrl: 'http://example.com/img.jpg',
        createdAt: new Date('2026-01-30'),
        status: 'pending',
        sources: ['lastfm'],
      }];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].artistName).toBe('Radiohead');
      expect(aggregated[0].linkedResultIds).toEqual([1]);
    });

    it('deduplicates by MBID when available', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
      expect(aggregated[0].linkedResultIds).toEqual([1, 2]);
    });

    it('deduplicates by normalized name when no MBID', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'The Beatles', artistMbid: null, subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Beatles', artistMbid: null, subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
    });

    it('collects unique source types across results', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['lastfm', 'spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toContain('lastfm');
      expect(aggregated[0].sourceTypes).toContain('spotify');
      expect(aggregated[0].sourceCount).toBe(2);
    });

    it('uses earliest createdAt from linked results', () => {
      const service = new FeedService();
      const early = new Date('2026-01-01');
      const late = new Date('2026-01-30');
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: late, status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['spotify'], createdAt: early, status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].earliestFound).toEqual(early);
    });
  });
});
```

### Step 3: Test Coverage Quality Gate

Verify tests cover:
- ✅ Empty array
- ✅ Single item
- ✅ MBID deduplication
- ✅ Name-based deduplication fallback
- ✅ Source type collection
- ✅ Earliest date tracking

### Step 4: Run tests to verify they fail

Run: `cd apps/api && npx vitest run tests/services/feed.test.ts`
Expected: FAIL (FeedService not defined)

### Step 5: Write minimal implementation

```typescript
// apps/api/src/services/FeedService.ts
export interface AggregatedFeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  subscriptionCount: number;
  sourceTypes: string[];
  sourceCount: number;
  linkedResultIds: number[];
  earliestFound: Date;
  score: number;
}

interface SubscriptionResultInput {
  id: number;
  artistName: string;
  artistMbid: string | null;
  subscriptionId: number;
  imageUrl?: string | null;
  sources: string[] | unknown;
  createdAt: Date;
  status: string;
}

export class FeedService {
  /**
   * Normalize artist name for deduplication.
   * Lowercase, remove "The " prefix, strip non-alphanumeric.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Parse sources from various formats (JSON array, string, etc.)
   */
  private parseSources(sources: unknown): string[] {
    if (Array.isArray(sources)) {
      return sources.filter((s): s is string => typeof s === 'string');
    }
    if (typeof sources === 'string') {
      try {
        const parsed = JSON.parse(sources);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Generate a synthetic feed item ID from linked result IDs.
   */
  private generateFeedId(linkedIds: number[]): string {
    const sorted = [...linkedIds].sort((a, b) => a - b);
    return `feed-${sorted.join('-')}`;
  }

  /**
   * Aggregate subscription results into deduplicated feed items.
   */
  aggregateResults(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
    if (results.length === 0) {
      return [];
    }

    // Group by MBID or normalized name
    const groups = new Map<string, SubscriptionResultInput[]>();

    for (const result of results) {
      const key = result.artistMbid || this.normalizeName(result.artistName);
      const existing = groups.get(key) || [];
      existing.push(result);
      groups.set(key, existing);
    }

    // Convert groups to aggregated items
    const aggregated: AggregatedFeedItem[] = [];

    for (const [, groupResults] of groups) {
      const linkedResultIds = groupResults.map((r) => r.id);
      const subscriptionIds = new Set(groupResults.map((r) => r.subscriptionId));

      // Collect all unique source types
      const allSources = new Set<string>();
      for (const r of groupResults) {
        const sources = this.parseSources(r.sources);
        sources.forEach((s) => allSources.add(s));
      }

      // Find earliest date
      const earliestFound = groupResults.reduce((earliest, r) => {
        return r.createdAt < earliest ? r.createdAt : earliest;
      }, groupResults[0].createdAt);

      // Prefer result with MBID for display data
      const primary = groupResults.find((r) => r.artistMbid) || groupResults[0];

      aggregated.push({
        id: this.generateFeedId(linkedResultIds),
        artistName: primary.artistName,
        artistMbid: primary.artistMbid,
        imageUrl: primary.imageUrl || null,
        subscriptionCount: subscriptionIds.size,
        sourceTypes: Array.from(allSources),
        sourceCount: allSources.size,
        linkedResultIds,
        earliestFound,
        score: 0, // Calculated in next task
      });
    }

    return aggregated;
  }
}
```

### Step 6: Code Quality Gate

Check implementation:
- 🦆 Logic: Handles empty, single, dedup by MBID/name ✅
- 💀 Security: Internal service, no user input ✅
- 🤖 AI Slop: Specific names, typed interfaces, no TODOs ✅

### Step 7: Run tests to verify they pass

Run: `cd apps/api && npx vitest run tests/services/feed.test.ts`
Expected: All tests PASS

### Step 8: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed.test.ts
git commit -m "feat(api): add FeedService with aggregation logic

- Deduplicates by MBID or normalized name
- Collects source types and subscription counts
- Tracks earliest found date
- Generates synthetic feed IDs"
```

---

## Task 2: FeedService - Scoring Logic

**Quality Requirements:**
- Edge Cases: zero subscriptions (shouldn't happen), max caps, all recency tiers
- Attack Vectors: none
- AI Slop Watch: clear scoring formula, testable pure function

**Files:**
- Modify: `apps/api/src/services/FeedService.ts`
- Modify: `apps/api/tests/services/feed.test.ts`

### Step 1: Write failing tests (RED)

```typescript
// Add to apps/api/tests/services/feed.test.ts
describe('calculateScore', () => {
  it('weights subscription count at 40%', () => {
    const service = new FeedService();
    // 2 subscriptions × 40 = 80 (before normalization)
    const score = service.calculateScore({
      subscriptionCount: 2,
      sourceCount: 0,
      librarySimilarity: 0,
      earliestFound: new Date(0), // old, no recency bonus
    });
    expect(score).toBeGreaterThan(0);
  });

  it('weights source count at 30%', () => {
    const service = new FeedService();
    const scoreWith1Source = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 1,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    const scoreWith3Sources = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 3,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    expect(scoreWith3Sources).toBeGreaterThan(scoreWith1Source);
  });

  it('caps subscription count at 10', () => {
    const service = new FeedService();
    const scoreAt10 = service.calculateScore({
      subscriptionCount: 10,
      sourceCount: 0,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    const scoreAt20 = service.calculateScore({
      subscriptionCount: 20,
      sourceCount: 0,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    expect(scoreAt20).toBe(scoreAt10);
  });

  it('caps source count at 5', () => {
    const service = new FeedService();
    const scoreAt5 = service.calculateScore({
      subscriptionCount: 0,
      sourceCount: 5,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    const scoreAt10 = service.calculateScore({
      subscriptionCount: 0,
      sourceCount: 10,
      librarySimilarity: 0,
      earliestFound: new Date(0),
    });
    expect(scoreAt10).toBe(scoreAt5);
  });

  it('gives recency bonus for items under 24 hours old', () => {
    const service = new FeedService();
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const recentScore = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 1,
      librarySimilarity: 0,
      earliestFound: hourAgo,
    });
    const oldScore = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 1,
      librarySimilarity: 0,
      earliestFound: weekAgo,
    });
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives partial recency bonus for items under 7 days old', () => {
    const service = new FeedService();
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const recentishScore = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 1,
      librarySimilarity: 0,
      earliestFound: threeDaysAgo,
    });
    const oldScore = service.calculateScore({
      subscriptionCount: 1,
      sourceCount: 1,
      librarySimilarity: 0,
      earliestFound: monthAgo,
    });
    expect(recentishScore).toBeGreaterThan(oldScore);
  });
});

describe('getFeed (with scoring)', () => {
  it('sorts results by score descending', () => {
    const service = new FeedService();
    const results = [
      { id: 1, artistName: 'LowScore', artistMbid: 'a', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date('2020-01-01'), status: 'pending' },
      { id: 2, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
      { id: 3, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
    ];
    const feed = service.aggregateAndScore(results);
    expect(feed[0].artistName).toBe('HighScore');
    expect(feed[1].artistName).toBe('LowScore');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/api && npx vitest run tests/services/feed.test.ts`
Expected: FAIL (calculateScore not defined)

### Step 3: Write minimal implementation

```typescript
// Add to apps/api/src/services/FeedService.ts

interface ScoreInput {
  subscriptionCount: number;
  sourceCount: number;
  librarySimilarity: number;
  earliestFound: Date;
}

// Add method to FeedService class:

/**
 * Calculate value score for a feed item.
 * Formula: (subscriptionCount × 40) + (sourceCount × 30) + (librarySimilarity × 20) + (recencyBonus × 10)
 * Caps: subscriptionCount at 10, sourceCount at 5, librarySimilarity at 20
 */
calculateScore(input: ScoreInput): number {
  const SUB_WEIGHT = 40;
  const SOURCE_WEIGHT = 30;
  const LIBRARY_WEIGHT = 20;
  const RECENCY_WEIGHT = 10;

  const subScore = Math.min(input.subscriptionCount, 10) * (SUB_WEIGHT / 10);
  const sourceScore = Math.min(input.sourceCount, 5) * (SOURCE_WEIGHT / 5);
  const libraryScore = Math.min(input.librarySimilarity, 20) * (LIBRARY_WEIGHT / 20);

  // Recency bonus
  const now = Date.now();
  const age = now - input.earliestFound.getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;

  let recencyBonus = 0;
  if (age < ONE_DAY) {
    recencyBonus = RECENCY_WEIGHT;
  } else if (age < ONE_WEEK) {
    recencyBonus = RECENCY_WEIGHT * 0.5;
  }

  return Math.round(subScore + sourceScore + libraryScore + recencyBonus);
}

/**
 * Aggregate results and calculate scores, sorted by score descending.
 */
aggregateAndScore(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
  const aggregated = this.aggregateResults(results);

  // Calculate scores
  for (const item of aggregated) {
    item.score = this.calculateScore({
      subscriptionCount: item.subscriptionCount,
      sourceCount: item.sourceCount,
      librarySimilarity: 0, // MVP: not implemented
      earliestFound: item.earliestFound,
    });
  }

  // Sort by score descending
  return aggregated.sort((a, b) => b.score - a.score);
}
```

### Step 4: Run tests to verify they pass

Run: `cd apps/api && npx vitest run tests/services/feed.test.ts`
Expected: All tests PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed.test.ts
git commit -m "feat(api): add scoring logic to FeedService

- Weighted formula: subscription (40%) + source (30%) + library (20%) + recency (10%)
- Caps on subscription count (10) and source count (5)
- Recency bonus: full for <24h, half for <7d
- Results sorted by score descending"
```

---

## Task 3: FeedService - Database Integration

**Quality Requirements:**
- Edge Cases: user with no subscriptions, user with no pending results
- Attack Vectors: user can only see own subscriptions (userId filter)
- AI Slop Watch: proper Prisma typing, clear query

**Files:**
- Modify: `apps/api/src/services/FeedService.ts`
- Create: `apps/api/tests/services/feed-integration.test.ts`

### Step 1: Write failing tests (RED)

```typescript
// apps/api/tests/services/feed-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FeedService } from '../../src/services/FeedService';

// Integration tests using test database
describe('FeedService Integration', () => {
  let prisma: PrismaClient;
  let feedService: FeedService;
  let testUserId: number;

  beforeEach(async () => {
    prisma = new PrismaClient();
    feedService = new FeedService(prisma);
    
    // Create test user and subscriptions
    const user = await prisma.user.create({
      data: { email: 'test@example.com', passwordHash: 'hash' },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.subscriptionResult.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  it('returns empty feed for user with no subscriptions', async () => {
    const feed = await feedService.getFeedForUser(testUserId, { limit: 50, offset: 0 });
    expect(feed.items).toEqual([]);
    expect(feed.total).toBe(0);
  });

  it('returns only pending and queued results', async () => {
    const sub = await prisma.subscription.create({
      data: { userId: testUserId, name: 'Test', type: 'lastfm_similar', enabled: true },
    });

    await prisma.subscriptionResult.createMany({
      data: [
        { subscriptionId: sub.id, resultType: 'artist', artistName: 'Pending', status: 'pending', sources: '["lastfm"]' },
        { subscriptionId: sub.id, resultType: 'artist', artistName: 'Queued', status: 'queued', sources: '["lastfm"]' },
        { subscriptionId: sub.id, resultType: 'artist', artistName: 'Added', status: 'added', sources: '["lastfm"]' },
        { subscriptionId: sub.id, resultType: 'artist', artistName: 'Rejected', status: 'rejected', sources: '["lastfm"]' },
      ],
    });

    const feed = await feedService.getFeedForUser(testUserId, { limit: 50, offset: 0 });
    expect(feed.items).toHaveLength(2);
    expect(feed.items.map(i => i.artistName).sort()).toEqual(['Pending', 'Queued']);
  });

  it('does not return other users results', async () => {
    const otherUser = await prisma.user.create({
      data: { email: 'other@example.com', passwordHash: 'hash' },
    });
    const otherSub = await prisma.subscription.create({
      data: { userId: otherUser.id, name: 'Other', type: 'lastfm_similar', enabled: true },
    });
    await prisma.subscriptionResult.create({
      data: { subscriptionId: otherSub.id, resultType: 'artist', artistName: 'OtherArtist', status: 'pending', sources: '["lastfm"]' },
    });

    const feed = await feedService.getFeedForUser(testUserId, { limit: 50, offset: 0 });
    expect(feed.items).toEqual([]);
  });

  it('respects pagination limit and offset', async () => {
    const sub = await prisma.subscription.create({
      data: { userId: testUserId, name: 'Test', type: 'lastfm_similar', enabled: true },
    });

    // Create 10 results
    for (let i = 0; i < 10; i++) {
      await prisma.subscriptionResult.create({
        data: { subscriptionId: sub.id, resultType: 'artist', artistName: `Artist${i}`, artistMbid: `mbid-${i}`, status: 'pending', sources: '["lastfm"]' },
      });
    }

    const page1 = await feedService.getFeedForUser(testUserId, { limit: 3, offset: 0 });
    const page2 = await feedService.getFeedForUser(testUserId, { limit: 3, offset: 3 });

    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.items[0].artistName).not.toBe(page2.items[0].artistName);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/api && npx vitest run tests/services/feed-integration.test.ts`
Expected: FAIL (getFeedForUser not defined)

### Step 3: Write minimal implementation

```typescript
// Update apps/api/src/services/FeedService.ts

import { PrismaClient } from '@prisma/client';

export interface FeedResponse {
  items: AggregatedFeedItem[];
  total: number;
  stats: {
    pending: number;
    addedToday: number;
  };
}

export interface FeedOptions {
  limit: number;
  offset: number;
  includeActedOn?: boolean;
}

export class FeedService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
  }

  async getFeedForUser(userId: number, options: FeedOptions): Promise<FeedResponse> {
    const { limit, offset, includeActedOn = false } = options;

    // Get user's subscription IDs
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId },
      select: { id: true },
    });

    if (subscriptions.length === 0) {
      return { items: [], total: 0, stats: { pending: 0, addedToday: 0 } };
    }

    const subscriptionIds = subscriptions.map((s) => s.id);

    // Filter statuses
    const statusFilter = includeActedOn
      ? ['pending', 'queued', 'added', 'rejected']
      : ['pending', 'queued'];

    // Fetch all matching results
    const results = await this.prisma.subscriptionResult.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        resultType: 'artist',
        status: { in: statusFilter },
      },
      select: {
        id: true,
        artistName: true,
        artistMbid: true,
        subscriptionId: true,
        imageUrl: true,
        sources: true,
        createdAt: true,
        status: true,
      },
    });

    // Aggregate and score
    const aggregated = this.aggregateAndScore(
      results.map((r) => ({
        id: r.id,
        artistName: r.artistName,
        artistMbid: r.artistMbid,
        subscriptionId: r.subscriptionId,
        imageUrl: r.imageUrl,
        sources: r.sources,
        createdAt: r.createdAt,
        status: r.status,
      }))
    );

    const total = aggregated.length;

    // Paginate
    const paginated = aggregated.slice(offset, offset + limit);

    // Calculate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const addedToday = await this.prisma.subscriptionResult.count({
      where: {
        subscriptionId: { in: subscriptionIds },
        status: 'added',
        updatedAt: { gte: today },
      },
    });

    const pending = await this.prisma.subscriptionResult.count({
      where: {
        subscriptionId: { in: subscriptionIds },
        status: { in: ['pending', 'queued'] },
      },
    });

    return {
      items: paginated,
      total,
      stats: { pending, addedToday },
    };
  }
  
  // ... existing methods
}
```

### Step 4: Run tests to verify they pass

Run: `cd apps/api && npx vitest run tests/services/feed-integration.test.ts`
Expected: All tests PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed-integration.test.ts
git commit -m "feat(api): add database integration to FeedService

- getFeedForUser fetches from SubscriptionResult
- Filters by user's subscriptions only
- Returns only pending/queued by default
- Supports pagination with limit/offset
- Includes stats: pending count, added today"
```

---

## Task 4: FeedService - Approve/Dismiss Actions

**Quality Requirements:**
- Edge Cases: feed item not found, Lidarr unavailable, concurrent requests
- Attack Vectors: user can only act on own feed items
- AI Slop Watch: transaction wrapping, clear error messages

**Files:**
- Modify: `apps/api/src/services/FeedService.ts`
- Create: `apps/api/tests/services/feed-actions.test.ts`

### Step 1: Write failing tests (RED)

```typescript
// apps/api/tests/services/feed-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedService } from '../../src/services/FeedService';

describe('FeedService Actions', () => {
  describe('approve', () => {
    it('throws NotFoundError when feed item does not exist', async () => {
      const mockPrisma = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrisma as any);
      
      await expect(service.approve('feed-999', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws ForbiddenError when feed item belongs to different user', async () => {
      const mockPrisma = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, subscription: { userId: 999 } }, // Different user
          ]),
        },
      };
      const service = new FeedService(mockPrisma as any);
      
      await expect(service.approve('feed-1', 1)).rejects.toThrow('Not authorized');
    });

    it('updates all linked SubscriptionResults to added status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const mockPrisma = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
            { id: 2, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
            { id: 3, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn) => fn(mockPrisma)),
      };
      const service = new FeedService(mockPrisma as any);
      
      await service.approve('feed-1-2-3', 1);
      
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3] } },
        data: { status: 'added' },
      });
    });

    it('deletes matching ReviewItems', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrisma = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn) => fn(mockPrisma)),
      };
      const service = new FeedService(mockPrisma as any);
      
      await service.approve('feed-1', 1);
      
      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { artistMbid: 'abc' },
            { artistName: 'Test' },
          ],
        },
      });
    });
  });

  describe('dismiss', () => {
    it('updates all linked SubscriptionResults to rejected status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockPrisma = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
            { id: 2, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn) => fn(mockPrisma)),
      };
      const service = new FeedService(mockPrisma as any);
      
      await service.dismiss('feed-1-2', 1);
      
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { status: 'rejected' },
      });
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/api && npx vitest run tests/services/feed-actions.test.ts`
Expected: FAIL (approve/dismiss not defined)

### Step 3: Write minimal implementation

```typescript
// Add to apps/api/src/services/FeedService.ts

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// Add to FeedService class:

/**
 * Parse linked result IDs from synthetic feed ID.
 */
private parseFeedId(feedId: string): number[] {
  const match = feedId.match(/^feed-(.+)$/);
  if (!match) return [];
  return match[1].split('-').map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
}

/**
 * Approve a feed item: add to Lidarr, update status to 'added', remove from ReviewItem.
 */
async approve(feedId: string, userId: number): Promise<{ artistName: string }> {
  const resultIds = this.parseFeedId(feedId);
  if (resultIds.length === 0) {
    throw new NotFoundError('Feed item not found');
  }

  // Fetch results with subscription to verify ownership
  const results = await this.prisma.subscriptionResult.findMany({
    where: { id: { in: resultIds } },
    include: { subscription: { select: { userId: true } } },
  });

  if (results.length === 0) {
    throw new NotFoundError('Feed item not found');
  }

  // Verify all belong to this user
  if (results.some((r) => r.subscription.userId !== userId)) {
    throw new ForbiddenError('Not authorized');
  }

  const artistName = results[0].artistName;
  const artistMbid = results[0].artistMbid;

  // Wrap in transaction
  await this.prisma.$transaction(async (tx) => {
    // Update all linked results
    await tx.subscriptionResult.updateMany({
      where: { id: { in: resultIds } },
      data: { status: 'added' },
    });

    // Delete matching ReviewItems
    await tx.reviewItem.deleteMany({
      where: {
        OR: [
          ...(artistMbid ? [{ artistMbid }] : []),
          { artistName },
        ],
      },
    });
  });

  // TODO: Call Lidarr to add artist (separate task)

  return { artistName };
}

/**
 * Dismiss a feed item: update status to 'rejected', remove from ReviewItem.
 */
async dismiss(feedId: string, userId: number): Promise<{ artistName: string }> {
  const resultIds = this.parseFeedId(feedId);
  if (resultIds.length === 0) {
    throw new NotFoundError('Feed item not found');
  }

  const results = await this.prisma.subscriptionResult.findMany({
    where: { id: { in: resultIds } },
    include: { subscription: { select: { userId: true } } },
  });

  if (results.length === 0) {
    throw new NotFoundError('Feed item not found');
  }

  if (results.some((r) => r.subscription.userId !== userId)) {
    throw new ForbiddenError('Not authorized');
  }

  const artistName = results[0].artistName;
  const artistMbid = results[0].artistMbid;

  await this.prisma.$transaction(async (tx) => {
    await tx.subscriptionResult.updateMany({
      where: { id: { in: resultIds } },
      data: { status: 'rejected' },
    });

    await tx.reviewItem.deleteMany({
      where: {
        OR: [
          ...(artistMbid ? [{ artistMbid }] : []),
          { artistName },
        ],
      },
    });
  });

  return { artistName };
}
```

### Step 4: Run tests to verify they pass

Run: `cd apps/api && npx vitest run tests/services/feed-actions.test.ts`
Expected: All tests PASS

### Step 5: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed-actions.test.ts
git commit -m "feat(api): add approve/dismiss actions to FeedService

- Parses linked result IDs from synthetic feed ID
- Verifies user owns all linked results
- Updates SubscriptionResult status in transaction
- Deletes matching ReviewItems atomically
- Returns artist name for UI feedback"
```

---

## Task 5: Feed API Routes

**Quality Requirements:**
- Edge Cases: invalid pagination params, unauthorized access
- Attack Vectors: auth required, user isolation, input validation
- AI Slop Watch: proper HTTP status codes, Zod validation

**Files:**
- Create: `apps/api/src/routes/feed.ts`
- Create: `apps/api/tests/api/feed.test.ts`
- Modify: `apps/api/src/index.ts` (register routes)

### Step 1: Write failing tests (RED)

```typescript
// apps/api/tests/api/feed.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { feedRouter } from '../../src/routes/feed';

describe('Feed Routes', () => {
  let app: express.Application;
  let mockFeedService: any;
  let mockUser: any;

  beforeEach(() => {
    mockUser = { id: 1, email: 'test@example.com' };
    mockFeedService = {
      getFeedForUser: vi.fn(),
      approve: vi.fn(),
      dismiss: vi.fn(),
    };

    app = express();
    app.use(express.json());
    // Mock auth middleware
    app.use((req, res, next) => {
      (req as any).user = mockUser;
      next();
    });
    app.use('/api/feed', feedRouter(mockFeedService));
  });

  describe('GET /api/feed', () => {
    it('returns 401 when not authenticated', async () => {
      const noAuthApp = express();
      noAuthApp.use('/api/feed', feedRouter(mockFeedService));

      const response = await request(noAuthApp).get('/api/feed');
      expect(response.status).toBe(401);
    });

    it('returns feed items with default pagination', async () => {
      mockFeedService.getFeedForUser.mockResolvedValue({
        items: [{ id: 'feed-1', artistName: 'Test' }],
        total: 1,
        stats: { pending: 1, addedToday: 0 },
      });

      const response = await request(app).get('/api/feed');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 50, offset: 0 });
    });

    it('accepts custom limit and offset', async () => {
      mockFeedService.getFeedForUser.mockResolvedValue({ items: [], total: 0, stats: { pending: 0, addedToday: 0 } });

      await request(app).get('/api/feed?limit=20&offset=40');

      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 20, offset: 40 });
    });

    it('rejects invalid limit', async () => {
      const response = await request(app).get('/api/feed?limit=-1');
      expect(response.status).toBe(400);
    });

    it('caps limit at 100', async () => {
      mockFeedService.getFeedForUser.mockResolvedValue({ items: [], total: 0, stats: { pending: 0, addedToday: 0 } });

      await request(app).get('/api/feed?limit=500');

      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 100, offset: 0 });
    });
  });

  describe('POST /api/feed/:id/approve', () => {
    it('approves feed item and returns artist name', async () => {
      mockFeedService.approve.mockResolvedValue({ artistName: 'Radiohead' });

      const response = await request(app).post('/api/feed/feed-1-2-3/approve');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, artistName: 'Radiohead' });
    });

    it('returns 404 when feed item not found', async () => {
      mockFeedService.approve.mockRejectedValue(new Error('Feed item not found'));

      const response = await request(app).post('/api/feed/feed-999/approve');

      expect(response.status).toBe(404);
    });

    it('returns 403 when not authorized', async () => {
      mockFeedService.approve.mockRejectedValue(new Error('Not authorized'));

      const response = await request(app).post('/api/feed/feed-1/approve');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/feed/:id/dismiss', () => {
    it('dismisses feed item and returns artist name', async () => {
      mockFeedService.dismiss.mockResolvedValue({ artistName: 'Coldplay' });

      const response = await request(app).post('/api/feed/feed-1/dismiss');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, artistName: 'Coldplay' });
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/api && npx vitest run tests/api/feed.test.ts`
Expected: FAIL (feedRouter not defined)

### Step 3: Write minimal implementation

```typescript
// apps/api/src/routes/feed.ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FeedService } from '../services/FeedService';

const feedQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export function feedRouter(feedService?: FeedService): Router {
  const router = Router();
  const service = feedService || new FeedService();

  // Auth middleware
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };

  // GET /api/feed
  router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = feedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      }

      const { limit, offset } = parsed.data;
      const userId = (req as any).user.id;

      const feed = await service.getFeedForUser(userId, { limit, offset });
      return res.json(feed);
    } catch (error) {
      console.error('Feed fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch feed' });
    }
  });

  // POST /api/feed/:id/approve
  router.post('/:id/approve', requireAuth, async (req: Request, res: Response) => {
    try {
      const feedId = req.params.id;
      const userId = (req as any).user.id;

      const result = await service.approve(feedId, userId);
      return res.json({ success: true, artistName: result.artistName });
    } catch (error: any) {
      if (error.message === 'Feed item not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === 'Not authorized') {
        return res.status(403).json({ error: error.message });
      }
      console.error('Approve error:', error);
      return res.status(500).json({ error: 'Failed to approve' });
    }
  });

  // POST /api/feed/:id/dismiss
  router.post('/:id/dismiss', requireAuth, async (req: Request, res: Response) => {
    try {
      const feedId = req.params.id;
      const userId = (req as any).user.id;

      const result = await service.dismiss(feedId, userId);
      return res.json({ success: true, artistName: result.artistName });
    } catch (error: any) {
      if (error.message === 'Feed item not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === 'Not authorized') {
        return res.status(403).json({ error: error.message });
      }
      console.error('Dismiss error:', error);
      return res.status(500).json({ error: 'Failed to dismiss' });
    }
  });

  return router;
}
```

### Step 4: Run tests to verify they pass

Run: `cd apps/api && npx vitest run tests/api/feed.test.ts`
Expected: All tests PASS

### Step 5: Register routes in index.ts

```typescript
// Add to apps/api/src/index.ts

import { feedRouter } from './routes/feed';

// After other route registrations:
app.use('/api/feed', feedRouter());
```

### Step 6: Commit

```bash
git add apps/api/src/routes/feed.ts apps/api/tests/api/feed.test.ts apps/api/src/index.ts
git commit -m "feat(api): add feed API routes

- GET /api/feed with pagination (limit, offset)
- POST /api/feed/:id/approve
- POST /api/feed/:id/dismiss
- Auth required on all endpoints
- Proper error status codes (401, 403, 404)"
```

---

## Task 6: Frontend - FeedCard Component

**Quality Requirements:**
- Edge Cases: missing image, long artist name, loading/error states
- Attack Vectors: XSS in artist name (React handles)
- AI Slop Watch: semantic HTML, accessible buttons

**Files:**
- Create: `apps/web/src/components/feed/FeedCard.tsx`
- Create: `apps/web/src/components/feed/FeedCard.test.tsx`

### Step 1: Write failing tests (RED)

```tsx
// apps/web/src/components/feed/FeedCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FeedCard } from './FeedCard';

describe('FeedCard', () => {
  const defaultProps = {
    id: 'feed-1',
    artistName: 'Radiohead',
    imageUrl: 'https://example.com/image.jpg',
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('renders artist name', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText('Radiohead')).toBeInTheDocument();
  });

  it('renders artist image', () => {
    render(<FeedCard {...defaultProps} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', expect.stringContaining('example.com'));
  });

  it('renders placeholder when no image', () => {
    render(<FeedCard {...defaultProps} imageUrl={null} />);
    expect(screen.getByTestId('image-placeholder')).toBeInTheDocument();
  });

  it('truncates long artist names', () => {
    render(<FeedCard {...defaultProps} artistName="This Is A Very Long Artist Name That Should Be Truncated" />);
    const name = screen.getByText(/This Is A Very Long/);
    expect(name).toHaveClass('truncate');
  });

  it('calls onApprove when approve button clicked', () => {
    const onApprove = vi.fn();
    render(<FeedCard {...defaultProps} onApprove={onApprove} />);
    
    fireEvent.click(screen.getByLabelText('Add to Lidarr'));
    expect(onApprove).toHaveBeenCalledWith('feed-1');
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    render(<FeedCard {...defaultProps} onDismiss={onDismiss} />);
    
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('feed-1');
  });

  it('shows "Added" overlay when status is added', () => {
    render(<FeedCard {...defaultProps} status="added" />);
    expect(screen.getByText('Added')).toBeInTheDocument();
  });

  it('shows "Dismissed" overlay when status is dismissed', () => {
    render(<FeedCard {...defaultProps} status="dismissed" />);
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(<FeedCard {...defaultProps} isLoading />);
    expect(screen.getByLabelText('Add to Lidarr')).toBeDisabled();
    expect(screen.getByLabelText('Dismiss')).toBeDisabled();
  });
});
```

### Step 2: Write implementation

```tsx
// apps/web/src/components/feed/FeedCard.tsx
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { cn } from '@/lib/utils';

export interface FeedCardProps {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
  isLoading?: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function FeedCard({
  id,
  artistName,
  imageUrl,
  status = 'pending',
  isLoading = false,
  onApprove,
  onDismiss,
}: FeedCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const showOverlay = status === 'added' || status === 'dismissed';
  const overlayText = status === 'added' ? 'Added' : status === 'dismissed' ? 'Dismissed' : '';

  return (
    <div
      className={cn(
        'relative group rounded-lg overflow-hidden bg-gray-800 transition-all duration-300',
        showOverlay && 'opacity-50'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image */}
      <div className="aspect-square relative">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={artistName}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div
            data-testid="image-placeholder"
            className="w-full h-full bg-gray-700 flex items-center justify-center"
          >
            <span className="text-4xl text-gray-500">🎵</span>
          </div>
        )}

        {/* Action overlay */}
        {showOverlay && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white font-semibold text-lg">{overlayText}</span>
          </div>
        )}

        {/* Action buttons */}
        {!showOverlay && (
          <div
            className={cn(
              'absolute inset-0 bg-black/40 flex items-center justify-center gap-4 transition-opacity',
              isHovered || isLoading ? 'opacity-100' : 'opacity-0'
            )}
          >
            <button
              type="button"
              aria-label="Add to Lidarr"
              disabled={isLoading}
              onClick={() => onApprove(id)}
              className="p-3 rounded-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <CheckIcon className="w-6 h-6 text-white" />
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              disabled={isLoading}
              onClick={() => onDismiss(id)}
              className="p-3 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <XMarkIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* Artist name */}
      <div className="p-3">
        <p className="text-white font-medium truncate" title={artistName}>
          {artistName}
        </p>
      </div>
    </div>
  );
}
```

### Step 3: Run tests

Run: `cd apps/web && npm test -- --run FeedCard`
Expected: All tests PASS

### Step 4: Commit

```bash
git add apps/web/src/components/feed/FeedCard.tsx apps/web/src/components/feed/FeedCard.test.tsx
git commit -m "feat(web): add FeedCard component

- Displays artist image with placeholder fallback
- Truncates long artist names
- Approve/dismiss buttons on hover
- Shows Added/Dismissed overlay on action
- Accessible button labels
- Loading state disables buttons"
```

---

## Task 7: Frontend - FeedGrid with Infinite Scroll

**Quality Requirements:**
- Edge Cases: empty feed, initial load, error state, all items loaded
- Attack Vectors: none (display only)
- AI Slop Watch: proper IntersectionObserver cleanup, loading states

**Files:**
- Create: `apps/web/src/components/feed/FeedGrid.tsx`
- Create: `apps/web/src/components/feed/FeedGrid.test.tsx`

### Step 1: Write failing tests (RED)

```tsx
// apps/web/src/components/feed/FeedGrid.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FeedGrid } from './FeedGrid';

describe('FeedGrid', () => {
  const mockItems = [
    { id: 'feed-1', artistName: 'Artist 1', imageUrl: null },
    { id: 'feed-2', artistName: 'Artist 2', imageUrl: null },
  ];

  it('renders cards for each item', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    expect(screen.getByText('Artist 1')).toBeInTheDocument();
    expect(screen.getByText('Artist 2')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(
      <FeedGrid
        items={[]}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    expect(screen.getByText(/No recommendations yet/)).toBeInTheDocument();
  });

  it('shows loading spinner when loading', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={true}
        isLoading
      />
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders in responsive grid layout', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    const grid = screen.getByTestId('feed-grid');
    expect(grid).toHaveClass('grid-cols-2');
    expect(grid).toHaveClass('md:grid-cols-3');
    expect(grid).toHaveClass('lg:grid-cols-4');
  });
});
```

### Step 2: Write implementation

```tsx
// apps/web/src/components/feed/FeedGrid.tsx
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { FeedCard } from './FeedCard';

export interface FeedItem {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
}

export interface FeedGridProps {
  items: FeedItem[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading?: boolean;
  loadingIds?: Set<string>;
}

export function FeedGrid({
  items,
  onApprove,
  onDismiss,
  onLoadMore,
  hasMore,
  isLoading = false,
  loadingIds = new Set(),
}: FeedGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading, onLoadMore]);

  // Empty state
  if (items.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-gray-400 text-lg mb-4">No recommendations yet</p>
        <p className="text-gray-500 mb-6">Set up subscriptions to start discovering artists</p>
        <Link
          href="/subscriptions"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
        >
          Set Up Subscriptions
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Grid */}
      <div
        data-testid="feed-grid"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
      >
        {items.map((item) => (
          <FeedCard
            key={item.id}
            id={item.id}
            artistName={item.artistName}
            imageUrl={item.imageUrl}
            status={item.status}
            isLoading={loadingIds.has(item.id)}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="h-10 mt-4">
          {isLoading && (
            <div data-testid="loading-spinner" className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Run tests

Run: `cd apps/web && npm test -- --run FeedGrid`
Expected: All tests PASS

### Step 4: Commit

```bash
git add apps/web/src/components/feed/FeedGrid.tsx apps/web/src/components/feed/FeedGrid.test.tsx
git commit -m "feat(web): add FeedGrid with infinite scroll

- Responsive grid: 4 cols desktop, 3 tablet, 2 mobile
- IntersectionObserver for infinite scroll (no deps)
- Empty state with link to subscriptions
- Loading spinner at bottom while fetching
- Proper observer cleanup on unmount"
```

---

## Task 8: Frontend - StatsBar Component

**Quality Requirements:**
- Edge Cases: zero counts, large numbers
- Attack Vectors: none
- AI Slop Watch: semantic markup, accessible

**Files:**
- Create: `apps/web/src/components/feed/StatsBar.tsx`

### Step 1: Write implementation (simple component, minimal test needed)

```tsx
// apps/web/src/components/feed/StatsBar.tsx
export interface StatsBarProps {
  pending: number;
  addedToday: number;
}

export function StatsBar({ pending, addedToday }: StatsBarProps) {
  return (
    <div className="text-sm text-gray-400 mb-6">
      <span>{pending} pending</span>
      <span className="mx-2">•</span>
      <span>{addedToday} added today</span>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add apps/web/src/components/feed/StatsBar.tsx
git commit -m "feat(web): add StatsBar component

- Displays pending count and added today
- Minimal styling, muted text"
```

---

## Task 9: Frontend - Dashboard Page

**Quality Requirements:**
- Edge Cases: fetch error, initial load, all cards dismissed
- Attack Vectors: auth required (Next.js middleware handles)
- AI Slop Watch: proper data fetching, optimistic updates

**Files:**
- Replace: `apps/web/src/app/dashboard/page.tsx`
- Create: `apps/web/src/hooks/useFeed.ts`

### Step 1: Create useFeed hook

```tsx
// apps/web/src/hooks/useFeed.ts
'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';

export interface FeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  score: number;
  subscriptionCount: number;
  sourceCount: number;
  status?: 'pending' | 'added' | 'dismissed';
}

export interface FeedStats {
  pending: number;
  addedToday: number;
}

export interface UseFeedResult {
  items: FeedItem[];
  stats: FeedStats;
  total: number;
  isLoading: boolean;
  loadingIds: Set<string>;
  hasMore: boolean;
  error: Error | null;
  fetchFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  approve: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const LIMIT = 50;

export function useFeed(): UseFeedResult {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [stats, setStats] = useState<FeedStats>({ pending: 0, addedToday: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const hasMore = offset + items.length < total;

  const fetchFeed = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feed?limit=${LIMIT}&offset=0`);
      if (!res.ok) throw new Error('Failed to fetch feed');
      const data = await res.json();
      setItems(data.items);
      setStats(data.stats);
      setTotal(data.total);
      setOffset(0);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    try {
      const newOffset = offset + LIMIT;
      const res = await fetch(`/api/feed?limit=${LIMIT}&offset=${newOffset}`);
      if (!res.ok) throw new Error('Failed to load more');
      const data = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setOffset(newOffset);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load more items', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMore, offset, toast]);

  const approve = useCallback(async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/feed/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to approve');
      const data = await res.json();
      
      // Optimistic update
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'added' as const } : item))
      );
      setStats((prev) => ({
        pending: prev.pending - 1,
        addedToday: prev.addedToday + 1,
      }));
      
      toast({ title: 'Added', description: `${data.artistName} added to Lidarr` });
      
      // Remove after animation
      setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 500);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to add artist', variant: 'destructive' });
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [toast]);

  const dismiss = useCallback(async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/feed/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to dismiss');
      const data = await res.json();
      
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'dismissed' as const } : item))
      );
      setStats((prev) => ({ ...prev, pending: prev.pending - 1 }));
      
      toast({ title: 'Dismissed', description: `${data.artistName} dismissed` });
      
      setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 500);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to dismiss artist', variant: 'destructive' });
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [toast]);

  return {
    items,
    stats,
    total,
    isLoading,
    loadingIds,
    hasMore,
    error,
    fetchFeed,
    loadMore,
    approve,
    dismiss,
  };
}
```

### Step 2: Replace Dashboard page

```tsx
// apps/web/src/app/dashboard/page.tsx
'use client';

import { useEffect } from 'react';
import { StatsBar } from '@/components/feed/StatsBar';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { useFeed } from '@/hooks/useFeed';

export default function DashboardPage() {
  const {
    items,
    stats,
    isLoading,
    loadingIds,
    hasMore,
    error,
    fetchFeed,
    loadMore,
    approve,
    dismiss,
  } = useFeed();

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => {
      fetchFeed();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchFeed]);

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-400">
          <p>Failed to load feed. Please try again.</p>
          <button
            onClick={fetchFeed}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <StatsBar pending={stats.pending} addedToday={stats.addedToday} />
      <FeedGrid
        items={items}
        onApprove={approve}
        onDismiss={dismiss}
        onLoadMore={loadMore}
        hasMore={hasMore}
        isLoading={isLoading}
        loadingIds={loadingIds}
      />
    </div>
  );
}
```

### Step 3: Commit

```bash
git add apps/web/src/hooks/useFeed.ts apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): replace Dashboard with Discovery Feed

- useFeed hook handles data fetching and actions
- Optimistic updates for approve/dismiss
- Auto-refresh on window focus
- Error state with retry button
- Cards fade and remove after action"
```

---

## Task 10: Integration - Lidarr Add Artist on Approve

**Quality Requirements:**
- Edge Cases: Lidarr unavailable, artist already exists, no Lidarr connection
- Attack Vectors: none (internal service call)
- AI Slop Watch: proper error handling, clear messages

**Files:**
- Modify: `apps/api/src/services/FeedService.ts`
- Modify: `apps/api/tests/services/feed-actions.test.ts`

### Step 1: Add Lidarr integration tests

```typescript
// Add to apps/api/tests/services/feed-actions.test.ts

describe('approve with Lidarr', () => {
  it('calls Lidarr to add artist after updating status', async () => {
    const addArtist = vi.fn().mockResolvedValue({ id: 123 });
    const mockLidarr = { addArtist };
    const mockPrisma = {
      subscriptionResult: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, artistName: 'Test', artistMbid: 'abc-123', subscription: { userId: 1 } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      connection: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, type: 'lidarr', config: {} }),
      },
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    };
    
    const service = new FeedService(mockPrisma as any, mockLidarr as any);
    await service.approve('feed-1', 1);
    
    expect(addArtist).toHaveBeenCalledWith('abc-123');
  });

  it('still succeeds if Lidarr call fails (logs warning)', async () => {
    const addArtist = vi.fn().mockRejectedValue(new Error('Lidarr unavailable'));
    const mockLidarr = { addArtist };
    const mockPrisma = {
      subscriptionResult: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, artistName: 'Test', artistMbid: 'abc-123', subscription: { userId: 1 } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      connection: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, type: 'lidarr', config: {} }),
      },
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    };
    
    const service = new FeedService(mockPrisma as any, mockLidarr as any);
    
    // Should not throw - Lidarr failure is non-blocking
    await expect(service.approve('feed-1', 1)).resolves.toEqual({ artistName: 'Test' });
  });

  it('skips Lidarr if no MBID available', async () => {
    const addArtist = vi.fn();
    const mockPrisma = {
      subscriptionResult: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, artistName: 'Test', artistMbid: null, subscription: { userId: 1 } },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    };
    
    const service = new FeedService(mockPrisma as any, { addArtist } as any);
    await service.approve('feed-1', 1);
    
    expect(addArtist).not.toHaveBeenCalled();
  });
});
```

### Step 2: Implement Lidarr integration

```typescript
// Update apps/api/src/services/FeedService.ts approve method

async approve(feedId: string, userId: number): Promise<{ artistName: string }> {
  // ... existing validation code ...

  const artistName = results[0].artistName;
  const artistMbid = results[0].artistMbid;

  // Update database
  await this.prisma.$transaction(async (tx) => {
    await tx.subscriptionResult.updateMany({
      where: { id: { in: resultIds } },
      data: { status: 'added' },
    });

    await tx.reviewItem.deleteMany({
      where: {
        OR: [
          ...(artistMbid ? [{ artistMbid }] : []),
          { artistName },
        ],
      },
    });
  });

  // Add to Lidarr (non-blocking)
  if (artistMbid && this.lidarrService) {
    try {
      await this.lidarrService.addArtist(artistMbid);
    } catch (error) {
      console.warn(`Failed to add artist to Lidarr: ${artistMbid}`, error);
      // Don't throw - Lidarr failure shouldn't block the UI action
    }
  }

  return { artistName };
}
```

### Step 3: Run tests

Run: `cd apps/api && npx vitest run tests/services/feed-actions.test.ts`
Expected: All tests PASS

### Step 4: Commit

```bash
git add apps/api/src/services/FeedService.ts apps/api/tests/services/feed-actions.test.ts
git commit -m "feat(api): integrate Lidarr add artist on approve

- Calls LidarrService.addArtist after status update
- Non-blocking: Lidarr failure logs warning but doesn't fail request
- Skips Lidarr if no MBID available"
```

---

## Task 11: Final Integration Testing

**Quality Requirements:**
- E2E flow works end-to-end
- All unit tests pass
- Type checking passes

**Files:**
- None (verification only)

### Step 1: Run all backend tests

```bash
cd apps/api && npm test
```
Expected: All tests PASS

### Step 2: Run type checking

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
Expected: No errors

### Step 3: Manual E2E verification

1. Start dev stack: `./start-dev.sh`
2. Navigate to Dashboard
3. Verify feed loads with cards
4. Approve one artist → verify "Added" toast, card fades
5. Dismiss one artist → verify "Dismissed" toast, card fades
6. Scroll to bottom → verify more cards load
7. Check Subscriptions page → verify approved artist shows in results

### Step 4: Commit verification

```bash
git add -A
git commit -m "test: verify discovery feed integration

- All backend tests pass
- Type checking clean
- E2E flow verified manually"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | FeedService aggregation logic | 15 min |
| 2 | FeedService scoring logic | 10 min |
| 3 | FeedService database integration | 15 min |
| 4 | FeedService approve/dismiss actions | 15 min |
| 5 | Feed API routes | 15 min |
| 6 | FeedCard component | 15 min |
| 7 | FeedGrid with infinite scroll | 15 min |
| 8 | StatsBar component | 5 min |
| 9 | Dashboard page replacement | 15 min |
| 10 | Lidarr integration on approve | 10 min |
| 11 | Final integration testing | 10 min |

**Total: ~2.5 hours**

---

**Plan complete and saved to `docs/plans/2026-02-01-discovery-feed-plan.md`.** Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
