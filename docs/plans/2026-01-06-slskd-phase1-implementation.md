# slskd Integration Phase 1: Foundation (MVP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Basic slskd connection and manual search/download functionality

**Architecture:** Add slskd as a new connection type following existing patterns (Jellyfin, TIDAL). Create SlskdService for API interactions. Add search modal UI with quality filtering. Track downloads in new database table.

**Tech Stack:** TypeScript, Prisma, Express, React, slskd REST API

**Reference Design:** `docs/plans/2026-01-06-slskd-integration-design.md`

---

## Task 1: Add slskd to ConnectionType enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/YYYYMMDD000001_add_slskd_support/migration.sql`

**Step 1: Update schema.prisma**

Add `slskd` to the ConnectionType enum (around line 125):

```prisma
enum ConnectionType {
  lidarr
  spotify
  lastfm
  tautulli
  deezer
  tidal
  listenbrainz
  discogs
  jellyfin
  slskd
}
```

**Step 2: Create migration file**

Run: `cd apps/api && npx prisma migrate dev --name add_slskd_support`

This generates the migration SQL automatically.

**Step 3: Verify migration**

Run: `cd apps/api && npx prisma generate`
Expected: Prisma client regenerated without errors

**Step 4: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add slskd to ConnectionType enum"
```

---

## Task 2: Add slskd connection schema

**Files:**
- Modify: `apps/api/src/schemas/connection.ts`
- Test: `apps/api/tests/types/connections.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/types/connections.test.ts`:

```typescript
describe('slskd connection type', () => {
  it('should be a valid connection type', () => {
    expect(connectionTypes).toContain('slskd');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- --run tests/types/connections.test.ts`
Expected: FAIL - 'slskd' not in connectionTypes

**Step 3: Add slskd to connection types**

In `apps/api/src/schemas/connection.ts`, add 'slskd' to the array:

```typescript
export const connectionTypes = [
  'lidarr',
  'spotify',
  'lastfm',
  'tautulli',
  'deezer',
  'tidal',
  'listenbrainz',
  'discogs',
  'jellyfin',
  'slskd',
] as const;
```

**Step 4: Add config schema**

Add after `jellyfinConfigSchema`:

```typescript
export const slskdConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  downloadDir: z.string(),
  musicLibraryDir: z.string(),
  // Quality profile
  minQuality: z.enum(['any', 'mp3-128', 'mp3-256', 'mp3-320', 'lossless']).default('mp3-320'),
  preferredQuality: z.enum(['highest', 'flac', 'mp3-320', 'mp3-256']).default('highest'),
  requireCompleteAlbums: z.boolean().default(false),
  minTrackCount: z.number().int().min(1).default(3),
  minSourceFiles: z.number().int().min(0).default(100),
  // Rate limits
  artistsPerRun: z.number().int().min(1).max(100).default(25),
  searchDelaySeconds: z.number().int().min(5).max(120).default(30),
});
```

**Step 5: Run test to verify it passes**

Run: `cd apps/api && npm test -- --run tests/types/connections.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/schemas/connection.ts apps/api/tests/types/connections.test.ts
git commit -m "feat(schema): add slskd connection schema and validation"
```

---

## Task 3: Create SlskdService - Connection Test

**Files:**
- Create: `apps/api/src/services/slskd.ts`
- Create: `apps/api/tests/services/slskd.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/services/slskd.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('SlskdService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create service instance with config', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'test-key',
      });
      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success for valid API key', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          version: '0.24.1',
          versionCurrent: true,
        }),
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'valid-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.24.1');
    });

    it('should return error for invalid API key', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'invalid-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });

    it('should handle network errors', async () => {
      const { SlskdService } = await import('../../src/services/slskd.js');
      
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new SlskdService({
        url: 'http://localhost:5030',
        apiKey: 'test-key',
      });
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: FAIL - module not found

**Step 3: Create minimal SlskdService**

Create `apps/api/src/services/slskd.ts`:

```typescript
/**
 * slskd Service
 * 
 * Handles all interactions with the slskd API for Soulseek network access.
 * API Documentation: https://github.com/slskd/slskd (see API controllers)
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('slskd');

export interface SlskdConfig {
  url: string;
  apiKey: string;
}

export interface SlskdConnectionResult {
  success: boolean;
  error?: string;
  version?: string;
}

export class SlskdService {
  private url: string;
  private apiKey: string;

  constructor(config: SlskdConfig) {
    // Normalize URL (remove trailing slash)
    this.url = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async testConnection(): Promise<SlskdConnectionResult> {
    try {
      const response = await this.callApi<{ version: string; versionCurrent: boolean }>(
        '/api/v0/application'
      );
      return { 
        success: true, 
        version: response.version,
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private async callApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    await rateLimit('slskd');

    const url = `${this.url}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`slskd API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd.test.ts
git commit -m "feat(slskd): add SlskdService with connection test"
```

---

## Task 4: Add slskd search functionality

**Files:**
- Modify: `apps/api/src/services/slskd.ts`
- Modify: `apps/api/tests/services/slskd.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/services/slskd.test.ts`:

```typescript
describe('search', () => {
  it('should start a search and return search id', async () => {
    const { SlskdService } = await import('../../src/services/slskd.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'InProgress',
      }),
    });

    const service = new SlskdService({
      url: 'http://localhost:5030',
      apiKey: 'valid-key',
    });
    const result = await service.search('Pink Floyd');

    expect(result.id).toBe('search-123');
    expect(result.searchText).toBe('Pink Floyd');
  });
});

describe('getSearchResults', () => {
  it('should return search results when complete', async () => {
    const { SlskdService } = await import('../../src/services/slskd.js');
    
    const mockResults = {
      id: 'search-123',
      searchText: 'Pink Floyd',
      state: 'Completed',
      responses: [
        {
          username: 'user1',
          files: [
            { filename: '01 - Breathe.flac', size: 45000000 },
            { filename: '02 - On The Run.flac', size: 32000000 },
          ],
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResults),
    });

    const service = new SlskdService({
      url: 'http://localhost:5030',
      apiKey: 'valid-key',
    });
    const result = await service.getSearchResults('search-123');

    expect(result.state).toBe('Completed');
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].username).toBe('user1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: FAIL - search method not defined

**Step 3: Add search methods to SlskdService**

Add to `apps/api/src/services/slskd.ts`:

```typescript
// Add these interfaces after SlskdConnectionResult

export interface SlskdSearchRequest {
  searchText: string;
  filterResponses?: boolean;
  maximumPeerQueueLength?: number;
  minimumPeerUploadSpeed?: number;
  minimumResponseFileCount?: number;
  responseLimit?: number;
  fileLimit?: number;
}

export interface SlskdFile {
  filename: string;
  size: number;
  code?: number;
  extension?: string;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  length?: number;
  isLocked?: boolean;
}

export interface SlskdSearchResponse {
  username: string;
  endpoint?: string;
  token?: number;
  hasFreeUploadSlot?: boolean;
  uploadSpeed?: number;
  queueLength?: number;
  fileCount?: number;
  lockedFileCount?: number;
  files: SlskdFile[];
  lockedFiles?: SlskdFile[];
}

export interface SlskdSearch {
  id: string;
  searchText: string;
  state: 'None' | 'Requested' | 'InProgress' | 'Completed' | 'Cancelled' | 'TimedOut' | 'Errored';
  startedAt?: string;
  endedAt?: string;
  responseCount?: number;
  fileCount?: number;
  responses?: SlskdSearchResponse[];
}

// Add these methods to the SlskdService class

async search(query: string, options?: Partial<SlskdSearchRequest>): Promise<SlskdSearch> {
  const request: SlskdSearchRequest = {
    searchText: query,
    filterResponses: true,
    ...options,
  };

  log.info('Starting slskd search', { query });
  
  return this.callApi<SlskdSearch>('/api/v0/searches', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

async getSearchResults(searchId: string, includeResponses = true): Promise<SlskdSearch> {
  const endpoint = includeResponses 
    ? `/api/v0/searches/${searchId}?includeResponses=true`
    : `/api/v0/searches/${searchId}`;
  
  return this.callApi<SlskdSearch>(endpoint);
}

async cancelSearch(searchId: string): Promise<void> {
  await this.callApi<void>(`/api/v0/searches/${searchId}`, {
    method: 'PUT',
  });
}

async deleteSearch(searchId: string): Promise<void> {
  await this.callApi<void>(`/api/v0/searches/${searchId}`, {
    method: 'DELETE',
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd.test.ts
git commit -m "feat(slskd): add search and getSearchResults methods"
```

---

## Task 5: Add slskd download functionality

**Files:**
- Modify: `apps/api/src/services/slskd.ts`
- Modify: `apps/api/tests/services/slskd.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/services/slskd.test.ts`:

```typescript
describe('queueDownload', () => {
  it('should queue files for download', async () => {
    const { SlskdService } = await import('../../src/services/slskd.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({}),
    });

    const service = new SlskdService({
      url: 'http://localhost:5030',
      apiKey: 'valid-key',
    });

    const files = [
      { filename: '/music/Pink Floyd/The Wall/01 - In The Flesh.flac', size: 45000000 },
      { filename: '/music/Pink Floyd/The Wall/02 - The Thin Ice.flac', size: 32000000 },
    ];

    await expect(service.queueDownload('user1', files)).resolves.not.toThrow();
    
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v0/transfers/downloads/user1'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getDownloads', () => {
  it('should return list of downloads', async () => {
    const { SlskdService } = await import('../../src/services/slskd.js');
    
    const mockDownloads = [
      {
        username: 'user1',
        directories: [
          {
            directory: '/music/Pink Floyd/The Wall',
            fileCount: 2,
            files: [
              { id: 'dl-1', filename: '01 - In The Flesh.flac', state: 'Completed, Succeeded' },
              { id: 'dl-2', filename: '02 - The Thin Ice.flac', state: 'InProgress' },
            ],
          },
        ],
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDownloads),
    });

    const service = new SlskdService({
      url: 'http://localhost:5030',
      apiKey: 'valid-key',
    });
    const result = await service.getDownloads();

    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('user1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: FAIL - queueDownload method not defined

**Step 3: Add download methods to SlskdService**

Add to `apps/api/src/services/slskd.ts`:

```typescript
// Add these interfaces

export interface SlskdDownloadRequest {
  filename: string;
  size: number;
}

export interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  direction: 'Download' | 'Upload';
  state: string;
  size: number;
  bytesTransferred?: number;
  averageSpeed?: number;
  startedAt?: string;
  endedAt?: string;
  elapsedTime?: string;
  remainingTime?: string;
  percentComplete?: number;
  exception?: string;
}

export interface SlskdDirectory {
  directory: string;
  fileCount: number;
  files: SlskdTransfer[];
}

export interface SlskdUserDownloads {
  username: string;
  directories: SlskdDirectory[];
}

// Add these methods to SlskdService class

async queueDownload(username: string, files: SlskdDownloadRequest[]): Promise<void> {
  log.info('Queueing slskd download', { username, fileCount: files.length });
  
  await this.callApi<void>(`/api/v0/transfers/downloads/${encodeURIComponent(username)}`, {
    method: 'POST',
    body: JSON.stringify(files),
  });
}

async getDownloads(includeRemoved = false): Promise<SlskdUserDownloads[]> {
  return this.callApi<SlskdUserDownloads[]>(
    `/api/v0/transfers/downloads?includeRemoved=${includeRemoved}`
  );
}

async cancelDownload(username: string, id: string, remove = false): Promise<void> {
  await this.callApi<void>(
    `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${id}?remove=${remove}`,
    { method: 'DELETE' }
  );
}

async clearCompletedDownloads(): Promise<void> {
  await this.callApi<void>('/api/v0/transfers/downloads/all/completed', {
    method: 'DELETE',
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- --run tests/services/slskd.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/slskd.ts apps/api/tests/services/slskd.test.ts
git commit -m "feat(slskd): add download queue and management methods"
```

---

## Task 6: Add slskd connection test route

**Files:**
- Modify: `apps/api/src/routes/connections.ts`

**Step 1: Add slskd case to connection test route**

In `apps/api/src/routes/connections.ts`, find the `POST /test` route (around line 130) and add after the `case 'jellyfin':` block:

```typescript
      case 'slskd': {
        const config = req.body.config || {};
        const slskdUrl = config.url;
        const slskdApiKey = config.apiKey;
        
        if (!slskdUrl || !slskdApiKey) {
          res.status(400).json({ success: false, error: 'slskd URL and API key required' });
          return;
        }
        const { SlskdService } = await import('../services/slskd.js');
        const service = new SlskdService({ url: slskdUrl, apiKey: slskdApiKey });
        const testResult = await service.testConnection();
        if (!testResult.success) {
          res.json({ success: false, error: testResult.error || 'Connection failed' });
          return;
        }
        res.json({ success: true, message: `Connected to slskd v${testResult.version}` });
        return;
      }
```

**Step 2: Add slskd case to authenticated test route**

Find the second connection test switch (around line 540) and add after `case 'jellyfin':`:

```typescript
      case 'slskd': {
        const { SlskdService } = await import('../services/slskd.js');
        const service = new SlskdService({
          url: config.url,
          apiKey: config.apiKey,
        });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected to slskd v${testResult.version}` 
            : testResult.error || 'Connection failed',
        };
        break;
      }
```

**Step 3: Run type check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/api/src/routes/connections.ts
git commit -m "feat(routes): add slskd connection test endpoints"
```

---

## Task 7: Create SlskdDownload database model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create migration

**Step 1: Add SlskdDownload model to schema.prisma**

Add before the final closing comment in `apps/api/prisma/schema.prisma`:

```prisma
// ============================================================================
// SLSKD DOWNLOADS
// ============================================================================

model SlskdDownload {
  id               Int            @id @default(autoincrement())
  connectionId     Int            @map("connection_id")
  slskdTransferId  String?        @map("slskd_transfer_id") @db.VarChar(100)
  
  // What we were looking for
  artistName       String         @map("artist_name") @db.VarChar(255)
  albumName        String?        @map("album_name") @db.VarChar(255)
  
  // Source info
  sourceUser       String         @map("source_user") @db.VarChar(255)
  sourcePath       String         @map("source_path") @db.Text
  
  // Status tracking
  status           SlskdDownloadStatus @default(queued)
  errorMessage     String?        @map("error_message") @db.Text
  
  // File info
  fileCount        Int            @default(0) @map("file_count")
  totalSize        BigInt         @default(0) @map("total_size")
  
  // Final destination
  destinationPath  String?        @map("destination_path") @db.Text
  
  // Timestamps
  queuedAt         DateTime       @default(now()) @map("queued_at")
  completedAt      DateTime?      @map("completed_at")
  organizedAt      DateTime?      @map("organized_at")

  @@index([connectionId])
  @@index([status])
  @@index([queuedAt])
  @@map("slskd_downloads")
}

enum SlskdDownloadStatus {
  queued
  downloading
  completed
  failed
  organized
}
```

**Step 2: Create migration**

Run: `cd apps/api && npx prisma migrate dev --name add_slskd_downloads`

**Step 3: Verify migration**

Run: `cd apps/api && npx prisma generate`
Expected: Prisma client regenerated without errors

**Step 4: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add SlskdDownload model for download tracking"
```

---

## Task 8: Create slskd API routes

**Files:**
- Create: `apps/api/src/routes/slskd.ts`
- Modify: `apps/api/src/index.ts`

**Step 1: Create slskd routes file**

Create `apps/api/src/routes/slskd.ts`:

```typescript
/**
 * slskd Routes
 * 
 * API endpoints for slskd integration - search, download, and status.
 */

import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { SlskdService } from '../services/slskd.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SlskdRoute');

export const slskdRouter = Router();

// All slskd routes require authentication
slskdRouter.use(requireAuth);

// Helper: Get slskd service from connection
async function getSlskdService(userId: number): Promise<SlskdService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'slskd', isActive: true },
        { userId: null, type: 'slskd', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' }, // Prefer user's connection over global
  });

  if (!connection) {
    return null;
  }

  const config = connection.config as { url: string; apiKey: string };
  return new SlskdService({ url: config.url, apiKey: config.apiKey });
}

// POST /api/slskd/search - Start a search
slskdRouter.post('/search', async (req, res) => {
  try {
    const service = await getSlskdService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No slskd connection configured' });
      return;
    }

    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query string required' });
      return;
    }

    const result = await service.search(query);
    res.json(result);
  } catch (error) {
    logger.error('slskd search error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Search failed' 
    });
  }
});

// GET /api/slskd/search/:id - Get search results
slskdRouter.get('/search/:id', async (req, res) => {
  try {
    const service = await getSlskdService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No slskd connection configured' });
      return;
    }

    const result = await service.getSearchResults(req.params.id);
    res.json(result);
  } catch (error) {
    logger.error('slskd get search error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get results' 
    });
  }
});

// DELETE /api/slskd/search/:id - Cancel/delete a search
slskdRouter.delete('/search/:id', async (req, res) => {
  try {
    const service = await getSlskdService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No slskd connection configured' });
      return;
    }

    await service.deleteSearch(req.params.id);
    res.status(204).send();
  } catch (error) {
    logger.error('slskd delete search error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to delete search' 
    });
  }
});

// POST /api/slskd/download - Queue a download
slskdRouter.post('/download', async (req, res) => {
  try {
    const service = await getSlskdService(req.user!.id);
    if (!service) {
      res.status(404).json({ error: 'No slskd connection configured' });
      return;
    }

    const { username, files, artistName, albumName } = req.body;
    
    if (!username || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Username and files array required' });
      return;
    }

    // Queue download in slskd
    await service.queueDownload(username, files);

    // Get connection for tracking
    const connection = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId: req.user!.id, type: 'slskd', isActive: true },
          { userId: null, type: 'slskd', isActive: true },
        ],
      },
      orderBy: { userId: 'desc' },
    });

    // Track download in our database
    const download = await prisma.slskdDownload.create({
      data: {
        connectionId: connection!.id,
        artistName: artistName || 'Unknown Artist',
        albumName: albumName || null,
        sourceUser: username,
        sourcePath: files[0]?.filename || '',
        fileCount: files.length,
        totalSize: files.reduce((sum: number, f: { size?: number }) => sum + (f.size || 0), 0),
        status: 'queued',
      },
    });

    logger.info('Queued slskd download', { 
      downloadId: download.id, 
      username, 
      fileCount: files.length 
    });

    res.status(201).json(download);
  } catch (error) {
    logger.error('slskd queue download error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to queue download' 
    });
  }
});

