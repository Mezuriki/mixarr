/**
 * CacheService
 *
 * Redis-backed cache wrapper for caching external API responses
 * (Deezer images, Last.fm stats) with graceful degradation.
 */

import { redis as defaultRedis } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('CacheService');

/** Sentinel value stored for negative cache entries */
export const CACHE_MISS_SENTINEL = '__MISS__';

/** Standard TTL values in seconds */
export const CACHE_TTLS = {
  /** 7 days */
  DEEZER_IMAGE: 7 * 24 * 60 * 60,
  /** 24 hours */
  LASTFM_STATS: 24 * 60 * 60,
  /** 1 hour */
  MISS: 60 * 60,
} as const;

/** Cache key generators */
export const CACHE_KEYS = {
  deezerImage: (normalizedName: string): string =>
    `deezer:image:${normalizedName}`,
  lastfmStats: (normalizedName: string): string =>
    `lastfm:stats:${normalizedName}`,
} as const;

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

export class CacheService {
  private redis: RedisLike;

  constructor(redisInstance?: RedisLike) {
    this.redis = redisInstance ?? defaultRedis;
  }

  /**
   * Get a cached value.
   * Returns parsed JSON on hit, null if key not in Redis,
   * or CACHE_MISS_SENTINEL if a negative result was cached.
   * On Redis error, returns null (graceful degradation).
   */
  async get<T>(key: string): Promise<T | null | typeof CACHE_MISS_SENTINEL> {
    let raw: string | null = null;
    try {
      raw = await this.redis.get(key);

      if (raw === null) {
        return null;
      }

      if (raw === CACHE_MISS_SENTINEL) {
        return CACHE_MISS_SENTINEL;
      }

      return JSON.parse(raw) as T;
    } catch (error) {
      logger.warn('Cache get failed', { key, error, raw });
      return null;
    }
  }

  /**
   * Cache a value with a TTL.
   * JSON-serializes the value before storing.
   * On Redis error, silently fails.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('Cache set failed', { key, error });
    }
  }

  /**
   * Cache a negative lookup result (miss) with a TTL.
   * Stores the sentinel string directly (not JSON-serialized).
   * On Redis error, silently fails.
   */
  async setMiss(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, CACHE_MISS_SENTINEL, 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('Cache setMiss failed', { key, error });
    }
  }
}

/** Singleton instance using the default Redis connection */
export const cacheService = new CacheService();
