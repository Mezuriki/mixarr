/**
 * Bandcamp Service Tests
 * 
 * Tests:
 * - Get tag releases (popular and by date)
 * - Search artists
 * - Image URL generation
 * - Rate limiting
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BandcampService } from '../../src/services/bandcamp.js';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Bandcamp Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let service: BandcampService;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    service = new BandcampService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service without configuration', () => {
      const svc = new BandcampService();
      expect(svc).toBeInstanceOf(BandcampService);
    });
  });

  describe('getTagReleases', () => {
    it('should get popular releases for a tag', async () => {
      const mockResponse = {
        items: [
          {
            id: 12345,
            type: 'a',
            band_id: 111,
            primary_text: 'Ambient Dreams',
            secondary_text: 'Space Artist',
            art_id: 99999,
            is_preorder: false,
            genre_text: 'ambient',
            url_hints: { subdomain: 'spaceartist', custom_domain: null, slug: 'ambient-dreams', item_type: 'a' },
          },
          {
            id: 67890,
            type: 'a',
            band_id: 222,
            primary_text: 'Electronic Vibes',
            secondary_text: 'Synth Master',
            art_id: 88888,
            is_preorder: true,
            genre_text: 'electronic',
            url_hints: { subdomain: 'synthmaster', custom_domain: null, slug: 'electronic-vibes', item_type: 'a' },
          },
        ],
        result_count: 1000,
        more_available: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.getTagReleases('electronic', 'pop');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://bandcamp.com/api/discover/3/get_web?s=top&p=0&g=electronic&f=all&w=0',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );

      expect(result.releases).toHaveLength(2);
      expect(result.releases[0]).toEqual({
        id: 12345,
        type: 'a',
        bandId: 111,
        title: 'Ambient Dreams',
        artistName: 'Space Artist',
        imageUrl: 'https://f4.bcbits.com/img/a99999_10.jpg',
        isPreorder: false,
        genre: 'ambient',
      });
      expect(result.releases[1].isPreorder).toBe(true);
      expect(result.totalCount).toBe(1000);
    });

    it('should get releases sorted by date', async () => {
      const mockResponse = {
        items: [],
        result_count: 0,
        more_available: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await service.getTagReleases('ambient', 'date', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://bandcamp.com/api/discover/3/get_web?s=new&p=2&g=ambient&f=all&w=0',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle releases without art_id', async () => {
      const mockResponse = {
        items: [
          {
            id: 12345,
            type: 'a',
            band_id: 111,
            primary_text: 'No Art Album',
            secondary_text: 'Unknown Artist',
            art_id: 0,
            is_preorder: false,
            url_hints: { subdomain: 'unknown', custom_domain: null, slug: 'no-art', item_type: 'a' },
          },
        ],
        result_count: 1,
        more_available: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.getTagReleases('test', 'pop');

      expect(result.releases[0].imageUrl).toBeNull();
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.getTagReleases('test', 'pop')).rejects.toThrow(
        'Bandcamp API error: 500 Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.getTagReleases('test', 'pop')).rejects.toThrow('Network error');
    });
  });

  describe('searchArtists', () => {
    it('should search for artists and return normalized results', async () => {
      const mockResponse = {
        auto: {
          results: [
            {
              type: 'b', // band type
              id: 123,
              name: 'Ambient Artist',
              band_name: 'Ambient Artist',
              img: 'https://f4.bcbits.com/img/custom.jpg',
              url: 'https://ambientartist.bandcamp.com',
              location: 'Berlin, Germany',
              genre: 'ambient',
              is_label: false,
            },
            {
              type: 'a', // artist type
              id: 456,
              name: 'Electronic Producer',
              img_id: 77777,
              url: 'https://electronicproducer.bandcamp.com',
              location: 'Los Angeles, USA',
              genre: 'electronic',
              is_label: false,
            },
            {
              type: 't', // track type - should be filtered out
              id: 789,
              name: 'Some Track',
            },
          ],
          time_ms: 50,
          stat: 'ok',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchArtists('ambient');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://bandcamp.com/api/fuzzysearch/2/autocomplete?q=ambient',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        })
      );

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({
        id: 123,
        name: 'Ambient Artist',
        url: 'https://ambientartist.bandcamp.com',
        imageUrl: 'https://f4.bcbits.com/img/custom.jpg',
        location: 'Berlin, Germany',
        genre: 'ambient',
        isLabel: false,
      });
      expect(result.artists[1].imageUrl).toBe('https://f4.bcbits.com/img/a77777_10.jpg');
    });

    it('should encode query parameters', async () => {
      const mockResponse = {
        auto: {
          results: [],
          time_ms: 10,
          stat: 'ok',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await service.searchArtists('ambient & electronic');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://bandcamp.com/api/fuzzysearch/2/autocomplete?q=ambient%20%26%20electronic',
        expect.any(Object)
      );
    });

    it('should handle empty search results', async () => {
      const mockResponse = {
        auto: {
          results: [],
          time_ms: 10,
          stat: 'ok',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchArtists('xyznonexistent');

      expect(result.artists).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(service.searchArtists('test')).rejects.toThrow(
        'Bandcamp API error: 429 Too Many Requests'
      );
    });

    it('should identify labels correctly', async () => {
      const mockResponse = {
        auto: {
          results: [
            {
              type: 'b',
              id: 100,
              name: 'Some Record Label',
              is_label: true,
            },
          ],
          time_ms: 10,
          stat: 'ok',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchArtists('record label');

      expect(result.artists[0].isLabel).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('should return success when connection works', async () => {
      const mockResponse = {
        items: [],
        total_count: 0,
        batch_size: 25,
        sequences: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.testConnection();

      expect(result).toEqual({ success: true });
    });

    it('should return error when connection fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const result = await service.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Bandcamp API error: 503 Service Unavailable',
      });
    });

    it('should return error when network fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Network error',
      });
    });
  });

  describe('image URL generation', () => {
    it('should generate correct image URL for art_id', async () => {
      const mockResponse = {
        items: [
          {
            tralbum_id: 1,
            tralbum_type: 'album',
            band_id: 1,
            album_title: 'Test',
            artist_name: 'Test',
            art_id: 123456789,
            is_preorder: false,
          },
        ],
        total_count: 1,
        batch_size: 25,
        sequences: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.getTagReleases('test', 'pop');

      expect(result.releases[0].imageUrl).toBe('https://f4.bcbits.com/img/a123456789_10.jpg');
    });
  });
});
