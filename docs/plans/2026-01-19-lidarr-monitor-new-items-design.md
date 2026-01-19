# Lidarr Monitor New Items Fix

**Date:** 2026-01-19  
**Status:** Approved

## Problem

Lidarr has two separate monitoring settings that Mixarr conflates:

1. **`addOptions.monitor`** (MonitorTypes) - One-time setting when adding an artist that determines which *existing* albums get marked as monitored
   - Options: `all`, `future`, `missing`, `existing`, `first`, `latest`, `none`

2. **`monitorNewItems`** (NewItemMonitorTypes) - Ongoing setting that determines what happens when *new* albums are discovered later
   - Options: `all`, `none`, `new`

Currently Mixarr only exposes #1 via "Monitor Option" and doesn't send #2 at all. Lidarr defaults `monitorNewItems` based on root folder settings, causing unexpected behavior where artists are added with "Monitor New Albums" set to something the user didn't choose.

## Solution

1. Add `monitorNewItems` field to `LidarrConnectionConfig` type
2. Add "Monitor New Albums" dropdown to Lidarr connection settings UI
3. Rename existing "Monitor Option" to "Monitor Existing Albums" for clarity
4. Send `monitorNewItems` in the Lidarr API request when adding artists
5. Default to `all` for backwards compatibility

## Scope

- **In scope:** Backend type, API request, frontend form, normalization
- **Out of scope:** Per-artist overrides, migration of existing Lidarr artists

## Backend Changes

### Type Definition

Update `LidarrConnectionConfig` in `apps/api/src/types/connections.ts`:

```typescript
/** Valid options for monitoring NEW albums (ongoing) */
export type LidarrMonitorNewItems = 'all' | 'none' | 'new';

export interface LidarrConnectionConfig {
  url: string;
  apiKey: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitorOption?: LidarrMonitorOption;      // Existing: which albums to monitor on add
  monitorNewItems?: LidarrMonitorNewItems;  // NEW: how to handle future albums
  searchOnAdd?: boolean;
}
```

### API Request

Update `addArtist()` in `apps/api/src/services/lidarr.ts` to include `monitorNewItems`:

```typescript
const requestBody = {
  artistName: artist.artistName,
  foreignArtistId: artist.foreignArtistId,
  qualityProfileId,
  metadataProfileId,
  rootFolderPath,
  monitored,
  monitorNewItems: monitorNewItems || 'all',  // NEW
  addOptions: {
    monitor: monitorOption,
    searchForMissingAlbums,
  },
};
```

### Normalization

Extend `normalizeLidarrConfig()` to validate `monitorNewItems` is one of `all`/`none`/`new`.

## Frontend Changes

### Connections Page UI

Update `apps/web/src/app/connections/page.tsx`:

**Form state:**
```typescript
const [form, setForm] = useState({
  // ... existing fields
  monitorOption: 'all',
  monitorNewItems: 'all',  // NEW field
});
```

**New dropdown in Lidarr config section:**
```tsx
{/* Rename existing */}
<label>Monitor Existing Albums</label>
<select value={form.monitorOption}>
  <option value="all">All Albums</option>
  <option value="future">Future Albums</option>
  <option value="missing">Missing Albums</option>
  <option value="existing">Existing Albums</option>
  <option value="first">First Album</option>
  <option value="latest">Latest Album</option>
  <option value="none">None</option>
</select>

{/* NEW dropdown */}
<label>Monitor New Albums</label>
<select value={form.monitorNewItems}>
  <option value="all">All Albums</option>
  <option value="new">New Albums Only</option>
  <option value="none">None</option>
</select>
```

## Test Cases

Add to `lidarr-config-normalization.test.ts`:
- `monitorNewItems` preserved when valid (`all`, `none`, `new`)
- Invalid `monitorNewItems` values default to `all`

Add to `lidarr.test.ts`:
- `addArtist` includes `monitorNewItems` in request body
- Default `monitorNewItems` is `all` when not specified

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/types/connections.ts` | Add `LidarrMonitorNewItems` type, add field to interface |
| `apps/api/src/services/lidarr.ts` | Add `monitorNewItems` param to `addArtist()` and `addArtistWithRefresh()`, include in request body |
| `apps/web/src/app/connections/page.tsx` | Add dropdown, rename label, update save/load |
| `apps/api/tests/types/lidarr-config-normalization.test.ts` | Add test cases |
| `apps/api/tests/services/lidarr.test.ts` | Add test cases |

## Call Sites to Update

All places that call `addArtist()` or `addArtistWithRefresh()` need to pass `monitorNewItems`:
- `discover.ts`
- `search.ts`
- `imports.ts`
- `subscriptions.ts`
- `subscription-worker.ts`
- `import-worker.ts`

## Backwards Compatibility

- Existing Lidarr connections without `monitorNewItems` will automatically use `all` as default
- No database migration required (JSON config field)
- No user action required for existing connections
