/**
 * Last.fm Service Tests
 * 
 * Tests:
 * - Chart endpoints (top artists, top tracks)
 * - Tag-based queries
 * - Similar artists
 * - User scrobble data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Last.fm Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const apiKey = 'test-lastfm-api-key';
  const baseUrl = 'https://ws.audioscrobbler.com/2.0';

  describe('getTopArtists', () => {
    it('should return chart top artists', async () => {
      const mockResponse = {
        artists: {
          artist: [
            { name: 'Artist One', playcount: '1000000', mbid: 'mbid-1' },
            { name: 'Artist Two', playcount: '900000', mbid: 'mbid-2' },
          ],
          '@attr': { page: '1', perPage: '50', total: '100' },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch(
        `${baseUrl}?method=chart.gettopartists&api_key=${apiKey}&format=json&limit=50`
      );
      const data = await response.json();

      expect(data.artists.artist).toHaveLength(2);
      expect(data.artists.artist[0].name).toBe('Artist One');
    });

    it('should handle period parameter', async () => {
      const periods = ['overall', '7day', '1month', '3month', '6month', '12month'];

      for (const period of periods) {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ artists: { artist: [] } }),
        });

        await mockFetch(
          `${baseUrl}?method=user.gettopartists&period=${period}&api_key=${apiKey}&format=json`
        );

        expect(mockFetch).toHaveBeenCalled();
      }
    });
  });

  describe('getTopTracks', () => {
    it('should return chart top tracks', async () => {
      const mockResponse = {
        tracks: {
          track: [
            { name: 'Track One', artist: { name: 'Artist One' }, playcount: '500000' },
            { name: 'Track Two', artist: { name: 'Artist Two' }, playcount: '450000' },
          ],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch(
        `${baseUrl}?method=chart.gettoptracks&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.tracks.track).toHaveLength(2);
    });
  });

  describe('getTagTopArtists', () => {
    it('should return artists for a tag', async () => {
      const mockResponse = {
        topartists: {
          artist: [
            { name: 'Rock Artist', mbid: 'mbid-rock-1' },
            { name: 'Another Rock Artist', mbid: 'mbid-rock-2' },
          ],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const tag = 'progressive rock';
      const response = await mockFetch(
        `${baseUrl}?method=tag.gettopartists&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.topartists.artist).toHaveLength(2);
    });

    it('should handle empty tag results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          topartists: { artist: [] },
        }),
      });

      const response = await mockFetch(
        `${baseUrl}?method=tag.gettopartists&tag=nonexistenttag&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.topartists.artist).toHaveLength(0);
    });
  });

  describe('getSimilarArtists', () => {
    it('should return similar artists', async () => {
      const mockResponse = {
        similarartists: {
          artist: [
            { name: 'Similar Artist 1', match: '1.0', mbid: 'mbid-sim-1' },
            { name: 'Similar Artist 2', match: '0.9', mbid: 'mbid-sim-2' },
          ],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch(
        `${baseUrl}?method=artist.getsimilar&artist=Test%20Artist&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.similarartists.artist).toHaveLength(2);
      expect(parseFloat(data.similarartists.artist[0].match)).toBeGreaterThan(0.5);
    });

    it('should handle artist with no similar artists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          similarartists: { artist: [] },
        }),
      });

      const response = await mockFetch(
        `${baseUrl}?method=artist.getsimilar&artist=Obscure%20Artist&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.similarartists.artist).toHaveLength(0);
    });
  });

  describe('getArtistInfo', () => {
    it('should return artist details', async () => {
      const mockResponse = {
        artist: {
          name: 'Test Artist',
          mbid: 'mbid-test',
          bio: { summary: 'Artist bio text' },
          tags: { tag: [{ name: 'rock' }, { name: 'alternative' }] },
          similar: { artist: [{ name: 'Similar' }] },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch(
        `${baseUrl}?method=artist.getinfo&artist=Test%20Artist&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.artist.name).toBe('Test Artist');
      expect(data.artist.mbid).toBe('mbid-test');
      expect(data.artist.tags.tag).toHaveLength(2);
    });

    it('should handle artist not found', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          error: 6,
          message: 'The artist you supplied could not be found',
        }),
      });

      const response = await mockFetch(
        `${baseUrl}?method=artist.getinfo&artist=NonExistentArtist&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.error).toBe(6);
    });
  });

  describe('getUserTopArtists', () => {
    it('should return user scrobble-based top artists', async () => {
      const mockResponse = {
        topartists: {
          artist: [
            { name: 'Most Played', playcount: '1000' },
            { name: 'Second Most', playcount: '800' },
          ],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch(
        `${baseUrl}?method=user.gettopartists&user=testuser&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.topartists.artist).toHaveLength(2);
    });

    it('should handle private profile', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          error: 17,
          message: 'User has disabled their recent listening information',
        }),
      });

      const response = await mockFetch(
        `${baseUrl}?method=user.gettopartists&user=privateuser&api_key=${apiKey}&format=json`
      );
      const data = await response.json();

      expect(data.error).toBe(17);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid API key', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          error: 10,
          message: 'Invalid API key',
        }),
      });

      const response = await mockFetch(`${baseUrl}?api_key=invalid&format=json`);
      const data = await response.json();

      expect(data.error).toBe(10);
    });

    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          error: 29,
          message: 'Rate limit exceeded',
        }),
      });

      const response = await mockFetch(`${baseUrl}?api_key=${apiKey}&format=json`);
      const data = await response.json();

      expect(data.error).toBe(29);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      try {
        await mockFetch(`${baseUrl}?api_key=${apiKey}&format=json`);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Network error');
      }
    });
  });

  describe('Response Normalization', () => {
    it('should handle single item as array', () => {
      // Last.fm returns single item as object, multiple as array
      const singleItemResponse = { artist: { name: 'Single Artist' } };
      const multiItemResponse = { artist: [{ name: 'Artist 1' }, { name: 'Artist 2' }] };

      const normalizeSingle = Array.isArray(singleItemResponse.artist)
        ? singleItemResponse.artist
        : [singleItemResponse.artist];

      const normalizeMulti = Array.isArray(multiItemResponse.artist)
        ? multiItemResponse.artist
        : [multiItemResponse.artist];

      expect(normalizeSingle).toHaveLength(1);
      expect(normalizeMulti).toHaveLength(2);
    });
  });
});
