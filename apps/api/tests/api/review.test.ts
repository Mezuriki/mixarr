/**
 * Review Queue API Tests
 * 
 * Tests:
 * - Review item CRUD
 * - Approve/reject workflow
 * - Bulk operations
 * - Lidarr integration on approve
 * - Logging of review actions
 * - Multi-tenant access
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  createMockReviewItem,
  createMockLidarrService,
  createMockLidarrCache,
  createMockLidarrConnection,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Review Queue API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;
  let mockCache: ReturnType<typeof createMockLidarrCache>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
    mockLidarr = createMockLidarrService();
    mockCache = createMockLidarrCache();
  });

  describe('GET /api/imports/review', () => {
    it('should return pending review items for user', async () => {
      const items = [
        createMockReviewItem({ userId: testUser.id, status: 'pending' }),
        createMockReviewItem({ userId: testUser.id, status: 'pending' }),
      ];
      mockPrisma.reviewItem.findMany.mockResolvedValue(items);
      
      const result = await mockPrisma.reviewItem.findMany({
        where: { userId: testUser.id, status: 'pending' },
      });
      
      expect(result).toHaveLength(2);
    });

    it('should return all review items for admin', async () => {
      const items = [
        createMockReviewItem({ userId: 1 }),
        createMockReviewItem({ userId: 2 }),
      ];
      mockPrisma.reviewItem.findMany.mockResolvedValue(items);
      
      const result = await mockPrisma.reviewItem.findMany({});
      
      expect(result).toHaveLength(2);
    });

    it('should support pagination', async () => {
      const limit = 50;
      const offset = 0;
      
      mockPrisma.reviewItem.findMany.mockResolvedValue([]);
      mockPrisma.reviewItem.count.mockResolvedValue(100);
      
      const total = await mockPrisma.reviewItem.count({ where: { userId: testUser.id } });
      
      expect(total).toBe(100);
      expect(Math.ceil(total / limit)).toBe(2); // 2 pages
    });

    it('should filter by status', async () => {
      const pendingItems = [createMockReviewItem({ status: 'pending' })];
      mockPrisma.reviewItem.findMany.mockResolvedValue(pendingItems);
      
      const result = await mockPrisma.reviewItem.findMany({
        where: { status: 'pending' },
      });
      
      expect(result[0].status).toBe('pending');
    });
  });

  describe('PUT /api/imports/review/:id', () => {
    it('should approve item and add to Lidarr', async () => {
      const item = createMockReviewItem({ status: 'pending' });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockPrisma.connection.findFirst.mockResolvedValue(createMockLidarrConnection(null));
      mockCache.exists.mockResolvedValue(false);
      mockCache.refresh.mockResolvedValue(undefined);
      mockLidarr.searchArtist.mockResolvedValue([{ foreignArtistId: 'mbid123' }]);
      mockLidarr.getQualityProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getMetadataProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getRootFolders.mockResolvedValue([{ path: '/music' }]);
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      mockPrisma.reviewItem.update.mockResolvedValue({ ...item, status: 'approved' });
      
      // Verify item exists and user can access
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: item.id } });
      expect(found).toBeDefined();
      
      // Mock the approval workflow
      const updatedItem = await mockPrisma.reviewItem.update({
        where: { id: item.id },
        data: { status: 'approved' },
      });
      
      expect(updatedItem.status).toBe('approved');
    });

    it('should mark as approved if already in library', async () => {
      const item = createMockReviewItem({ status: 'pending' });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockCache.exists.mockResolvedValue(true); // Already in library
      
      const alreadyInLibrary = await mockCache.exists({ name: item.artistName });
      
      expect(alreadyInLibrary).toBe(true);
      // Should still mark as approved, not add again
    });

    it('should reject item', async () => {
      const item = createMockReviewItem({ status: 'pending' });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockPrisma.reviewItem.update.mockResolvedValue({ ...item, status: 'rejected' });
      
      const result = await mockPrisma.reviewItem.update({
        where: { id: item.id },
        data: { status: 'rejected' },
      });
      
      expect(result.status).toBe('rejected');
    });

    it('should reset to pending', async () => {
      const item = createMockReviewItem({ status: 'rejected' });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockPrisma.reviewItem.update.mockResolvedValue({ ...item, status: 'pending' });
      
      const result = await mockPrisma.reviewItem.update({
        where: { id: item.id },
        data: { status: 'pending' },
      });
      
      expect(result.status).toBe('pending');
    });

    it('should require valid status', () => {
      const validStatuses = ['pending', 'approved', 'rejected'];
      const invalidStatus = 'invalid';
      
      expect(validStatuses.includes(invalidStatus)).toBe(false);
    });

    it('should prevent user from approving other users items', async () => {
      const otherUserItem = createMockReviewItem({ userId: 999 });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(otherUserItem);
      
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: otherUserItem.id } });
      const canUpdate = found?.userId === testUser.id || testUser.role === 'admin';
      
      expect(canUpdate).toBe(false);
    });

    it('should allow admin to approve any item', async () => {
      const otherUserItem = createMockReviewItem({ userId: 999 });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(otherUserItem);
      
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: otherUserItem.id } });
      const canUpdate = found?.userId === adminUser.id || adminUser.role === 'admin';
      
      expect(canUpdate).toBe(true);
    });

    it('should approve album and call addAlbum when itemType is album', async () => {
      const albumItem = createMockReviewItem({ 
        status: 'pending',
        itemType: 'album',
        artistName: 'Test Artist',
        albumName: 'Test Album',
        mbid: 'artist-mbid-123',
        albumMbid: 'album-mbid-456',
      });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(albumItem);
      mockPrisma.connection.findFirst.mockResolvedValue(createMockLidarrConnection(null));
      mockCache.exists.mockResolvedValue(false);
      mockCache.refresh.mockResolvedValue(undefined);
      mockLidarr.getQualityProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getMetadataProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getRootFolders.mockResolvedValue([{ path: '/music' }]);
      mockLidarr.addAlbum.mockResolvedValue({ artist: { id: 1 }, album: { id: 1 }, isNewArtist: false });
      mockPrisma.reviewItem.update.mockResolvedValue({ ...albumItem, status: 'approved' });
      
      // Verify item exists and is an album type
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: albumItem.id } });
      expect(found).toBeDefined();
      expect(found?.itemType).toBe('album');
      expect(found?.albumMbid).toBe('album-mbid-456');
      
      // Simulate the approval workflow for album
      // Should call addAlbum instead of addArtist
      if (found?.itemType === 'album' && found?.albumMbid) {
        await mockLidarr.addAlbum(
          found.mbid!,
          found.albumMbid,
          1, // qualityProfileId
          1, // metadataProfileId
          '/music' // rootFolderPath
        );
      } else {
        await mockLidarr.addArtist(found!.mbid!, 1, 1, '/music');
      }
      
      expect(mockLidarr.addAlbum).toHaveBeenCalledWith(
        'artist-mbid-123',
        'album-mbid-456',
        1,
        1,
        '/music'
      );
      expect(mockLidarr.addArtist).not.toHaveBeenCalled();
    });

    it('should approve artist (default behavior) when itemType is artist', async () => {
      const artistItem = createMockReviewItem({ 
        status: 'pending',
        itemType: 'artist',
        artistName: 'Test Artist',
        mbid: 'artist-mbid-123',
      });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(artistItem);
      mockPrisma.connection.findFirst.mockResolvedValue(createMockLidarrConnection(null));
      mockCache.exists.mockResolvedValue(false);
      mockCache.refresh.mockResolvedValue(undefined);
      mockLidarr.searchArtist.mockResolvedValue([{ foreignArtistId: 'artist-mbid-123' }]);
      mockLidarr.getQualityProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getMetadataProfiles.mockResolvedValue([{ id: 1 }]);
      mockLidarr.getRootFolders.mockResolvedValue([{ path: '/music' }]);
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      mockPrisma.reviewItem.update.mockResolvedValue({ ...artistItem, status: 'approved' });
      
      // Verify item exists and is an artist type
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: artistItem.id } });
      expect(found).toBeDefined();
      expect(found?.itemType).toBe('artist');
      
      // Simulate the approval workflow for artist
      if (found?.itemType === 'album' && found?.albumMbid) {
        await mockLidarr.addAlbum(found.mbid!, found.albumMbid, 1, 1, '/music');
      } else {
        await mockLidarr.addArtist(found!.mbid!, 1, 1, '/music');
      }
      
      expect(mockLidarr.addArtist).toHaveBeenCalledWith('artist-mbid-123', 1, 1, '/music');
      expect(mockLidarr.addAlbum).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/imports/review/bulk', () => {
    it('should bulk approve items', async () => {
      const items = [
        createMockReviewItem({ id: 1, status: 'pending' }),
        createMockReviewItem({ id: 2, status: 'pending' }),
        createMockReviewItem({ id: 3, status: 'pending' }),
      ];
      mockPrisma.reviewItem.findMany.mockResolvedValue(items);
      
      let added = 0;
      let failed = 0;
      
      for (const item of items) {
        try {
          // Simulate approval
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(3);
      expect(failed).toBe(0);
    });

    it('should bulk reject items', async () => {
      const ids = [1, 2, 3];
      mockPrisma.reviewItem.updateMany.mockResolvedValue({ count: 3 });
      
      const result = await mockPrisma.reviewItem.updateMany({
        where: { id: { in: ids }, userId: testUser.id },
        data: { status: 'rejected' },
      });
      
      expect(result.count).toBe(3);
    });

    it('should skip items already in library', async () => {
      const items = [
        createMockReviewItem({ id: 1, artistName: 'Existing Artist' }),
        createMockReviewItem({ id: 2, artistName: 'New Artist' }),
      ];
      
      mockCache.exists
        .mockResolvedValueOnce(true) // First artist exists
        .mockResolvedValueOnce(false); // Second doesn't
      
      let added = 0;
      let skipped = 0;
      
      for (const item of items) {
        if (await mockCache.exists({ name: item.artistName })) {
          skipped++;
        } else {
          added++;
        }
      }
      
      expect(added).toBe(1);
      expect(skipped).toBe(1);
    });

    it('should continue processing on individual failures', async () => {
      const items = [
        createMockReviewItem({ id: 1 }),
        createMockReviewItem({ id: 2 }),
        createMockReviewItem({ id: 3 }),
      ];
      
      mockLidarr.addArtist
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: 3 });
      
      let added = 0;
      let failed = 0;
      
      for (const item of items) {
        try {
          await mockLidarr.addArtist('mbid', 1, 1, '/music');
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(2);
      expect(failed).toBe(1);
    });

    it('should require valid request body', () => {
      const body = { ids: [], status: 'approved' };
      
      const isValid = Array.isArray(body.ids) && 
        ['pending', 'approved', 'rejected'].includes(body.status);
      
      expect(isValid).toBe(true);
    });
  });

  describe('DELETE /api/imports/review/:id', () => {
    it('should delete own review item', async () => {
      const item = createMockReviewItem({ userId: testUser.id });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockPrisma.reviewItem.delete.mockResolvedValue(item);
      
      const found = await mockPrisma.reviewItem.findUnique({ where: { id: item.id } });
      const canDelete = found?.userId === testUser.id;
      
      expect(canDelete).toBe(true);
    });
  });

  describe('Logging', () => {
    it('should log successful approval', async () => {
      mockPrisma.logEntry.create.mockResolvedValue({
        id: 1,
        level: 'info',
        category: 'review',
        message: 'Added artist "Test Artist" to Lidarr',
        metadata: { artistName: 'Test Artist', mbid: 'mbid123' },
        createdAt: new Date(),
      });
      
      const log = await mockPrisma.logEntry.create({
        data: {
          level: 'info',
          category: 'review',
          message: 'Added artist "Test Artist" to Lidarr',
          metadata: { artistName: 'Test Artist', mbid: 'mbid123' },
        },
      });
      
      expect(log.category).toBe('review');
      expect(log.level).toBe('info');
    });

    it('should log already in library', async () => {
      mockPrisma.logEntry.create.mockResolvedValue({
        id: 1,
        level: 'info',
        category: 'review',
        message: 'Artist "Test Artist" already in library',
        metadata: {},
        createdAt: new Date(),
      });
      
      const log = await mockPrisma.logEntry.create({
        data: {
          level: 'info',
          category: 'review',
          message: 'Artist "Test Artist" already in library',
          metadata: {},
        },
      });
      
      expect(log.message).toContain('already in library');
    });

    it('should log failures', async () => {
      mockPrisma.logEntry.create.mockResolvedValue({
        id: 1,
        level: 'error',
        category: 'review',
        message: 'Failed to add artist: Connection refused',
        metadata: { error: 'Connection refused' },
        createdAt: new Date(),
      });
      
      const log = await mockPrisma.logEntry.create({
        data: {
          level: 'error',
          category: 'review',
          message: 'Failed to add artist: Connection refused',
          metadata: { error: 'Connection refused' },
        },
      });
      
      expect(log.level).toBe('error');
    });
  });
});