// GET /api/slskd/downloads - Get tracked downloads
slskdRouter.get('/downloads', async (req, res) => {
  try {
    const downloads = await prisma.slskdDownload.findMany({
      orderBy: { queuedAt: 'desc' },
      take: 100,
    });
    res.json(downloads);
  } catch (error) {
    logger.error('slskd get downloads error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get downloads' 
    });
  }
});

// DELETE /api/slskd/downloads/:id - Cancel a download
slskdRouter.delete('/downloads/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid download ID' });
      return;
    }

    const download = await prisma.slskdDownload.findUnique({ where: { id } });
    if (!download) {
      res.status(404).json({ error: 'Download not found' });
      return;
    }

    // Try to cancel in slskd if we have a transfer ID
    if (download.slskdTransferId) {
      const service = await getSlskdService(req.user!.id);
      if (service) {
        try {
          await service.cancelDownload(download.sourceUser, download.slskdTransferId, true);
        } catch (e) {
          // Log but don't fail - the download might already be complete/cancelled
          logger.warn('Failed to cancel in slskd', { error: e });
        }
      }
    }

    // Update status in our database
    await prisma.slskdDownload.update({
      where: { id },
      data: { status: 'failed', errorMessage: 'Cancelled by user' },
    });

    res.status(204).send();
  } catch (error) {
    logger.error('slskd cancel download error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to cancel download' 
    });
  }
});
```

**Step 2: Register routes in index.ts**

In `apps/api/src/index.ts`, add import and route registration:

```typescript
// Add import with other route imports
import { slskdRouter } from './routes/slskd.js';

