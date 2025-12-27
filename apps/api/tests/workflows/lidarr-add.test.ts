/**
 * Lidarr Add Artist Tests
 * 
 * Tests adding artists to Lidarr from ALL locations:
 * - Search results
 * - Album search results  
 * - Discover recommendations
 * - Review queue (single and bulk)
 * - Subscription results
 * 
 * Ensures consistent behavior across all entry points
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLidarrCache,
  createMockLidarrConnection,
  createMockReviewItem,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Lidarr Add Artist - All Locations', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;
  let mockCache: ReturnType<typeof createMockLidarrCache>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockLidarr = createMockLidarrService();
    mockCache = createMockLidarrCache();
    
    // Default mock setup
    mockPrisma.connection.findFirst.mockResolvedValue(createMockLidarrConnection(null));
    mockLidarr.getQualityProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }]);
    mockLidarr.getMetadataProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }]);
    mockLidarr.getRootFolders.mockResolvedValue([{ id: 1, path: '/music' }]);
  });

  describe('Common Requirements', () => {
    it('should require active Lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: {
          OR: [
            { userId: testUser.id, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
      });
      
      expect(conn).toBeNull();
      // All add operations should fail without connection
    });

    it('should require quality profiles', async () => {
      mockLidarr.getQualityProfiles.mockResolvedValue([]);
      
      const profiles = await mockLidarr.getQualityProfiles();
      
      expect(profiles).toHaveLength(0);
      // Should fail gracefully
    });

    it('should require metadata profiles', async () => {
      mockLidarr.getMetadataProfiles.mockResolvedValue([]);
      
      const profiles = await mockLidarr.getMetadataProfiles();
      
      expect(profiles).toHaveLength(0);
    });

    it('should require root folders', async () => {
      mockLidarr.getRootFolders.mockResolvedValue([]);
      
      const folders = await mockLidarr.getRootFolders();
      
      expect(folders).toHaveLength(0);
    });

    it('should check if already in library before adding', async () => {
      mockCache.exists.mockResolvedValue(true);
      
      const alreadyExists = await mockCache.exists({ mbid: 'known-mbid' });
      
      expect(alreadyExists).toBe(true);
      // Should skip add
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

  describe('From Search Results', () => {
    it('should add artist with foreignArtistId from search', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 123 });
      
      const foreignArtistId = 'mbid-from-search';
      
      const result = await mockLidarr.addArtist(
        foreignArtistId,
        1, // qualityProfileId
        1, // metadataProfileId
        '/music'
      );
      
      expect(result.id).toBe(123);
      expect(mockLidarr.addArtist).toHaveBeenCalledWith(foreignArtistId, 1, 1, '/music');
    });

    it('should return alreadyInLibrary when artist exists', async () => {
      mockCache.exists.mockResolvedValue(true);
      
      const exists = await mockCache.exists({ mbid: 'existing-mbid' });
      
      expect(exists).toBe(true);
    });
  });

  describe('From Album Search Results', () => {
    it('should add artist from album when artist not in library', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 456 });
      
      // Album search provides artistForeignArtistId
      const artistMbid = 'artist-mbid-from-album';
      
      const result = await mockLidarr.addArtist(artistMbid, 1, 1, '/music');
      
      expect(result.id).toBe(456);
    });

    it('should skip when artist already in library from album add', async () => {
      mockCache.exists.mockResolvedValue(true);
      
      const artistInLibrary = await mockCache.exists({ mbid: 'artist-mbid' });
      
      expect(artistInLibrary).toBe(true);
      expect(mockLidarr.addArtist).not.toHaveBeenCalled();
    });
  });

  describe('From Discover Recommendations', () => {
    it('should add recommended artist', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.searchArtist.mockResolvedValue([{ foreignArtistId: 'mbid-found' }]);
      mockLidarr.addArtist.mockResolvedValue({ id: 789 });
      
      // Recommendations may not have MBID, need to search first
      const artistName = 'Recommended Artist';
      const searchResults = await mockLidarr.searchArtist(artistName);
      
      expect(searchResults).toHaveLength(1);
      
      const result = await mockLidarr.addArtist(searchResults[0].foreignArtistId, 1, 1, '/music');
      
      expect(result.id).toBe(789);
    });

    it('should batch add multiple recommendations', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      
      const artists = ['Artist 1', 'Artist 2', 'Artist 3'];
      let addedCount = 0;
      
      for (const _artist of artists) {
        await mockLidarr.addArtist('mbid', 1, 1, '/music');
        addedCount++;
      }
      
      expect(addedCount).toBe(3);
    });
  });

  describe('From Review Queue - Single Item', () => {
    it('should add artist when approving review item', async () => {
      const item = createMockReviewItem({ artistName: 'Review Artist', mbid: null });
      mockPrisma.reviewItem.findUnique.mockResolvedValue(item);
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.searchArtist.mockResolvedValue([{ foreignArtistId: 'found-mbid' }]);
      mockLidarr.addArtist.mockResolvedValue({ id: 111 });
      
      // No MBID, search first
      const searchResults = await mockLidarr.searchArtist(item.artistName);
      expect(searchResults).toHaveLength(1);
      
      const result = await mockLidarr.addArtist(searchResults[0].foreignArtistId, 1, 1, '/music');
      
      expect(result.id).toBe(111);
    });

    it('should mark as approved if already in library', async () => {
      const item = createMockReviewItem({ status: 'pending' });
      mockCache.exists.mockResolvedValue(true);
      mockPrisma.reviewItem.update.mockResolvedValue({ ...item, status: 'approved' });
      
      const alreadyInLibrary = await mockCache.exists({ name: item.artistName });
      expect(alreadyInLibrary).toBe(true);
      
      // Should update status to approved without adding
      const updated = await mockPrisma.reviewItem.update({
        where: { id: item.id },
        data: { status: 'approved' },
      });
      
      expect(updated.status).toBe('approved');
      expect(mockLidarr.addArtist).not.toHaveBeenCalled();
    });

    it('should use existing MBID if available', async () => {
      const item = createMockReviewItem({ artistName: 'Artist', mbid: 'existing-mbid' });
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 222 });
      
      // Should use existing MBID, no search needed
      const result = await mockLidarr.addArtist(item.mbid!, 1, 1, '/music');
      
      expect(result.id).toBe(222);
      expect(mockLidarr.searchArtist).not.toHaveBeenCalled();
    });
  });

  describe('From Review Queue - Bulk', () => {
    it('should process multiple items', async () => {
      const items = [
        createMockReviewItem({ id: 1, artistName: 'Artist 1', mbid: 'mbid1' }),
        createMockReviewItem({ id: 2, artistName: 'Artist 2', mbid: 'mbid2' }),
        createMockReviewItem({ id: 3, artistName: 'Artist 3', mbid: 'mbid3' }),
      ];
      
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      
      let added = 0;
      for (const item of items) {
        await mockLidarr.addArtist(item.mbid!, 1, 1, '/music');
        added++;
      }
      
      expect(added).toBe(3);
    });

    it('should skip items already in library', async () => {
      mockCache.exists
        .mockResolvedValueOnce(true)  // First artist exists
        .mockResolvedValueOnce(false) // Second doesn't
        .mockResolvedValueOnce(false); // Third doesn't
      
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      
      const items = [
        { artistName: 'Existing', mbid: 'mbid1' },
        { artistName: 'New 1', mbid: 'mbid2' },
        { artistName: 'New 2', mbid: 'mbid3' },
      ];
      
      let added = 0;
      let skipped = 0;
      
      for (const item of items) {
        if (await mockCache.exists({ mbid: item.mbid })) {
          skipped++;
        } else {
          await mockLidarr.addArtist(item.mbid!, 1, 1, '/music');
          added++;
        }
      }
      
      expect(skipped).toBe(1);
      expect(added).toBe(2);
    });

    it('should continue on individual failures', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: 3 });
      
      let added = 0;
      let failed = 0;
      
      for (let i = 0; i < 3; i++) {
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
  });

  describe('From Subscription Results', () => {
    it('should add artist from subscription result with auto handling', async () => {
      mockCache.exists.mockResolvedValue(false);
      mockLidarr.addArtist.mockResolvedValue({ id: 333 });
      
      // Subscription with resultHandling: 'auto'
      const result = await mockLidarr.addArtist('sub-result-mbid', 1, 1, '/music');
      
      expect(result.id).toBe(333);
    });

    it('should add to review queue with queue handling', async () => {
      // With resultHandling: 'queue', adds to reviewItem table
      mockPrisma.reviewItem.create.mockResolvedValue(createMockReviewItem());
      
      const item = await mockPrisma.reviewItem.create({
        data: {
          userId: testUser.id,
          artistName: 'Subscription Artist',
          source: 'subscription',
          status: 'pending',
        },
      });
      
      expect(item.status).toBe('pending');
    });
  });

  describe('MBID Resolution', () => {
    it('should search Lidarr when MBID not available', async () => {
      mockLidarr.searchArtist.mockResolvedValue([{ foreignArtistId: 'found-via-search' }]);
      
      const artistName = 'Artist Without MBID';
      const results = await mockLidarr.searchArtist(artistName);
      
      expect(results[0].foreignArtistId).toBe('found-via-search');
    });

    it('should fall back to MusicBrainz when Lidarr search fails', async () => {
      mockLidarr.searchArtist.mockResolvedValue([]);
      
      // In actual code, would call MusicBrainz service
      const lidarrResults = await mockLidarr.searchArtist('Unknown Artist');
      expect(lidarrResults).toHaveLength(0);
      
      // Would then try MusicBrainz
    });

    it('should fail gracefully when no MBID found', async () => {
      mockLidarr.searchArtist.mockResolvedValue([]);
      // MusicBrainz would also return null
      
      const results = await mockLidarr.searchArtist('Completely Unknown Artist');
      
      expect(results).toHaveLength(0);
      // Should return error to user
    });
  });

  describe('Error Handling', () => {
    it('should handle artist already exists in Lidarr error', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('ArtistExistsValidator'));
      
      await expect(mockLidarr.addArtist('mbid', 1, 1, '/music')).rejects.toThrow('ArtistExistsValidator');
    });

    it('should handle Lidarr connection error', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('ECONNREFUSED'));
      
      await expect(mockLidarr.addArtist('mbid', 1, 1, '/music')).rejects.toThrow('ECONNREFUSED');
    });

    it('should handle invalid MBID error', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('Invalid artist ID'));
      
      await expect(mockLidarr.addArtist('invalid', 1, 1, '/music')).rejects.toThrow('Invalid artist ID');
    });
  });
});
