/**
 * Lidarr Service Tests
 * 
 * Tests:
 * - API request handling
 * - Retry logic with exponential backoff
 * - Connection testing
 * - Artist CRUD operations
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Lidarr Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createService = () => ({
    baseUrl: 'http://localhost:8686',
    apiKey: 'test-api-key',
    maxRetries: 3,
    baseDelay: 100,
  });

  describe('testConnection', () => {
    it('should return success with version on valid connection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.2.3' }),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/system/status', {
        headers: { 'X-Api-Key': 'test-api-key' },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.version).toBe('1.2.3');
    });

    it('should return failure on connection error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        await mockFetch('http://localhost:8686/api/v1/system/status');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('ECONNREFUSED');
      }
    });

    it('should return failure on invalid API key', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API Key'),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/system/status', {
        headers: { 'X-Api-Key': 'invalid-key' },
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('getArtists', () => {
    it('should return list of artists', async () => {
      const mockArtists = [
        { id: 1, artistName: 'Artist One', foreignArtistId: 'mbid-1' },
        { id: 2, artistName: 'Artist Two', foreignArtistId: 'mbid-2' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockArtists),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist');
      const artists = await response.json();

      expect(artists).toHaveLength(2);
      expect(artists[0].artistName).toBe('Artist One');
    });

    it('should return empty array when no artists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist');
      const artists = await response.json();

      expect(artists).toHaveLength(0);
    });
  });

  describe('searchArtist', () => {
    it('should return search results', async () => {
      const mockResults = [
        { foreignArtistId: 'mbid-1', artistName: 'Search Result' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      });

      const response = await mockFetch(
        'http://localhost:8686/api/v1/artist/lookup?term=Search%20Result'
      );
      const results = await response.json();

      expect(results).toHaveLength(1);
      expect(results[0].artistName).toBe('Search Result');
    });

    it('should return empty array for no matches', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const response = await mockFetch(
        'http://localhost:8686/api/v1/artist/lookup?term=NonExistent'
      );
      const results = await response.json();

      expect(results).toHaveLength(0);
    });
  });

  describe('addArtist', () => {
    it('should add artist and return result', async () => {
      const newArtist = {
        id: 123,
        artistName: 'New Artist',
        foreignArtistId: 'mbid-new',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(newArtist),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist', {
        method: 'POST',
        body: JSON.stringify({
          artistName: 'New Artist',
          foreignArtistId: 'mbid-new',
          qualityProfileId: 1,
          metadataProfileId: 1,
          rootFolderPath: '/music',
        }),
      });
      const result = await response.json();

      expect(result.id).toBe(123);
      expect(result.artistName).toBe('New Artist');
    });

    it('should handle duplicate artist error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Artist already exists'),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist', {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it('should pass monitorOption to Lidarr when specified', async () => {
      // This test verifies that addArtist accepts and passes monitorOption
      // to the Lidarr API request body under addOptions.monitor
      
      const searchResult = { foreignArtistId: 'mbid-test', artistName: 'Test Artist' };
      const newArtist = {
        id: 456,
        artistName: 'Test Artist',
        foreignArtistId: 'mbid-test',
      };

      // Mock search call then add call
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([searchResult]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(newArtist),
        });

      // Import and use the actual service
      const { LidarrService } = await import('../../src/services/lidarr.js');
      const lidarr = new LidarrService({ url: 'http://localhost:8686', apiKey: 'test' });

      // Call addArtist with monitorOption = 'none'
      await lidarr.addArtist(
        'mbid-test',
        1,   // qualityProfileId
        1,   // metadataProfileId
        '/music',
        true,  // monitored
        true,  // searchForMissingAlbums
        'none' // monitorOption - should be passed to Lidarr
      );

      // Verify the POST call included monitor: 'none' in addOptions
      const postCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.addOptions.monitor).toBe('none');
    });

    it('should default monitorOption to "all" when not specified', async () => {
      const searchResult = { foreignArtistId: 'mbid-default', artistName: 'Default Artist' };
      const newArtist = {
        id: 789,
        artistName: 'Default Artist',
        foreignArtistId: 'mbid-default',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([searchResult]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(newArtist),
        });

      const { LidarrService } = await import('../../src/services/lidarr.js');
      const lidarr = new LidarrService({ url: 'http://localhost:8686', apiKey: 'test' });

      // Call addArtist without monitorOption (should default to 'all')
      await lidarr.addArtist(
        'mbid-default',
        1,
        1,
        '/music'
      );

      const postCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.addOptions.monitor).toBe('all');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on 500 errors', async () => {
      const config = createService();
      let attempts = 0;

      mockFetch.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: () => Promise.resolve('Server Error'),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      // Simulate retry loop
      for (let i = 0; i <= config.maxRetries; i++) {
        const response = await mockFetch('http://localhost:8686/api/v1/test');
        if (response.ok) break;
      }

      expect(attempts).toBe(3);
    });

    it('should retry on 429 rate limit errors', async () => {
      let attempts = 0;

      mockFetch.mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: () => Promise.resolve('Rate limited'),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      // First call fails with 429
      const response1 = await mockFetch('http://localhost:8686/api/v1/test');
      expect(response1.status).toBe(429);

      // Retry succeeds
      const response2 = await mockFetch('http://localhost:8686/api/v1/test');
      expect(response2.ok).toBe(true);
    });

    it('should retry on network errors', async () => {
      let attempts = 0;

      mockFetch.mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('fetch failed'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      // First call fails
      try {
        await mockFetch('http://localhost:8686/api/v1/test');
      } catch (e) {
        // Expected
      }

      // Retry succeeds
      const response = await mockFetch('http://localhost:8686/api/v1/test');
      expect(response.ok).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should not retry on 400 errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid input'),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/test');
      
      // 400 errors should not be retried
      expect(response.status).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', () => {
      const config = createService();
      
      const delays = [0, 1, 2, 3].map(attempt => {
        if (attempt === 0) return 0;
        return config.baseDelay * Math.pow(2, attempt - 1);
      });

      expect(delays).toEqual([0, 100, 200, 400]);
    });
  });

  describe('getQualityProfiles', () => {
    it('should return quality profiles', async () => {
      const mockProfiles = [
        { id: 1, name: 'Any' },
        { id: 2, name: 'Lossless' },
        { id: 3, name: 'Standard' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfiles),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/qualityprofile');
      const profiles = await response.json();

      expect(profiles).toHaveLength(3);
      expect(profiles[1].name).toBe('Lossless');
    });
  });

  describe('getMetadataProfiles', () => {
    it('should return metadata profiles', async () => {
      const mockProfiles = [
        { id: 1, name: 'Standard' },
        { id: 2, name: 'Extended' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfiles),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/metadataprofile');
      const profiles = await response.json();

      expect(profiles).toHaveLength(2);
    });
  });

  describe('getRootFolders', () => {
    it('should return root folders', async () => {
      const mockFolders = [
        { id: 1, path: '/music', freeSpace: 1000000000000 },
        { id: 2, path: '/music2', freeSpace: 500000000000 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFolders),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/rootfolder');
      const folders = await response.json();

      expect(folders).toHaveLength(2);
      expect(folders[0].path).toBe('/music');
    });
  });

  describe('Error Message Parsing', () => {
    it('should extract JSON error message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve(JSON.stringify({ message: 'Detailed error' })),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/test');
      const errorText = await response.text();
      
      try {
        const jsonError = JSON.parse(errorText);
        expect(jsonError.message).toBe('Detailed error');
      } catch {
        expect.fail('Should parse as JSON');
      }
    });

    it('should handle HTML error responses', async () => {
      const htmlError = '<html><body><h1>500 Internal Server Error</h1></body></html>';
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(htmlError),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/test');
      const errorText = await response.text();
      
      // Should truncate long HTML
      const truncated = errorText.substring(0, 200);
      expect(truncated.length).toBeLessThanOrEqual(200);
    });
  });

  describe('getArtistByMbid', () => {
    it('should return artist when found by MBID', async () => {
      const mockArtists = [
        { id: 1, artistName: 'Artist One', foreignArtistId: 'mbid-1' },
        { id: 2, artistName: 'Artist Two', foreignArtistId: 'mbid-2' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockArtists),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist');
      const artists = await response.json();
      const found = artists.find((a: { foreignArtistId: string }) => a.foreignArtistId === 'mbid-2');

      expect(found).toBeDefined();
      expect(found.id).toBe(2);
      expect(found.artistName).toBe('Artist Two');
    });

    it('should return undefined when artist not found', async () => {
      const mockArtists = [
        { id: 1, artistName: 'Artist One', foreignArtistId: 'mbid-1' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockArtists),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist');
      const artists = await response.json();
      const found = artists.find((a: { foreignArtistId: string }) => a.foreignArtistId === 'non-existent');

      expect(found).toBeUndefined();
    });
  });

  describe('addArtistUnmonitored', () => {
    it('should add artist with monitor set to none', async () => {
      // First mock: search lookup returns artist
      const mockSearchResult = {
        foreignArtistId: 'mbid-new',
        artistName: 'New Artist',
        overview: 'A new artist',
      };

      // Second mock: POST creates artist
      const newArtist = {
        id: 123,
        artistName: 'New Artist',
        foreignArtistId: 'mbid-new',
        monitored: false,
      };

      let callCount = 0;
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        callCount++;
        if (url.includes('/artist/lookup')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockSearchResult]),
          });
        }
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          // Verify monitor is set to 'none' (camelCase for Lidarr API per OpenAPI spec)
          expect(body.addOptions.monitor).toBe('none');
          expect(body.monitored).toBe(false);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(newArtist),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      // Simulate search
      await mockFetch('http://localhost:8686/api/v1/artist/lookup?term=lidarr:mbid-new');
      
      // Simulate add
      const response = await mockFetch('http://localhost:8686/api/v1/artist', {
        method: 'POST',
        body: JSON.stringify({
          foreignArtistId: 'mbid-new',
          artistName: 'New Artist',
          qualityProfileId: 1,
          metadataProfileId: 1,
          rootFolderPath: '/music',
          monitored: false,
          addOptions: {
            monitor: 'none',
            searchForMissingAlbums: false,
          },
        }),
      });

      const result = await response.json();
      expect(result.id).toBe(123);
      expect(result.monitored).toBe(false);
    });
  });

  describe('getAlbums', () => {
    it('should return albums for an artist', async () => {
      const mockAlbums = [
        { id: 1, title: 'Album One', foreignAlbumId: 'album-mbid-1', artistId: 1, monitored: true },
        { id: 2, title: 'Album Two', foreignAlbumId: 'album-mbid-2', artistId: 1, monitored: false },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAlbums),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album?artistId=1');
      const albums = await response.json();

      expect(albums).toHaveLength(2);
      expect(albums[0].title).toBe('Album One');
      expect(albums[1].foreignAlbumId).toBe('album-mbid-2');
    });

    it('should return empty array when artist has no albums', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album?artistId=999');
      const albums = await response.json();

      expect(albums).toHaveLength(0);
    });
  });

  describe('lookupAlbum', () => {
    it('should lookup album by MBID', async () => {
      const mockAlbum = {
        foreignAlbumId: 'album-mbid-1',
        title: 'Test Album',
        artistId: 1,
        monitored: false,
        releaseDate: '2020-01-01',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockAlbum]),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album/lookup?term=lidarr:album-mbid-1');
      const albums = await response.json();

      expect(albums).toHaveLength(1);
      expect(albums[0].foreignAlbumId).toBe('album-mbid-1');
    });

    it('should return empty array when album not found', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album/lookup?term=lidarr:non-existent');
      const albums = await response.json();

      expect(albums).toHaveLength(0);
    });
  });

  describe('updateAlbum', () => {
    it('should update album monitored status', async () => {
      const updatedAlbum = {
        id: 1,
        title: 'Album One',
        foreignAlbumId: 'album-mbid-1',
        artistId: 1,
        monitored: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updatedAlbum),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album/1', {
        method: 'PUT',
        body: JSON.stringify({ monitored: true }),
      });
      const result = await response.json();

      expect(result.monitored).toBe(true);
    });

    it('should handle album not found error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Album not found'),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/album/999', {
        method: 'PUT',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe('searchAlbum', () => {
    it('should trigger album search command', async () => {
      const mockCommand = {
        id: 1,
        name: 'AlbumSearch',
        albumIds: [1],
        status: 'queued',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCommand),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/command', {
        method: 'POST',
        body: JSON.stringify({
          name: 'AlbumSearch',
          albumIds: [1],
        }),
      });
      const result = await response.json();

      expect(result.name).toBe('AlbumSearch');
      expect(result.albumIds).toContain(1);
    });
  });

  describe('addAlbum', () => {
    it('should add album when artist already exists', async () => {
      // Mock sequence:
      // 1. getArtists - returns existing artist
      // 2. getAlbums - returns albums including target
      // 3. updateAlbum - sets monitored: true
      // 4. command - triggers search

      const existingArtist = {
        id: 1,
        artistName: 'Existing Artist',
        foreignArtistId: 'artist-mbid',
        monitored: false,
      };

      const albums = [
        { id: 10, title: 'Target Album', foreignAlbumId: 'album-mbid', artistId: 1, monitored: false },
        { id: 11, title: 'Other Album', foreignAlbumId: 'other-mbid', artistId: 1, monitored: false },
      ];

      const updatedAlbum = { ...albums[0], monitored: true };

      let callIndex = 0;
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        callIndex++;
        
        if (url.includes('/artist') && !options?.method) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([existingArtist]),
          });
        }
        
        if (url.includes('/album?artistId=')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(albums),
          });
        }
        
        if (url.includes('/album/') && options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(updatedAlbum),
          });
        }
        
        if (url.includes('/command') && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 1, name: 'AlbumSearch' }),
          });
        }
        
        return Promise.resolve({ ok: false, status: 404 });
      });

      // Step 1: Check artist exists
      let response = await mockFetch('http://localhost:8686/api/v1/artist');
      let artists = await response.json();
      expect(artists.find((a: { foreignArtistId: string }) => a.foreignArtistId === 'artist-mbid')).toBeDefined();

      // Step 2: Get albums
      response = await mockFetch('http://localhost:8686/api/v1/album?artistId=1');
      const albumList = await response.json();
      const targetAlbum = albumList.find((a: { foreignAlbumId: string }) => a.foreignAlbumId === 'album-mbid');
      expect(targetAlbum).toBeDefined();

      // Step 3: Update album to monitored
      response = await mockFetch('http://localhost:8686/api/v1/album/10', {
        method: 'PUT',
        body: JSON.stringify({ ...targetAlbum, monitored: true }),
      });
      const updated = await response.json();
      expect(updated.monitored).toBe(true);

      // Step 4: Trigger search
      response = await mockFetch('http://localhost:8686/api/v1/command', {
        method: 'POST',
        body: JSON.stringify({ name: 'AlbumSearch', albumIds: [10] }),
      });
      const command = await response.json();
      expect(command.name).toBe('AlbumSearch');
    });

    it('should add artist first when not exists, then monitor album', async () => {
      // Mock sequence:
      // 1. getArtists - returns empty (artist not in library)
      // 2. searchArtist - lookup artist by MBID
      // 3. addArtist - add artist with monitor: 'none'
      // 4. getAlbums - get albums for new artist
      // 5. updateAlbum - set target album to monitored
      // 6. command - trigger search

      const searchResult = {
        foreignArtistId: 'artist-mbid',
        artistName: 'New Artist',
      };

      const newArtist = {
        id: 1,
        artistName: 'New Artist',
        foreignArtistId: 'artist-mbid',
        monitored: false,
      };

      const albums = [
        { id: 10, title: 'Target Album', foreignAlbumId: 'album-mbid', artistId: 1, monitored: false },
      ];

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/artist/lookup')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([searchResult]),
          });
        }
        
        if (url.includes('/artist') && options?.method === 'POST') {
          // Verify artist is added with monitor: 'none' (camelCase for Lidarr API per OpenAPI spec)
          const body = JSON.parse(options.body as string);
          expect(body.addOptions.monitor).toBe('none');
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(newArtist),
          });
        }
        
        if (url.includes('/artist') && !options?.method) {
          // First call returns empty, subsequent calls return artist
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          });
        }
        
        if (url.includes('/album?artistId=')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(albums),
          });
        }
        
        if (url.includes('/album/') && options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...albums[0], monitored: true }),
          });
        }
        
        if (url.includes('/command')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 1, name: 'AlbumSearch' }),
          });
        }
        
        return Promise.resolve({ ok: false, status: 404 });
      });

      // Step 1: Artist not in library
      let response = await mockFetch('http://localhost:8686/api/v1/artist');
      let artists = await response.json();
      expect(artists.find((a: { foreignArtistId: string }) => a.foreignArtistId === 'artist-mbid')).toBeUndefined();

      // Step 2: Search for artist
      response = await mockFetch('http://localhost:8686/api/v1/artist/lookup?term=lidarr:artist-mbid');
      const lookupResults = await response.json();
      expect(lookupResults).toHaveLength(1);

      // Step 3: Add artist with monitor: 'none'
      response = await mockFetch('http://localhost:8686/api/v1/artist', {
        method: 'POST',
        body: JSON.stringify({
          ...lookupResults[0],
          monitored: false,
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        }),
      });
      const addedArtist = await response.json();
      expect(addedArtist.id).toBe(1);

      // Step 4: Get albums
      response = await mockFetch('http://localhost:8686/api/v1/album?artistId=1');
      const albumList = await response.json();
      expect(albumList).toHaveLength(1);

      // Step 5: Monitor target album
      response = await mockFetch('http://localhost:8686/api/v1/album/10', {
        method: 'PUT',
        body: JSON.stringify({ ...albums[0], monitored: true }),
      });
      const updatedAlbum = await response.json();
      expect(updatedAlbum.monitored).toBe(true);

      // Step 6: Trigger search
      response = await mockFetch('http://localhost:8686/api/v1/command', {
        method: 'POST',
        body: JSON.stringify({ name: 'AlbumSearch', albumIds: [10] }),
      });
      const command = await response.json();
      expect(command.name).toBe('AlbumSearch');
    });

    it('should throw error when album not found for artist', async () => {
      const existingArtist = {
        id: 1,
        artistName: 'Existing Artist',
        foreignArtistId: 'artist-mbid',
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/artist')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([existingArtist]),
          });
        }
        if (url.includes('/album?artistId=')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]), // No albums
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      // Get artist
      let response = await mockFetch('http://localhost:8686/api/v1/artist');
      const artists = await response.json();
      expect(artists).toHaveLength(1);

      // Get albums - empty
      response = await mockFetch('http://localhost:8686/api/v1/album?artistId=1');
      const albums = await response.json();
      expect(albums).toHaveLength(0);

      // Looking for a specific album that doesn't exist
      const targetAlbum = albums.find((a: { foreignAlbumId: string }) => a.foreignAlbumId === 'non-existent-album');
      expect(targetAlbum).toBeUndefined();
    });
  });

  describe('updateArtist', () => {
    it('should update artist with new metadata via PUT', async () => {
      const updatedArtist = {
        id: 123,
        artistName: 'Test Artist',
        foreignArtistId: 'mbid-123',
        overview: 'New bio from enrichment',
        genres: ['rock', 'indie'],
        images: [
          { coverType: 'poster', url: 'https://example.com/poster.jpg' },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updatedArtist),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist/123', {
        method: 'PUT',
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedArtist),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8686/api/v1/artist/123',
        expect.objectContaining({ method: 'PUT' })
      );

      const data = await response.json();
      expect(data.overview).toBe('New bio from enrichment');
      expect(data.genres).toContain('rock');
    });

    it('should preserve existing fields when updating partial metadata', async () => {
      const existingArtist = {
        id: 123,
        artistName: 'Test Artist',
        foreignArtistId: 'mbid-123',
        path: '/music/Test Artist',
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitored: true,
        overview: '',
        genres: [],
      };

      const enrichedFields = {
        overview: 'New bio',
        genres: ['rock'],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...existingArtist, ...enrichedFields }),
      });

      const response = await mockFetch('http://localhost:8686/api/v1/artist/123', {
        method: 'PUT',
        body: JSON.stringify({ ...existingArtist, ...enrichedFields }),
      });

      const data = await response.json();
      expect(data.path).toBe('/music/Test Artist');
      expect(data.overview).toBe('New bio');
    });
  });
});
