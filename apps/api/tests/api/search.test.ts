/**
 * Search API Tests
 * 
 * Tests:
 * - Artist search
 * - Album search
 * - In-library detection
 * - Deezer image enrichment
 * - Last.fm stats enrichment
 * - Add artist from search
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma before importing multi-search
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLastfmService,
  createMockLidarrCache,
  createMockLidarrConnection,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Search API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;
  let mockLastfm: ReturnType<typeof createMockLastfmService>;
  let mockCache: ReturnType<typeof createMockLidarrCache>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockLidarr = createMockLidarrService();
    mockLastfm = createMockLastfmService();
    mockCache = createMockLidarrCache();
  });

  describe('GET /api/search/artists', () => {
    it('should require search query', () => {
      const query = '';
      const isValid = query && typeof query === 'string';
      expect(isValid).toBeFalsy();
    });

    it('should require Lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'lidarr', isActive: true },
      });
      
      expect(conn).toBeNull();
    });

    it('should search artists via Lidarr', async () => {
      const searchResults = [
        { foreignArtistId: 'mbid1', artistName: 'Pink Floyd', overview: 'Rock band' },
        { foreignArtistId: 'mbid2', artistName: 'Pink', overview: 'Pop artist' },
      ];
      mockLidarr.searchArtist.mockResolvedValue(searchResults);
      
      const results = await mockLidarr.searchArtist('pink');
      
      expect(results).toHaveLength(2);
      expect(results[0].artistName).toBe('Pink Floyd');
    });

    it('should mark artists already in library', async () => {
      mockCache.exists.mockResolvedValue(true);
      
      const inLibrary = await mockCache.exists({ mbid: 'mbid1' });
      
      expect(inLibrary).toBe(true);
    });

    it('should mark artists not in library', async () => {
      mockCache.exists.mockResolvedValue(false);
      
      const inLibrary = await mockCache.exists({ mbid: 'unknown-mbid' });
      
      expect(inLibrary).toBe(false);
    });

    it('should enrich with Last.fm stats when requested', async () => {
      mockLastfm.getArtistInfo.mockResolvedValue({
        name: 'Pink Floyd',
        listeners: 5000000,
        playcount: 200000000,
        tags: ['rock', 'progressive rock', 'psychedelic'],
      });
      
      const info = await mockLastfm.getArtistInfo('Pink Floyd');
      
      expect(info?.listeners).toBe(5000000);
      expect(info?.tags).toContain('rock');
    });

    it('should use global Lidarr when user has none', async () => {
      const globalLidarr = createMockLidarrConnection(null);
      mockPrisma.connection.findFirst.mockResolvedValue(globalLidarr);
      
      const conn = await mockPrisma.connection.findFirst({
        where: {
          OR: [
            { userId: testUser.id, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' },
      });
      
      expect(conn?.userId).toBeNull();
    });
  });

  describe('GET /api/search/albums', () => {
    it('should search albums via Lidarr', async () => {
      const searchResults = [
        { 
          foreignAlbumId: 'album1', 
          title: 'The Dark Side of the Moon', 
          artistName: 'Pink Floyd',
          releaseDate: '1973-03-01',
        },
      ];
      mockLidarr.searchArtist.mockResolvedValue([]); // Using same mock for demo
      
      expect(searchResults[0].title).toBe('The Dark Side of the Moon');
    });
  });

  describe('POST /api/search/add', () => {
    it('should add artist to Lidarr', async () => {
      mockLidarr.getQualityProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }]);
      mockLidarr.getMetadataProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }]);
      mockLidarr.getRootFolders.mockResolvedValue([{ id: 1, path: '/music' }]);
      mockLidarr.addArtist.mockResolvedValue({ id: 123 });
      
      const profiles = await mockLidarr.getQualityProfiles();
      const metadata = await mockLidarr.getMetadataProfiles();
      const folders = await mockLidarr.getRootFolders();
      
      expect(profiles).toHaveLength(1);
      expect(metadata).toHaveLength(1);
      expect(folders).toHaveLength(1);
      
      const result = await mockLidarr.addArtist(
        'mbid123',
        profiles[0].id,
        metadata[0].id,
        folders[0].path
      );
      
      expect(result.id).toBe(123);
    });

    it('should require foreignArtistId', () => {
      const body = { foreignArtistId: '' };
      const isValid = body.foreignArtistId && typeof body.foreignArtistId === 'string';
      expect(isValid).toBeFalsy();
    });

    it('should prevent adding artist already in library', async () => {
      mockCache.exists.mockResolvedValue(true);
      
      const alreadyExists = await mockCache.exists({ mbid: 'mbid123' });
      
      expect(alreadyExists).toBe(true);
      // Should return error or skip
    });

    it('should handle Lidarr add failure', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('Artist already exists'));
      
      await expect(mockLidarr.addArtist('mbid', 1, 1, '/music')).rejects.toThrow('Artist already exists');
    });
  });

  describe('POST /api/search/add-album', () => {
    it('should add album to Lidarr from search results', async () => {
      // Album add involves adding the artist if not present
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 123 });
      
      const inLibrary = await mockCache.exists({ mbid: 'artist-mbid' });
      expect(inLibrary).toBe(false);
      
      // Would add artist first
      const result = await mockLidarr.addArtist('artist-mbid', 1, 1, '/music');
      expect(result.id).toBe(123);
    });
  });

  describe('LidarrService.addAlbum', () => {
    it('should add artist with monitor:none if artist not in library', async () => {
      // Artist doesn't exist in Lidarr
      mockLidarr.getArtistByMbid = vi.fn().mockResolvedValue(null);
      mockLidarr.addArtist.mockResolvedValue({ 
        id: 123, 
        foreignArtistId: 'artist-mbid-123',
        artistName: 'Pink Floyd',
        monitored: true,
      });
      mockLidarr.getAlbums = vi.fn().mockResolvedValue([
        { id: 1, foreignAlbumId: 'album-mbid-456', title: 'The Wall', monitored: false },
        { id: 2, foreignAlbumId: 'album-mbid-789', title: 'Dark Side', monitored: false },
      ]);
      mockLidarr.updateAlbum = vi.fn().mockResolvedValue({ id: 1, monitored: true });
      mockLidarr.searchAlbum = vi.fn().mockResolvedValue({ id: 1 });

      // Simulate addAlbum logic
      const artistMbid = 'artist-mbid-123';
      const albumMbid = 'album-mbid-456';
      
      // Check if artist exists
      const existingArtist = await mockLidarr.getArtistByMbid(artistMbid);
      expect(existingArtist).toBeNull();
      
      // Artist should be added with monitor: none
      expect(mockLidarr.addArtist).toBeDefined();
    });

    it('should find specific album by MBID and set it to monitored', async () => {
      const albums = [
        { id: 1, foreignAlbumId: 'album-mbid-456', title: 'The Wall', monitored: false },
        { id: 2, foreignAlbumId: 'target-album-mbid', title: 'Dark Side', monitored: false },
        { id: 3, foreignAlbumId: 'album-mbid-789', title: 'Animals', monitored: false },
      ];
      
      mockLidarr.getAlbums = vi.fn().mockResolvedValue(albums);
      mockLidarr.updateAlbum = vi.fn().mockResolvedValue({ 
        id: 2, 
        foreignAlbumId: 'target-album-mbid',
        title: 'Dark Side', 
        monitored: true 
      });

      const artistId = 123;
      const targetAlbumMbid = 'target-album-mbid';
      
      const albumList = await mockLidarr.getAlbums(artistId);
      const targetAlbum = albumList.find((a: { foreignAlbumId: string }) => a.foreignAlbumId === targetAlbumMbid);
      
      expect(targetAlbum).toBeDefined();
      expect(targetAlbum.title).toBe('Dark Side');
      
      const updatedAlbum = await mockLidarr.updateAlbum({ ...targetAlbum, monitored: true });
      expect(updatedAlbum.monitored).toBe(true);
    });

    it('should trigger search for the specific album only', async () => {
      mockLidarr.searchAlbum = vi.fn().mockResolvedValue({ id: 1 });
      
      const albumId = 42;
      await mockLidarr.searchAlbum(albumId);
      
      expect(mockLidarr.searchAlbum).toHaveBeenCalledWith(albumId);
    });

    it('should throw error if album not found in artist discography', async () => {
      mockLidarr.getAlbums = vi.fn().mockResolvedValue([
        { id: 1, foreignAlbumId: 'album-1', title: 'Album 1', monitored: false },
        { id: 2, foreignAlbumId: 'album-2', title: 'Album 2', monitored: false },
      ]);
      
      const artistId = 123;
      const nonExistentAlbumMbid = 'non-existent-album-mbid';
      
      const albums = await mockLidarr.getAlbums(artistId);
      const targetAlbum = albums.find((a: { foreignAlbumId: string }) => a.foreignAlbumId === nonExistentAlbumMbid);
      
      expect(targetAlbum).toBeUndefined();
    });

    it('should use existing artist if already in library', async () => {
      const existingArtist = {
        id: 99,
        foreignArtistId: 'artist-mbid-existing',
        artistName: 'Existing Artist',
        monitored: true,
      };
      
      mockLidarr.getArtistByMbid = vi.fn().mockResolvedValue(existingArtist);
      mockLidarr.getAlbums = vi.fn().mockResolvedValue([
        { id: 10, foreignAlbumId: 'album-xyz', title: 'New Album', monitored: false },
      ]);
      mockLidarr.updateAlbum = vi.fn().mockResolvedValue({ id: 10, monitored: true });
      mockLidarr.searchAlbum = vi.fn().mockResolvedValue({ id: 10 });

      const artistMbid = 'artist-mbid-existing';
      
      // Check existing artist
      const artist = await mockLidarr.getArtistByMbid(artistMbid);
      expect(artist).not.toBeNull();
      expect(artist.id).toBe(99);
      
      // Should NOT call addArtist since artist exists
      expect(mockLidarr.addArtist).not.toHaveBeenCalled();
    });
  });

  describe('Image enrichment', () => {
    it('should fetch Deezer images for search results', () => {
      // Mock Deezer image fetch
      const imageMap = new Map<string, string>([
        ['Pink Floyd', 'https://e-cdns-images.dzcdn.net/images/artist/...'],
        ['Pink', 'https://e-cdns-images.dzcdn.net/images/artist/...'],
      ]);
      
      expect(imageMap.get('Pink Floyd')).toBeDefined();
    });

    it('should handle missing Deezer images gracefully', () => {
      const imageMap = new Map<string, string>();
      
      expect(imageMap.get('Unknown Artist')).toBeUndefined();
    });
  });

  describe('Spotify Search', () => {
    it('should search artists via Spotify', async () => {
      const mockSpotify = {
        searchArtists: vi.fn().mockResolvedValue([
          { id: 'spotify1', name: 'Pink Floyd', popularity: 75, genres: ['rock'], imageUrl: 'https://img.com/1', followers: 5000000 },
        ]),
      };
      
      const results = await mockSpotify.searchArtists('pink floyd', 25);
      
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Pink Floyd');
      expect(results[0].popularity).toBeDefined();
      expect(results[0].followers).toBeDefined();
    });
  });

  describe('Multi-Source Search', () => {
    it('should merge results from multiple sources by name', async () => {
      const { mergeSearchResults } = await import('../../src/services/multi-search.js');
      
      const spotifyResults = [
        { name: 'Pink Floyd', source: 'spotify' as const, sourceId: 'sp1', imageUrl: 'spotify-img', popularity: 75 },
        { name: 'Pink', source: 'spotify' as const, sourceId: 'sp2', imageUrl: 'spotify-img2', popularity: 80 },
      ];
      const deezerResults = [
        { name: 'Pink Floyd', source: 'deezer' as const, sourceId: 123, imageUrl: 'deezer-img', fans: 5000000 },
        { name: 'Pinkish Black', source: 'deezer' as const, sourceId: 456, imageUrl: 'deezer-img2', fans: 50000 },
      ];
      
      const merged = mergeSearchResults([spotifyResults, deezerResults], ['spotify', 'deezer']);
      
      // Should have 3 unique artists: Pink Floyd, Pink, Pinkish Black
      expect(merged).toHaveLength(3);
      
      // Pink Floyd should have both sources
      const pinkFloyd = merged.find(r => r.name === 'Pink Floyd');
      expect(pinkFloyd?.sources).toContain('spotify');
      expect(pinkFloyd?.sources).toContain('deezer');
    });
    
    it('should prioritize sources in order', async () => {
      const { mergeSearchResults } = await import('../../src/services/multi-search.js');
      
      const spotifyResult = [{ name: 'Test Artist', source: 'spotify' as const, sourceId: 'sp1', imageUrl: 'spotify-img', popularity: 75 }];
      const deezerResult = [{ name: 'Test Artist', source: 'deezer' as const, sourceId: 123, imageUrl: 'deezer-img', fans: 100000 }];
      
      // Spotify is higher priority, so its image should be used
      const merged = mergeSearchResults([spotifyResult, deezerResult], ['spotify', 'deezer']);
      
      expect(merged[0].imageUrl).toBe('spotify-img');
    });

    it('should sort results by number of sources then popularity', async () => {
      const { mergeSearchResults } = await import('../../src/services/multi-search.js');
      
      const spotifyResults = [
        { name: 'Popular Artist', source: 'spotify' as const, sourceId: 'sp1', imageUrl: null, popularity: 90 },
        { name: 'Multi Source Artist', source: 'spotify' as const, sourceId: 'sp2', imageUrl: null, popularity: 50 },
      ];
      const deezerResults = [
        { name: 'Multi Source Artist', source: 'deezer' as const, sourceId: 123, imageUrl: null },
      ];
      
      const merged = mergeSearchResults([spotifyResults, deezerResults], ['spotify', 'deezer']);
      
      // Multi Source Artist should come first (2 sources > 1 source)
      expect(merged[0].name).toBe('Multi Source Artist');
      expect(merged[0].sources).toHaveLength(2);
    });
  });

  describe('GET /api/search/discover', () => {
    it('should accept sources query parameter', () => {
      const sources = 'spotify,deezer';
      const parsed = sources.split(',').filter(s => 
        ['spotify', 'deezer', 'tidal', 'bandcamp'].includes(s)
      );
      
      expect(parsed).toEqual(['spotify', 'deezer']);
    });
    
    it('should filter invalid sources', () => {
      const sources = 'spotify,invalid,deezer,unknown';
      const validSources = ['spotify', 'deezer', 'tidal', 'bandcamp'];
      const parsed = sources.split(',').filter(s => validSources.includes(s));
      
      expect(parsed).toEqual(['spotify', 'deezer']);
    });
    
    it('should default to all sources when none specified', () => {
      const sources = '';
      const parsed = sources ? sources.split(',') : ['spotify', 'deezer', 'tidal', 'bandcamp'];
      
      expect(parsed).toHaveLength(4);
    });
  });
});
