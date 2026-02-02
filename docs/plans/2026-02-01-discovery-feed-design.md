# Discovery Feed Design

**Date**: 2026-02-01  
**Status**: Approved  
**Author**: Chris + AI

## Overview

Replace the current Dashboard with a **Discovery Feed**—a curated, ranked grid of artist recommendations aggregated from all subscriptions. Users see the most valuable finds first, approve or dismiss with one click, and never see the same artist twice.

This leverages Mixarr's core strength as a recommendation **aggregator** rather than building a competing recommendation engine.

## Core Decisions

| Decision | Choice |
|----------|--------|
| Primary goal | Unified inbox + smart ranking |
| Value algorithm | Cross-subscription frequency (40%) → Source diversity (30%) → Library similarity (20%) → Recency (10%) |
| Provenance display | None—algorithm works silently, users just see curated results |
| Actions | Simple approve/dismiss (add to Lidarr or reject) |
| Post-action behavior | Fade briefly ("Added"/"Dismissed"), remove on refresh |
| Layout | Responsive card grid (4/3/2 columns), infinite scroll |
| Location | Replaces Dashboard as home page |
| Stats | Minimal bar: "47 pending • 12 added today" |
| Feed source | `SubscriptionResult` with status `pending` or `queued` |
| Sync | Approving removes from ReviewItem table too |

## Data Architecture

### Feed Source

Aggregate all `SubscriptionResult` records where:
- `status` IN ('pending', 'queued')
- Subscription belongs to current user

### Cross-Subscription Deduplication

Match artists by:
1. **MBID** (exact match, preferred)
2. **Normalized name** (fallback—lowercase, strip "The ", remove non-alphanumeric)

Aggregated metadata per feed item:
- `subscriptionCount` — How many subscriptions found this artist
- `sourceTypes` — Unique source types (e.g., ["lastfm", "spotify", "listenbrainz"])
- `sourceCount` — Count of distinct source types
- `earliestFound` — First discovery timestamp
- `linkedResultIds` — All `SubscriptionResult.id` values for this artist

### Value Score Calculation

```
score = (subscriptionCount × 40) + (sourceCount × 30) + (librarySimilarity × 20) + (recencyBonus × 10)
```

| Factor | Calculation | Cap |
|--------|-------------|-----|
| `subscriptionCount` | Raw count of subscriptions that found this artist | 10 |
| `sourceCount` | Distinct source types | 5 |
| `librarySimilarity` | Future: count of similar library artists (default 0 for MVP) | 20 |
| `recencyBonus` | 1.0 if <24h, 0.5 if <7d, 0 otherwise | 1 |

### Sync Behavior

When user approves:
1. Update all `linkedResultIds` to `status = 'added'`
2. Delete any matching `ReviewItem` records (by MBID or normalized name)
3. Call Lidarr API to add artist

When user dismisses:
1. Update all `linkedResultIds` to `status = 'rejected'`
2. Delete any matching `ReviewItem` records

### Migration Path

- **No schema changes required** — Feed is computed at query time from existing tables
- **No data migration** — Existing SubscriptionResult/ReviewItem data remains intact
- **Additive only** — If future optimization needs a FeedItem cache table, it will be new columns/tables only

## API Design

### GET /api/feed

Returns aggregated, scored, deduplicated feed.

**Query params**:
- `limit` (default 50)
- `offset` (for pagination)
- `includeActedOn` (boolean, default false)

**Response**:
```json
{
  "items": [
    {
      "id": "feed-abc123",
      "artistName": "Radiohead",
      "artistMbid": "a74b1b7f-...",
      "imageUrl": "https://...",
      "score": 87,
      "subscriptionCount": 4,
      "sourceCount": 3,
      "linkedResultIds": [12, 45, 78, 92],
      "earliestFound": "2026-01-30T..."
    }
  ],
  "total": 156,
  "stats": {
    "pending": 47,
    "addedToday": 12
  }
}
```

### POST /api/feed/:id/approve

