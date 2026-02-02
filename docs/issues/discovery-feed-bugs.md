# Discovery Feed - Known Issues

> **Feature Branch**: `feature/discovery-feed`  
> **Created**: 2026-02-01  
> **Status**: Pre-merge bug tracking

---

## 🔴 Critical Bugs

### BUG-DF-001: Artist Cards Don't Show Images

**Status**: ✅ Fixed  
**Priority**: Critical  
**Location**: FeedService.ts, next.config.js

**Root Cause**:  
1. `image_url` column was NULL for all subscription results (never populated)
2. Deezer CDN hostname in next.config.js didn't match actual API response (`cdn-images.dzcdn.net` vs `e-cdns-images.dzcdn.net`)

**Fix Applied**:
1. Added `enrichWithImages()` method to FeedService that fetches images from Deezer API for items missing imageUrl
2. Updated next.config.js to whitelist all Deezer CDN subdomains (`**.dzcdn.net`)

**Files Changed**:
- `apps/api/src/services/FeedService.ts` - Added image enrichment
- `apps/web/next.config.js` - Fixed Deezer CDN pattern

---

### BUG-DF-002: No Rollback on Failed Optimistic Update

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Critical  
**Location**: [apps/web/src/lib/hooks.ts](../apps/web/src/lib/hooks.ts) - useApproveFeedItem, useDismissFeedItem

**Description**:  
When approve/dismiss API calls fail, the optimistic UI update is NOT rolled back. The card shows "Added" or "Dismissed" overlay, stats are decremented, and after 500ms the card is removed - even though the server operation failed.

**Expected**: On API failure, card should revert to "pending" status and stats should be restored.

**Actual**: Card shows success state and is removed despite failure.

**Fix Required**:
```typescript
catch {
  // ROLLBACK optimistic update
  setItems((prev) =>
    prev.map((item) => (item.id === id ? { ...item, status: 'pending' as const } : item))
  );
  setStats((prev) => ({
    pending: prev.pending + 1,
    addedToday: prev.addedToday - 1,
  }));
  addToast({ type: 'error', ... });
  return;  // Don't proceed to setTimeout removal
}
```

---

### BUG-DF-003: Stats Can Go Negative

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Critical  
**Location**: [apps/web/src/lib/hooks.ts](../apps/web/src/lib/hooks.ts) - uses Math.max(0, pending-1)

**Description**:  
Race conditions between optimistic updates and `fetchFeed()` (triggered by window focus) can cause stats to desync. Additionally, no guard prevents `pending` from going negative.

**Fix Required**:
```typescript
setStats((prev) => ({
  pending: Math.max(0, prev.pending - 1),
  addedToday: prev.addedToday + 1,
}));
```

---

### BUG-DF-004: setTimeout Memory Leak on Unmount

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Critical  
**Location**: No longer uses setTimeout - React Query handles lifecycle

**Description**:  
The 500ms `setTimeout` for card removal is not cleaned up on component unmount. If user navigates away during animation, React will warn: "Can't perform a React state update on an unmounted component."

**Fix Required**:
```typescript
const mountedRef = useRef(true);

useEffect(() => {
  return () => { mountedRef.current = false; };
}, []);

// In approve/dismiss:
setTimeout(() => {
  if (mountedRef.current) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }
}, 500);
```

---

### BUG-DF-005: hasMore Uses Stale Total After loadMore

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Critical  
**Location**: useInfiniteQuery handles pagination correctly

**Description**:  
The `hasMore` calculation uses `total` which is only set on initial `fetchFeed()`, not updated during `loadMore()`. If items are added/removed on the server between fetches, the calculation is wrong.

**Fix Required**:
```typescript
// In loadMore callback:
const data = await res.json();
setItems((prev) => [...prev, ...data.items]);
setTotal(data.total);  // ADD THIS LINE
setOffset(newOffset);
```

---

### BUG-DF-006: Infinite Scroll Race Condition

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Critical  
**Location**: React Query deduplicates concurrent fetches

**Description**:  
IntersectionObserver can fire multiple times before `isLoading` is set to true in the parent hook. This causes multiple concurrent `loadMore` API calls.

**Fix Required**: Add local loading guard in FeedGrid:
```typescript
const [loadingLocal, setLoadingLocal] = useState(false);

// In observer callback:
if (entry.isIntersecting && !loadingLocal) {
  setLoadingLocal(true);
  onLoadMore();
}

useEffect(() => {
  if (!isLoading) setLoadingLocal(false);
}, [isLoading]);
```

---

## 🟠 High Priority Issues

### BUG-DF-007: No Loading State on Initial Page Load

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: High  
**Location**: [apps/web/src/app/page.tsx](../apps/web/src/app/page.tsx) - shows LoadingSpinner

**Description**:  
Page shows blank content briefly before cards load. No loading spinner or skeleton during initial fetch.

**Fix Required**: Add loading state check:
```tsx
if (isLoading && items.length === 0) {
  return (
    <>
      <PageHeader ... />
      <div className="flex justify-center py-20">
        <LoadingSpinner />
      </div>
    </>
  );
}
```

---

### BUG-DF-008: Backend addedToday Uses Wrong Timestamp Field

