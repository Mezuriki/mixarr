# Feed Card Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance Discovery Feed cards with metadata (tags, listeners, subscription source) and improved toast messaging.

**Architecture:** Backend adds new fields to feed aggregation (tags, listeners, subscriptionName). Frontend updates FeedCard to display metadata and improves toast flow.

**Tech Stack:** TypeScript, Prisma, React, TanStack Query, Vitest

**Design Doc:** [docs/plans/2026-02-02-feed-card-enhancements-design.md](2026-02-02-feed-card-enhancements-design.md)

---

## Pre-Implementation Quality Analysis

### 🦆 Edge Cases
- Tags field is comma-separated string in DB, could be null/empty/malformed
- Listeners could be null, 0, or very large numbers (billions)
- Subscription could be deleted between result creation and feed fetch
- Artist found in 10+ subscriptions - display should truncate gracefully

### 💀 Security Considerations
- No user input involved in these changes (read-only metadata)
- Subscription names could contain special characters - ensure proper escaping in JSX

### 🤖 AI Slop Watch
- Don't add generic "metadata" props - be specific (tags, listeners, subscriptionName)
- Helper functions need descriptive names (formatListenerCount, not formatNumber)
- Tests must cover edge cases, not just happy path

---

## Task 1: Add Metadata Fields to AggregatedFeedItem Interface

**Quality Requirements:**
- Edge Cases: null tags, null listeners, missing subscription
- AI Slop Watch: Specific field names, not generic "metadata" object

**Files:**
- Modify: `apps/api/src/services/FeedService.ts:40-52` (AggregatedFeedItem interface)

**Step 1: Update the interface**

Add to `AggregatedFeedItem` interface after `score: number;`:

```typescript
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
  // New metadata fields
  tags: string[] | null;
  listeners: number | null;
  subscriptionName: string | null;
}
```