Add artist to Lidarr, update all linked results to 'added', remove from ReviewItem.

**Response**: `{ "success": true, "artistName": "Radiohead" }`

### POST /api/feed/:id/dismiss

Update all linked results to 'rejected', remove from ReviewItem.

**Response**: `{ "success": true, "artistName": "Radiohead" }`

## Frontend Design

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  47 pending  •  12 added today                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │  image  │  │  image  │  │  image  │  │  image  │            │
│  │         │  │         │  │         │  │         │            │
│  │ Artist  │  │ Artist  │  │ Artist  │  │ Artist  │            │
│  │  ✓   ✕  │  │  ✓   ✕  │  │  ✓   ✕  │  │  ✓   ✕  │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
│                                                                 │
│  (infinite scroll - more cards load automatically)             │
└─────────────────────────────────────────────────────────────────┘
```

### Grid

- **Responsive**: 4 columns desktop, 3 tablet, 2 mobile
- **Infinite scroll**: `IntersectionObserver` on sentinel div, no external dependencies

### FeedCard Component

- Square artist image (placeholder if none)
- Artist name (truncate with ellipsis)
- Approve (✓) and Dismiss (✕) buttons on hover/touch
- On action: overlay shows "Added" or "Dismissed", card fades out (300ms)

### Stats Bar

- Single line, muted text, left-aligned
- Format: `{pending} pending • {addedToday} added today`
- Optimistic updates on action

### States

| State | Display |
|-------|---------|
| Loading | Skeleton cards (pulsing placeholders) |
| Empty | "No recommendations yet. Set up subscriptions to start discovering." + link |
| Error | Toast notification, retry on next action |
| No Lidarr | Approve button disabled, tooltip explains |

### Behavior

- On window focus: silently refresh feed (preserve scroll position)
- Optimistic UI: card fades immediately, rollback on API error
- After action fade: card removed from DOM on refresh/scroll

## Testing Strategy

### Backend (Vitest)

| Area | Tests |
|------|-------|
| FeedService.getFeed() | Aggregation, MBID dedup, name dedup, scoring, sorting, pagination, status filtering |
| FeedService.approve() | Updates all linked results, deletes ReviewItems, calls Lidarr |
| FeedService.dismiss() | Updates all linked results to rejected, deletes ReviewItems |
| Feed routes | Auth required, param validation, 404 handling, JSON responses |
| Scoring edge cases | Zero subscriptions, missing MBID, tied scores |

### Frontend

| Area | Tests |
|------|-------|
| FeedCard | Renders correctly, buttons work, overlay shows, handles missing image |
| Feed page | Fetches on load, renders grid, infinite scroll, empty state, stats updates |
| Error handling | API failures show toast, card reverts |

### E2E (Playwright)

- Load feed → approve → verify removed → verify count decreases
- Load feed → dismiss → verify removed
- Empty state when no subscriptions

## Implementation Notes

### Files to Create

- `apps/api/src/services/FeedService.ts` — Aggregation and scoring logic
- `apps/api/src/routes/feed.ts` — API endpoints
- `apps/api/tests/services/feed.test.ts` — Service tests
- `apps/api/tests/api/feed.test.ts` — Route tests
- `apps/web/src/app/dashboard/page.tsx` — New feed-based dashboard (replaces current)
- `apps/web/src/components/feed/FeedCard.tsx` — Card component
- `apps/web/src/components/feed/FeedGrid.tsx` — Grid with infinite scroll
- `apps/web/src/components/feed/StatsBar.tsx` — Minimal stats display

### Files to Modify

- `apps/api/src/index.ts` — Register feed routes
- Sidebar navigation — Ensure "Dashboard" route points to new page

### Files to Archive/Remove

- Current dashboard components (after new implementation verified)

## Future Enhancements (Out of Scope)

- `librarySimilarity` scoring factor (requires Lidarr library analysis)
- Materialized FeedItem table for performance at scale
- "Show dismissed" toggle
- Genre/tag filtering on feed
- Subscription source badges (optional provenance display)
