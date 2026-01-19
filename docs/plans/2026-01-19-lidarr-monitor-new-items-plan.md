# Lidarr Monitor New Items Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `monitorNewItems` field to Lidarr connection config so Mixarr correctly sets how Lidarr handles future album releases.

**Architecture:** Add new type and field to backend config, update `addArtist()` to send `monitorNewItems` to Lidarr API, add new dropdown to frontend connections form.

**Tech Stack:** TypeScript, Vitest, React/Next.js

---

## Task 1: Add `LidarrMonitorNewItems` type and field to config

**Files:**
- Modify: `apps/api/src/types/connections.ts:117-128`

**Step 1: Add the new type and field**

After line 117 (`export type LidarrMonitorOption = ...`), add the new type. Then add the field to the interface:

```typescript
/** Valid Lidarr monitor options for album monitoring (one-time on add) */
export type LidarrMonitorOption = 'all' | 'future' | 'missing' | 'existing' | 'first' | 'latest' | 'none';

/** Valid Lidarr options for monitoring NEW albums (ongoing) */
export type LidarrMonitorNewItems = 'all' | 'none' | 'new';

export interface LidarrConnectionConfig {
  url: string;
  apiKey: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitorOption?: LidarrMonitorOption;
  monitorNewItems?: LidarrMonitorNewItems;
  searchOnAdd?: boolean;
  [key: string]: JsonValue | undefined;
}
```

**Step 2: Verify types compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/types/connections.ts
git commit -m "feat(lidarr): add LidarrMonitorNewItems type to connection config"
```

---

## Task 2: Add validation to `normalizeLidarrConfig()`

**Files:**
- Modify: `apps/api/src/types/connections.ts:143-163`

**Step 1: Add monitorNewItems normalization**

After the `metadataProfileId` normalization block, add validation for `monitorNewItems`:

```typescript
  // Validate monitorNewItems is a valid option (defaults to 'all' if invalid)
  const validMonitorNewItems = ['all', 'none', 'new'];
  if (normalized.monitorNewItems !== undefined) {
    if (!validMonitorNewItems.includes(normalized.monitorNewItems as string)) {
      normalized.monitorNewItems = 'all';
    }
  }

  return normalized;
}
```

**Step 2: Verify types compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/types/connections.ts
git commit -m "feat(lidarr): add monitorNewItems validation to normalizeLidarrConfig"
```

---

## Task 3: Write failing tests for normalization

**Files:**
- Modify: `apps/api/tests/types/lidarr-config-normalization.test.ts`

**Step 1: Add test cases**

Add these tests to the existing `describe('normalizeLidarrConfig')` block:

```typescript
    it('should preserve valid monitorNewItems values', () => {
      const configs = [
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'all' as const },
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'none' as const },
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'new' as const },
      ];

      configs.forEach(config => {
        const normalized = normalizeLidarrConfig(config);
        expect(normalized.monitorNewItems).toBe(config.monitorNewItems);
      });
    });

    it('should default invalid monitorNewItems to all', () => {
      const config = {
        url: 'http://localhost:8686',
        apiKey: 'key',
        monitorNewItems: 'invalid' as unknown as 'all',
      };

      const normalized = normalizeLidarrConfig(config);
      expect(normalized.monitorNewItems).toBe('all');
    });

    it('should not modify undefined monitorNewItems', () => {
      const config = {
        url: 'http://localhost:8686',
        apiKey: 'key',
      };

      const normalized = normalizeLidarrConfig(config);
      expect(normalized.monitorNewItems).toBeUndefined();
    });
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/types/lidarr-config-normalization.test.ts`
Expected: All 11 tests pass (8 existing + 3 new)

**Step 3: Commit**

```bash
git add apps/api/tests/types/lidarr-config-normalization.test.ts
git commit -m "test(lidarr): add monitorNewItems normalization tests"
```

---

## Task 4: Update `addArtist()` to accept and send `monitorNewItems`

