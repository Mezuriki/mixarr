# slskd Implementation Fixes - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 9 critical issues in slskd integration to make it production-ready

**Architecture:** Per-file download model, transaction safety for queue operations, atomic status updates to prevent races, exponential backoff polling, retry logic for transient failures

**Tech Stack:** TypeScript, Prisma, React, Express, Vitest

**Design Document:** `docs/plans/2026-01-08-slskd-fixes-design.md`

---

## Phase 1: Foundation

### Task 1: Add slskd Connection UI

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx:44-53`

**Step 1: Write failing test for slskd connection type**

File: `apps/web/src/app/connections/__tests__/page.test.tsx` (create if doesn't exist)

```typescript
import { render, screen } from '@testing-library/react';
import ConnectionsPage from '../page';

describe('ConnectionsPage - slskd', () => {
  it('should include slskd in connection types', () => {
    render(<ConnectionsPage />);
    expect(screen.getByText(/slskd/i)).toBeInTheDocument();
    expect(screen.getByText(/Soulseek downloads/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- connections/page.test.tsx`
Expected: FAIL - "slskd" not found in document

**Step 3: Add slskd to connectionTypes array**

File: `apps/web/src/app/connections/page.tsx`

Find the `connectionTypes` array (around line 44) and add:

```typescript
const connectionTypes = [
  { value: 'lidarr', label: 'Lidarr', color: '#62BC50', description: 'Music collection manager' },
  { value: 'spotify', label: 'Spotify', color: '#1DB954', description: 'Import & playlist subscriptions' },
  { value: 'lastfm', label: 'Last.fm', color: '#D51007', description: 'Chart & tag subscriptions' },
  { value: 'tautulli', label: 'Tautulli', color: '#E5A00D', description: 'Plex listening history' },
  { value: 'jellyfin', label: 'Jellyfin', color: '#00A4DC', description: 'Jellyfin listening history' },
  { value: 'deezer', label: 'Deezer', color: '#FEAA2D', description: 'Deezer library & playlists' },
  { value: 'tidal', label: 'TIDAL', color: '#00FFFF', description: 'TIDAL library & mixes' },
  { value: 'listenbrainz', label: 'ListenBrainz', color: '#353070', description: 'Open-source music tracking' },
  { value: 'discogs', label: 'Discogs', color: '#333333', description: 'Music database & collection' },
  { value: 'slskd', label: 'slskd', color: '#00A0DC', description: 'Soulseek downloads via slskd' },
];
```

**Step 4: Add slskd form fields in modal**

Find the connection form modal (search for form fields rendering). Add slskd-specific fields:

```typescript
{form.type === 'slskd' && (
  <>
    <div>
      <label className="block text-sm font-medium mb-2">
        slskd URL <span className="text-red-500">*</span>
      </label>
      <Input
        type="url"
        placeholder="http://localhost:5030"
        value={(form.config as any)?.url || ''}
        onChange={(e) => setForm({
          ...form,
          config: { ...(form.config as any), url: e.target.value }
        })}
        required
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-2">
        API Key <span className="text-red-500">*</span>
      </label>
      <Input
        type={showPassword ? 'text' : 'password'}
        placeholder="Enter slskd API key"
        value={(form.config as any)?.apiKey || ''}
        onChange={(e) => setForm({
          ...form,
          config: { ...(form.config as any), apiKey: e.target.value }
        })}
        required
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-2">
        Download Directory (optional)
      </label>
      <Input
        type="text"
        placeholder="/data/slskd/downloads"
        value={(form.config as any)?.downloadDir || ''}
        onChange={(e) => setForm({
          ...form,
          config: { ...(form.config as any), downloadDir: e.target.value }
        })}
      />
      <p className="text-xs text-gray-500 mt-1">Default: /data/slskd/downloads</p>
    </div>
    <div>
      <label className="block text-sm font-medium mb-2">
        Music Library Directory (optional)
      </label>
      <Input
        type="text"
        placeholder="/data/plex/music"
        value={(form.config as any)?.musicLibraryDir || ''}
        onChange={(e) => setForm({
          ...form,
          config: { ...(form.config as any), musicLibraryDir: e.target.value }
        })}
      />
      <p className="text-xs text-gray-500 mt-1">Default: /data/plex/music</p>
    </div>
  </>
)}
```

**Step 5: Run test to verify it passes**

Run: `cd apps/web && npm test -- connections/page.test.tsx`
Expected: PASS

**Step 6: Run TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/web/src/app/connections/page.tsx
git commit -m "feat(ui): add slskd connection configuration to Connections page

- Add slskd to connectionTypes array
- Add form fields: URL, API Key, downloadDir, musicLibraryDir
- URL and API Key required, directories optional with defaults"
```

---

## Phase 2: Data Model

### Task 2: Normalize Download Records (Per-File Model)

**Files:**
- Modify: `apps/api/src/services/slskd-subscription-processor.ts:239-257`
- Test: `apps/api/tests/services/slskd-subscription-processor.test.ts`

**Step 1: Write failing test for per-file download creation**

File: `apps/api/tests/services/slskd-subscription-processor.test.ts`

Add test after existing tests:

```typescript
describe('download record creation', () => {
  it('should create one record per file for album downloads', async () => {
    const mockFiles = [
      { filename: 'track1.flac', size: 30000000 },
      { filename: 'track2.flac', size: 28000000 },
      { filename: 'track3.flac', size: 32000000 },
    ];
    
    mockSlskdService.search.mockResolvedValue({
      id: 'search123',
      searchText: 'Test Artist',
      state: 'Requested',
    });
    
    mockSlskdService.getSearchResults.mockResolvedValue({
      id: 'search123',
      state: 'Completed',
      responses: [{
        username: 'testuser',
        files: mockFiles,
        uploadSpeed: 1000000,
        queueLength: 5,
        hasFreeUploadSlot: true,
      }],
    });
    
    mockSlskdService.queueDownload.mockResolvedValue(undefined);
    
    const result = await processor.processArtist(
      { name: 'Test Artist', album: 'Test Album' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );
    
    expect(result.status).toBe('queued');
    
    // Should create 3 download records (one per file)
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: 'Test Artist', albumName: 'Test Album' }
    });
    
    expect(downloads).toHaveLength(3);
    expect(downloads[0].filename).toBe('track1.flac');
    expect(downloads[0].fileSize).toBe(30000000);
    expect(downloads[1].filename).toBe('track2.flac');
    expect(downloads[1].fileSize).toBe(28000000);
    expect(downloads[2].filename).toBe('track3.flac');
    expect(downloads[2].fileSize).toBe(32000000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/slskd-subscription-processor.test.ts`
Expected: FAIL - expects 3 records, gets 1

**Step 3: Update processArtist to create per-file records**

File: `apps/api/src/services/slskd-subscription-processor.ts`

Find the download creation code (around line 239-257) and replace:

```typescript
// OLD CODE (remove):
const download = await prisma.slskdDownload.create({
  data: {
    connectionId,
    artistName: artist.name,
    albumName: artist.album,
    username: bestResult.username,
    filename: filesToDownload[0]?.filename || '',
    fileSize: totalSize,
    searchId: search.id,
    status: 'pending',
  },
});

// NEW CODE:
// Create one record per file
const downloads = await Promise.all(
  filesToDownload.map(file =>
    prisma.slskdDownload.create({
      data: {
        connectionId,
        artistName: artist.name,
        albumName: artist.album,
        username: bestResult.username,
        filename: file.filename,
        fileSize: file.size,
        searchId: search.id,
        status: 'pending',
      },
    })
  )
);

log.info('Queued slskd download', { 
  artist: artist.name, 
  username: bestResult.username,
  fileCount: filesToDownload.length,
  downloadIds: downloads.map(d => d.id),
});

return { 
  status: 'queued', 
  downloadId: downloads[0]?.id, // Return first download ID for compatibility
  searchResultCount: searchResult.responses.length,
};
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/slskd-subscription-processor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd-subscription-processor.ts apps/api/tests/services/slskd-subscription-processor.test.ts
git commit -m "fix(slskd): normalize downloads to per-file model

- Create one SlskdDownload record per file (not per album)
- Each record has individual file size
- Maintains consistent data model with manual downloads
- Test: verify 3 records created for 3-track album"
```

---

## Phase 3: Security & Safety

### Task 3: Fix Path Traversal Vulnerability

**Files:**
- Modify: `apps/api/src/routes/slskd.ts:346-416`
- Test: `apps/api/tests/security/slskd-security.test.ts` (create)

**Step 1: Write failing security test**

File: `apps/api/tests/security/slskd-security.test.ts` (create new file)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/index.js';
import prisma from '../../src/lib/db.js';

describe('slskd security - path traversal', () => {
  beforeEach(async () => {
    await prisma.slskdDownload.deleteMany();
    await prisma.connection.deleteMany();
    
    // Create slskd connection
    await prisma.connection.create({
      data: {
        type: 'slskd',
        name: 'Test slskd',
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'testkey',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      },
    });
  });

  it('should reject webhook with path traversal in username', async () => {
    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: '../../../etc',
        directory: 'passwd',
        filename: 'shadow',
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('should reject webhook with path traversal in directory', async () => {
    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: '../../sensitive',
        filename: 'data.mp3',
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });

  it('should accept webhook with valid paths', async () => {
    // Create matching download record
    await prisma.slskdDownload.create({
      data: {
        connectionId: 1,
        username: 'validuser',
        filename: 'song.mp3',
        fileSize: 5000000,
        artistName: 'Test Artist',
        status: 'pending',
      },
    });

    const res = await request(app)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'validuser',
        directory: 'Test Artist - Album',
        filename: '/path/to/song.mp3',
      });
    
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/security/slskd-security.test.ts`
Expected: FAIL - path traversal not blocked

**Step 3: Add path sanitization utility**

File: `apps/api/src/routes/slskd.ts`

Add utility function at top of file (after imports):

```typescript
/**
 * Sanitize path component to prevent directory traversal
 */
function sanitizePathComponent(component: string): string {
  return component
    .replace(/\.\./g, '')   // Remove ..
    .replace(/\//g, '')      // Remove /
    .replace(/\\/g, '')      // Remove \
    .trim();
}

/**
 * Validate that resolved path is within base directory
 */
function validatePathWithinBase(fullPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(fullPath);
  return resolvedPath.startsWith(resolvedBase);
}
```

**Step 4: Apply sanitization in webhook handler**

File: `apps/api/src/routes/slskd.ts`

Find webhook handler (around line 370-400) and update:

```typescript
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, username, filename, directory } = req.body;

    // Only handle download completion events
    if (event !== 'DownloadComplete') {
      res.json({ success: true, ignored: true });
      return;
    }

    log.info('slskd webhook received', { event, username, filename });

    // Get connection config
    const connection = await prisma.connection.findFirst({
      where: { type: 'slskd', isActive: true },
    });

    if (!connection) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    const config = connection.config as {
      url: string;
      apiKey: string;
      downloadDir?: string;
      musicLibraryDir?: string;
    };

    const downloadDir = config.downloadDir || '/data/slskd/downloads';
    const musicLibraryDir = config.musicLibraryDir || '/data/plex/music';

    // Sanitize path components to prevent traversal
    const safeUsername = sanitizePathComponent(username);
    const safeDirectory = sanitizePathComponent(directory);
    const downloadPath = path.join(
      downloadDir,
      safeUsername,
      safeDirectory,
      path.basename(filename)
    );

    // Validate path is within downloadDir
    if (!validatePathWithinBase(downloadPath, downloadDir)) {
      log.warn('Path traversal attempt detected', { username, directory, filename });
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    // ... rest of webhook logic
  } catch (error) {
    log.error('Webhook processing failed', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
```

**Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/security/slskd-security.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/routes/slskd.ts apps/api/tests/security/slskd-security.test.ts
git commit -m "fix(security): prevent path traversal in slskd webhook

- Add sanitizePathComponent() to strip .., /, \
- Add validatePathWithinBase() to verify resolved paths
- Reject webhooks with traversal attempts
- Security tests for username and directory parameters"
```

---

### Task 4: Transaction Safety for Download Queue

**Files:**
- Modify: `apps/api/src/routes/slskd.ts:150-189`
- Modify: `apps/api/src/services/slskd-subscription-processor.ts:239-257`
- Modify: `apps/api/prisma/schema.prisma:499-506`
- Test: `apps/api/tests/api/slskd-downloads.test.ts`

**Step 1: Add queued_locally status to schema**

File: `apps/api/prisma/schema.prisma`

Update SlskdDownloadStatus enum:

```prisma
enum SlskdDownloadStatus {
  queued_locally
  pending
  downloading
  completed
  failed
  cancelled
}
```

**Step 2: Run Prisma migration**

Run: `cd apps/api && npx prisma db push`
Expected: Schema updated successfully

**Step 3: Write failing test for transaction safety**

File: `apps/api/tests/api/slskd-downloads.test.ts`

Add test:

```typescript
describe('POST /api/slskd/download - transaction safety', () => {
  it('should mark downloads as failed if slskd queue fails', async () => {
    const mockSlskdService = {
      queueDownload: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    
    vi.mock('../../src/services/slskd.js', () => ({
      SlskdService: vi.fn(() => mockSlskdService),
    }));

    const res = await request(app)
      .post('/api/slskd/download')
      .set('Cookie', authCookie)
      .send({
        username: 'testuser',
        files: [
          { filename: 'track1.mp3', size: 5000000 },
          { filename: 'track2.mp3', size: 4800000 },
        ],
        artistName: 'Test Artist',
      });

    expect(res.status).toBe(500);

    // Verify downloads marked as failed (not orphaned)
    const downloads = await prisma.slskdDownload.findMany({
      where: { username: 'testuser' }
    });

    expect(downloads).toHaveLength(2);
    expect(downloads.every(d => d.status === 'failed')).toBe(true);
    expect(downloads.every(d => d.error?.includes('Network error'))).toBe(true);
  });
});
```

**Step 4: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/api/slskd-downloads.test.ts`
Expected: FAIL - downloads not created or status incorrect

**Step 5: Update POST /download route with transaction safety**

File: `apps/api/src/routes/slskd.ts`

Replace the POST /download handler (around line 150-189):

```typescript
router.post('/download', async (req: Request, res: Response) => {
  try {
    const { username, files, artistName, albumName, albumYear } = req.body;

    if (!username || !files || !Array.isArray(files)) {
      res.status(400).json({ error: 'Username and files are required' });
      return;
    }

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    // Create DB records FIRST with queued_locally status
    const downloads = await Promise.all(
      files.map((file: { filename: string; size: number }) =>
        prisma.slskdDownload.create({
          data: {
            connectionId: slskd.connectionId,
            username,
            artistName: artistName || 'Unknown Artist',
            albumName,
            albumYear,
            filename: file.filename,
            fileSize: file.size,
            status: 'queued_locally',
          },
        })
      )
    );

    try {
      // Queue in slskd
      await slskd.service.queueDownload(username, files);

      // Update status to pending on success
      await prisma.slskdDownload.updateMany({
        where: { id: { in: downloads.map(d => d.id) } },
        data: { status: 'pending' }
      });

      res.json({ success: true, downloads });
    } catch (queueError) {
      // slskd failed - mark downloads as failed
      await prisma.slskdDownload.updateMany({
        where: { id: { in: downloads.map(d => d.id) } },
        data: {
          status: 'failed',
          error: queueError instanceof Error ? queueError.message : 'Queue failed'
        }
      });
      
      throw queueError;
    }
  } catch (error) {
    log.error('Failed to queue download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to queue download' });
  }
});
```

**Step 6: Update subscription processor with same pattern**

File: `apps/api/src/services/slskd-subscription-processor.ts`

Update the download creation section (around line 239-257):

```typescript
// Create one record per file with queued_locally status
const downloads = await Promise.all(
  filesToDownload.map(file =>
    prisma.slskdDownload.create({
      data: {
        connectionId,
        artistName: artist.name,
        albumName: artist.album,
        username: bestResult.username,
        filename: file.filename,
        fileSize: file.size,
        searchId: search.id,
        status: 'queued_locally',
      },
    })
  )
);

try {
  // Queue download in slskd
  await this.slskdService.queueDownload(bestResult.username, filesToDownload);

  // Update status to pending on success
  await prisma.slskdDownload.updateMany({
    where: { id: { in: downloads.map(d => d.id) } },
    data: { status: 'pending' }
  });

  log.info('Queued slskd download', { 
    artist: artist.name, 
    username: bestResult.username,
    fileCount: filesToDownload.length,
    downloadIds: downloads.map(d => d.id),
  });

  return { 
    status: 'queued', 
    downloadId: downloads[0]?.id,
    searchResultCount: searchResult.responses.length,
  };
} catch (queueError) {
  // Queue failed - mark as failed
  await prisma.slskdDownload.updateMany({
    where: { id: { in: downloads.map(d => d.id) } },
    data: {
      status: 'failed',
      error: queueError instanceof Error ? queueError.message : 'Queue failed'
    }
  });

  return {
    status: 'failed',
    error: queueError instanceof Error ? queueError.message : 'Queue failed',
  };
}
```

**Step 7: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/api/slskd-downloads.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/src/routes/slskd.ts apps/api/src/services/slskd-subscription-processor.ts apps/api/tests/api/slskd-downloads.test.ts
git commit -m "fix(slskd): add transaction safety to prevent orphaned downloads

- Add queued_locally status to track pre-queue state
- Create DB records before queuing in slskd
- Update to pending on success, failed on error
- Prevents orphaned downloads in either system
- Test: verify failed queue marks downloads as failed"
```

---

## Phase 4: Correctness

### Task 5: Fix Completion Tracking

**Files:**
- Modify: `apps/api/src/services/slskd-organizer.ts`
- Test: `apps/api/tests/services/slskd-organizer.test.ts`

**Step 1: Write failing test for completion tracking**

File: `apps/api/tests/services/slskd-organizer.test.ts`

Add test:

```typescript
describe('organizeFile - completion tracking', () => {
  it('should set status to completed after successful organization', async () => {
    const download = await prisma.slskdDownload.create({
      data: {
        connectionId: 1,
        username: 'testuser',
        filename: 'song.mp3',
        fileSize: 5000000,
        artistName: 'Test Artist',
        albumName: 'Test Album',
        status: 'downloading',
        downloadPath: '/data/slskd/downloads/testuser/Test Artist - Test Album/song.mp3',
      },
    });

    const organizer = new SlskdOrganizerService({
      downloadDir: '/data/slskd/downloads',
      musicLibraryDir: '/data/plex/music',
    });

    const finalPath = await organizer.organizeFile(download.id);

    const updated = await prisma.slskdDownload.findUnique({
      where: { id: download.id }
    });

    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeDefined();
    expect(updated?.finalPath).toBe(finalPath);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/slskd-organizer.test.ts`
Expected: FAIL - status not updated to completed

**Step 3: Update organizeFile to set completed status**

File: `apps/api/src/services/slskd-organizer.ts`

Find the end of `organizeFile()` method and update the database update:

```typescript
async organizeFile(downloadId: number): Promise<string> {
  // ... existing organization logic ...
  
  // Update download record with final path and completed status
  await prisma.slskdDownload.update({
    where: { id: downloadId },
    data: {
      finalPath,
      status: 'completed',
      completedAt: new Date(),
    },
  });

  return finalPath;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/slskd-organizer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd-organizer.ts apps/api/tests/services/slskd-organizer.test.ts
git commit -m "fix(slskd): set completed status after successful organization

- Update status to completed after organizeFile succeeds
- Set completedAt timestamp
- Downloads now show completed in UI
- Test: verify status and timestamp updated"
```

---

### Task 6: Fix Poll/Webhook Race Condition

**Files:**
- Modify: `apps/api/prisma/schema.prisma:499-506`
- Modify: `apps/api/src/jobs/slskd-poll.ts:76-101`
- Modify: `apps/api/src/routes/slskd.ts:370-415`
- Test: `apps/api/tests/jobs/slskd-poll.test.ts`

**Step 1: Add organizing status to schema**

File: `apps/api/prisma/schema.prisma`

Update SlskdDownloadStatus enum:

```prisma
enum SlskdDownloadStatus {
  queued_locally
  pending
  downloading
  organizing
  completed
  failed
  cancelled
}
```

**Step 2: Run Prisma migration**

Run: `cd apps/api && npx prisma db push`
Expected: Schema updated successfully

**Step 3: Write failing test for race condition**

File: `apps/api/tests/jobs/slskd-poll.test.ts`

Add test:

```typescript
describe('race condition prevention', () => {
  it('should not organize the same download twice', async () => {
    const download = await prisma.slskdDownload.create({
      data: {
        connectionId: 1,
        username: 'testuser',
        filename: 'song.mp3',
        fileSize: 5000000,
        artistName: 'Test Artist',
        status: 'downloading',
      },
    });

    const mockOrganizer = {
      organizeFile: vi.fn().mockResolvedValue('/final/path/song.mp3'),
    };

    // Simulate both poll and webhook trying to organize
    const promise1 = pollSlskdDownloads();
    const promise2 = pollSlskdDownloads();

    await Promise.all([promise1, promise2]);

    // organizeFile should only be called once
    expect(mockOrganizer.organizeFile).toHaveBeenCalledTimes(1);
    expect(mockOrganizer.organizeFile).toHaveBeenCalledWith(download.id);
  });
});
```

**Step 4: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/jobs/slskd-poll.test.ts`
Expected: FAIL - organizeFile called twice

**Step 5: Update poll job with atomic update**

File: `apps/api/src/jobs/slskd-poll.ts`

Find the Completed state handling (around line 76-101) and replace:

```typescript
if (slskdStatus.state === 'Completed') {
  // Download finished - use atomic update to prevent race
  const downloadPath = `${downloadDir}/${download.username}/${slskdStatus.directory}/${basename}`;

  // Atomic: only update if still 'downloading'
  const updated = await prisma.slskdDownload.updateMany({
    where: {
      id: download.id,
      status: 'downloading',  // Condition - only update if still downloading
    },
    data: {
      status: 'organizing',
      downloadPath,
    },
  });

  if (updated.count === 0) {
    // Another process (webhook or concurrent poll) beat us to it
    log.debug('Download already being organized by another process', { downloadId: download.id });
    continue;
  }

  // We won the race - proceed with organization
  try {
    await organizer.organizeFile(download.id);
    log.info('Organized completed slskd download', { downloadId: download.id });
  } catch (error) {
    log.error('Failed to organize download', { downloadId: download.id, error });
    await prisma.slskdDownload.update({
      where: { id: download.id },
      data: { status: 'failed', error: String(error) },
    });
  }
}
```

**Step 6: Update webhook with same atomic pattern**

File: `apps/api/src/routes/slskd.ts`

Find the webhook organization section (after path validation) and update:

```typescript
// Find matching download record
const download = await prisma.slskdDownload.findFirst({
  where: {
    username,
    filename: { contains: path.basename(filename) },
    status: { in: ['pending', 'downloading'] },
  },
});

if (!download) {
  log.warn('Webhook for unknown download', { username, filename });
  res.json({ success: true, matched: false });
  return;
}

// Atomic update: only transition from downloading to organizing
const updated = await prisma.slskdDownload.updateMany({
  where: {
    id: download.id,
    status: { in: ['pending', 'downloading'] },  // Condition
  },
  data: {
    status: 'organizing',
    downloadPath,
  },
});

if (updated.count === 0) {
  log.debug('Download already being organized', { downloadId: download.id });
  res.json({ success: true, alreadyOrganizing: true });
  return;
}

// We won the race - trigger organization
const organizer = new SlskdOrganizerService({ downloadDir, musicLibraryDir });

try {
  const finalPath = await organizer.organizeFile(download.id);
  log.info('Webhook triggered file organization', { downloadId: download.id, finalPath });
  res.json({ success: true, organized: true, finalPath });
} catch (orgError) {
  log.error('Webhook organization failed', { downloadId: download.id, error: orgError });
  await prisma.slskdDownload.update({
    where: { id: download.id },
    data: { status: 'failed', error: String(orgError) },
  });
  res.status(500).json({ error: 'Organization failed' });
}
```

**Step 7: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/jobs/slskd-poll.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/src/jobs/slskd-poll.ts apps/api/src/routes/slskd.ts apps/api/tests/jobs/slskd-poll.test.ts
git commit -m "fix(slskd): prevent race condition between poll and webhook

- Add organizing status to SlskdDownloadStatus enum
- Use atomic updateMany with status condition
- Only one process transitions downloading → organizing
- Losing process skips gracefully
- Test: verify organizeFile called exactly once with concurrent execution"
```

---

## Phase 5: Reliability & Performance

### Task 7: Add Search Retry Logic

**Files:**
- Modify: `apps/api/src/services/slskd-subscription-processor.ts:169-230`
- Test: `apps/api/tests/services/slskd-subscription-processor.test.ts`

**Step 1: Write failing test for retry logic**

File: `apps/api/tests/services/slskd-subscription-processor.test.ts`

Add tests:

```typescript
describe('retry logic', () => {
  it('should retry on timeout and succeed on second attempt', async () => {
    let attempt = 0;
    
    mockSlskdService.search.mockImplementation(() => {
      attempt++;
      return Promise.resolve({
        id: `search${attempt}`,
        searchText: 'Test Artist',
        state: 'Requested',
      });
    });
    
    mockSlskdService.getSearchResults.mockImplementation((searchId) => {
      if (searchId === 'search1') {
        // First attempt times out
        return Promise.resolve({
          id: searchId,
          state: 'TimedOut',
          responses: [],
        });
      } else {
        // Second attempt succeeds
        return Promise.resolve({
          id: searchId,
          state: 'Completed',
          responses: [{
            username: 'testuser',
            files: [{ filename: 'track.mp3', size: 5000000 }],
            uploadSpeed: 1000000,
            queueLength: 5,
            hasFreeUploadSlot: true,
          }],
        });
      }
    });

    mockSlskdService.queueDownload.mockResolvedValue(undefined);

    const result = await processor.processArtist(
      { name: 'Test Artist' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );

    expect(result.status).toBe('queued');
    expect(attempt).toBe(2); // Retried once
  });

  it('should fail after max retries exceeded', async () => {
    mockSlskdService.search.mockResolvedValue({
      id: 'search123',
      searchText: 'Test Artist',
      state: 'Requested',
    });
    
    mockSlskdService.getSearchResults.mockResolvedValue({
      id: 'search123',
      state: 'TimedOut',
      responses: [],
    });

    const result = await processor.processArtist(
      { name: 'Test Artist' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('after retries');
  });

  it('should not retry on not found', async () => {
    let searchCount = 0;
    
    mockSlskdService.search.mockImplementation(() => {
      searchCount++;
      return Promise.resolve({
        id: 'search123',
        searchText: 'Test Artist',
        state: 'Requested',
      });
    });
    
    mockSlskdService.getSearchResults.mockResolvedValue({
      id: 'search123',
      state: 'Completed',
      responses: [], // No results
    });

    const result = await processor.processArtist(
      { name: 'Test Artist' },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } }
    );

    expect(result.status).toBe('not_found');
    expect(searchCount).toBe(1); // No retries for not found
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/slskd-subscription-processor.test.ts -t "retry"`
Expected: FAIL - no retry logic implemented

**Step 3: Add retry loop to processArtist**

File: `apps/api/src/services/slskd-subscription-processor.ts`

Replace the `processArtist` method (around line 169-230):

```typescript
async processArtist(
  artist: { name: string; mbid?: string; album?: string },
  options: ProcessOptions
): Promise<ProcessResult> {
  const { connectionId, preferences } = options;
  const searchQuery = artist.album 
    ? `${artist.name} ${artist.album}`
    : artist.name;

  const maxRetries = 3;
  const retryDelay = 30000; // 30 seconds

  log.debug('Processing artist via slskd', { artist: artist.name, query: searchQuery });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Start search
      const search = await this.slskdService.search(searchQuery, {
        filterResponses: true,
        minimumResponseFileCount: 3, // At least a few tracks
      });

      // Wait for results
      const searchResult = await this.waitForSearch(search.id);

      if (!searchResult.completed) {
        // Search failed or timed out
        if (searchResult.timedOut && attempt < maxRetries) {
          log.warn('Search timed out, retrying', {
            artist: artist.name,
            attempt: attempt + 1,
            maxRetries,
          });
          await this.sleep(retryDelay);
          continue; // Retry
        }

        return {
          status: 'failed',
          error: searchResult.timedOut
            ? 'Search timed out after retries'
            : 'Search failed or was cancelled',
          searchResultCount: 0,
        };
      }

      if (searchResult.responses.length === 0) {
        log.debug('No results found', { artist: artist.name });
        return { 
          status: 'not_found', 
          searchResultCount: 0,
        };
      }

      // Select best result
      const bestResult = this.selectBestResult(searchResult.responses, preferences);
      
      if (!bestResult) {
        return { 
          status: 'not_found', 
          searchResultCount: searchResult.responses.length,
        };
      }

      // Queue download (with transaction safety from Task 4)
      const filesToDownload: Pick<SlskdFile, 'filename' | 'size'>[] = bestResult.files.map(f => ({
        filename: f.filename,
        size: f.size,
      }));

      // Create records with queued_locally status
      const downloads = await Promise.all(
        filesToDownload.map(file =>
          prisma.slskdDownload.create({
            data: {
              connectionId,
              artistName: artist.name,
              albumName: artist.album,
              username: bestResult.username,
              filename: file.filename,
              fileSize: file.size,
              searchId: search.id,
              status: 'queued_locally',
            },
          })
        )
      );

      try {
        await this.slskdService.queueDownload(bestResult.username, filesToDownload);

        // Update to pending on success
        await prisma.slskdDownload.updateMany({
          where: { id: { in: downloads.map(d => d.id) } },
          data: { status: 'pending' }
        });

        log.info('Queued slskd download', { 
          artist: artist.name, 
          username: bestResult.username,
          fileCount: filesToDownload.length,
          downloadIds: downloads.map(d => d.id),
        });

        return { 
          status: 'queued', 
          downloadId: downloads[0]?.id,
          searchResultCount: searchResult.responses.length,
        };
      } catch (queueError) {
        // Queue failed - mark as failed
        await prisma.slskdDownload.updateMany({
          where: { id: { in: downloads.map(d => d.id) } },
          data: {
            status: 'failed',
            error: queueError instanceof Error ? queueError.message : 'Queue failed'
          }
        });

        return {
          status: 'failed',
          error: queueError instanceof Error ? queueError.message : 'Queue failed',
        };
      }

    } catch (error) {
      // Network error or other exception - retry if attempts remain
      if (attempt < maxRetries) {
        log.warn('Search error, retrying', {
          artist: artist.name,
          attempt: attempt + 1,
          maxRetries,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(retryDelay);
        continue;
      }

      log.error('Failed to process artist via slskd', { 
        artist: artist.name, 
        error: error instanceof Error ? error.message : String(error),
      });
      return { 
        status: 'failed', 
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Should never reach here, but TypeScript needs a return
  return { status: 'failed', error: 'Max retries exceeded' };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/slskd-subscription-processor.test.ts -t "retry"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd-subscription-processor.ts apps/api/tests/services/slskd-subscription-processor.test.ts
git commit -m "feat(slskd): add retry logic for transient search failures

- Retry timeout and network errors up to 3 times
- 30 second delay between retries
- Do not retry on not_found (valid result)
- Log retry attempts with context
- Tests: verify retry on timeout, fail after max, no retry on not_found"
```

---

### Task 8: Optimize Search Modal Polling

**Files:**
- Modify: `apps/web/src/components/slskd/SearchModal.tsx:124-142`

**Step 1: Update polling logic with exponential backoff**

File: `apps/web/src/components/slskd/SearchModal.tsx`

Replace the useEffect that polls for results (around line 124-142):

```typescript
// Poll for results with exponential backoff
useEffect(() => {
  if (!searchId) return;
  
  let pollDelay = 2000; // Start at 2 seconds
  const maxDelay = 10000; // Max 10 seconds
  const backoffMultiplier = 1.5;
  let timeoutId: NodeJS.Timeout;
  
  const poll = async () => {
    try {
      const { data, error } = await api.get<SlskdSearchResult>(`/api/slskd/search/${searchId}`);
      if (error) throw new Error(error);
      
      if (data) {
        setResults(data);
        
        // Stop polling when complete or errored
        if (data.state === 'Completed' || data.state === 'Errored') {
          setIsSearching(false);
          setSearchId(null);
          return; // Don't schedule next poll
        }
        
        // Schedule next poll with exponentially increased delay
        pollDelay = Math.min(pollDelay * backoffMultiplier, maxDelay);
        timeoutId = setTimeout(poll, pollDelay);
      }
    } catch (err) {
      console.error('Failed to poll search results:', err);
      // Continue polling even on error
      timeoutId = setTimeout(poll, pollDelay);
    }
  };
  
  // Start first poll
  timeoutId = setTimeout(poll, pollDelay);
  
  return () => clearTimeout(timeoutId);
}, [searchId]);
```

**Step 2: Run TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual testing**

Since this is UI behavior, manual test:
1. Start dev server: `npm run dev`
2. Open search modal
3. Observe network tab: polls should be 2s, 3s, 4.5s, 6.75s, 10s intervals
4. Search should stop polling when complete

**Step 4: Commit**

```bash
git add apps/web/src/components/slskd/SearchModal.tsx
git commit -m "perf(slskd): optimize search modal polling with exponential backoff

- Start at 2s, multiply by 1.5x each poll, max 10s
- Stop immediately when search completes
- Reduces API calls from 15 → ~8-9 per 30s search
- More responsive for quick searches, less load for long searches"
```

---

### Task 9: Rate Limit Webhook Endpoint

**Files:**
- Modify: `apps/api/src/routes/slskd.ts:346`
- Test: `apps/api/tests/security/slskd-security.test.ts`

**Step 1: Write failing test for rate limiting**

File: `apps/api/tests/security/slskd-security.test.ts`

Add test:

```typescript
describe('webhook rate limiting', () => {
  it('should rate limit excessive webhook requests', async () => {
    const requests = [];
    
    // Send 100 requests rapidly
    for (let i = 0; i < 100; i++) {
      requests.push(
        request(app)
          .post('/api/slskd/webhook')
          .send({
            event: 'DownloadComplete',
            username: 'testuser',
            directory: 'album',
            filename: `track${i}.mp3`,
          })
      );
    }
    
    const responses = await Promise.all(requests);
    
    // Some should be rate limited (429)
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/security/slskd-security.test.ts -t "rate limit"`
Expected: FAIL - all requests succeed (no rate limiting)

**Step 3: Apply rate limiting to webhook**

File: `apps/api/src/routes/slskd.ts`

Add rate limit middleware to webhook route (find the route around line 346):

```typescript
import { rateLimit } from '../middleware/rate-limit.js';

// ... other routes ...

/**
 * POST /api/slskd/webhook - Receive slskd completion events
 * 
 * Rate limited to 60 requests/minute to prevent abuse
 */
router.post('/webhook', rateLimit({ max: 60, window: 60000 }), async (req: Request, res: Response) => {
  // ... existing webhook logic
});
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/security/slskd-security.test.ts -t "rate limit"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/routes/slskd.ts apps/api/tests/security/slskd-security.test.ts
git commit -m "feat(security): add rate limiting to slskd webhook endpoint

- Limit to 60 requests/minute
- Prevents webhook spam attacks
- Defense in depth (even without auth)
- Test: verify rate limit enforced on excessive requests"
```

---

## Final Steps

### Verification

**Step 1: Run full test suite**

Run: `cd apps/api && npm test`
Expected: All tests passing (should be ~66 slskd tests total)

**Step 2: Run TypeScript checks**

Run:
```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
Expected: No errors

**Step 3: Check git status**

Run: `git status`
Expected: Clean working tree (all changes committed)

**Step 4: Review commits**

Run: `git log --oneline -9`
Expected: 9 commits (one per task)

---

## Success Criteria

- [ ] All 9 tasks completed
- [ ] All tests passing (~66 total for slskd)
- [ ] TypeScript compiles with no errors
- [ ] All changes committed with descriptive messages
- [ ] Users can configure slskd connections in UI
- [ ] Downloads create consistent per-file records
- [ ] Path traversal attacks blocked
- [ ] No orphaned downloads possible
- [ ] Downloads show completed status
- [ ] No duplicate organization (race-free)
- [ ] Search failures retry automatically
- [ ] Polling optimized (reduced API calls)
- [ ] Webhook rate limited

---

**Plan saved to:** `docs/plans/2026-01-08-slskd-fixes-plan.md`
