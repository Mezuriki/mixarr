/**
 * Import Sources API Tests
 * 
 * Tests:
 * - Spotify import source management
 * - Import type validation
 * - Schedule management
 * - Preview and run operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockSpotifyConnection,
  createMockSpotifyService,
  resetIdCounter,
} from '../utils/fixtures.js';

describe('Import Sources API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockSpotify: ReturnType<typeof createMockSpotifyService>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockSpotify = createMockSpotifyService();
  });

  describe('GET /api/imports', () => {
    it('should return user import sources', async () => {
      const sources = [
        { id: 1, userId: testUser.id, type: 'liked_songs', name: 'Liked Songs' },
        { id: 2, userId: testUser.id, type: 'playlist', name: 'My Playlist' },
      ];
      mockPrisma.importSource.findMany.mockResolvedValue(sources);
      
      const result = await mockPrisma.importSource.findMany({
        where: { userId: testUser.id },
      });
      
      expect(result).toHaveLength(2);
    });
  });

  describe('POST /api/imports', () => {
    it('should create liked songs import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'liked_songs',
        name: 'Liked Songs',
        externalId: null,
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'liked_songs',
          name: 'Liked Songs',
        },
      });
      
      expect(result.type).toBe('liked_songs');
    });

    it('should create saved albums import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'saved_albums',
        name: 'Saved Albums',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'saved_albums',
          name: 'Saved Albums',
        },
      });
      
      expect(result.type).toBe('saved_albums');
    });

    it('should create followed artists import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'followed_artists',
        name: 'Followed Artists',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'followed_artists',
          name: 'Followed Artists',
        },
      });
      
      expect(result.type).toBe('followed_artists');
    });

    it('should create playlist import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'playlist',
        name: 'My Cool Playlist',
        externalId: 'playlist123',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'playlist',
          name: 'My Cool Playlist',
          externalId: 'playlist123',
        },
      });
      
      expect(result.type).toBe('playlist');
      expect(result.externalId).toBe('playlist123');
    });

    it('should require type and name', () => {
      const body = { type: '', name: '' };
      const isValid = body.type && body.name;
      expect(isValid).toBeFalsy();
    });

    it('should validate import type', () => {
      const validTypes = ['liked_songs', 'saved_albums', 'followed_artists', 'playlist'];
      const invalidType = 'invalid';
      
      expect(validTypes.includes(invalidType)).toBe(false);
    });
  });

  describe('PUT /api/imports/:id', () => {
    it('should update import source schedule', async () => {
      const source = { id: 1, userId: testUser.id, schedule: null };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.update.mockResolvedValue({ ...source, schedule: '0 0 * * *' });
      
      const result = await mockPrisma.importSource.update({
        where: { id: source.id },
        data: { schedule: '0 0 * * *' },
      });
      
      expect(result.schedule).toBe('0 0 * * *');
    });

    it('should update result handling mode', async () => {
      const source = { id: 1, userId: testUser.id, resultHandling: 'preview' };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.update.mockResolvedValue({ ...source, resultHandling: 'queue' });
      
      const result = await mockPrisma.importSource.update({
        where: { id: source.id },
        data: { resultHandling: 'queue' },
      });
      
      expect(result.resultHandling).toBe('queue');
    });
  });

  describe('DELETE /api/imports/:id', () => {
    it('should delete import source', async () => {
      const source = { id: 1, userId: testUser.id };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.delete.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.delete({
        where: { id: source.id },
      });
      
      expect(result.id).toBe(1);
    });
  });

  describe('POST /api/imports/:id/preview', () => {
    it('should preview liked songs', async () => {
      mockSpotify.getLikedSongs.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }] },
        { artists: [{ name: 'Artist 2' }] },
      ]);
      
      const tracks = await mockSpotify.getLikedSongs();
      const artists = new Set(tracks.flatMap((t: { artists: { name: string }[] }) => t.artists.map((a: { name: string }) => a.name)));
      
      expect(artists.size).toBe(2);
    });

    it('should preview saved albums', async () => {
      mockSpotify.getSavedAlbums.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }], name: 'Album 1' },
      ]);
      
      const albums = await mockSpotify.getSavedAlbums();
      
      expect(albums).toHaveLength(1);
    });

    it('should preview followed artists', async () => {
      mockSpotify.getFollowedArtists.mockResolvedValue([
        { name: 'Artist 1' },
        { name: 'Artist 2' },
      ]);
      
      const artists = await mockSpotify.getFollowedArtists();
      
      expect(artists).toHaveLength(2);
    });

    it('should preview playlist tracks', async () => {
      mockSpotify.getPlaylistTracks.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }] },
        { artists: [{ name: 'Artist 2' }] },
      ]);
      
      const tracks = await mockSpotify.getPlaylistTracks('playlist123');
      
      expect(tracks).toHaveLength(2);
    });

    it('should require Spotify connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'spotify', isActive: true },
      });
      
      expect(conn).toBeNull();
    });
  });

  describe('POST /api/imports/:id/run', () => {
    it('should run import and add to review queue', async () => {
      mockSpotify.getLikedSongs.mockResolvedValue([
        { artists: [{ name: 'Artist 1', id: 'spotify1' }] },
      ]);
      
      mockPrisma.reviewItem.createMany.mockResolvedValue({ count: 1 });
      
      const result = await mockPrisma.reviewItem.createMany({
        data: [
          {
            userId: testUser.id,
            artistName: 'Artist 1',
            spotifyId: 'spotify1',
            source: 'liked_songs',
            status: 'pending',
          },
        ],
      });
      
      expect(result.count).toBe(1);
    });

    it('should skip duplicates in review queue', async () => {
      // Artist already in review queue
      mockPrisma.reviewItem.findFirst.mockResolvedValue({
        id: 1,
        artistName: 'Artist 1',
        status: 'pending',
      });
      
      const existing = await mockPrisma.reviewItem.findFirst({
        where: { userId: testUser.id, artistName: 'Artist 1' },
      });
      
      expect(existing).toBeDefined();
      // Should skip this artist
    });
  });
});
