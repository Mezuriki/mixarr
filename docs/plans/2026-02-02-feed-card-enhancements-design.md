# Feed Card Enhancements Design

**Date:** 2026-02-02  
**Status:** Approved  
**Branch:** feature/discovery-feed

## Summary

Enhance the Discovery Feed dashboard cards with:
1. Improved toast messaging during approve/dismiss actions
2. Artist metadata (genre tags, listener count)
3. Recommendation source display (subscription name)

## Decisions

| Feature | Decision |
|---------|----------|
| Progress indicator | Optimistic update with improved toast messaging |
| Metadata on cards | Genre tags (1-2) + listener count |
| Recommendation source | Single subscription name, or "Found in X subs" if multiple |
| Card layout | Condensed single line below artist name |

## Data Model Changes

### FeedItem Interface (hooks.ts)

```typescript
export interface FeedItem {
  // Existing fields
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
  
  // New fields
  tags: string[] | null;           // Genre tags, e.g. ["Jazz", "Blues"]
  listeners: number | null;        // Listener count from Last.fm/Spotify
  subscriptionName: string | null; // Single sub name, or null if multiple
}
```

### Backend Changes (FeedService.ts)

- Join `Subscription` table during aggregation to get subscription names
- Include first 2-3 tags from the `tags` field (already stored as comma-separated)
- Include `listeners` field (already stored)
- If `subscriptionCount === 1`, include the subscription name; otherwise `null`

### API Response Example

```json
{
  "artistName": "Beppe Gambetta",
  "tags": ["Folk", "Acoustic"],
  "listeners": 45000,
  "subscriptionName": "Similar Artists",
  "subscriptionCount": 1
}
```

## FeedCard Component Changes

### Card Layout

```
┌─────────────────┐
│                 │
│     [Image]     │
│                 │
├─────────────────┤
│ Artist Name     │
│ Jazz · 45K · Similar Artists │
└─────────────────┘
```

### Metadata Line Formatting

- **Tags**: First 1-2 tags, comma-separated (e.g., "Jazz, Blues")
- **Listeners**: Abbreviated (45000 → "45K", 2300000 → "2.3M")
- **Source**: Subscription name OR "Found in X subs" if `subscriptionCount > 1`
- **Separator**: Middle dot (·) between each element
- **Styling**: `text-xs text-muted-foreground truncate`

### Edge Cases

- Missing tags: Skip that segment entirely
- Missing listeners: Skip that segment
- No subscription name & count=1: Show nothing (shouldn't happen)
- All metadata missing: Don't show the metadata line at all

### Example Outputs

- Full: `Jazz, Blues · 2.3M · Similar Artists`
- No listeners: `Jazz · Similar Artists`
- Multiple subs: `Rock · 150K · Found in 3 subs`
- Minimal: `Similar Artists` (only source available)

## Toast Messaging Flow

### On Approve Click

1. Card immediately shows "Added" overlay (optimistic update)
2. Toast shows: "Adding [Artist Name] to Lidarr..." with subtle spinner

### On Success (API Returns)

- Toast updates to: "✓ [Artist Name] added to Lidarr"
- Toast auto-dismisses after 3s

### On API Error (Database Update Failed)

- Card reverts to pending state
- Toast shows: "✗ Failed to add [Artist Name]" (error style)

### Note About Lidarr Errors

- Lidarr add is non-blocking on the backend
- Backend logs warnings but returns success
- User sees success toast even if Lidarr add failed
- This is intentional - the item IS approved in the database

## Files to Modify

### Backend
- `apps/api/src/services/FeedService.ts` - Add metadata fields to aggregation
- `apps/api/src/routes/feed.ts` - No changes needed (uses FeedService)

### Frontend
- `apps/web/src/lib/hooks.ts` - Update FeedItem interface
- `apps/web/src/components/feed/FeedCard.tsx` - Add metadata line, update props
- `apps/web/src/app/page.tsx` - Update toast messaging in mutation callbacks

### Tests
- `apps/api/tests/services/feed.test.ts` - Test new metadata fields
- `apps/web/src/components/feed/FeedCard.test.tsx` - Test metadata rendering
