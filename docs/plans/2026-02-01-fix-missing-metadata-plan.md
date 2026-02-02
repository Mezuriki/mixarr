# Fix Missing Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cache-warming-powered metadata repair to the Library page with single-artist "Fix" buttons and batch "Fix All" with progress tracking.

**Architecture:** New `MetadataFixService` handles single/batch fix operations. Batch jobs run async with Redis state for progress tracking. Frontend polls status endpoint and displays progress bar.

**Tech Stack:** TypeScript, Express, Redis (ioredis), React, existing SkyHookCacheWarmer

**Requirements:**
- Edge Cases: no artists with issues, job already running, artist deleted mid-batch, Redis unavailable
- Security: Admin-only endpoints, validate artist IDs, user-scoped jobs
- Data Integrity: Graceful handling of partial failures, job state cleanup
- Error Handling: Return 400 for invalid input, 409 for job conflicts, 500 for server errors

---

## Task 1: MetadataFixService - Core Types and Single Artist Fix

**Quality Requirements:**
- Edge Cases: invalid artistId, missing MBID, Lidarr timeout, cache warm failure
- Attack Vectors: SQL injection in artistId (N/A - numeric), privilege escalation (check user)
- AI Slop Watch: Specific error messages, no TODOs, descriptive method names

**Files:**
- Create: `apps/api/src/services/metadata-fix.ts`
- Create: `apps/api/tests/api/metadata-fix.test.ts`

