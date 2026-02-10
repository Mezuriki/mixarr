# useFeed React Query Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `useFeed` hook to use React Query patterns matching the rest of the codebase, fixing 9 bugs in the process.

**Architecture:** 
- Move feed hooks to centralized `lib/hooks.ts`
- Use `useQuery` for data fetching with automatic caching/refetch
- Use `useMutation` with `onMutate`/`onError`/`onSettled` for optimistic updates with proper rollback
- Add feed endpoints to centralized `api.ts` endpoints object

**Tech Stack:** TanStack React Query, existing `api` wrapper from `lib/api.ts`

**Bugs Fixed By This Refactor:**
- DF-002: No rollback on failed optimistic update → `useMutation.onError` handles rollback
- DF-003: Stats can go negative → React Query cache prevents desync
- DF-004: setTimeout memory leak → No more manual timeouts, RQ handles lifecycle
- DF-005: hasMore stale total → `useInfiniteQuery` handles pagination correctly
- DF-006: Infinite scroll race → React Query deduplicates concurrent fetches
- DF-007: No initial loading state → `isLoading` from useQuery is accurate
- DF-009: FeedItem type duplication → Single source of truth in hooks.ts
- DF-012: No loadMore retry → React Query provides automatic retry
- DF-013: Double fetch on mount → React Query deduplicates

**Requirements:**
- Edge Cases: empty feed, API errors, concurrent requests, unmount during animation
- Security: N/A (read-only from perspective of this hook)
- Data Integrity: Optimistic update must rollback on failure; cache must stay consistent
- Error Handling: Toast on error, rollback optimistic state, no stale UI

---

## Pre-Implementation Quality Analysis

### 🦆 Edge Cases Identified
1. **Empty feed** - Already handled by FeedGrid empty state
2. **API returns error** - Must show toast, NOT update UI optimistically
3. **Concurrent approve/dismiss** - useMutation handles queuing
4. **Unmount during card removal animation** - No manual timeout = no leak
5. **Rapid pagination** - useInfiniteQuery prevents duplicate fetches
6. **Window focus during pending action** - onSettled invalidates to resync

### 💀 Security/Integrity Risks
1. **Race between optimistic update and refetch** - Use `queryClient.cancelQueries` in onMutate
2. **Stale closure in optimistic update** - Functional setState with `old` param
3. **Cache drift if mutation succeeds but network drops before response** - onSettled always invalidates

### 🤖 AI Slop Watch
- No TODOs or placeholders in migration
- Use descriptive mutation names (`useApproveFeedItem`, not `useFeedMutation`)
- Comments explain WHY, not WHAT

---

## Task 1: Add Feed Query Keys and Types to hooks.ts

**Quality Requirements:**
- Edge Cases: Types must include all fields from API response
- AI Slop Watch: Export types properly, no duplication

**Files:**
- Modify: `apps/web/src/lib/hooks.ts` (add to queryKeys + add types)

**Step 1: Add feed query keys to queryKeys object**

```typescript
// In queryKeys object (around line 8), add:
  // Feed
  feed: ['feed'] as const,
  feedItems: (limit: number, offset: number) => ['feed', 'items', limit, offset] as const,
```

**Step 2: Add FeedItem and FeedStats types**

Add after existing interface definitions (around line 120):

```typescript
// Feed Types

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
}

export interface FeedStats {
  pending: number;
  addedToday: number;
}

export interface FeedResponse {
  items: FeedItem[];
  stats: FeedStats;
  total: number;
}
```

**Step 3: Verify types compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to Feed types

**Step 4: Commit**
```bash
git add apps/web/src/lib/hooks.ts
git commit -m "feat(feed): add query keys and types for feed refactor"
```

---

## Task 2: Add Feed Endpoints to api.ts

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add to endpoints object)

**Step 1: Add feed endpoints**

```typescript
// In endpoints object (around line 113), add:
  // Feed
  feed: {
    list: '/api/feed',
    approve: (id: string) => `/api/feed/${id}/approve`,
    dismiss: (id: string) => `/api/feed/${id}/dismiss`,
  },
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(feed): add feed endpoints to centralized api config"
```

---

## Task 3: Implement useFeed Query Hook

**Quality Requirements:**
- Edge Cases: Handle API errors, empty responses
- AI Slop Watch: Match exact pattern from useSubscriptions

