/**
 * ListenBrainz Service Tests
 * 
 * Tests:
 * - User validation
 * - Top artists retrieval
 * - Recommendations (top_artist, similar_artist)
 * - Similar users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListenBrainzService, VALID_PERIODS } from '../../src/services/listenbrainz.js';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a mock fetch response with both json() and text() methods
function mockResponse(data: unknown, ok = true, status = 200, statusText = 'OK'): Partial<Response> {
  const jsonStr = JSON.stringify(data);
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(jsonStr),
  };
}

// Helper for error responses
function mockErrorResponse(status: number, statusText: string, errorData?: { error?: string; code?: number }): Partial<Response> {
  const jsonStr = errorData ? JSON.stringify(errorData) : '';
  return {
    ok: false,
    status,
    statusText,
    json: () => errorData ? Promise.resolve(errorData) : Promise.reject(new Error('No body')),
    text: () => Promise.resolve(jsonStr),
  };
}

describe('ListenBrainz Service', () => {
  let service: ListenBrainzService;
  let mockFetch: ReturnType<typeof vi.fn>;
  const testUsername = 'testuser';
  const testToken = 'test-token-12345';

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    service = new ListenBrainzService(testUsername);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with username only', () => {
      const svc = new ListenBrainzService('myuser');
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });

    it('should create service with username and token', () => {
      const svc = new ListenBrainzService('myuser', 'my-token');
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });

    it('should throw error for empty username', () => {
      expect(() => new ListenBrainzService('')).toThrow('ListenBrainz username is required');
    });

    it('should throw error for whitespace-only username', () => {
      expect(() => new ListenBrainzService('   ')).toThrow('ListenBrainz username is required');
    });

    it('should trim whitespace from username', () => {
      const svc = new ListenBrainzService('  myuser  ', 'token');
      // Service should work without error, username is trimmed internally
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });
  });

  describe('validateUser', () => {
    it('should return true for valid user (without token, uses stats endpoint)', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { artists: [], count: 0 },
      }));

      const result = await service.validateUser();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/stats/user/${testUsername}/artists?range=all_time&count=1`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );
    });

    it('should return true for valid token (uses validate-token endpoint with Authorization header)', async () => {
      const serviceWithToken = new ListenBrainzService(testUsername, 'test-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername,
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(true);
      // Token should be in Authorization header, NOT in URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.listenbrainz.org/1/validate-token',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'Authorization': 'Token test-token',
          }),
        })
      );
    });

    it('should return false when token is invalid', async () => {
      const serviceWithToken = new ListenBrainzService(testUsername, 'invalid-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: false,
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(false);
    });

    it('should return false when token username does not match', async () => {
      const serviceWithToken = new ListenBrainzService('differentuser', 'test-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername, // Different from 'differentuser'
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      const result = await service.validateUser();

      expect(result).toBe(false);
    });

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.validateUser()).rejects.toThrow('ListenBrainz API error: 500 Internal Server Error');
    });
  });

  describe('getUserTopArtists', () => {
    it('should return top artists for a period', async () => {
      const responseData = {
        payload: {
          artists: [
            { artist_name: 'Artist One', listen_count: 100, artist_mbid: 'mbid-1' },
            { artist_name: 'Artist Two', listen_count: 80, artist_mbid: 'mbid-2' },
          ],
          count: 2,
          total_artist_count: 50,
          range: 'month',
          user_id: testUsername,
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getUserTopArtists('month', 25);

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0].artist_name).toBe('Artist One');
      expect(result.artists[0].listen_count).toBe(100);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/stats/user/${testUsername}/artists?range=month&count=25`,
        expect.any(Object)
      );
    });

    it('should handle all valid periods', async () => {
      const periods = ['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time'] as const;

      for (const period of periods) {
        mockFetch.mockResolvedValue(mockResponse({
          payload: { artists: [], count: 0, total_artist_count: 0 },
        }));

        const result = await service.getUserTopArtists(period, 10);

        expect(result.artists).toEqual([]);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining(`range=${period}`),
          expect.any(Object)
        );
      }
    });

    it('should use default count if not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { artists: [], count: 0, total_artist_count: 0 },
      }));

      await service.getUserTopArtists('month');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('count=25'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, 'Bad Request'));

      await expect(service.getUserTopArtists('month', 10)).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getRecommendations', () => {
    it('should return top_artist recommendations', async () => {
      const responseData = {
        payload: {
          mbids: [
            { recording_mbid: 'rec-1', score: 0.95 },
            { recording_mbid: 'rec-2', score: 0.90 },
          ],
          count: 2,
          user_name: testUsername,
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getRecommendations('top_artist', 10);

      expect(result.mbids).toHaveLength(2);
      expect(result.mbids[0].recording_mbid).toBe('rec-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/cf/recommendation/user/${testUsername}/recording?artist_type=top_artist&count=10`,
        expect.any(Object)
      );
    });

    it('should return similar_artist recommendations', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { mbids: [], count: 0 },
      }));

      await service.getRecommendations('similar_artist', 5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('artist_type=similar_artist'),
        expect.any(Object)
      );
    });

    it('should use default count if not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { mbids: [], count: 0 },
      }));

      await service.getRecommendations('top_artist');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('count=25'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      await expect(service.getRecommendations('top_artist', 10)).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getSimilarUsers', () => {
    it('should return similar users', async () => {
      const responseData = {
        payload: [
          { user_name: 'user1', similarity: 0.85 },
          { user_name: 'user2', similarity: 0.72 },
        ],
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getSimilarUsers();

      expect(result).toHaveLength(2);
      expect(result[0].user_name).toBe('user1');
      expect(result[0].similarity).toBe(0.85);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/user/${testUsername}/similar-users`,
        expect.any(Object)
      );
    });

    it('should return empty array when no similar users', async () => {
      mockFetch.mockResolvedValue(mockResponse({ payload: [] }));

      const result = await service.getSimilarUsers();

      expect(result).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getSimilarUsers()).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('with token', () => {
    beforeEach(() => {
      service = new ListenBrainzService(testUsername, testToken);
    });

    it('should include Authorization header when token is provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({ payload: [] }));

      await service.getSimilarUsers();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Token ${testToken}`,
          }),
        })
      );
    });
  });

  describe('timeout handling', () => {
    it('should abort request on timeout', async () => {
      // Create service with short timeout
      const shortTimeoutService = new ListenBrainzService(testUsername, testToken, 100);
      
      // Mock fetch to simulate slow response - delay longer than timeout
      mockFetch.mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          // Listen for abort signal
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const error = new Error('AbortError');
              error.name = 'AbortError';
              reject(error);
            });
          }
          // Never resolve naturally
        });
      });

      await expect(shortTimeoutService.validateUser()).rejects.toThrow('ListenBrainz API request timed out');
    }, 5000); // Test timeout of 5 seconds

    it('should complete successfully within timeout', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername,
      }));

      const result = await service.validateUser();

      expect(result).toBe(true);
    });
  });

  describe('VALID_PERIODS constant', () => {
    it('should export valid periods array', () => {
      expect(VALID_PERIODS).toEqual(['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time']);
    });

    it('should contain all expected periods', () => {
      expect(VALID_PERIODS).toContain('week');
      expect(VALID_PERIODS).toContain('month');
      expect(VALID_PERIODS).toContain('quarter');
      expect(VALID_PERIODS).toContain('half_yearly');
      expect(VALID_PERIODS).toContain('year');
      expect(VALID_PERIODS).toContain('all_time');
    });
  });
});