**Status**: ✅ Fixed  
**Priority**: High  
**Location**: [apps/api/src/services/FeedService.ts](../apps/api/src/services/FeedService.ts) - changed to updatedAt

**Description**:  
The `addedToday` stat counts items by `createdAt` (when discovered) instead of `updatedAt` (when status changed to 'added'). Items approved today but discovered earlier won't be counted.

**Current Code**:
```typescript
const addedToday = await this.prismaClient.subscriptionResult.count({
  where: {
    subscriptionId: { in: subscriptionIds },
    status: 'added',
    createdAt: { gte: today },  // WRONG
  },
});
```

**Fix Required**: Change `createdAt` to `updatedAt`.

---

### BUG-DF-009: FeedItem Type Duplication

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: High  
**Location**: Single source of truth in [apps/web/src/lib/hooks.ts](../apps/web/src/lib/hooks.ts)

**Description**:  
`FeedItem` interface is defined twice with different fields. The hook version has `score`, `subscriptionCount`, `sourceCount`; the component version only has basic fields. Risk of type drift.

**Fix Required**: Export from hook and import in component:
```typescript
// FeedGrid.tsx
import type { FeedItem } from '@/hooks/useFeed';
```

---

## 🟡 Medium Priority Issues

### BUG-DF-010: Touch Devices Can't Access Action Buttons

**Status**: ✅ Fixed  
**Priority**: Medium  
**Location**: [apps/web/src/components/feed/FeedCard.tsx](../apps/web/src/components/feed/FeedCard.tsx) - added touch handlers

**Description**:  
Approve/dismiss buttons only appear on hover, which doesn't work on touch devices. Mobile users can't interact with cards.

**Fix Required**: Add touch event handlers:
```typescript
const [isTouched, setIsTouched] = useState(false);

<div
  onTouchStart={() => setIsTouched(true)}
  onTouchEnd={() => setTimeout(() => setIsTouched(false), 3000)}
>
  {/* Show buttons when isHovered || isTouched */}
</div>
```

---

### BUG-DF-011: No Card Exit Animation

**Status**: ✅ Fixed  
**Priority**: Medium  
**Location**: [apps/web/src/components/feed/FeedCard.tsx](../apps/web/src/components/feed/FeedCard.tsx) - added scale animation

**Description**:  
Cards are removed after 500ms with no visual transition. They just disappear abruptly.

**Fix Required**: Add CSS transition class before removal.

---

### BUG-DF-012: No Retry Mechanism for loadMore Failures

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Medium  
**Location**: React Query provides automatic retry

**Description**:  
If `loadMore` fails, only a toast is shown. User has no way to retry loading more items without scrolling away and back.

---

### BUG-DF-013: Potential Double Fetch on Mount

**Status**: ✅ Fixed (React Query refactor)  
**Priority**: Medium  
**Location**: React Query deduplicates requests

**Description**:  
Two separate `useEffect` hooks can both trigger `fetchFeed()` on mount - one explicit, one from window focus event.

---

## 🟢 Low Priority / Polish

### BUG-DF-014: Magic Number 500ms Animation Delay

**Status**: Open  
**Priority**: Low  
**Location**: Multiple files

**Description**:  
The 500ms animation delay is hardcoded in multiple places. Should be extracted to a constant.

---

### BUG-DF-015: No Keyboard Navigation

**Status**: Open  
**Priority**: Low  
**Location**: [apps/web/src/components/feed/FeedCard.tsx](../apps/web/src/components/feed/FeedCard.tsx)

**Description**:  
Cards can only be interacted with via mouse/touch. No keyboard support (Tab, Enter, Delete).

---

## Summary

| ID | Bug | Priority | Status |
|----|-----|----------|--------|
| DF-001 | Images not showing on cards | 🔴 Critical | ✅ Fixed |
| DF-002 | No optimistic rollback | 🔴 Critical | ✅ Fixed (RQ) |
| DF-003 | Stats can go negative | 🔴 Critical | ✅ Fixed (RQ) |
| DF-004 | setTimeout memory leak | 🔴 Critical | ✅ Fixed (RQ) |
| DF-005 | hasMore stale total | 🔴 Critical | ✅ Fixed (RQ) |
| DF-006 | Infinite scroll race | 🔴 Critical | ✅ Fixed (RQ) |
| DF-007 | No initial loading state | 🟠 High | ✅ Fixed (RQ) |
| DF-008 | addedToday wrong field | 🟠 High | ✅ Fixed |
| DF-009 | Type duplication | 🟠 High | ✅ Fixed (RQ) |
| DF-010 | Touch devices broken | 🟡 Medium | ✅ Fixed |
| DF-011 | No exit animation | 🟡 Medium | ✅ Fixed |
| DF-012 | No loadMore retry | 🟡 Medium | ✅ Fixed (RQ) |
| DF-013 | Double fetch on mount | 🟡 Medium | ✅ Fixed (RQ) |
| DF-014 | Magic number 500ms | 🟢 Low | Open |
| DF-015 | No keyboard navigation | 🟢 Low | Open |

> **(RQ)** = Fixed by React Query refactor
