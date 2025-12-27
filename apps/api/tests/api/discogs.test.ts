/**
 * Discogs Service Tests
 * 
 * Tests:
 * - Label search
 * - Label releases
 * - Style/genre search
 * - Artist details
 * - Rate limiting
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscogsService } from '../../src/services/discogs.js';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Discogs Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let service: DiscogsService;
  const token = 'test-discogs-token';

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    service = new DiscogsService(token);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with token', () => {
      const svc = new DiscogsService('my-token');
      expect(svc).toBeInstanceOf(DiscogsService);
    });
  });

  describe('searchLabels', () => {
    it('should search for labels with default page', async () => {
      const mockResponse = {
        pagination: {
          page: 1,
          pages: 5,
          per_page: 25,
          items: 100,
        },
        results: [
          { id: 1, title: 'Warp Records', resource_url: 'https://api.discogs.com/labels/1' },
          { id: 2, title: 'Ninja Tune', resource_url: 'https://api.discogs.com/labels/2' },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchLabels('warp');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/database/search?type=label&q=warp&page=1&per_page=25',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Discogs token=test-discogs-token',
            'User-Agent': 'MixarrMusicDiscovery/1.0',
          }),
        })
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe('Warp Records');
      expect(result.pagination.items).toBe(100);
    });

    it('should search for labels with custom page', async () => {
      const mockResponse = {
        pagination: { page: 3, pages: 5, per_page: 25, items: 100 },
        results: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await service.searchLabels('electronic', 3);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/database/search?type=label&q=electronic&page=3&per_page=25',
        expect.any(Object)
      );
    });

    it('should handle empty search results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 0, per_page: 25, items: 0 },
          results: [],
        }),
      });

      const result = await service.searchLabels('nonexistentlabel12345');

      expect(result.results).toHaveLength(0);
      expect(result.pagination.items).toBe(0);
    });
  });

  describe('getLabelReleases', () => {
    it('should get releases for a label with default page', async () => {
      const mockResponse = {
        pagination: {
          page: 1,
          pages: 10,
          per_page: 50,
          items: 500,
        },
        releases: [
          {
            id: 12345,
            title: 'Album One',
            artist: 'Artist One',
            year: 2023,
            format: 'LP',
            catno: 'WARP001',
          },
          {
            id: 12346,
            title: 'Album Two',
            artist: 'Artist Two',
            year: 2022,
            format: 'CD',
            catno: 'WARP002',
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.getLabelReleases(1);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/labels/1/releases?page=1&per_page=50',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Discogs token=test-discogs-token',
          }),
        })
      );

      expect(result.releases).toHaveLength(2);
      expect(result.releases[0].title).toBe('Album One');
      expect(result.pagination.items).toBe(500);
    });

    it('should get releases for a label with custom page', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 5, pages: 10, per_page: 50, items: 500 },
          releases: [],
        }),
      });

      await service.getLabelReleases(123, 5);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/labels/123/releases?page=5&per_page=50',
        expect.any(Object)
      );
    });
  });

  describe('searchByStyle', () => {
    it('should search releases by style with default page', async () => {
      const mockResponse = {
        pagination: {
          page: 1,
          pages: 100,
          per_page: 50,
          items: 5000,
        },
        results: [
          {
            id: 99999,
            title: 'Ambient Album',
            type: 'release',
            style: ['Ambient', 'Drone'],
            genre: ['Electronic'],
          },
          {
            id: 99998,
            title: 'Another Ambient Album',
            type: 'release',
            style: ['Ambient'],
            genre: ['Electronic'],
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchByStyle('Ambient');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/database/search?type=release&style=Ambient&page=1&per_page=50',
        expect.any(Object)
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].style).toContain('Ambient');
    });

    it('should handle URL encoding for style with spaces', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 1, per_page: 50, items: 10 },
          results: [],
        }),
      });

      await service.searchByStyle('Progressive Rock', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/database/search?type=release&style=Progressive%20Rock&page=2&per_page=50',
        expect.any(Object)
      );
    });
  });

  describe('getArtist', () => {
    it('should get artist details by ID', async () => {
      const mockResponse = {
        id: 45678,
        name: 'Aphex Twin',
        realname: 'Richard D. James',
        profile: 'British electronic musician...',
        urls: ['http://aphextwin.warp.net/'],
        images: [
          { type: 'primary', uri: 'https://img.discogs.com/...' },
        ],
        members: [],
        namevariations: ['AFX', 'The Aphex Twin'],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.getArtist(45678);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/artists/45678',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Discogs token=test-discogs-token',
            'User-Agent': 'MixarrMusicDiscovery/1.0',
          }),
        })
      );

      expect(result.name).toBe('Aphex Twin');
      expect(result.realname).toBe('Richard D. James');
      expect(result.namevariations).toContain('AFX');
    });

    it('should handle artist not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(service.getArtist(999999999)).rejects.toThrow(
        'Discogs API error: 404 Not Found'
      );
    });
  });

  describe('error handling', () => {
    it('should throw error on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(service.searchLabels('test')).rejects.toThrow(
        'Discogs API error: 401 Unauthorized'
      );
    });

    it('should throw error on rate limit exceeded', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(service.searchLabels('test')).rejects.toThrow(
        'Discogs API error: 429 Too Many Requests'
      );
    });

    it('should throw error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.searchLabels('test')).rejects.toThrow('Network error');
    });
  });

  describe('testConnection', () => {
    it('should return success for valid token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { items: 1 },
          results: [{ id: 1, title: 'Test' }],
        }),
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });
});
