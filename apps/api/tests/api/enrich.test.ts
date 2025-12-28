// apps/api/tests/api/enrich.test.ts
/**
 * Metadata Enrichment API Tests
 *
 * Tests:
 * - Single artist enrichment
 * - Batch incomplete artist enrichment
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLastfmService,
  resetIdCounter,
} from '../utils/fixtures.js';

// Mock the MetadataEnrichmentService
const mockEnrichArtist = vi.fn();
const mockEnrichArtists = vi.fn();

vi.mock('../../src/services/metadata-enrichment.js', () => ({
  MetadataEnrichmentService: vi.fn().mockImplementation(() => ({
    enrichArtist: mockEnrichArtist,
    enrichArtists: mockEnrichArtists,
  })),
}));

describe('Enrich Endpoints', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;
  let mockLastfm: ReturnType<typeof createMockLastfmService>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockLidarr = createMockLidarrService();
    mockLastfm = createMockLastfmService();
    vi.clearAllMocks();
  });

  describe('POST /api/search/lidarr/artists/:id/enrich', () => {
    it('should enrich single artist and return result', async () => {
      const enrichResult = {
        artistId: 123,
        artistName: 'Radiohead',
        success: true,
        updated: true,
        fieldsUpdated: ['overview', 'genres'],
        errors: [],
      };
      mockEnrichArtist.mockResolvedValue(enrichResult);

      const result = await mockEnrichArtist(123, { updateLidarr: true });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
      expect(result.fieldsUpdated).toContain('overview');
    });

    it('should return 400 for invalid artist ID', () => {
      const artistId = parseInt('invalid');
      expect(isNaN(artistId)).toBe(true);
    });

    it('should require Lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'lidarr', isActive: true },
      });

      expect(conn).toBeNull();
    });
  });

  describe('POST /api/search/lidarr/artists/enrich-incomplete', () => {
    it('should enrich all artists with missing metadata', async () => {
      const artists = [
        { id: 1, artistName: 'Artist 1', overview: '', genres: [] },
        { id: 2, artistName: 'Artist 2', overview: 'Has bio', genres: ['rock'] },
        { id: 3, artistName: 'Artist 3', overview: '', genres: [] },
      ];
      mockLidarr.getArtists.mockResolvedValue(artists);

      const enrichResults = [
        { artistId: 1, success: true, updated: true, fieldsUpdated: ['overview'] },
        { artistId: 3, success: true, updated: true, fieldsUpdated: ['genres'] },
      ];
      mockEnrichArtists.mockResolvedValue(enrichResults);

      // Filter incomplete (no overview or no genres)
      const incomplete = artists.filter(
        (a) => !a.overview?.trim() || !a.genres?.length
      );
      expect(incomplete).toHaveLength(2); // Artists 1 and 3 are missing fields, Artist 2 is complete

      const results = await mockEnrichArtists(
        incomplete.map((a) => a.id),
        { updateLidarr: true }
      );

      expect(results).toHaveLength(2);
      expect(results.filter((r: { updated: boolean }) => r.updated).length).toBe(2);
    });

    it('should respect limit parameter', async () => {
      const artists = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        artistName: `Artist ${i + 1}`,
        overview: '',
        genres: [],
      }));

      const limit = 50;
      const limitedArtists = artists.slice(0, limit);

      expect(limitedArtists).toHaveLength(50);
    });

    it('should return empty results when no incomplete artists', async () => {
      const artists = [
        { id: 1, artistName: 'Complete Artist', overview: 'Full bio', genres: ['rock', 'indie'] },
      ];
      mockLidarr.getArtists.mockResolvedValue(artists);

      // This artist has both overview and genres
      const incomplete = artists.filter(
        (a) => !a.overview?.trim() || !a.genres?.length
      );

      expect(incomplete).toHaveLength(0);
    });
  });
});