**Files:**
- Modify: `apps/web/src/lib/hooks.ts` (add useFeed hook)

**Step 1: Add useFeed hook**

Add after Feed types (around line 140):

```typescript
// Feed Hooks

export function useFeed(limit = 50) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.feed, limit],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await api.get<FeedResponse>(
        `/api/feed?limit=${limit}&offset=${pageParam}`
      );
      if (error) throw new Error(error);
      return data!;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return totalFetched < lastPage.total ? totalFetched : undefined;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/lib/hooks.ts
git commit -m "feat(feed): add useFeed infinite query hook"
```

---

## Task 4: Implement useApproveFeedItem Mutation

**Quality Requirements:**
- Edge Cases: Rollback on error, handle concurrent mutations
- Security: onMutate cancels in-flight queries to prevent race
- AI Slop Watch: Clear mutation lifecycle (onMutate → onError → onSettled)

**Files:**
- Modify: `apps/web/src/lib/hooks.ts` (add mutation hook)

**Step 1: Add useApproveFeedItem mutation**

```typescript
export function useApproveFeedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.post<{ artistName: string }>(
        `/api/feed/${id}/approve`
      );
      if (error) throw new Error(error);
      return data!;
    },
    onMutate: async (id) => {
      // Cancel any outgoing refetches to prevent race condition
      await queryClient.cancelQueries({ queryKey: queryKeys.feed });

      // Snapshot current cache for rollback
      const previousData = queryClient.getQueryData(queryKeys.feed);

      // Optimistic update - mark item as 'added'
      queryClient.setQueryData(queryKeys.feed, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            items: page.items.map((item: FeedItem) =>
              item.id === id ? { ...item, status: 'added' as const } : item
            ),
            stats: {
              pending: Math.max(0, page.stats.pending - 1),
              addedToday: page.stats.addedToday + 1,
            },
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback to snapshot on error
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.feed, context.previousData);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.feed });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/lib/hooks.ts
git commit -m "feat(feed): add useApproveFeedItem mutation with optimistic update"
```

---

## Task 5: Implement useDismissFeedItem Mutation

**Files:**
- Modify: `apps/web/src/lib/hooks.ts` (add mutation hook)

**Step 1: Add useDismissFeedItem mutation**

```typescript
export function useDismissFeedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.post<{ artistName: string }>(
        `/api/feed/${id}/dismiss`
      );
      if (error) throw new Error(error);
      return data!;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.feed });
      const previousData = queryClient.getQueryData(queryKeys.feed);

      queryClient.setQueryData(queryKeys.feed, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            items: page.items.map((item: FeedItem) =>
              item.id === id ? { ...item, status: 'dismissed' as const } : item
            ),
            stats: {
              ...page.stats,
              pending: Math.max(0, page.stats.pending - 1),
            },
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.feed, context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feed });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
  });
}
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/lib/hooks.ts
git commit -m "feat(feed): add useDismissFeedItem mutation with optimistic update"
```

---

## Task 6: Update FeedGrid to Import Types from hooks.ts

**Quality Requirements:**
- AI Slop Watch: Remove duplicate type definition

**Files:**
- Modify: `apps/web/src/components/feed/FeedGrid.tsx`

**Step 1: Replace local FeedItem with import**

Change:
```typescript
export interface FeedItem {
  id: string;
  artistName: string;
  imageUrl: string | null;
  status?: 'pending' | 'added' | 'dismissed';
}
```

To:
```typescript
import type { FeedItem } from '@/lib/hooks';
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/FeedGrid.tsx
git commit -m "refactor(feed): use FeedItem type from hooks.ts"
```

---

## Task 7: Update page.tsx to Use New Hooks

**Quality Requirements:**
- Edge Cases: Handle loading states, hasNextPage logic
- AI Slop Watch: Remove manual window focus listener (React Query handles it)

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Step 1: Replace useFeed import and usage**

Full file replacement:

