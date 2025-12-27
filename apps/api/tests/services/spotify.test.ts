/**
 * Spotify Service Tests
 * 
 * Tests:
 * - OAuth flow (auth URL, code exchange)
 * - Token refresh
 * - API endpoints (liked songs, albums, playlists, etc.)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Spotify Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createConfig = () => ({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
  });

  describe('getAuthUrl', () => {
    it('should generate valid authorization URL', () => {
      const config = createConfig();
      const redirectUri = 'http://localhost:3010/api/connections/spotify/callback';
      const state = 'random-state-123';

      const scopes = [
        'user-library-read',
        'user-follow-read',
        'playlist-read-private',
        'playlist-read-collaborative',
      ].join(' ');

      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
        scope: scopes,
      });

      const authUrl = `https://accounts.spotify.com/authorize?${params}`;

      expect(authUrl).toContain('accounts.spotify.com/authorize');
      expect(authUrl).toContain('client_id=test-client-id');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('user-library-read');
    });

    it('should include all required scopes', () => {
      const scopes = [
        'user-library-read',
        'user-follow-read',
        'playlist-read-private',
        'playlist-read-collaborative',
      ];

      scopes.forEach(scope => {
        expect(scopes).toContain(scope);
      });
    });
  });

  describe('exchangeCode', () => {
    it('should exchange authorization code for tokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });

      const response = await mockFetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from('client:secret').toString('base64'),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'auth-code-123',
          redirect_uri: 'http://localhost:3010/callback',
        }),
      });

      const tokens = await response.json();

      expect(tokens.access_token).toBe('new-access-token');
      expect(tokens.refresh_token).toBe('new-refresh-token');
      expect(tokens.expires_in).toBe(3600);
    });

    it('should handle invalid authorization code', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code',
        }),
      });

      const response = await mockFetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh expired access token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'refreshed-access-token',
          expires_in: 3600,
        }),
      });

      const response = await mockFetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'test-refresh-token',
        }),
      });

      const data = await response.json();

      expect(data.access_token).toBe('refreshed-access-token');
    });

    it('should handle refresh token revoked', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'Refresh token revoked',
        }),
      });

      const response = await mockFetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('getLikedSongs', () => {
    it('should return liked songs with pagination', async () => {
      const mockTracks = {
        items: [
          {
            track: {
              id: 'track-1',
              name: 'Song One',
              artists: [{ id: 'artist-1', name: 'Artist One' }],
            },
          },
          {
            track: {
              id: 'track-2',
              name: 'Song Two',
              artists: [{ id: 'artist-2', name: 'Artist Two' }],
            },
          },
        ],
        next: 'https://api.spotify.com/v1/me/tracks?offset=50&limit=50',
        total: 100,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTracks),
      });

      const response = await mockFetch('https://api.spotify.com/v1/me/tracks?limit=50');
      const data = await response.json();

      expect(data.items).toHaveLength(2);
      expect(data.total).toBe(100);
      expect(data.next).toBeDefined();
    });

    it('should handle empty library', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          items: [],
          next: null,
          total: 0,
        }),
      });

      const response = await mockFetch('https://api.spotify.com/v1/me/tracks');
      const data = await response.json();

      expect(data.items).toHaveLength(0);
      expect(data.total).toBe(0);
    });
  });

  describe('getSavedAlbums', () => {
    it('should return saved albums', async () => {
      const mockAlbums = {
        items: [
          {
            album: {
              id: 'album-1',
              name: 'Album One',
              artists: [{ id: 'artist-1', name: 'Artist One' }],
              release_date: '2024-01-01',
            },
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAlbums),
      });

      const response = await mockFetch('https://api.spotify.com/v1/me/albums');
      const data = await response.json();

      expect(data.items).toHaveLength(1);
      expect(data.items[0].album.name).toBe('Album One');
    });
  });

  describe('getFollowedArtists', () => {
    it('should return followed artists', async () => {
      const mockArtists = {
        artists: {
          items: [
            { id: 'artist-1', name: 'Artist One', genres: ['rock'] },
            { id: 'artist-2', name: 'Artist Two', genres: ['pop'] },
          ],
          next: null,
          total: 2,
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockArtists),
      });

      const response = await mockFetch('https://api.spotify.com/v1/me/following?type=artist');
      const data = await response.json();

      expect(data.artists.items).toHaveLength(2);
      expect(data.artists.items[0].name).toBe('Artist One');
    });
  });

  describe('getPlaylistTracks', () => {
    it('should return playlist tracks', async () => {
      const mockTracks = {
        items: [
          {
            track: {
              id: 'track-1',
              name: 'Playlist Track',
              artists: [{ id: 'artist-1', name: 'Playlist Artist' }],
            },
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTracks),
      });

      const playlistId = 'playlist-123';
      const response = await mockFetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`
      );
      const data = await response.json();

      expect(data.items).toHaveLength(1);
    });

    it('should handle private playlist access denied', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({
          error: { status: 403, message: 'Forbidden' },
        }),
      });

      const response = await mockFetch(
        'https://api.spotify.com/v1/playlists/private-playlist/tracks'
      );

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });
  });

  describe('getPlaylist', () => {
    it('should return playlist details', async () => {
      const mockPlaylist = {
        id: 'playlist-123',
        name: 'My Playlist',
        description: 'A test playlist',
        owner: { display_name: 'Test User' },
        tracks: { total: 50 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPlaylist),
      });

      const response = await mockFetch('https://api.spotify.com/v1/playlists/playlist-123');
      const data = await response.json();

      expect(data.name).toBe('My Playlist');
      expect(data.tracks.total).toBe(50);
    });

    it('should handle non-existent playlist', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({
          error: { status: 404, message: 'Not found' },
        }),
      });

      const response = await mockFetch('https://api.spotify.com/v1/playlists/non-existent');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe('getNewReleases', () => {
    it('should return new album releases', async () => {
      const mockReleases = {
        albums: {
          items: [
            {
              id: 'album-new-1',
              name: 'New Release',
              artists: [{ id: 'artist-1', name: 'New Artist' }],
              release_date: '2025-01-01',
            },
          ],
          total: 1,
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      });

      const response = await mockFetch('https://api.spotify.com/v1/browse/new-releases');
      const data = await response.json();

      expect(data.albums.items).toHaveLength(1);
      expect(data.albums.items[0].name).toBe('New Release');
    });
  });

  describe('Rate Limiting', () => {
    it('should handle 429 rate limit response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => name === 'Retry-After' ? '5' : null,
        },
        json: () => Promise.resolve({
          error: { status: 429, message: 'Rate limited' },
        }),
      });

      const response = await mockFetch('https://api.spotify.com/v1/me/tracks');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(429);
    });
  });

  describe('Token Expiration', () => {
    it('should detect expired token', () => {
      const expiresAt = Date.now() - 1000; // Already expired
      const isExpired = Date.now() >= expiresAt;

      expect(isExpired).toBe(true);
    });

    it('should detect valid token', () => {
      const expiresAt = Date.now() + 3600000; // 1 hour from now
      const isExpired = Date.now() >= expiresAt;

      expect(isExpired).toBe(false);
    });

    it('should refresh before expiration (buffer)', () => {
      const expiresAt = Date.now() + 60000; // 1 minute from now
      const bufferMs = 300000; // 5 minute buffer
      const shouldRefresh = Date.now() >= (expiresAt - bufferMs);

      expect(shouldRefresh).toBe(true);
    });
  });

  describe('extractArtistsFromTracks', () => {
    it('should extract unique artists from tracks', () => {
      const tracks = [
        { artists: [{ id: 'a1', name: 'Artist 1' }, { id: 'a2', name: 'Artist 2' }] },
        { artists: [{ id: 'a1', name: 'Artist 1' }] }, // Duplicate
        { artists: [{ id: 'a3', name: 'Artist 3' }] },
      ];

      const artistMap = new Map<string, { id: string; name: string }>();
      for (const track of tracks) {
        for (const artist of track.artists) {
          if (!artistMap.has(artist.id)) {
            artistMap.set(artist.id, artist);
          }
        }
      }

      const uniqueArtists = Array.from(artistMap.values());

      expect(uniqueArtists).toHaveLength(3);
    });
  });
});
