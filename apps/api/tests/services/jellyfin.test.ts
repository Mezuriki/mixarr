import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('JellyfinService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create service instance', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      const service = new JellyfinService();
      expect(service).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return success for valid API key', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ServerName: 'My Jellyfin',
          Version: '10.8.0',
        }),
      });

      const service = new JellyfinService();
      const result = await service.testConnection({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'valid-key',
      });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('My Jellyfin');
    });

    it('should return error for invalid API key', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const service = new JellyfinService();
      const result = await service.testConnection({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'invalid-key',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('getUsers', () => {
    it('should return list of users', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { Id: 'user-1', Name: 'Alice', Policy: { IsAdministrator: true } },
          { Id: 'user-2', Name: 'Bob', Policy: { IsAdministrator: false } },
        ]),
      });

      const service = new JellyfinService();
      const users = await service.getUsers({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'valid-key',
      });

      expect(users).toHaveLength(2);
      expect(users[0]).toEqual({ userId: 'user-1', username: 'Alice', isAdmin: true });
      expect(users[1]).toEqual({ userId: 'user-2', username: 'Bob', isAdmin: false });
    });
  });

  describe('getLibraries', () => {
    it('should return music libraries only', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { ItemId: 'lib-1', Name: 'Music', CollectionType: 'music' },
          { ItemId: 'lib-2', Name: 'Movies', CollectionType: 'movies' },
          { ItemId: 'lib-3', Name: 'Audiobooks', CollectionType: 'music' },
        ]),
      });

      const service = new JellyfinService();
      const libraries = await service.getLibraries({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'valid-key',
      });

      expect(libraries).toHaveLength(2);
      expect(libraries[0].name).toBe('Music');
      expect(libraries[1].name).toBe('Audiobooks');
    });
  });

  describe('getTopArtists', () => {
    it('should return top artists by play count', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      // The service queries Audio items and aggregates by artist
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          Items: [
            { Id: 'song-1', Name: 'Comfortably Numb', AlbumArtist: 'Pink Floyd', UserData: { PlayCount: 100 } },
            { Id: 'song-2', Name: 'Wish You Were Here', AlbumArtist: 'Pink Floyd', UserData: { PlayCount: 50 } },
            { Id: 'song-3', Name: 'Stairway to Heaven', AlbumArtist: 'Led Zeppelin', UserData: { PlayCount: 100 } },
          ],
          TotalRecordCount: 3,
        }),
      });

      const service = new JellyfinService();
      const artists = await service.getTopArtists(
        {
          jellyfinUrl: 'http://localhost:8096',
          jellyfinApiKey: 'valid-key',
          jellyfinUserId: 'user-1',
        },
        { period: 'month', limit: 10 }
      );

      expect(artists).toHaveLength(2);
      // Pink Floyd has 100+50=150 plays, Led Zeppelin has 100
      expect(artists[0].name).toBe('Pink Floyd');
      expect(artists[0].playCount).toBe(150);
      expect(artists[1].name).toBe('Led Zeppelin');
      expect(artists[1].playCount).toBe(100);
    });

    it('should throw if userId not provided', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      
      const service = new JellyfinService();
      
      await expect(service.getTopArtists(
        { jellyfinUrl: 'http://localhost:8096', jellyfinApiKey: 'key' },
        { period: 'month', limit: 10 }
      )).rejects.toThrow('Jellyfin user ID is required');
    });
  });
});
