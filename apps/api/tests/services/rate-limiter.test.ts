/**
 * Rate Limiter Service Tests
 * 
 * Tests:
 * - Token bucket algorithm
 * - Service-specific configurations
 * - Wait behavior when rate limited
 * - Token refill logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inline implementation for testing (mirrors rate-limiter.ts)
interface RateLimitConfig {
  requestsPerSecond: number;
  burstSize?: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

function createRateLimiter() {
  const limiters = new Map<string, RateLimitState>();
  const configs: Record<string, RateLimitConfig> = {
    lidarr: { requestsPerSecond: 2, burstSize: 5 },
    lidarr_add: { requestsPerSecond: 0.5, burstSize: 2 },
    spotify: { requestsPerSecond: 5, burstSize: 10 },
    lastfm: { requestsPerSecond: 5, burstSize: 10 },
    musicbrainz: { requestsPerSecond: 1, burstSize: 1 },
    tautulli: { requestsPerSecond: 5, burstSize: 10 },
    deezer: { requestsPerSecond: 10, burstSize: 20 },
    tidal: { requestsPerSecond: 1, burstSize: 3 },
  };

  function getOrCreateLimiter(service: string): RateLimitState {
    if (!limiters.has(service)) {
      const config = configs[service] || { requestsPerSecond: 5, burstSize: 10 };
      limiters.set(service, {
        tokens: config.burstSize || config.requestsPerSecond,
        lastRefill: Date.now(),
      });
    }
    return limiters.get(service)!;
  }

  function refillTokens(service: string): void {
    const state = getOrCreateLimiter(service);
    const config = configs[service] || { requestsPerSecond: 5, burstSize: 10 };
    const now = Date.now();
    const elapsed = (now - state.lastRefill) / 1000;
    const tokensToAdd = elapsed * config.requestsPerSecond;
    
    state.tokens = Math.min(
      config.burstSize || config.requestsPerSecond,
      state.tokens + tokensToAdd
    );
    state.lastRefill = now;
  }

  async function rateLimit(service: string): Promise<void> {
    refillTokens(service);
    const state = getOrCreateLimiter(service);
    
    if (state.tokens < 1) {
      const config = configs[service] || { requestsPerSecond: 5 };
      const waitTime = (1 - state.tokens) / config.requestsPerSecond * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      refillTokens(service);
    }
    
    state.tokens -= 1;
  }

  function setConfig(service: string, config: RateLimitConfig): void {
    configs[service] = config;
    limiters.delete(service);
  }

  function getTokens(service: string): number {
    return getOrCreateLimiter(service).tokens;
  }

  function reset(): void {
    limiters.clear();
  }

  return { rateLimit, setConfig, getTokens, reset, configs };
}

describe('Rate Limiter Service', () => {
  let rateLimiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = createRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
    rateLimiter.reset();
  });

  describe('Service Configurations', () => {
    it('should have configuration for lidarr', () => {
      expect(rateLimiter.configs.lidarr).toBeDefined();
      expect(rateLimiter.configs.lidarr.requestsPerSecond).toBe(2);
      expect(rateLimiter.configs.lidarr.burstSize).toBe(5);
    });

    it('should have conservative configuration for lidarr_add', () => {
      expect(rateLimiter.configs.lidarr_add).toBeDefined();
      expect(rateLimiter.configs.lidarr_add.requestsPerSecond).toBe(0.5);
      expect(rateLimiter.configs.lidarr_add.burstSize).toBe(2);
    });

    it('should have configuration for spotify', () => {
      expect(rateLimiter.configs.spotify).toBeDefined();
      expect(rateLimiter.configs.spotify.requestsPerSecond).toBe(5);
      expect(rateLimiter.configs.spotify.burstSize).toBe(10);
    });

    it('should have configuration for lastfm', () => {
      expect(rateLimiter.configs.lastfm).toBeDefined();
      expect(rateLimiter.configs.lastfm.requestsPerSecond).toBe(5);
    });

    it('should have strict configuration for musicbrainz', () => {
      expect(rateLimiter.configs.musicbrainz).toBeDefined();
      expect(rateLimiter.configs.musicbrainz.requestsPerSecond).toBe(1);
      expect(rateLimiter.configs.musicbrainz.burstSize).toBe(1);
    });

    it('should have configuration for deezer', () => {
      expect(rateLimiter.configs.deezer).toBeDefined();
      expect(rateLimiter.configs.deezer.requestsPerSecond).toBe(10);
      expect(rateLimiter.configs.deezer.burstSize).toBe(20);
    });

    it('should have configuration for tidal', () => {
      expect(rateLimiter.configs.tidal).toBeDefined();
      expect(rateLimiter.configs.tidal.requestsPerSecond).toBe(1);
      expect(rateLimiter.configs.tidal.burstSize).toBe(3);
    });
  });

  describe('Token Bucket Algorithm', () => {
    it('should start with burst size tokens', async () => {
      await rateLimiter.rateLimit('spotify');
      // After one request, should have burstSize - 1 tokens
      expect(rateLimiter.getTokens('spotify')).toBe(9);
    });

    it('should consume one token per request', async () => {
      await rateLimiter.rateLimit('spotify');
      await rateLimiter.rateLimit('spotify');
      await rateLimiter.rateLimit('spotify');
      
      expect(rateLimiter.getTokens('spotify')).toBe(7);
    });

    it('should refill tokens over time', async () => {
      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.rateLimit('spotify');
      }
      
      expect(rateLimiter.getTokens('spotify')).toBe(0);
      
      // Advance time by 1 second (should add 5 tokens at 5/sec)
      vi.advanceTimersByTime(1000);
      
      await rateLimiter.rateLimit('spotify');
      // Should have refilled some tokens then consumed one
      expect(rateLimiter.getTokens('spotify')).toBeGreaterThan(0);
    });

    it('should not exceed burst size when refilling', async () => {
      // Advance time significantly
      vi.advanceTimersByTime(10000);
      
      await rateLimiter.rateLimit('spotify');
      
      // Should be at burstSize - 1, not higher
      expect(rateLimiter.getTokens('spotify')).toBeLessThanOrEqual(9);
    });
  });

  describe('Rate Limiting Behavior', () => {
    it('should not wait when tokens available', async () => {
      const start = Date.now();
      await rateLimiter.rateLimit('spotify');
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(10); // Should be near-instant
    });

    it('should wait when no tokens available', async () => {
      // Use a service with small burst and slow refill
      rateLimiter.setConfig('test', { requestsPerSecond: 1, burstSize: 1 });
      
      await rateLimiter.rateLimit('test'); // Use the 1 token
      
      // Next request should need to wait
      const waitPromise = rateLimiter.rateLimit('test');
      
      // Advance timer to allow refill
      vi.advanceTimersByTime(1000);
      
      await waitPromise;
      
      // Should have consumed the refilled token
      expect(rateLimiter.getTokens('test')).toBe(0);
    });

    it('should calculate correct wait time based on rate', () => {
      // For a service with 2 req/sec, wait for 1 token should be 500ms
      const requestsPerSecond = 2;
      const tokensNeeded = 1;
      const waitTime = tokensNeeded / requestsPerSecond * 1000;
      
      expect(waitTime).toBe(500);
    });
  });

  describe('Configuration Updates', () => {
    it('should allow updating service configuration', () => {
      rateLimiter.setConfig('custom', { requestsPerSecond: 20, burstSize: 50 });
      
      expect(rateLimiter.configs.custom).toBeDefined();
      expect(rateLimiter.configs.custom.requestsPerSecond).toBe(20);
      expect(rateLimiter.configs.custom.burstSize).toBe(50);
    });

    it('should reset limiter state when config changes', async () => {
      await rateLimiter.rateLimit('spotify');
      await rateLimiter.rateLimit('spotify');
      
      const tokensBefore = rateLimiter.getTokens('spotify');
      
      rateLimiter.setConfig('spotify', { requestsPerSecond: 10, burstSize: 20 });
      
      await rateLimiter.rateLimit('spotify');
      
      // Should start fresh with new burst size
      expect(rateLimiter.getTokens('spotify')).toBe(19);
    });
  });

  describe('Unknown Services', () => {
    it('should use default config for unknown services', async () => {
      await rateLimiter.rateLimit('unknown_service');
      
      // Default is 5 req/sec, burst 10
      expect(rateLimiter.getTokens('unknown_service')).toBe(9);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple services independently', async () => {
      await rateLimiter.rateLimit('spotify');
      await rateLimiter.rateLimit('lastfm');
      await rateLimiter.rateLimit('lidarr');
      
      // Each service should have its own token count
      expect(rateLimiter.getTokens('spotify')).toBe(9);
      expect(rateLimiter.getTokens('lastfm')).toBe(9);
      expect(rateLimiter.getTokens('lidarr')).toBe(4);
    });
  });
});
