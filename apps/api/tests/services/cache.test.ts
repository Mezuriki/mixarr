/**
 * CacheService Tests
 *
 * Tests for Redis-backed cache wrapper service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redis module before importing CacheService
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  CacheService,
  CACHE_MISS_SENTINEL,
  CACHE_TTLS,
  CACHE_KEYS,
  cacheService,
} from '../../src/services/cache.js';
import { redis } from '../../src/lib/redis.js';

describe('CacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exports', () => {
    it('exports CACHE_MISS_SENTINEL as __MISS__', () => {
      expect(CACHE_MISS_SENTINEL).toBe('__MISS__');
    });

    it('exports CACHE_TTLS with correct values', () => {
      expect(CACHE_TTLS.DEEZER_IMAGE).toBe(604800);
      expect(CACHE_TTLS.LASTFM_STATS).toBe(86400);
      expect(CACHE_TTLS.MISS).toBe(3600);
    });

    it('exports CACHE_KEYS with correct key generators', () => {
      expect(CACHE_KEYS.deezerImage('radiohead')).toBe('deezer:image:radiohead');
      expect(CACHE_KEYS.lastfmStats('radiohead')).toBe('lastfm:stats:radiohead');
    });

    it('exports cacheService singleton instance', () => {
      expect(cacheService).toBeInstanceOf(CacheService);
    });
  });

  describe('get', () => {
    it('returns parsed JSON on hit', async () => {
      const data = { url: 'https://example.com/image.jpg', width: 300 };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(data));

      const result = await cacheService.get('deezer:image:radiohead');

      expect(redis.get).toHaveBeenCalledWith('deezer:image:radiohead');
      expect(result).toEqual(data);
    });

    it('returns string on hit (plain string stored as JSON)', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify('hello'));

      const result = await cacheService.get<string>('some:key');

      expect(result).toBe('hello');
    });

    it('returns null on miss (key not in Redis)', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await cacheService.get('deezer:image:unknown');

      expect(result).toBeNull();
    });

    it('returns CACHE_MISS_SENTINEL when miss was cached', async () => {
      vi.mocked(redis.get).mockResolvedValue(CACHE_MISS_SENTINEL);

      const result = await cacheService.get('deezer:image:nonexistent');

      expect(result).toBe(CACHE_MISS_SENTINEL);
    });

    it('returns null when Redis throws', async () => {
      vi.mocked(redis.get).mockRejectedValue(new Error('Connection refused'));

      const result = await cacheService.get('deezer:image:radiohead');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores JSON-serialized value with EX TTL', async () => {
      const data = { url: 'https://example.com/image.jpg', width: 300 };
      await cacheService.set('deezer:image:radiohead', data, CACHE_TTLS.DEEZER_IMAGE);

      expect(redis.set).toHaveBeenCalledWith(
        'deezer:image:radiohead',
        JSON.stringify(data),
        'EX',
        604800,
      );
    });

    it('stores simple strings (JSON-serialized)', async () => {
      await cacheService.set('some:key', 'simple-value', 3600);

      expect(redis.set).toHaveBeenCalledWith(
        'some:key',
        JSON.stringify('simple-value'),
        'EX',
        3600,
      );
    });

    it('does not throw when Redis unavailable', async () => {
      vi.mocked(redis.set).mockRejectedValue(new Error('Connection refused'));

      await expect(
        cacheService.set('deezer:image:radiohead', { url: 'test' }, 3600),
      ).resolves.toBeUndefined();
    });
  });

  describe('setMiss', () => {
    it('stores sentinel with TTL', async () => {
      await cacheService.setMiss('deezer:image:nonexistent', CACHE_TTLS.MISS);

      expect(redis.set).toHaveBeenCalledWith(
        'deezer:image:nonexistent',
        CACHE_MISS_SENTINEL,
        'EX',
        3600,
      );
    });

    it('does not throw when Redis unavailable', async () => {
      vi.mocked(redis.set).mockRejectedValue(new Error('Connection refused'));

      await expect(
        cacheService.setMiss('deezer:image:nonexistent', 3600),
      ).resolves.toBeUndefined();
    });
  });

  describe('constructor', () => {
    it('accepts optional redisInstance for testing', async () => {
      const mockRedis = {
        get: vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(JSON.stringify({ test: true })),
        set: vi.fn<(key: string, value: string, ...args: unknown[]) => Promise<unknown>>(),
      };

      const service = new CacheService(mockRedis);
      const result = await service.get('test:key');

      expect(mockRedis.get).toHaveBeenCalledWith('test:key');
      expect(result).toEqual({ test: true });
    });
  });

  describe('edge cases', () => {
    it('returns null when cached value is corrupt (invalid JSON)', async () => {
      vi.mocked(redis.get).mockResolvedValue('{not valid json');

      const result = await cacheService.get('some:key');

      expect(result).toBeNull();
    });
  });
});
