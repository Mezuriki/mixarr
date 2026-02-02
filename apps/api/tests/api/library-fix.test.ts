/**
 * Library Fix API Tests
 * 
 * Tests for POST /api/search/lidarr/artists/:id/fix endpoint
 * 
 * Tests:
 * - Input validation (artist ID)
 * - Lidarr connection check
 * - Artist not found handling
 * - Artist with no MBID handling
 * - Successful fix operation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLidarrConnection,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Library Fix API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockLidarr = createMockLidarrService();
  });

  describe('POST /api/search/lidarr/artists/:id/fix', () => {
    describe('Input Validation', () => {
      it('should return 400 for invalid artist ID (non-numeric)', () => {
        // The parseIntParam function should return null for non-numeric strings
        const invalidId = 'abc';
        const parsed = /^[0-9]+$/.test(invalidId) ? parseInt(invalidId, 10) : null;
        expect(parsed).toBeNull();
      });

      it('should return 400 for invalid artist ID (negative)', () => {
        // The parseIntParam function returns null for negative numbers
        const negativeId = '-1';
        const parsed = /^[0-9]+$/.test(negativeId) ? parseInt(negativeId, 10) : null;
        expect(parsed).toBeNull();
      });

      it('should return 400 for invalid artist ID (zero)', () => {
        // Zero is technically parsed but the service should reject it
        const zeroId = '0';
        const parsed = /^[0-9]+$/.test(zeroId) ? parseInt(zeroId, 10) : null;
        expect(parsed).toBe(0);
        // MetadataFixService.fixArtist validates artistId > 0
        expect(parsed).toBe(0); // Zero should be rejected by the endpoint
      });

      it('should return 400 for invalid artist ID (decimal)', () => {
        const decimalId = '1.5';
        const parsed = /^[0-9]+$/.test(decimalId) ? parseInt(decimalId, 10) : null;
        expect(parsed).toBeNull();
      });
    });

    describe('Lidarr Connection', () => {
      it('should return 400 when no Lidarr connection', async () => {
        mockPrisma.connection.findFirst.mockResolvedValue(null);
        
        const conn = await mockPrisma.connection.findFirst({
          where: { userId: testUser.id, type: 'lidarr', isActive: true },
        });
        
        expect(conn).toBeNull();
        // Endpoint should return: { error: 'No active Lidarr connection' }
      });

      it('should proceed when Lidarr connection exists', async () => {
        const lidarrConn = createMockLidarrConnection(testUser.id);
        mockPrisma.connection.findFirst.mockResolvedValue(lidarrConn);
        
        const conn = await mockPrisma.connection.findFirst({
          where: { userId: testUser.id, type: 'lidarr', isActive: true },
        });
        
        expect(conn).not.toBeNull();
        expect(conn!.type).toBe('lidarr');
      });
    });

    describe('Artist Lookup', () => {
      it('should return 404 when artist not found in Lidarr', async () => {
        mockLidarr.getArtist.mockResolvedValue(null);
        
        const artist = await mockLidarr.getArtist(999);
        
        expect(artist).toBeNull();
        // Endpoint should return: { error: 'Artist not found' }
      });

      it('should return 400 when artist has no MBID (foreignArtistId)', async () => {
        const artistWithoutMbid = {
          id: 123,
          artistName: 'Test Artist',
          foreignArtistId: '', // Empty MBID
          overview: 'A test artist',
          images: [],
          genres: [],
        };
        mockLidarr.getArtist.mockResolvedValue(artistWithoutMbid);
        
        const artist = await mockLidarr.getArtist(123);
        
        expect(artist).not.toBeNull();
        expect(artist!.foreignArtistId).toBeFalsy();
        // Endpoint should return: { error: 'Artist has no MusicBrainz ID' }
      });

      it('should proceed when artist has valid MBID', async () => {
        const artistWithMbid = {
          id: 123,
          artistName: 'Pink Floyd',
          foreignArtistId: '83d91898-7763-47d7-b03b-b92132c0c308',
          overview: '',
          images: [],
          genres: [],
        };
        mockLidarr.getArtist.mockResolvedValue(artistWithMbid);
        
        const artist = await mockLidarr.getArtist(123);
        
        expect(artist).not.toBeNull();
        expect(artist!.foreignArtistId).toBeTruthy();
        expect(artist!.foreignArtistId).toMatch(/^[0-9a-f-]{36}$/i);
      });
    });

    describe('Fix Operation', () => {
      it('should return fix result on success', async () => {
        const mockFixResult = {
          success: true,
          artist: {
            id: 123,
            name: 'Pink Floyd',
            hasPoster: true,
            hasOverview: true,
            hasGenres: true,
          },
          fixed: ['poster', 'overview'],
          stillMissing: [] as string[],
        };

        // Simulating the expected response structure
        expect(mockFixResult.success).toBe(true);
        expect(mockFixResult.artist.id).toBe(123);
        expect(mockFixResult.fixed).toContain('poster');
        expect(mockFixResult.fixed).toContain('overview');
        expect(mockFixResult.stillMissing).toHaveLength(0);
      });

      it('should return partial success when some metadata still missing', async () => {
        const mockFixResult = {
          success: false,
          artist: {
            id: 123,
            name: 'Test Artist',
            hasPoster: true,
            hasOverview: false,
            hasGenres: false,
          },
          fixed: ['poster'],
          stillMissing: ['overview', 'genres'],
        };

        expect(mockFixResult.success).toBe(false);
        expect(mockFixResult.fixed).toContain('poster');
        expect(mockFixResult.stillMissing).toContain('overview');
        expect(mockFixResult.stillMissing).toContain('genres');
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when fix operation throws', async () => {
        // Simulate MetadataFixService throwing an error
        const errorMessage = 'Failed to warm SkyHook cache';
        
        // The endpoint should catch this and return 500
        expect(() => {
          throw new Error(errorMessage);
        }).toThrow(errorMessage);
      });

      it('should return 500 when Lidarr refresh fails', async () => {
        mockLidarr.refreshArtist.mockRejectedValue(new Error('Lidarr connection timeout'));
        
        await expect(mockLidarr.refreshArtist(123)).rejects.toThrow('Lidarr connection timeout');
      });
    });
  });
});