// Add route registration (after other app.use statements)
app.use('/api/slskd', slskdRouter);
```

**Step 3: Run type check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/api/src/routes/slskd.ts apps/api/src/index.ts
git commit -m "feat(routes): add slskd API routes for search and download"
```

---

## Task 9: Add slskd result parsing utilities

**Files:**
- Create: `apps/api/src/utils/slskd-parser.ts`
- Create: `apps/api/tests/utils/slskd-parser.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/utils/slskd-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { 
  parseFormat, 
  parseQuality, 
  groupByFolder,
  scoreResult,
  type SlskdQualityProfile,
} from '../../src/utils/slskd-parser.js';

describe('slskd-parser', () => {
  describe('parseFormat', () => {
    it('should detect FLAC format', () => {
      expect(parseFormat('01 - Track.flac')).toBe('flac');
      expect(parseFormat('song.FLAC')).toBe('flac');
    });

    it('should detect MP3 format', () => {
      expect(parseFormat('01 - Track.mp3')).toBe('mp3');
    });

    it('should return unknown for unrecognized formats', () => {
      expect(parseFormat('document.pdf')).toBe('unknown');
    });
  });

  describe('parseQuality', () => {
    it('should classify FLAC as lossless', () => {
      expect(parseQuality('flac', undefined)).toBe('lossless');
    });

    it('should classify MP3 by bitrate', () => {
      expect(parseQuality('mp3', 320)).toBe('mp3-320');
      expect(parseQuality('mp3', 256)).toBe('mp3-256');
      expect(parseQuality('mp3', 192)).toBe('mp3-192');
      expect(parseQuality('mp3', 128)).toBe('mp3-128');
    });

    it('should default to mp3-unknown without bitrate', () => {
      expect(parseQuality('mp3', undefined)).toBe('mp3-unknown');
    });
  });

  describe('groupByFolder', () => {
    it('should group files by directory', () => {
      const files = [
        { filename: '/music/Artist/Album/01.flac', size: 1000 },
        { filename: '/music/Artist/Album/02.flac', size: 1000 },
        { filename: '/music/Artist/Other Album/01.flac', size: 1000 },
      ];

      const groups = groupByFolder(files);
      
      expect(groups).toHaveLength(2);
      expect(groups.find(g => g.folder.includes('Album'))?.files).toHaveLength(2);
      expect(groups.find(g => g.folder.includes('Other Album'))?.files).toHaveLength(1);
    });
  });

  describe('scoreResult', () => {
    const profile: SlskdQualityProfile = {
      minQuality: 'mp3-320',
      preferredQuality: 'highest',
      requireCompleteAlbums: false,
      minTrackCount: 3,
      minSourceFiles: 100,
    };

    it('should score lossless higher than lossy', () => {
      const losslessScore = scoreResult('lossless', 10, 1000);
      const mp3Score = scoreResult('mp3-320', 10, 1000);
      expect(losslessScore).toBeGreaterThan(mp3Score);
    });

    it('should score more tracks higher', () => {
      const moreTracksScore = scoreResult('flac', 12, 1000);
      const fewerTracksScore = scoreResult('flac', 5, 1000);
      expect(moreTracksScore).toBeGreaterThan(fewerTracksScore);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npm test -- --run tests/utils/slskd-parser.test.ts`