```tsx
'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StatsBar } from '@/components/feed/StatsBar';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { LoadingSpinner } from '@/components/ui/loading';
import { useToast } from '@/components/ui/toast';
import { useFeed, useApproveFeedItem, useDismissFeedItem, FeedItem } from '@/lib/hooks';

export default function Home() {
  const { addToast } = useToast();
  
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useFeed();

  const approveMutation = useApproveFeedItem();
  const dismissMutation = useDismissFeedItem();

  // Flatten pages into single items array
  const items = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  // Get stats from first page (they're the same across pages)
  const stats = data?.pages[0]?.stats ?? { pending: 0, addedToday: 0 };

  // Track which items have pending mutations
  const loadingIds = useMemo(() => {
    const ids = new Set<string>();
    if (approveMutation.isPending && approveMutation.variables) {
      ids.add(approveMutation.variables);
    }
    if (dismissMutation.isPending && dismissMutation.variables) {
      ids.add(dismissMutation.variables);
    }
    return ids;
  }, [approveMutation.isPending, approveMutation.variables, dismissMutation.isPending, dismissMutation.variables]);

  const handleApprove = async (id: string) => {
    try {
      const result = await approveMutation.mutateAsync(id);
      addToast({ type: 'success', title: 'Added', message: `${result.artistName} added to Lidarr` });
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to add artist' });
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      const result = await dismissMutation.mutateAsync(id);
      addToast({ type: 'info', title: 'Dismissed', message: `${result.artistName} dismissed` });
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to dismiss artist' });
    }
  };

  const handleLoadMore = () => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPage();
    }
  };

  // Initial loading state
  if (isLoading && items.length === 0) {
    return (
      <>
        <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
        <div className="flex justify-center py-20">
          <LoadingSpinner />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
        <div className="text-center py-16">
          <p className="text-red-400 mb-4">Failed to load feed. Please try again.</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Discovery Feed" description="Review and approve artist recommendations" />
      <StatsBar pending={stats.pending} addedToday={stats.addedToday} />
      <FeedGrid
        items={items}
        onApprove={handleApprove}
        onDismiss={handleDismiss}
        onLoadMore={handleLoadMore}
        hasMore={hasNextPage ?? false}
        isLoading={isFetchingNextPage}
        loadingIds={loadingIds}
      />
    </>
  );
}
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add apps/web/src/app/page.tsx
git commit -m "refactor(feed): use React Query hooks for feed page"
```

---

## Task 8: Add Card Removal Animation (Fix DF-011)

**Quality Requirements:**
- Edge Cases: Don't block mutations, purely visual
- AI Slop Watch: Use CSS transitions, not JS animation libraries

**Files:**
- Modify: `apps/web/src/components/feed/FeedCard.tsx`

**Step 1: Add exit animation with CSS**

Update the card wrapper to include transition classes:

```tsx
// Replace the outer div with:
<div
  className={cn(
    'relative group rounded-lg overflow-hidden bg-gray-800 transition-all duration-300',
    showOverlay && 'opacity-50 scale-95'  // Add scale-95 for exit effect
  )}
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
>
```

**Step 2: Verify visually**
Rebuild and test card interactions show scale animation

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/FeedCard.tsx
git commit -m "feat(feed): add scale animation for card exit states"
```

---

## Task 9: Add Touch Support (Fix DF-010)

**Files:**
- Modify: `apps/web/src/components/feed/FeedCard.tsx`

**Step 1: Add touch state**

```tsx
const [isTouched, setIsTouched] = useState(false);

// Add to the outer div:
onTouchStart={() => setIsTouched(true)}
onTouchEnd={() => setTimeout(() => setIsTouched(false), 3000)}

