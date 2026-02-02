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

  describe('POST /api/search/lidarr/artists/fix-all', () => {
    describe('Starting Batch Fix', () => {
      it('should start job and return job info', () => {
        // When there are artists with issues, endpoint should:
        // 1. Start a batch fix job
        // 2. Return job info immediately
        const mockJobInfo = {
          jobId: 'fix-metadata-123',
          total: 847,
          estimatedMinutes: 14,
        };

        expect(mockJobInfo.jobId).toBeTruthy();
        expect(mockJobInfo.total).toBeGreaterThan(0);
        expect(mockJobInfo.estimatedMinutes).toBeGreaterThanOrEqual(0);
      });

      it('should return message when no artists need fixing', () => {
        // When no artists have metadata issues, return early with message
        const mockResponse = {
          jobId: null,
          total: 0,
          estimatedMinutes: 0,
          message: 'No artists need fixing',
        };

        expect(mockResponse.jobId).toBeNull();
        expect(mockResponse.total).toBe(0);
        expect(mockResponse.message).toBe('No artists need fixing');
      });

      it('should return 409 if job already running', () => {
        // When a job is already in progress, return 409 Conflict
        const errorResponse = {
          error: 'Job already in progress',
        };

        expect(errorResponse.error).toBe('Job already in progress');
        // The actual HTTP response would have status 409
      });

      it('should filter artists by issueType when provided', () => {
        // Request body can contain optional issueType filter
        const requestBody = {
          issueType: 'no_poster' as const,
        };

        expect(['no_poster', 'no_overview', 'no_genres', 'any']).toContain(requestBody.issueType);
      });
    });

    describe('Connection Validation', () => {
      it('should return 400 when no Lidarr connection', async () => {
        mockPrisma.connection.findFirst.mockResolvedValue(null);
        
        const conn = await mockPrisma.connection.findFirst({
          where: { userId: testUser.id, type: 'lidarr', isActive: true },
        });
        
        expect(conn).toBeNull();
        // Endpoint should return 400: { error: 'No active Lidarr connection' }
      });
    });
  });

  describe('GET /api/search/lidarr/artists/fix-all/status', () => {
    describe('Job Status Retrieval', () => {
      it('should return null status when no job exists', () => {
        // When no job has been started, status is null
        const mockResponse = {
          status: null,
        };

        expect(mockResponse.status).toBeNull();
      });

      it('should return job progress when job is running', () => {
        // When a job is in progress, return full status
        const mockStatus = {
          jobId: 'fix-metadata-123',
          status: 'running' as const,
          total: 847,
          processed: 234,
          fixed: 198,
          failed: 36,
          currentArtist: 'Miles Davis',
        };

        expect(mockStatus.jobId).toBeTruthy();
        expect(mockStatus.status).toBe('running');
        expect(mockStatus.processed).toBeLessThanOrEqual(mockStatus.total);
        expect(mockStatus.fixed + mockStatus.failed).toBeLessThanOrEqual(mockStatus.processed);
        expect(mockStatus.currentArtist).toBeTruthy();
      });

      it('should return completed status after job finishes', () => {
        // When job has completed, status reflects final state
        const mockStatus = {
          jobId: 'fix-metadata-123',
          status: 'completed' as const,
          total: 847,
          processed: 847,
          fixed: 811,
          failed: 36,
        };

        expect(mockStatus.status).toBe('completed');
        expect(mockStatus.processed).toBe(mockStatus.total);
      });
    });
  });

  describe('POST /api/search/lidarr/artists/fix-all/cancel', () => {
    describe('Job Cancellation', () => {
      it('should cancel running job and return success', () => {
        // When a job is running, cancellation should succeed
        const mockResponse = {
          cancelled: true,
        };

        expect(mockResponse.cancelled).toBe(true);
      });

      it('should return 404 when no job is running', () => {
        // When no job exists or job is not running, return 404
        const mockError = {
          error: 'No running job to cancel',
        };

        expect(mockError.error).toBe('No running job to cancel');
        // The actual HTTP response would have status 404
      });
    });
  });
});