**Step 2: Verify no TypeScript errors**
```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```
Expected: Errors about missing properties in aggregateResults (we'll fix those next)

**Step 3: Commit**
```bash
git add apps/api/src/services/FeedService.ts
git commit -m "feat(feed): add metadata fields to AggregatedFeedItem interface

- tags: string[] | null - genre tags from subscription results
- listeners: number | null - popularity metric
- subscriptionName: string | null - source subscription (if single)"
```

---

## Task 2: Update SubscriptionResultInput to Include Metadata

**Files:**
- Modify: `apps/api/src/services/FeedService.ts:54-65` (SubscriptionResultInput interface)

**Step 1: Add tags and listeners to input interface**

```typescript
export interface SubscriptionResultInput {
  id: number;
  artistName: string;
  artistMbid: string | null;
  subscriptionId: number;
  imageUrl?: string | null;
  sources: string[] | string | null | unknown;
  createdAt: Date;
  status: string;
  // New fields from SubscriptionResult
  tags?: string | null;
  listeners?: number | null;
}
```

**Step 2: Commit**
```bash
git add apps/api/src/services/FeedService.ts
git commit -m "feat(feed): add tags and listeners to SubscriptionResultInput"
```

---

## Task 3: Write Failing Tests for Metadata Aggregation

**Quality Requirements:**
- Edge Cases: null tags, empty tags, comma-separated parsing, null listeners
- Test Priority: Failure cases first, then happy path

**Files:**
- Modify: `apps/api/tests/services/feed.test.ts`

**Step 1: Write failing tests**

Add these tests to the `aggregateResults` describe block:

```typescript
describe('metadata aggregation', () => {
  it('parses comma-separated tags and takes first 3', () => {
    const results: SubscriptionResultInput[] = [
      {
        id: 1,
        artistName: 'Test Artist',
        artistMbid: 'mbid-1',
        subscriptionId: 1,
        sources: ['spotify'],
        createdAt: new Date(),
        status: 'pending',
        tags: 'Rock, Jazz, Blues, Folk, Country',
        listeners: 50000,
      },
    ];

    const aggregated = service.aggregateResults(results);
    expect(aggregated[0].tags).toEqual(['Rock', 'Jazz', 'Blues']);
    expect(aggregated[0].listeners).toBe(50000);
  });

  it('handles null tags gracefully', () => {
    const results: SubscriptionResultInput[] = [
      {
        id: 1,
        artistName: 'Test Artist',
        artistMbid: 'mbid-1',
        subscriptionId: 1,
        sources: ['spotify'],
        createdAt: new Date(),
        status: 'pending',
        tags: null,
        listeners: null,
      },
    ];

    const aggregated = service.aggregateResults(results);
    expect(aggregated[0].tags).toBeNull();
    expect(aggregated[0].listeners).toBeNull();
  });

  it('handles empty tags string', () => {
    const results: SubscriptionResultInput[] = [
      {
        id: 1,
        artistName: 'Test Artist',
        artistMbid: 'mbid-1',
        subscriptionId: 1,
        sources: ['spotify'],
        createdAt: new Date(),
        status: 'pending',
        tags: '',
        listeners: 0,
      },
    ];

    const aggregated = service.aggregateResults(results);
    expect(aggregated[0].tags).toBeNull();
    expect(aggregated[0].listeners).toBe(0);
  });

  it('merges tags from multiple results taking highest listener count', () => {
    const results: SubscriptionResultInput[] = [
      {
        id: 1,
        artistName: 'Test Artist',
        artistMbid: 'mbid-1',
        subscriptionId: 1,
        sources: ['spotify'],
        createdAt: new Date(),
        status: 'pending',
        tags: 'Rock, Pop',
        listeners: 1000,
      },
      {
        id: 2,
        artistName: 'Test Artist',
        artistMbid: 'mbid-1',
        subscriptionId: 2,
        sources: ['lastfm'],
        createdAt: new Date(),
        status: 'pending',
        tags: 'Jazz, Blues',
        listeners: 50000,
      },
    ];

    const aggregated = service.aggregateResults(results);
    // Should take tags from result with more data, and max listeners
    expect(aggregated[0].listeners).toBe(50000);
    // Tags should come from result with MBID or first with tags
    expect(aggregated[0].tags).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/services/feed.test.ts -t "metadata aggregation" 2>&1
```
Expected: FAIL (tags/listeners not returned from aggregateResults)

**Step 3: Commit failing tests**
```bash
git add apps/api/tests/services/feed.test.ts
git commit -m "test(feed): add failing tests for metadata aggregation

- Tests tag parsing from comma-separated strings
- Tests null/empty tag handling
- Tests listener count aggregation
- Tests merging metadata from multiple results"
```

---

## Task 4: Implement Metadata Aggregation in FeedService

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (aggregateResults method ~lines 218-250)

**Step 1: Add helper method to parse tags**

Add after `parseSources` method (~line 130):

```typescript
/**
 * Parse tags from comma-separated string, returning first N tags.
 */
private parseTags(tags: string | null | undefined, limit = 3): string[] | null {
  if (!tags || typeof tags !== 'string' || tags.trim() === '') {
    return null;
  }
  const parsed = tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, limit);
  return parsed.length > 0 ? parsed : null;
}
```

**Step 2: Update aggregateResults to include metadata**

In the aggregation loop (inside `for (const [, groupResults] of groups)`), after getting `primary`, add:

```typescript
// Get best metadata: prefer result with highest listeners, fall back to first with tags
let bestTags: string | null = null;
let bestListeners: number | null = null;

for (const r of groupResults) {
  const resultTags = (r as SubscriptionResultInput & { tags?: string | null }).tags;
  const resultListeners = (r as SubscriptionResultInput & { listeners?: number | null }).listeners;
  
  if (resultListeners != null && (bestListeners == null || resultListeners > bestListeners)) {
    bestListeners = resultListeners;
  }
  if (resultTags && !bestTags) {
    bestTags = resultTags;
  }
}

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
  score: 0,
  // New metadata fields
  tags: this.parseTags(bestTags),
  listeners: bestListeners,
  subscriptionName: null, // Will be populated in getFeedForUser
});
```

**Step 3: Run tests**
```bash
cd apps/api && npx vitest run tests/services/feed.test.ts -t "metadata aggregation" 2>&1
```
Expected: PASS

**Step 4: Commit**
```bash
git add apps/api/src/services/FeedService.ts
git commit -m "feat(feed): implement metadata aggregation for tags and listeners

- Add parseTags helper to parse comma-separated tag strings
- Aggregate takes highest listener count across results
- Takes first available tags from results with MBID preference"
```

---

## Task 5: Write Failing Tests for Subscription Name Resolution

**Files:**
- Modify: `apps/api/tests/services/feed.test.ts`

**Step 1: Write failing tests for subscription name**

Add to the test file:

```typescript
describe('subscription name resolution', () => {
  it('includes subscription name when found in single subscription', async () => {
    // Create a subscription first
    const subscription = await prisma.subscription.create({
      data: {
        userId: testUserId,
        connectionId: testConnectionId,
        name: 'Similar Artists',
        type: 'similar_artists',
        config: {},
        isActive: true,
      },
    });

    // Create result linked to that subscription
    await prisma.subscriptionResult.create({
      data: {
        subscriptionId: subscription.id,
        itemType: 'artist',
        name: 'Test Artist',
        mbid: 'test-mbid',
        status: 'pending',
        sources: JSON.stringify(['spotify']),
      },
    });

    const feed = await service.getFeedForUser(testUserId, { limit: 50, offset: 0 });
    
    expect(feed.items[0].subscriptionName).toBe('Similar Artists');
    expect(feed.items[0].subscriptionCount).toBe(1);
  });

  it('returns null subscription name when found in multiple subscriptions', async () => {
    const sub1 = await prisma.subscription.create({
      data: {
        userId: testUserId,
        connectionId: testConnectionId,
        name: 'Similar Artists',
        type: 'similar_artists',
        config: {},
        isActive: true,
      },
    });

    const sub2 = await prisma.subscription.create({
      data: {
        userId: testUserId,
        connectionId: testConnectionId,
        name: 'New Releases',
        type: 'new_releases',
        config: {},
        isActive: true,
      },
    });

    // Same artist from two subscriptions
    await prisma.subscriptionResult.create({
      data: {
        subscriptionId: sub1.id,
        itemType: 'artist',
        name: 'Test Artist',
        mbid: 'test-mbid',
        status: 'pending',
        sources: JSON.stringify(['spotify']),
      },
    });

    await prisma.subscriptionResult.create({
      data: {
        subscriptionId: sub2.id,
        itemType: 'artist',
        name: 'Test Artist',
        mbid: 'test-mbid',
        status: 'pending',
        sources: JSON.stringify(['lastfm']),
      },
    });

    const feed = await service.getFeedForUser(testUserId, { limit: 50, offset: 0 });
    
    expect(feed.items[0].subscriptionName).toBeNull();
    expect(feed.items[0].subscriptionCount).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/services/feed.test.ts -t "subscription name" 2>&1
```
Expected: FAIL (subscriptionName always null)

**Step 3: Commit**
```bash
git add apps/api/tests/services/feed.test.ts
git commit -m "test(feed): add failing tests for subscription name resolution

- Test single subscription shows name
- Test multiple subscriptions returns null name with count"
```

---

## Task 6: Implement Subscription Name Resolution in getFeedForUser

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (getFeedForUser method)

**Step 1: Find getFeedForUser and update the query**

The method fetches results and needs to also fetch subscription names. After aggregation, resolve subscription names for items with `subscriptionCount === 1`.

Add after the aggregation step in `getFeedForUser`:

```typescript
// Resolve subscription names for items from single subscription
const subscriptionIds = new Set<number>();
for (const item of aggregated) {
  if (item.subscriptionCount === 1) {
    // Get the subscription ID from linked results
    const firstResultId = item.linkedResultIds[0];
    const result = results.find((r) => r.id === firstResultId);
    if (result) {
      subscriptionIds.add(result.subscriptionId);
    }
  }
}

// Batch fetch subscription names
const subscriptions = await this.db.subscription.findMany({
  where: { id: { in: Array.from(subscriptionIds) } },
  select: { id: true, name: true },
});
const subscriptionNameMap = new Map(subscriptions.map((s) => [s.id, s.name]));

// Populate subscription names
for (const item of aggregated) {
  if (item.subscriptionCount === 1) {
    const firstResultId = item.linkedResultIds[0];
    const result = results.find((r) => r.id === firstResultId);
    if (result) {
      item.subscriptionName = subscriptionNameMap.get(result.subscriptionId) || null;
    }
  }
}
```

**Step 2: Run tests**
```bash
cd apps/api && npx vitest run tests/services/feed.test.ts -t "subscription name" 2>&1
```
Expected: PASS

**Step 3: Commit**
```bash
git add apps/api/src/services/FeedService.ts
git commit -m "feat(feed): resolve subscription names for single-source items

- Batch fetch subscription names for efficiency
- Only resolves for items with subscriptionCount === 1
- Items from multiple subscriptions keep subscriptionName as null"
```

---

## Task 7: Update Frontend FeedItem Interface

**Files:**
- Modify: `apps/web/src/lib/hooks.ts:59-72` (FeedItem interface)

**Step 1: Add new fields to FeedItem**

```typescript
export interface FeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  score: number;
  subscriptionCount: number;
  sourceCount: number;
  sources: string[];
  createdAt: string;
  status?: 'pending' | 'added' | 'dismissed';
  // New metadata fields
  tags: string[] | null;
  listeners: number | null;
  subscriptionName: string | null;
}
```

**Step 2: Verify TypeScript compiles**
```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: No errors (fields are optional in response handling)

**Step 3: Commit**
```bash
git add apps/web/src/lib/hooks.ts
git commit -m "feat(web): add metadata fields to FeedItem interface

- tags: string[] | null
- listeners: number | null  
- subscriptionName: string | null"
```

---

## Task 8: Write Failing Tests for FeedCard Metadata Display

**Files:**
- Modify: `apps/web/src/components/feed/FeedCard.test.tsx`

**Step 1: Write failing tests**

```typescript
describe('metadata display', () => {
  it('displays genre tags', () => {
    render(
      <FeedCard
        {...defaultProps}
        tags={['Jazz', 'Blues']}
      />
    );
    expect(screen.getByText(/Jazz/)).toBeInTheDocument();
  });

  it('displays formatted listener count', () => {
    render(
      <FeedCard
        {...defaultProps}
        listeners={2500000}
      />
    );
    expect(screen.getByText(/2\.5M/)).toBeInTheDocument();
  });

  it('displays subscription name for single source', () => {
    render(
      <FeedCard
        {...defaultProps}
        subscriptionName="Similar Artists"
        subscriptionCount={1}
      />
    );
    expect(screen.getByText(/Similar Artists/)).toBeInTheDocument();
  });

  it('displays subscription count for multiple sources', () => {
    render(
      <FeedCard
        {...defaultProps}
        subscriptionName={null}
        subscriptionCount={3}
      />
    );
    expect(screen.getByText(/Found in 3 subs/)).toBeInTheDocument();
  });

  it('handles missing metadata gracefully', () => {
    render(
      <FeedCard
        {...defaultProps}
        tags={null}
        listeners={null}
        subscriptionName={null}
        subscriptionCount={1}
      />
    );
    // Should not crash, just not show metadata line
    expect(screen.getByText(defaultProps.artistName)).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/web && npm test -- --run FeedCard.test.tsx 2>&1 | tail -20
```
Expected: FAIL (props don't exist yet)

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/FeedCard.test.tsx
git commit -m "test(web): add failing tests for FeedCard metadata display

- Test genre tag display
- Test listener count formatting
- Test subscription name display
- Test multi-subscription count display
- Test graceful handling of missing metadata"
```

---

## Task 9: Implement FeedCard Metadata Display

**Files:**
- Modify: `apps/web/src/components/feed/FeedCard.tsx`

**Step 1: Update FeedCardProps interface**

```typescript
export interface FeedCardProps {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
  isLoading?: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  // New metadata props
  tags?: string[] | null;
  listeners?: number | null;
  subscriptionName?: string | null;
  subscriptionCount?: number;
}
```

**Step 2: Add formatListenerCount helper**

```typescript
function formatListenerCount(count: number): string {
  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1)}B`;
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}
```

**Step 3: Add metadata line component**

Inside FeedCard, after the artist name paragraph, add:

```typescript
{/* Metadata line */}
{(() => {
  const parts: string[] = [];
  
  // Tags (first 2)
  if (tags && tags.length > 0) {
    parts.push(tags.slice(0, 2).join(', '));
  }
  
  // Listeners
  if (listeners != null && listeners > 0) {
    parts.push(formatListenerCount(listeners));
  }
  
  // Subscription source
  if (subscriptionName) {
    parts.push(subscriptionName);
  } else if (subscriptionCount && subscriptionCount > 1) {
    parts.push(`Found in ${subscriptionCount} subs`);
  }
  
  if (parts.length === 0) return null;
  
  return (
    <p className="text-xs text-muted-foreground truncate" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </p>
  );
})()}
```

**Step 4: Run tests**
```bash
cd apps/web && npm test -- --run FeedCard.test.tsx 2>&1
```
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/src/components/feed/FeedCard.tsx
git commit -m "feat(web): implement FeedCard metadata display

- Add tags, listeners, subscriptionName, subscriptionCount props
- Add formatListenerCount helper (K, M, B abbreviations)
- Display condensed metadata line: 'Jazz · 2.5M · Similar Artists'
- Gracefully handle missing metadata"
```

---

## Task 10: Update FeedGrid to Pass Metadata Props

**Files:**
- Modify: `apps/web/src/components/feed/FeedGrid.tsx`

**Step 1: Update FeedGrid to pass new props**

Find where FeedCard is rendered and add the new props:

```typescript
<FeedCard
  key={item.id}
  id={item.id}
  artistName={item.artistName}
  imageUrl={item.imageUrl}
  status={item.status}
  isLoading={loadingIds.has(item.id)}
  onApprove={onApprove}
  onDismiss={onDismiss}
  // New metadata props
  tags={item.tags}
  listeners={item.listeners}
  subscriptionName={item.subscriptionName}
  subscriptionCount={item.subscriptionCount}
/>
```

**Step 2: Verify no TypeScript errors**
```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/FeedGrid.tsx
git commit -m "feat(web): pass metadata props from FeedGrid to FeedCard"
```

---

## Task 11: Improve Toast Messaging on Approve

**Files:**
- Modify: `apps/web/src/app/page.tsx:48-54` (handleApprove function)

**Step 1: Update handleApprove for better messaging**

```typescript
const handleApprove = async (id: string) => {
  // Find the item to get artist name for toast
  const item = items.find((i) => i.id === id);
  const artistName = item?.artistName || 'Artist';
  
  // Show loading toast
  addToast({ 
    type: 'info', 
    title: 'Adding to Lidarr', 
    message: `Adding ${artistName}...` 
  });
  
  try {
    const result = await approveMutation.mutateAsync(id);
    addToast({ 
      type: 'success', 
      title: 'Added to Lidarr', 
      message: `${result.artistName} added successfully` 
    });
  } catch {
    addToast({ 
      type: 'error', 
      title: 'Failed to Add', 
      message: `Could not add ${artistName}` 
    });
  }
};
```

**Step 2: Update handleDismiss similarly**

```typescript
const handleDismiss = async (id: string) => {
  const item = items.find((i) => i.id === id);
  const artistName = item?.artistName || 'Artist';
  
  try {
    const result = await dismissMutation.mutateAsync(id);
    addToast({ 
      type: 'info', 
      title: 'Dismissed', 
      message: `${result.artistName} removed from feed` 
    });
  } catch {
    addToast({ 
      type: 'error', 
      title: 'Failed to Dismiss', 
      message: `Could not dismiss ${artistName}` 
    });
  }
};
```

**Step 3: Commit**
```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): improve toast messaging for approve/dismiss

- Show 'Adding to Lidarr...' while processing
- Show success with artist name
- Show specific error message on failure"
```

---

## Task 12: Integration Test - Full Stack Verification

**Step 1: Rebuild and test the full stack**
```bash
cd /home/chris/Github/mixarr && sudo docker compose -f docker-compose.dev.yml up -d --build api web
```

**Step 2: Run all API tests**
```bash
cd apps/api && npx vitest run 2>&1 | tail -20
```
Expected: All tests pass

**Step 3: Run all web tests**
```bash
cd apps/web && npm test -- --run 2>&1 | tail -20
```
Expected: All tests pass

**Step 4: Manual verification**
1. Open http://localhost:3000 (dashboard)
2. Verify cards show metadata line (genre · listeners · subscription)
3. Click approve on an artist
4. Verify toast shows "Adding to Lidarr..."
5. Verify toast updates to "Added to Lidarr" on success

**Step 5: Final commit**
```bash
git add -A
git commit -m "feat: complete feed card enhancements

- Backend: Add tags, listeners, subscriptionName to feed API
- Frontend: Display metadata on cards
- Frontend: Improved toast messaging for approve/dismiss
- Tests: Full coverage for new functionality"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Add metadata fields to AggregatedFeedItem | 2 min |
| 2 | Update SubscriptionResultInput interface | 2 min |
| 3 | Write failing tests for metadata aggregation | 5 min |
| 4 | Implement metadata aggregation | 5 min |
| 5 | Write failing tests for subscription name | 5 min |
| 6 | Implement subscription name resolution | 5 min |
| 7 | Update frontend FeedItem interface | 2 min |
| 8 | Write failing tests for FeedCard metadata | 5 min |
| 9 | Implement FeedCard metadata display | 5 min |
| 10 | Update FeedGrid to pass props | 2 min |
| 11 | Improve toast messaging | 3 min |
| 12 | Integration test | 5 min |

**Total estimated time:** ~45 minutes
