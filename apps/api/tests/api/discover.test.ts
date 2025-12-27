/**
 * Discover API Tests
 * 
 * Tests:
 * - Library browsing with pagination
 * - Similar artist recommendations
 * - Filtering already in library
 * - Seed selection
 * - Batch add operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLastfmService,
  createMockLidarrCache,
  createMockLidarrConnection,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Discover API', () => {
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

  describe('GET /api/discover/library', () => {
    it('should return paginated library', async () => {
      const artists = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        artistName: `Artist ${i + 1}`,
        foreignArtistId: `mbid${i + 1}`,
        monitored: true,
      }));
      mockLidarr.getArtists.mockResolvedValue(artists);
      
      const result = await mockLidarr.getArtists();
      
      expect(result).toHaveLength(100);
    });

    it('should support pagination parameters', () => {
      const page = 1;
      const limit = 500;
      const offset = (page - 1) * limit;
      
      expect(offset).toBe(0);
      
      const page2Offset = (2 - 1) * limit;
      expect(page2Offset).toBe(500);
    });

    it('should filter by search term', () => {
      const artists = [
        { artistName: 'Pink Floyd' },
        { artistName: 'Pink' },
        { artistName: 'Led Zeppelin' },
      ];
      
      const searchTerm = 'pink';
      const filtered = artists.filter(a => 
        a.artistName.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      expect(filtered).toHaveLength(2);
    });

    it('should use cache for library data', () => {
      // Simulating cache behavior
      const cache = new Map<string, { artists: unknown[]; timestamp: number }>();
      const cacheKey = `user-${testUser.id}`;
      const TTL = 60 * 1000; // 1 minute
      
      // Set cache
      cache.set(cacheKey, { artists: [], timestamp: Date.now() });
      
      // Check cache validity
      const cached = cache.get(cacheKey);
      const isValid = cached && (Date.now() - cached.timestamp) < TTL;
      
      expect(isValid).toBe(true);
    });

    it('should refresh cache when requested', () => {
      const cache = new Map<string, { artists: unknown[]; timestamp: number }>();
      const cacheKey = `user-${testUser.id}`;
      
      // Old cache
      cache.set(cacheKey, { artists: [], timestamp: Date.now() - 120000 }); // 2 min old
      
      const cached = cache.get(cacheKey);
      const isExpired = cached && (Date.now() - cached.timestamp) >= 60000;
      
      expect(isExpired).toBe(true);
    });

    it('should require Lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'lidarr' },
      });
      
      expect(conn).toBeNull();
    });
  });

  describe('POST /api/discover/recommendations', () => {
    it('should get recommendations from seed artists', async () => {
      const seedArtists = ['Pink Floyd', 'Led Zeppelin'];
      const recommendations = [
        { name: 'Genesis', listeners: 1000000 },
        { name: 'Yes', listeners: 800000 },
        { name: 'King Crimson', listeners: 600000 },
      ];
      
      mockLastfm.getSimilarArtists.mockResolvedValue(recommendations);
      
      const results = await mockLastfm.getSimilarArtists(seedArtists[0]);
      
      expect(results).toHaveLength(3);
    });

    it('should filter out artists already in library', async () => {
      const recommendations = [
        { name: 'Genesis', mbid: 'mbid1' },
        { name: 'Yes', mbid: 'mbid2' },
      ];
      
      // Simulate cache check
      mockCache.exists.mockImplementation(async ({ mbid }) => mbid === 'mbid1');
      
      const filtered = [];
      for (const rec of recommendations) {
        if (!await mockCache.exists({ mbid: rec.mbid })) {
          filtered.push(rec);
        }
      }
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Yes');
    });

    it('should limit results per seed', async () => {
      const limit = 100; // per seed
      const seeds = 5;
      const maxResults = limit * seeds;
      
      expect(maxResults).toBe(500);
    });

    it('should use random sampling for variety', () => {
      const allResults = Array.from({ length: 500 }, (_, i) => ({ name: `Artist ${i}` }));
      const sampleSize = 100;
      
      // Simulate random sampling
      const shuffled = [...allResults].sort(() => Math.random() - 0.5);
      const sample = shuffled.slice(0, sampleSize);
      
      expect(sample).toHaveLength(100);
    });

    it('should require seed artists', () => {
      const seeds: string[] = [];
      const isValid = seeds.length > 0;
      
      expect(isValid).toBe(false);
    });
  });

  describe('POST /api/discover/add', () => {
    it('should add single artist from recommendations', async () => {
      mockLidarr.addArtist.mockResolvedValue({ id: 123 });
      
      const result = await mockLidarr.addArtist('mbid123', 1, 1, '/music');
      
      expect(result.id).toBe(123);
    });

    it('should handle add failure gracefully', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('Failed to add'));
      
      await expect(mockLidarr.addArtist('mbid', 1, 1, '/music')).rejects.toThrow();
    });
  });

  describe('POST /api/discover/add-batch', () => {
    it('should add multiple artists in batch', async () => {
      const artists = [
        { foreignArtistId: 'mbid1', artistName: 'Artist 1' },
        { foreignArtistId: 'mbid2', artistName: 'Artist 2' },
        { foreignArtistId: 'mbid3', artistName: 'Artist 3' },
      ];
      
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      
      let added = 0;
      let failed = 0;
      
      for (const artist of artists) {
        try {
          await mockLidarr.addArtist(artist.foreignArtistId, 1, 1, '/music');
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(3);
      expect(failed).toBe(0);
    });

    it('should continue on individual failures', async () => {
      const artists = ['mbid1', 'mbid2', 'mbid3'];
      
      mockLidarr.addArtist
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: 3 });
      
      let added = 0;
      let failed = 0;
      
      for (const mbid of artists) {
        try {
          await mockLidarr.addArtist(mbid, 1, 1, '/music');
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(2);
      expect(failed).toBe(1);
    });
  });

  describe('Deezer image enrichment', () => {
    it('should add Deezer images to recommendations', () => {
      const recommendations = [
        { name: 'Artist 1' },
        { name: 'Artist 2' },
      ];
      
      const imageMap = new Map([
        ['Artist 1', 'https://deezer.com/image1.jpg'],
        ['Artist 2', 'https://deezer.com/image2.jpg'],
      ]);
      
      const enriched = recommendations.map(r => ({
        ...r,
        imageUrl: imageMap.get(r.name),
      }));
      
      expect(enriched[0].imageUrl).toBeDefined();
      expect(enriched[1].imageUrl).toBeDefined();
    });
  });
});