**Step 1: Planning Phase - Quality Gate**
Edge cases for `fixArtist`:
- Artist ID doesn't exist in Lidarr
- Artist has no foreignArtistId (MBID)
- SkyHook cache warm times out
- Lidarr RefreshArtist command times out
- Artist still missing data after refresh (MusicBrainz doesn't have it)

**Step 2: Write failing tests (RED)**

```typescript
// apps/api/tests/api/metadata-fix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataFixService, FixResult } from '../../src/services/metadata-fix.js';
import { createMockLidarrService } from '../utils/fixtures.js';

describe('MetadataFixService', () => {
  describe('fixArtist', () => {
    let service: MetadataFixService;
    let mockLidarr: ReturnType<typeof createMockLidarrService>;
    let mockWarmer: { warmArtist: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockLidarr = createMockLidarrService();
      mockWarmer = { warmArtist: vi.fn().mockResolvedValue({ success: true, attempts: 1 }) };
      service = new MetadataFixService(mockWarmer);
    });

    it('should reject invalid artist ID', async () => {
      await expect(service.fixArtist(mockLidarr, -1, 'valid-mbid-1234'))
        .rejects.toThrow('Invalid artist ID');
    });

    it('should reject empty MBID', async () => {
      await expect(service.fixArtist(mockLidarr, 123, ''))
        .rejects.toThrow('MBID is required');
    });

    it('should warm cache before refreshing', async () => {
      const mbid = 'c423b65c-1234-5678-9abc-def012345678';
      mockLidarr.getArtist.mockResolvedValue({
        id: 123,
        artistName: 'Test Artist',
        foreignArtistId: mbid,
        overview: 'Has bio now',
        images: [{ coverType: 'poster', url: 'http://example.com/poster.jpg' }],
        genres: ['Jazz'],
      });

      const result = await service.fixArtist(mockLidarr, 123, mbid);

      expect(mockWarmer.warmArtist).toHaveBeenCalledWith(mbid);
      expect(mockLidarr.refreshArtist).toHaveBeenCalledWith(123);
      expect(mockLidarr.waitForCommand).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should report what was fixed', async () => {
      const mbid = 'c423b65c-1234-5678-9abc-def012345678';
      mockLidarr.getArtist.mockResolvedValue({
        id: 123,
        artistName: 'Test Artist',
        foreignArtistId: mbid,
        overview: 'Has bio now',
        images: [{ coverType: 'poster', url: 'http://example.com/poster.jpg' }],
        genres: [],  // Still missing genres
      });

      const result = await service.fixArtist(mockLidarr, 123, mbid);

      expect(result.fixed).toContain('overview');
      expect(result.fixed).toContain('poster');
      expect(result.stillMissing).toContain('genres');
    });

    it('should handle cache warm failure gracefully', async () => {
      mockWarmer.warmArtist.mockResolvedValue({ success: false, attempts: 3, error: 'timeout' });
      mockLidarr.getArtist.mockResolvedValue({
        id: 123,
        artistName: 'Test Artist',
        foreignArtistId: 'mbid-123',
        overview: '',
        images: [],
        genres: [],
      });

      const result = await service.fixArtist(mockLidarr, 123, 'mbid-123');

      // Should still try refresh even if warm failed
      expect(mockLidarr.refreshArtist).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.stillMissing.length).toBeGreaterThan(0);
    });

    it('should handle Lidarr command timeout', async () => {
      mockLidarr.waitForCommand.mockRejectedValue(new Error('Command timed out'));

      await expect(service.fixArtist(mockLidarr, 123, 'mbid-123'))
        .rejects.toThrow('Command timed out');
    });
  });
});
```

**Step 3: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/api/metadata-fix.test.ts
```
Expected: All tests fail (module not found)

**Step 4: Write minimal implementation**

```typescript
// apps/api/src/services/metadata-fix.ts
import { createLogger } from '../lib/logger.js';
import type { LidarrService } from './lidarr.js';
import type { SkyHookCacheWarmer } from './skyhook-cache-warmer.js';

const log = createLogger('MetadataFix');

export interface FixResult {
  success: boolean;
  artist: {
    id: number;
    name: string;
    hasPoster: boolean;
    hasOverview: boolean;
    hasGenres: boolean;
  };
  fixed: string[];
  stillMissing: string[];
}

export class MetadataFixService {
  constructor(private warmer: SkyHookCacheWarmer) {}

  /**
   * Fix metadata for a single artist.
   * Warms SkyHook cache, triggers Lidarr refresh, waits for completion.
   */
  async fixArtist(
    lidarr: LidarrService,
    artistId: number,
    mbid: string
  ): Promise<FixResult> {
    // Validate inputs
    if (!artistId || artistId < 0) {
      throw new Error('Invalid artist ID');
    }
    if (!mbid || mbid.trim() === '') {
      throw new Error('MBID is required');
    }

    log.info(`Fixing metadata for artist ${artistId} (${mbid})`);

    // Step 1: Warm SkyHook cache
    const warmResult = await this.warmer.warmArtist(mbid);
    if (!warmResult.success) {
      log.warn(`Cache warm failed for ${mbid}: ${warmResult.error}`);
    }

    // Step 2: Trigger Lidarr refresh
    const command = await lidarr.refreshArtist(artistId);
    
    // Step 3: Wait for completion
    await lidarr.waitForCommand(command.id, 30000);

    // Step 4: Fetch updated artist and determine what changed
    const artist = await lidarr.getArtist(artistId);
    if (!artist) {
      throw new Error(`Artist ${artistId} not found after refresh`);
    }

    const hasPoster = artist.images?.some(
      (img: { coverType: string; url?: string }) => 
        img.coverType?.toLowerCase() === 'poster' && img.url
    ) || false;
    const hasOverview = !!artist.overview?.trim();
    const hasGenres = (artist.genres?.length || 0) > 0;

    const fixed: string[] = [];
    const stillMissing: string[] = [];

    if (hasOverview) fixed.push('overview');
    else stillMissing.push('overview');

    if (hasPoster) fixed.push('poster');
    else stillMissing.push('poster');

    if (hasGenres) fixed.push('genres');
    else stillMissing.push('genres');

    const success = stillMissing.length === 0 || fixed.length > 0;

    log.info(`Fixed ${fixed.length} issues for ${artist.artistName}, ${stillMissing.length} still missing`);

    return {
      success,
      artist: {
        id: artist.id,
        name: artist.artistName,
        hasPoster,
        hasOverview,
        hasGenres,
      },
      fixed,
      stillMissing,
    };
  }
}
```

**Step 5: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/api/metadata-fix.test.ts
```
Expected: 6 PASS

**Step 6: Commit**
```bash
git add apps/api/src/services/metadata-fix.ts apps/api/tests/api/metadata-fix.test.ts
git commit -m "feat(api): add MetadataFixService with single artist fix

- Validates artist ID and MBID inputs
- Warms SkyHook cache before Lidarr refresh
- Waits for refresh command completion
- Reports what was fixed vs still missing
- Graceful handling of cache warm failures"
```

---

## Task 2: MetadataFixService - Batch Job Management

**Quality Requirements:**
- Edge Cases: job already running, no artists need fixing, Redis unavailable
- Attack Vectors: user A accessing user B's job (user-scoped keys)
- AI Slop Watch: Descriptive job state structure, specific status values

**Files:**
- Modify: `apps/api/src/services/metadata-fix.ts`
- Modify: `apps/api/tests/api/metadata-fix.test.ts`

**Step 1: Write failing tests for batch operations (RED)**

```typescript
// Add to apps/api/tests/api/metadata-fix.test.ts

import { redis } from '../../src/lib/redis.js';

// Mock Redis
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

describe('MetadataFixService - Batch Operations', () => {
  let service: MetadataFixService;
  let mockWarmer: { warmArtist: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWarmer = { warmArtist: vi.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    service = new MetadataFixService(mockWarmer);
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.del).mockResolvedValue(1);
  });

  describe('startBatchFix', () => {
    it('should reject if job already running', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
        status: 'running',
        total: 100,
        processed: 50,
      }));

      await expect(service.startBatchFix(1, []))
        .rejects.toThrow('Job already in progress');
    });

    it('should return immediately with job info', async () => {
      const artists = [
        { id: 1, foreignArtistId: 'mbid-1' },
        { id: 2, foreignArtistId: 'mbid-2' },
      ];

      const result = await service.startBatchFix(1, artists);

      expect(result.jobId).toMatch(/^fix-metadata-/);
      expect(result.total).toBe(2);
      expect(result.estimatedMinutes).toBe(1); // 2 artists at 1/sec = < 1 min, rounds up
    });

    it('should store initial job state in Redis', async () => {
      const artists = [{ id: 1, foreignArtistId: 'mbid-1' }];

      await service.startBatchFix(1, artists);

      expect(redis.set).toHaveBeenCalledWith(
        'metadata-fix:job:1',
        expect.stringContaining('"status":"running"'),
        'EX',
        3600 // 1 hour expiry
      );
    });
  });

  describe('getJobStatus', () => {
    it('should return null when no job exists', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.getJobStatus(1);

      expect(result).toBeNull();
    });

    it('should return current job state', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
        jobId: 'fix-metadata-123',
        status: 'running',
        total: 100,
        processed: 50,
        fixed: 45,
        failed: 5,
        currentArtist: 'Miles Davis',
      }));

      const result = await service.getJobStatus(1);

      expect(result?.status).toBe('running');
      expect(result?.processed).toBe(50);
      expect(result?.currentArtist).toBe('Miles Davis');
    });
  });

  describe('cancelJob', () => {
    it('should set cancel flag in Redis', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
        status: 'running',
        total: 100,
      }));

      const result = await service.cancelJob(1);

      expect(result).toBe(true);
      expect(redis.set).toHaveBeenCalledWith('metadata-fix:cancel:1', '1', 'EX', 300);
    });

    it('should return false when no job running', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.cancelJob(1);

      expect(result).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/api/metadata-fix.test.ts
```
Expected: New tests fail (methods not defined)

**Step 3: Implement batch job management**

Add to `apps/api/src/services/metadata-fix.ts`:

```typescript
import { redis } from '../lib/redis.js';

export interface JobInfo {
  jobId: string;
  total: number;
  estimatedMinutes: number;
}

export interface JobStatus {
  jobId: string;
  status: 'running' | 'completed' | 'cancelled';
  total: number;
  processed: number;
  fixed: number;
  failed: number;
  currentArtist?: string;
}

interface ArtistToFix {
  id: number;
  foreignArtistId: string;
  artistName?: string;
}

export class MetadataFixService {
  // ... existing fixArtist method ...

  private getJobKey(userId: number): string {
    return `metadata-fix:job:${userId}`;
  }

  private getCancelKey(userId: number): string {
    return `metadata-fix:cancel:${userId}`;
  }

  /**
   * Start a batch fix job. Returns immediately; job runs async.
   */
  async startBatchFix(userId: number, artists: ArtistToFix[]): Promise<JobInfo> {
    // Check if job already running
    const existingJob = await this.getJobStatus(userId);
    if (existingJob && existingJob.status === 'running') {
      throw new Error('Job already in progress');
    }

    const jobId = `fix-metadata-${Date.now()}`;
    const estimatedMinutes = Math.max(1, Math.ceil(artists.length / 60));

    const initialState: JobStatus = {
      jobId,
      status: 'running',
      total: artists.length,
      processed: 0,
      fixed: 0,
      failed: 0,
    };

    // Store initial state with 1 hour expiry
    await redis.set(
      this.getJobKey(userId),
      JSON.stringify(initialState),
      'EX',
      3600
    );

    // Clear any previous cancel flag
    await redis.del(this.getCancelKey(userId));

    // Job execution happens separately (in route handler via setImmediate)
    log.info(`Started batch fix job ${jobId} for ${artists.length} artists`);

    return {
      jobId,
      total: artists.length,
      estimatedMinutes,
    };
  }

  /**
   * Get current job status for a user.
   */
  async getJobStatus(userId: number): Promise<JobStatus | null> {
    const data = await redis.get(this.getJobKey(userId));
    if (!data) return null;
    return JSON.parse(data) as JobStatus;
  }

  /**
   * Cancel a running job.
   */
  async cancelJob(userId: number): Promise<boolean> {
    const job = await this.getJobStatus(userId);
    if (!job || job.status !== 'running') {
      return false;
    }

    // Set cancel flag with 5 minute expiry
    await redis.set(this.getCancelKey(userId), '1', 'EX', 300);
    log.info(`Cancel requested for job ${job.jobId}`);
    return true;
  }

  /**
   * Check if cancellation was requested.
   */
  async isCancelled(userId: number): Promise<boolean> {
    const flag = await redis.get(this.getCancelKey(userId));
    return flag === '1';
  }

  /**
   * Update job progress in Redis.
   */
  async updateProgress(
    userId: number,
    update: Partial<JobStatus>
  ): Promise<void> {
    const job = await this.getJobStatus(userId);
    if (!job) return;

    const updated = { ...job, ...update };
    await redis.set(
      this.getJobKey(userId),
      JSON.stringify(updated),
      'EX',
      3600
    );
  }

  /**
   * Execute the batch fix loop. Call this with setImmediate after startBatchFix.
   */
  async executeBatchFix(
    userId: number,
    lidarr: LidarrService,
    artists: ArtistToFix[]
  ): Promise<void> {
    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < artists.length; i++) {
      // Check for cancellation
      if (await this.isCancelled(userId)) {
        log.info(`Job cancelled at ${i}/${artists.length}`);
        await this.updateProgress(userId, { status: 'cancelled', processed: i });
        await redis.del(this.getCancelKey(userId));
        return;
      }

      const artist = artists[i];

      try {
        await this.updateProgress(userId, {
          processed: i,
          fixed,
          failed,
          currentArtist: artist.artistName || `Artist ${artist.id}`,
        });

        const result = await this.fixArtist(lidarr, artist.id, artist.foreignArtistId);
        if (result.fixed.length > 0) {
          fixed++;
        } else {
          failed++;
        }
      } catch (error) {
        log.error(`Failed to fix artist ${artist.id}:`, error);
        failed++;
      }

      // Rate limit: 1 artist per second
      if (i < artists.length - 1) {
        await this.sleep(1000);
      }
    }

    await this.updateProgress(userId, {
      status: 'completed',
      processed: artists.length,
      fixed,
      failed,
      currentArtist: undefined,
    });

    log.info(`Batch fix completed: ${fixed} fixed, ${failed} failed`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/api/metadata-fix.test.ts
```
Expected: All tests pass

**Step 5: Commit**
```bash
git add apps/api/src/services/metadata-fix.ts apps/api/tests/api/metadata-fix.test.ts
git commit -m "feat(api): add batch job management to MetadataFixService

- startBatchFix: creates job, stores state in Redis, returns immediately
- getJobStatus: retrieves current progress
- cancelJob: sets cancel flag for running job
- executeBatchFix: runs the actual loop with 1/sec rate limit
- User-scoped Redis keys prevent cross-user access"
```

---

## Task 3: API Routes - Single Artist Fix Endpoint

**Quality Requirements:**
- Edge Cases: invalid artist ID, artist not found, no Lidarr connection
- Attack Vectors: non-admin access (admin-only route), invalid ID injection
- AI Slop Watch: Specific error messages, proper HTTP status codes

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Create: `apps/api/tests/api/routes/library-fix.test.ts`

**Step 1: Write failing tests (RED)**

```typescript
// apps/api/tests/api/routes/library-fix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { searchRouter } from '../../../src/routes/search.js';

// Mock dependencies
vi.mock('../../../src/services/metadata-fix.js', () => ({
  MetadataFixService: vi.fn().mockImplementation(() => ({
    fixArtist: vi.fn().mockResolvedValue({
      success: true,
      artist: { id: 123, name: 'Test Artist', hasPoster: true, hasOverview: true, hasGenres: true },
      fixed: ['poster', 'overview'],
      stillMissing: [],
    }),
    startBatchFix: vi.fn(),
    getJobStatus: vi.fn(),
    cancelJob: vi.fn(),
  })),
}));

vi.mock('../../../src/lib/connections.js');

describe('POST /api/search/lidarr/artists/:id/fix', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });
    app.use('/api/search', searchRouter);
  });

  it('should return 400 for invalid artist ID', async () => {
    const response = await request(app)
      .post('/api/search/lidarr/artists/invalid/fix')
      .send();

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid artist ID');
  });

  it('should return 400 for negative artist ID', async () => {
    const response = await request(app)
      .post('/api/search/lidarr/artists/-1/fix')
      .send();

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid artist ID');
  });

  it('should return fixed artist on success', async () => {
    // Need to mock getLidarrService and artist lookup
    const response = await request(app)
      .post('/api/search/lidarr/artists/123/fix')
      .send();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.fixed).toContain('poster');
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/api/routes/library-fix.test.ts
```
Expected: Tests fail (route not defined)

**Step 3: Implement the single fix endpoint**

Add to `apps/api/src/routes/search.ts` (after existing `/lidarr/artists/:id/refresh`):

```typescript
import { MetadataFixService } from '../services/metadata-fix.js';
import { skyhookWarmer } from '../services/skyhook-cache-warmer.js';

const metadataFixService = new MetadataFixService(skyhookWarmer);

// Fix metadata for a single artist using cache warming
searchRouter.post('/lidarr/artists/:id/fix', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artistId = parseIntParam(req.params.id);
    if (artistId === null || artistId < 0) {
      res.status(400).json({ error: 'Invalid artist ID' });
      return;
    }

    // Get artist to find MBID
    const artist = await lidarr.getArtist(artistId);
    if (!artist) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }

    if (!artist.foreignArtistId) {
      res.status(400).json({ error: 'Artist has no MusicBrainz ID' });
      return;
    }

    const result = await metadataFixService.fixArtist(
      lidarr,
      artistId,
      artist.foreignArtistId
    );

    res.json(result);
  } catch (error) {
    log.error('Failed to fix artist metadata', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fix artist metadata',
    });
  }
});
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/api/routes/library-fix.test.ts
```
Expected: All tests pass

**Step 5: Commit**
```bash
git add apps/api/src/routes/search.ts apps/api/tests/api/routes/library-fix.test.ts
git commit -m "feat(api): add POST /lidarr/artists/:id/fix endpoint

- Validates artist ID parameter
- Fetches artist to get MBID
- Uses MetadataFixService for cache warm + refresh
- Returns what was fixed vs still missing"
```

---

## Task 4: API Routes - Batch Fix Endpoints

**Quality Requirements:**
- Edge Cases: no artists need fixing, job already running, no job to cancel
- Attack Vectors: user A cancelling user B's job (user-scoped)
- AI Slop Watch: Proper 409 for conflicts, descriptive status responses

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/tests/api/routes/library-fix.test.ts`

**Step 1: Write failing tests for batch endpoints (RED)**

Add to test file:

```typescript
describe('POST /api/search/lidarr/artists/fix-all', () => {
  it('should start batch job and return job info', async () => {
    const response = await request(app)
      .post('/api/search/lidarr/artists/fix-all')
      .send();

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBeDefined();
    expect(response.body.total).toBeGreaterThanOrEqual(0);
  });

  it('should return 409 if job already running', async () => {
    // Mock service to throw job conflict
    const response = await request(app)
      .post('/api/search/lidarr/artists/fix-all')
      .send();

    // Adjust based on mock setup
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('already in progress');
  });
});

describe('GET /api/search/lidarr/artists/fix-all/status', () => {
  it('should return null when no job exists', async () => {
    const response = await request(app)
      .get('/api/search/lidarr/artists/fix-all/status')
      .send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBeNull();
  });

  it('should return job progress when running', async () => {
    // Mock getJobStatus to return running job
    const response = await request(app)
      .get('/api/search/lidarr/artists/fix-all/status')
      .send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('running');
    expect(response.body.processed).toBeDefined();
  });
});

describe('POST /api/search/lidarr/artists/fix-all/cancel', () => {
  it('should cancel running job', async () => {
    const response = await request(app)
      .post('/api/search/lidarr/artists/fix-all/cancel')
      .send();

    expect(response.status).toBe(200);
    expect(response.body.cancelled).toBe(true);
  });

  it('should return 404 when no job running', async () => {
    const response = await request(app)
      .post('/api/search/lidarr/artists/fix-all/cancel')
      .send();

    expect(response.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement batch endpoints**

Add to `apps/api/src/routes/search.ts`:

```typescript
// Start batch fix for all artists with issues
searchRouter.post('/lidarr/artists/fix-all', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const { issueType = 'any' } = req.body as { issueType?: string };

    // Get artists with issues
    const artists = await lidarr.getArtists();
    const artistsWithIssues = artists
      .filter(artist => {
        const issues = getMetadataIssues(artist);
        if (issueType === 'any') return issues.length > 0;
        return issues.includes(issueType);
      })
      .map(artist => ({
        id: artist.id,
        foreignArtistId: artist.foreignArtistId,
        artistName: artist.artistName,
      }));

    if (artistsWithIssues.length === 0) {
      res.json({
        jobId: null,
        total: 0,
        estimatedMinutes: 0,
        message: 'No artists need fixing',
      });
      return;
    }

    try {
      const jobInfo = await metadataFixService.startBatchFix(
        req.user!.id,
        artistsWithIssues
      );

      // Start async execution (doesn't block response)
      setImmediate(async () => {
        try {
          await metadataFixService.executeBatchFix(
            req.user!.id,
            lidarr,
            artistsWithIssues
          );
        } catch (error) {
          log.error('Batch fix execution failed', { error });
        }
      });

      res.json(jobInfo);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already in progress')) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  } catch (error) {
    log.error('Failed to start batch fix', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start batch fix',
    });
  }
});

// Get batch fix job status
searchRouter.get('/lidarr/artists/fix-all/status', async (req, res) => {
  try {
    const status = await metadataFixService.getJobStatus(req.user!.id);
    res.json(status || { status: null });
  } catch (error) {
    log.error('Failed to get job status', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get job status',
    });
  }
});

// Cancel batch fix job
searchRouter.post('/lidarr/artists/fix-all/cancel', async (req, res) => {
  try {
    const cancelled = await metadataFixService.cancelJob(req.user!.id);
    if (!cancelled) {
      res.status(404).json({ error: 'No running job to cancel' });
      return;
    }
    res.json({ cancelled: true });
  } catch (error) {
    log.error('Failed to cancel job', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to cancel job',
    });
  }
});
```

**Step 4: Run tests to verify they pass**

**Step 5: Commit**
```bash
git add apps/api/src/routes/search.ts apps/api/tests/api/routes/library-fix.test.ts
git commit -m "feat(api): add batch fix endpoints for library metadata

- POST /fix-all: starts background job, returns job info
- GET /fix-all/status: returns current progress
- POST /fix-all/cancel: cancels running job
- 409 returned if job already running
- Job execution runs async via setImmediate"
```

---

## Task 5: Frontend - Fix All Button and Progress Bar

**Quality Requirements:**
- Edge Cases: no issues to fix (button disabled), job cancelled, navigate away and return
- Attack Vectors: N/A (UI only)
- AI Slop Watch: Clear loading states, descriptive button text, accessible

**Files:**
- Modify: `apps/web/src/app/library/page.tsx`

**Step 1: Add state for job tracking**

```typescript
// Add to state declarations
const [fixJob, setFixJob] = useState<{
  jobId: string | null;
  status: 'running' | 'completed' | 'cancelled' | null;
  total: number;
  processed: number;
  fixed: number;
  failed: number;
  currentArtist?: string;
} | null>(null);
const [isStartingFix, setIsStartingFix] = useState(false);
```

**Step 2: Add job status polling**

```typescript
// Poll for job status when job is running
useEffect(() => {
  if (!fixJob || fixJob.status !== 'running') return;

  const pollInterval = setInterval(async () => {
    const { data } = await api.get<typeof fixJob>('/api/search/lidarr/artists/fix-all/status');
    if (data) {
      setFixJob(data);
      if (data.status === 'completed' || data.status === 'cancelled') {
        fetchArtists(); // Refresh the list
        addToast({
          type: data.status === 'completed' ? 'success' : 'info',
          title: data.status === 'completed' ? 'Fix completed' : 'Fix cancelled',
          message: `Fixed ${data.fixed} artists, ${data.failed} still need attention`,
        });
      }
    }
  }, 2000);

  return () => clearInterval(pollInterval);
}, [fixJob?.status]);

// Check for existing job on mount
useEffect(() => {
  const checkExistingJob = async () => {
    const { data } = await api.get('/api/search/lidarr/artists/fix-all/status');
    if (data && data.status === 'running') {
      setFixJob(data);
    }
  };
  if (isAdmin) checkExistingJob();
}, [isAdmin]);
```

**Step 3: Add Fix All button and handlers**

```typescript
const handleFixAll = async () => {
  const issueCount = issueStats?.noPoster + issueStats?.noOverview + issueStats?.noGenres || 0;
  if (!confirm(`This will attempt to fix ${issueCount} artists with missing metadata. This may take ~${Math.ceil(issueCount / 60)} minutes. Continue?`)) {
    return;
  }

  setIsStartingFix(true);
  const { data, error } = await api.post('/api/search/lidarr/artists/fix-all');
  setIsStartingFix(false);

  if (error) {
    addToast({ type: 'error', title: 'Failed to start fix', message: error });
    return;
  }

  if (data?.jobId) {
    setFixJob({ ...data, status: 'running', processed: 0, fixed: 0, failed: 0 });
  } else {
    addToast({ type: 'info', title: 'Nothing to fix', message: 'All artists have complete metadata' });
  }
};

const handleCancelFix = async () => {
  const { error } = await api.post('/api/search/lidarr/artists/fix-all/cancel');
  if (error) {
    addToast({ type: 'error', title: 'Failed to cancel', message: error });
  }
};
```

**Step 4: Update PageHeader with buttons**

```tsx
<PageHeader
  title="Lidarr Library"
  description="View the health of your Lidarr library"
>
  <div className="flex gap-2">
    <Button variant="outline" onClick={fetchArtists} disabled={isLoading}>
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
      Refresh
    </Button>
    {fixJob?.status === 'running' ? (
      <Button variant="destructive" onClick={handleCancelFix}>
        Cancel Fix
      </Button>
    ) : (
      <Button
        onClick={handleFixAll}
        disabled={isStartingFix || (issueStats?.noPoster === 0 && issueStats?.noOverview === 0 && issueStats?.noGenres === 0)}
      >
        {isStartingFix ? (
          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Wrench className="h-4 w-4 mr-2" />
        )}
        Fix All ({(issueStats?.noPoster || 0) + (issueStats?.noOverview || 0) + (issueStats?.noGenres || 0)})
      </Button>
    )}
  </div>
</PageHeader>
```

**Step 5: Add progress bar component**

```tsx
{/* Progress bar when job running */}
{fixJob?.status === 'running' && (
  <Card className="mb-4 border-primary">
    <CardContent className="pt-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">Fixing metadata...</span>
        <span className="text-sm text-muted-foreground">
          {fixJob.processed}/{fixJob.total} ({Math.round((fixJob.processed / fixJob.total) * 100)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(fixJob.processed / fixJob.total) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>Currently: {fixJob.currentArtist || '...'}</span>
        <span>~{Math.ceil((fixJob.total - fixJob.processed) / 60)} min remaining</span>
      </div>
    </CardContent>
  </Card>
)}
```

**Step 6: Add Wrench icon import**

```typescript
import Wrench from 'lucide-react/dist/esm/icons/wrench';
```

**Step 7: Manual test**
- Start dev stack
- Navigate to Library page
- Click "Fix All" button
- Verify confirmation dialog
- Verify progress bar appears
- Verify progress updates
- Verify cancel works
- Verify completion toast

**Step 8: Commit**
```bash
git add apps/web/src/app/library/page.tsx
git commit -m "feat(web): add Fix All button with progress tracking to library page

- Fix All button starts batch job with confirmation
- Progress bar shows current progress and ETA
- Cancel button stops running job
- Polls status every 2 seconds
- Resumes progress if user navigates away and returns
- Disabled when no artists need fixing"
```

---

## Task 6: Frontend - Row-Level Fix Button

**Quality Requirements:**
- Edge Cases: fix button only for artists with issues, spinner during fix
- Attack Vectors: N/A (UI only)
- AI Slop Watch: Clear feedback, no layout shift during loading

**Files:**
- Modify: `apps/web/src/app/library/page.tsx`

**Step 1: Add state for per-artist fix loading**

```typescript
const [fixingArtists, setFixingArtists] = useState<Set<number>>(new Set());
```

**Step 2: Add fix handler**

```typescript
const handleFixArtist = async (artistId: number, artistName: string) => {
  setFixingArtists(prev => new Set(prev).add(artistId));

  const { data, error } = await api.post(`/api/search/lidarr/artists/${artistId}/fix`);

  setFixingArtists(prev => {
    const next = new Set(prev);
    next.delete(artistId);
    return next;
  });

  if (error) {
    addToast({ type: 'error', title: `Failed to fix ${artistName}`, message: error });
    return;
  }

  if (data?.fixed?.length > 0) {
    addToast({
      type: 'success',
      title: `Fixed ${artistName}`,
      message: `Updated: ${data.fixed.join(', ')}`,
    });
    // Update artist in local state
    setArtists(prev => prev.map(a =>
      a.id === artistId
        ? {
            ...a,
            hasPoster: data.artist.hasPoster,
            hasOverview: data.artist.hasOverview,
            hasGenres: data.artist.hasGenres,
            issues: data.stillMissing.map((m: string) => `no_${m}`),
            needsRefresh: data.stillMissing.length > 0,
          }
        : a
    ));
  } else {
    addToast({
      type: 'warning',
      title: `Still missing data for ${artistName}`,
      message: data?.stillMissing?.length
        ? `Missing: ${data.stillMissing.join(', ')}`
        : 'MusicBrainz may not have this data',
    });
  }
};
```

**Step 3: Add Actions column to table**

Update table header:

```tsx
<th className="text-center py-3 px-2 w-20">Actions</th>
```

Add table cell in row:

```tsx
<td className="text-center py-3 px-2">
  {artist.issues.length > 0 && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => handleFixArtist(artist.id, artist.name)}
      disabled={fixingArtists.has(artist.id)}
    >
      {fixingArtists.has(artist.id) ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Wrench className="h-4 w-4" />
      )}
    </Button>
  )}
</td>
```

**Step 4: Manual test**
- Navigate to Library page
- Find artist with issues
- Click Fix button
- Verify spinner appears
- Verify toast on completion
- Verify row updates with new status

**Step 5: Commit**
```bash
git add apps/web/src/app/library/page.tsx
git commit -m "feat(web): add row-level Fix button for individual artists

- Fix button appears only for artists with issues
- Shows spinner during fix operation
- Updates row data without full refresh
- Toast shows what was fixed or still missing"
```

---

## Task 7: Integration Testing and Polish

**Quality Requirements:**
- Edge Cases: full end-to-end flow, error handling
- Attack Vectors: verify admin-only access
- AI Slop Watch: Clean code, no debug logs left

**Files:**
- Review all modified files

**Step 1: Run full test suite**
```bash
cd apps/api && npm test
```
Expected: All tests pass

**Step 2: Manual E2E test**
1. Start dev stack: `./start-dev.sh`
2. Navigate to Library page
3. Single fix: Click Fix on one artist, verify success
4. Batch fix: Click Fix All, verify progress, cancel mid-way
5. Resume: Refresh page during batch, verify progress resumes
6. Complete: Let batch complete, verify final stats

**Step 3: Check for debug logs**
```bash
grep -r "console.log" apps/api/src/services/metadata-fix.ts
grep -r "console.log" apps/web/src/app/library/page.tsx
```
Expected: No console.log statements

**Step 4: Final commit**
```bash
git add -A
git commit -m "feat: complete fix missing metadata feature

Library page now has:
- Fix All button with progress tracking
- Row-level Fix button for individual artists
- Cache warming before Lidarr refresh
- 1 artist/second rate limiting
- Cancellable batch jobs
- Redis-backed job persistence"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | MetadataFixService - Single Artist Fix | 15 min |
| 2 | MetadataFixService - Batch Job Management | 20 min |
| 3 | API Routes - Single Artist Endpoint | 10 min |
| 4 | API Routes - Batch Endpoints | 15 min |
| 5 | Frontend - Fix All Button + Progress | 20 min |
| 6 | Frontend - Row-Level Fix Button | 10 min |
| 7 | Integration Testing | 15 min |

**Total: ~105 minutes**