// Update button visibility condition:
isHovered || isTouched || isLoading ? 'opacity-100' : 'opacity-0'
```

**Step 2: Verify on mobile viewport**
Test in Chrome DevTools mobile view

**Step 3: Commit**
```bash
git add apps/web/src/components/feed/FeedCard.tsx
git commit -m "feat(feed): add touch support for mobile card interactions"
```

---

## Task 10: Fix Backend addedToday Field (Fix DF-008)

**Files:**
- Modify: `apps/api/src/services/FeedService.ts` (line ~340)

**Step 1: Change createdAt to updatedAt**

Find and replace:
```typescript
createdAt: { gte: today },  // WRONG
```

With:
```typescript
updatedAt: { gte: today },  // Counts items approved today
```

**Step 2: Run backend tests**
Run: `cd apps/api && npm test 2>&1 | tail -10`
Expected: All tests pass

**Step 3: Commit**
```bash
git add apps/api/src/services/FeedService.ts
git commit -m "fix(feed): count addedToday by updatedAt not createdAt"
```

---

## Task 11: Delete Old useFeed Hook and Test

**Files:**
- Delete: `apps/web/src/hooks/useFeed.ts`
- Delete: `apps/web/src/hooks/useFeed.test.ts`
- Delete: `apps/web/src/hooks/` directory if empty

**Step 1: Remove old files**

```bash
rm apps/web/src/hooks/useFeed.ts
rm apps/web/src/hooks/useFeed.test.ts
rmdir apps/web/src/hooks 2>/dev/null || true
```

**Step 2: Verify compile**
Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**
```bash
git add -A
git commit -m "refactor(feed): remove old useFeed hook (replaced by hooks.ts)"
```

---

## Task 12: Add Tests for New Feed Hooks

**Quality Requirements:**
- Edge Cases: Test optimistic update, rollback on error, pagination
- AI Slop Watch: Use QueryClientProvider wrapper

**Files:**
- Create: `apps/web/src/lib/__tests__/feed-hooks.test.tsx`

**Step 1: Create test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFeed, useApproveFeedItem, useDismissFeedItem } from '../hooks';

// Mock api module
vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches feed items', async () => {
    const mockResponse = {
      data: {
        items: [{ id: 'feed-1', artistName: 'Test Artist' }],
        stats: { pending: 5, addedToday: 2 },
        total: 1,
      },
      error: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].items).toHaveLength(1);
    expect(result.current.data?.pages[0].stats.pending).toBe(5);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: null, error: 'Network error' });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});

describe('useApproveFeedItem', () => {
  it('calls approve endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist' },
      error: null,
    });

    const { result } = renderHook(() => useApproveFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-123');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-123/approve');
  });
});

describe('useDismissFeedItem', () => {
  it('calls dismiss endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist' },
      error: null,
    });

    const { result } = renderHook(() => useDismissFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-456');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-456/dismiss');
  });
});
```

**Step 2: Run tests**
Run: `cd apps/web && npm test 2>&1 | tail -20`
Expected: All tests pass

**Step 3: Commit**
```bash
git add apps/web/src/lib/__tests__/feed-hooks.test.tsx
git commit -m "test(feed): add tests for React Query feed hooks"
```

---

## Task 13: Update Bug Tracker

**Files:**
- Modify: `docs/issues/discovery-feed-bugs.md`

**Step 1: Mark bugs as fixed**

Update the following bugs to "✅ Fixed":
- DF-002, DF-003, DF-004, DF-005, DF-006, DF-007, DF-008, DF-009, DF-010, DF-011, DF-012, DF-013

Add note: "Fixed by React Query refactor (commit: [hash])"

**Step 2: Commit**
```bash
git add docs/issues/discovery-feed-bugs.md
git commit -m "docs: mark feed bugs fixed by React Query refactor"
```

---

## Task 14: Manual Verification

**Step 1: Rebuild containers**
```bash
./scripts/start-dev.sh
```

**Step 2: Test scenarios**

1. **Initial load** - Should show loading spinner, then cards
2. **Approve** - Card shows "Added", toast appears, stats update, card fades
3. **Dismiss** - Card shows "Dismissed", toast appears, stats update, card fades
4. **Error handling** - Disconnect network, try approve, should rollback
5. **Infinite scroll** - Scroll down, more cards load
6. **Window focus** - Switch tabs, come back, should refetch silently
7. **Touch device** - Use Chrome mobile emulation, tap card to show buttons

**Step 3: Final commit**
```bash
git add -A
git commit -m "feat(feed): complete React Query refactor

- Fixes DF-002 through DF-013
- Uses established project patterns
- Proper optimistic updates with rollback
- Infinite query for pagination
- Touch support for mobile"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Add query keys and types | 3 min |
| 2 | Add feed endpoints | 2 min |
| 3 | Implement useFeed hook | 5 min |
| 4 | Implement useApproveFeedItem | 5 min |
| 5 | Implement useDismissFeedItem | 3 min |
| 6 | Update FeedGrid types | 2 min |
| 7 | Update page.tsx | 5 min |
| 8 | Add card exit animation | 3 min |
| 9 | Add touch support | 3 min |
| 10 | Fix backend addedToday | 2 min |
| 11 | Delete old useFeed | 2 min |
| 12 | Add tests | 10 min |
| 13 | Update bug tracker | 3 min |
| 14 | Manual verification | 10 min |
| **Total** | | **~55 min** |
