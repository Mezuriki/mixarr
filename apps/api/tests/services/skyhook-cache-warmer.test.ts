// apps/api/tests/services/skyhook-cache-warmer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
import { SkyHookCacheWarmer } from '../../src/services/skyhook-cache-warmer.js';

describe('SkyHookCacheWarmer', () => {
  let warmer: SkyHookCacheWarmer;

  beforeEach(() => {
    warmer = new SkyHookCacheWarmer();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('warmArtist', () => {
    describe('validation', () => {
      it('rejects empty MBID with descriptive error', async () => {
        await expect(warmer.warmArtist('')).rejects.toThrow('MBID is required');
      });

      it('rejects malformed MBID (not UUID format)', async () => {
        await expect(warmer.warmArtist('not-a-uuid')).rejects.toThrow('Invalid MBID format');
      });

      it('rejects MBID with SQL injection attempt', async () => {
        await expect(warmer.warmArtist("abc'; DROP TABLE--")).rejects.toThrow('Invalid MBID format');
      });
    });

    describe('404 handling (artist not in MusicBrainz)', () => {
      it('returns success=false immediately on 404 without retrying', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f');

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(1);
        expect(result.error).toContain('not found in MusicBrainz');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('503 handling (cache not warm)', () => {
      it('retries on 503 until success', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 503 })
          .mockResolvedValueOnce({ ok: false, status: 503 })
          .mockResolvedValueOnce({ 
            ok: true, 
            status: 200,
            json: () => Promise.resolve({ artistName: 'Test Artist' }),
          });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f', { 
          timeoutMs: 10000,
          initialDelayMs: 10, // Fast for tests
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(3);
        expect(result.cached).toBe(false); // Was not cached initially
      });

      it('times out after maxTimeout and returns success=false', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 503 });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f', {
          timeoutMs: 100,
          initialDelayMs: 20,
        });

        expect(result.success).toBe(false);
        expect(result.attempts).toBeGreaterThan(1);
        expect(result.error).toContain('timeout');
      });
    });

    describe('already cached (fast path)', () => {
      it('returns cached=true when first request succeeds', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ artistName: 'Test Artist' }),
        });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f');

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(1);
        expect(result.cached).toBe(true); // Was already cached
      });
    });

    describe('network errors', () => {
      it('retries on network timeout', async () => {
        mockFetch
          .mockRejectedValueOnce(new Error('ETIMEDOUT'))
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ artistName: 'Test Artist' }),
          });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f', {
          initialDelayMs: 10,
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
      });
    });

    describe('invalid response handling', () => {
      it('retries when response is 200 but invalid JSON', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.reject(new Error('Invalid JSON')),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ artistName: 'Test Artist' }),
          });

        const result = await warmer.warmArtist('df494a19-4657-4a77-92b6-80325c63510f', {
          initialDelayMs: 10,
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
      });
    });
  });

  describe('warmAlbum', () => {
    it('hits the album endpoint with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ title: 'Test Album' }),
      });

      await warmer.warmAlbum('bc4c3083-c484-4c2f-8983-dd82eb8b60c0');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.lidarr.audio/api/v0.4/album/bc4c3083-c484-4c2f-8983-dd82eb8b60c0',
        expect.any(Object)
      );
    });
  });
});