Expected: FAIL - module not found

**Step 3: Create slskd-parser utilities**

Create `apps/api/src/utils/slskd-parser.ts`:

```typescript
/**
 * slskd Result Parser Utilities
 * 
 * Helpers for parsing and scoring slskd search results.
 */

export type AudioFormat = 'flac' | 'alac' | 'wav' | 'mp3' | 'aac' | 'ogg' | 'unknown';
export type QualityLevel = 'lossless' | 'mp3-320' | 'mp3-256' | 'mp3-192' | 'mp3-128' | 'mp3-unknown' | 'lossy' | 'unknown';

export interface SlskdQualityProfile {
  minQuality: 'any' | 'mp3-128' | 'mp3-256' | 'mp3-320' | 'lossless';
  preferredQuality: 'highest' | 'flac' | 'mp3-320' | 'mp3-256';
  requireCompleteAlbums: boolean;
  minTrackCount: number;
  minSourceFiles: number;
}

export interface SlskdFileInfo {
  filename: string;
  size: number;
  bitRate?: number;
}

export interface SlskdFolderGroup {
  folder: string;
  files: SlskdFileInfo[];
  format: AudioFormat;
  quality: QualityLevel;
  trackCount: number;
  totalSize: number;
}

const FORMAT_EXTENSIONS: Record<string, AudioFormat> = {
  '.flac': 'flac',
  '.alac': 'alac',
  '.wav': 'wav',
  '.mp3': 'mp3',
  '.aac': 'aac',
  '.m4a': 'aac',
  '.ogg': 'ogg',
};

const QUALITY_SCORES: Record<QualityLevel, number> = {
  'lossless': 100,
  'mp3-320': 80,
  'mp3-256': 70,
  'mp3-192': 50,
  'mp3-128': 30,
  'mp3-unknown': 40,
  'lossy': 40,
  'unknown': 10,
};

/**
 * Parse audio format from filename
 */
export function parseFormat(filename: string): AudioFormat {
  const lower = filename.toLowerCase();
  for (const [ext, format] of Object.entries(FORMAT_EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      return format;
    }
  }
  return 'unknown';
}

/**
 * Determine quality level from format and bitrate
 */
export function parseQuality(format: AudioFormat, bitRate?: number): QualityLevel {
  if (format === 'flac' || format === 'alac' || format === 'wav') {
    return 'lossless';
  }

  if (format === 'mp3') {
    if (!bitRate) return 'mp3-unknown';
    if (bitRate >= 320) return 'mp3-320';
    if (bitRate >= 256) return 'mp3-256';
    if (bitRate >= 192) return 'mp3-192';
    return 'mp3-128';
  }

  if (format === 'aac' || format === 'ogg') {
    return 'lossy';
  }

  return 'unknown';
}

/**
 * Extract directory from file path
 */
function getDirectory(filename: string): string {
  const lastSlash = filename.lastIndexOf('/');
  const lastBackslash = filename.lastIndexOf('\\');
  const separator = Math.max(lastSlash, lastBackslash);
  
  if (separator === -1) return '';
  return filename.substring(0, separator);
}

/**
 * Check if file is an audio file
 */
function isAudioFile(filename: string): boolean {
  const format = parseFormat(filename);
  return format !== 'unknown';
}

/**
 * Group files by folder and analyze quality
 */
export function groupByFolder(files: SlskdFileInfo[]): SlskdFolderGroup[] {
  const folders = new Map<string, SlskdFileInfo[]>();

  for (const file of files) {
    if (!isAudioFile(file.filename)) continue;
    
    const folder = getDirectory(file.filename);
    if (!folders.has(folder)) {
      folders.set(folder, []);
    }
    folders.get(folder)!.push(file);
  }

  const groups: SlskdFolderGroup[] = [];

  for (const [folder, folderFiles] of folders) {
    // Determine predominant format
    const formatCounts = new Map<AudioFormat, number>();
    let totalBitRate = 0;
    let bitRateCount = 0;

    for (const file of folderFiles) {
      const format = parseFormat(file.filename);
      formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
      if (file.bitRate) {
        totalBitRate += file.bitRate;
        bitRateCount++;
      }
    }

    // Most common format
    let predominantFormat: AudioFormat = 'unknown';
    let maxCount = 0;
    for (const [format, count] of formatCounts) {
      if (count > maxCount) {
        maxCount = count;
        predominantFormat = format;
      }
    }

    const avgBitRate = bitRateCount > 0 ? Math.round(totalBitRate / bitRateCount) : undefined;
    const quality = parseQuality(predominantFormat, avgBitRate);
    const totalSize = folderFiles.reduce((sum, f) => sum + f.size, 0);

    groups.push({
      folder,
      files: folderFiles,
      format: predominantFormat,
      quality,
      trackCount: folderFiles.length,
      totalSize,
    });
  }

  return groups.sort((a, b) => b.trackCount - a.trackCount);
}

/**
 * Score a result for auto-selection
 * Higher score = better match
 */
export function scoreResult(
  quality: QualityLevel | string,
  trackCount: number,
  sourceFiles: number
): number {
  let score = 0;

  // Quality score (0-100)
  score += QUALITY_SCORES[quality as QualityLevel] || 10;

  // Track count bonus (0-50)
  // More tracks = likely more complete
  score += Math.min(trackCount * 4, 50);

  // Source reliability bonus (0-30)
  // Users with more files are often more reliable
  const sourceScore = Math.min(sourceFiles / 1000, 1) * 30;
  score += sourceScore;

  return Math.round(score);
}

/**
 * Check if quality meets minimum threshold
 */
export function meetsQualityThreshold(
  quality: QualityLevel,
  minQuality: SlskdQualityProfile['minQuality']
): boolean {
  if (minQuality === 'any') return true;

  const qualityScore = QUALITY_SCORES[quality] || 0;
  const thresholdScore = {
    'mp3-128': 30,
    'mp3-256': 70,
    'mp3-320': 80,
    'lossless': 100,
  }[minQuality];

  return qualityScore >= thresholdScore;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npm test -- --run tests/utils/slskd-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/utils/slskd-parser.ts apps/api/tests/utils/slskd-parser.test.ts
git commit -m "feat(utils): add slskd result parsing and scoring utilities"
```

---

## Task 10: Run full test suite and verify

**Step 1: Run all tests**

Run: `cd apps/api && npm test`
Expected: All tests pass

**Step 2: Run type check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No type errors

**Step 3: Start dev stack and test manually**

Run: `./start-dev.sh`

Test connection via API:
```bash
curl -X POST http://localhost:3010/api/connections/test \
  -H "Content-Type: application/json" \
  -d '{"type": "slskd", "config": {"url": "http://slskd:5030", "apiKey": "your-key"}}'
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(slskd): complete Phase 1 MVP - connection and search"
```

---

## Summary

Phase 1 MVP complete. Users can now:
- Add slskd as a connection in Settings
- Test slskd connectivity
- Search slskd via API endpoints
- Queue downloads and track status

**Next Phase:** Phase 2 - File Organization (download completion detection, metadata parsing, Plex-compatible organization)