**Files:**
- Modify: `apps/api/src/services/lidarr.ts:231-271`

**Step 1: Add parameter to function signature**

Change `addArtist` signature to:

```typescript
  async addArtist(
    foreignArtistId: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderPath: string,
    monitored: boolean = true,
    searchForMissingAlbums: boolean = true,
    monitorOption: string = 'all',
    monitorNewItems: string = 'all'
  ): Promise<LidarrArtist> {
```

**Step 2: Add to request body**

Update the `requestBody` object (around line 259):

```typescript
    const requestBody = {
      artistName: artist.artistName,
      foreignArtistId: artist.foreignArtistId,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      monitored,
      monitorNewItems,
      addOptions: {
        monitor: monitorOption,
        searchForMissingAlbums: searchForMissingAlbums,
      },
    };
```

**Step 3: Verify types compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: Errors about call sites (expected - we'll fix those next)

**Step 4: Commit**

```bash
git add apps/api/src/services/lidarr.ts
git commit -m "feat(lidarr): add monitorNewItems parameter to addArtist()"
```

---

## Task 5: Update `addArtistWithRefresh()` to pass through `monitorNewItems`

**Files:**
- Modify: `apps/api/src/services/lidarr.ts:409-427`

**Step 1: Add parameter to function signature**

Change `addArtistWithRefresh` signature to:

```typescript
  async addArtistWithRefresh(
    foreignArtistId: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderPath: string,
    monitored: boolean = true,
    searchForMissingAlbums: boolean = true,
    _waitForRefresh: boolean = false,
    monitorOption: string = 'all',
    monitorNewItems: string = 'all'
  ): Promise<{ artist: LidarrArtist; refreshCommand?: LidarrCommand }> {
```

**Step 2: Pass to inner call**

Update the `addArtist` call:

```typescript
    const artist = await this.addArtist(
      foreignArtistId,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      monitored,
      searchForMissingAlbums,
      monitorOption,
      monitorNewItems
    );
```

**Step 3: Commit**

```bash
git add apps/api/src/services/lidarr.ts
git commit -m "feat(lidarr): pass monitorNewItems through addArtistWithRefresh()"
```

---

## Task 6: Update all call sites to pass `monitorNewItems`

**Files:**
- Modify: `apps/api/src/routes/discover.ts`
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/routes/subscriptions.ts`
- Modify: `apps/api/src/jobs/subscription-worker.ts`
- Modify: `apps/api/src/jobs/import-worker.ts`

🦆 **Rubber duck note:** All call sites need `lidarrConfig?.monitorNewItems || 'all'` as the last parameter.

**Step 1: Update discover.ts (line ~367)**

Find the `addArtistWithRefresh` call and add `monitorNewItems`:

```typescript
    const { artist: result, refreshCommand } = await lidarr.addArtistWithRefresh(
      foreignArtistId,
      qpId,
      mpId,
      rfPath,
      true,
      lidarrConfig.searchOnAdd !== false,
      false,
      lidarrConfig.monitorOption || 'all',
      lidarrConfig.monitorNewItems || 'all'
    );
```

**Step 2: Update search.ts (3 call sites around lines 440, 522, 1214)**

Same pattern for each `addArtistWithRefresh` call.

**Step 3: Update imports.ts (3 call sites around lines 376, 598, 1206)**

Same pattern for each `addArtistWithRefresh` call.

**Step 4: Update subscriptions.ts (line ~334)**

Same pattern.

**Step 5: Update subscription-worker.ts (line ~2083)**

For `addArtist` calls:

```typescript
          await lidarr.addArtist(
            mbid,
            qpId,
            mpId,
            rfPath,
            true,
            lidarrConfig?.searchOnAdd !== false,
            lidarrConfig?.monitorOption || 'all',
            lidarrConfig?.monitorNewItems || 'all'
          );
```

**Step 6: Update import-worker.ts (line ~292)**

Same pattern as subscription-worker.

**Step 7: Verify types compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add apps/api/src/routes/*.ts apps/api/src/jobs/*.ts
git commit -m "feat(lidarr): pass monitorNewItems from config to all addArtist calls"
```

---

## Task 7: Add test for addArtist request body

**Files:**
- Modify: `apps/api/tests/services/lidarr.test.ts`

**Step 1: Add test case**

Find the `describe('addArtist')` block and add:

```typescript
    it('should include monitorNewItems in request body', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => [{ foreignArtistId: 'mbid-test', artistName: 'Test' }] })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1 }) });
      
      vi.stubGlobal('fetch', fetchMock);
      
      const service = new LidarrService({ url: 'http://localhost:8686', apiKey: 'test' });
      await service.addArtist('mbid-test', 1, 1, '/music', true, true, 'all', 'new');
      
      const postCall = fetchMock.mock.calls.find((c: unknown[]) => 
        (c[1] as { method?: string })?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as { body: string }).body);
      expect(body.monitorNewItems).toBe('new');
    });
```

**Step 2: Run test**

Run: `cd apps/api && npx vitest run tests/services/lidarr.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/api/tests/services/lidarr.test.ts
git commit -m "test(lidarr): verify monitorNewItems is included in addArtist request"
```

---

## Task 8: Add frontend form field for monitorNewItems

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx`

**Step 1: Add to form state (line ~120)**

Add `monitorNewItems: 'all',` after `monitorOption`:

```typescript
    monitorOption: 'all',
    monitorNewItems: 'all',
    searchOnAdd: true,
```

**Step 2: Add to save handler (line ~533)**

After `config.monitorOption = form.monitorOption;`:

```typescript
      config.monitorNewItems = form.monitorNewItems;
```

**Step 3: Add to load handler (line ~652)**

After `monitorOption: config.monitorOption || 'all',`:

```typescript
        monitorNewItems: config.monitorNewItems || 'all',
```

**Step 4: Add to reset handler (line ~707)**

After `monitorOption: 'all',`:

```typescript
        monitorNewItems: 'all',
```

**Step 5: Add dropdown in UI (after line ~1201)**

After the existing Monitor Option dropdown, add:

```tsx
                  <div>
                    <label className="text-sm font-medium">Monitor New Albums</label>
                    <Select
                      value={form.monitorNewItems}
                      onChange={(e) => setForm({ ...form, monitorNewItems: e.target.value })}
                      options={[
                        { value: 'all', label: 'All New Albums' },
                        { value: 'new', label: 'New Releases Only' },
                        { value: 'none', label: 'None' },
                      ]}
                    />
                    <p className="text-xs text-muted-foreground mt-1">How to handle future album releases</p>
                  </div>
```

**Step 6: Rename existing dropdown label**

Change `<label className="text-sm font-medium">Monitor Option</label>` to:

```tsx
                    <label className="text-sm font-medium">Monitor Existing Albums</label>
```

**Step 7: Verify frontend compiles**

Run: `cd apps/web && npm run build`
Expected: No errors

**Step 8: Commit**

```bash
git add apps/web/src/app/connections/page.tsx
git commit -m "feat(ui): add Monitor New Albums dropdown to Lidarr connection settings"
```

---

## Task 9: Run full test suite and verify

**Step 1: Run backend tests**

Run: `cd apps/api && npm test`
Expected: All Lidarr-related tests pass

**Step 2: Run type checks**

Run: `cd apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: No errors

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "chore: final cleanup for lidarr monitorNewItems feature"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Add type and field | 2 min |
| 2 | Add normalization | 2 min |
| 3 | Write normalization tests | 3 min |
| 4 | Update addArtist() | 3 min |
| 5 | Update addArtistWithRefresh() | 2 min |
| 6 | Update all call sites | 5 min |
| 7 | Add request body test | 3 min |
| 8 | Add frontend form field | 5 min |
| 9 | Run full test suite | 2 min |

**Total: ~27 minutes**
