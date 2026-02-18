/**
 * TIDAL OAuth Service
 * 
 * Handles OAuth 2.0 + PKCE authentication and API interactions with TIDAL.
 * Documentation: https://developer.tidal.com
 * API Reference: https://tidal-music.github.io/tidal-api-reference/
 * 
 * TIDAL uses JSON:API format for responses.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import * as crypto from 'crypto';

const API_TIMEOUT = 15_000;

interface TidalConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

interface TidalTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// JSON:API resource types
interface JsonApiResource<T = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: T;
  relationships?: Record<string, { data: { id: string; type: string } | Array<{ id: string; type: string }> }>;
}

interface JsonApiResponse<T = Record<string, unknown>> {
  data: JsonApiResource<T> | JsonApiResource<T>[];
  included?: JsonApiResource[];
  links?: { next?: string };
}

interface TidalArtistAttributes {
  name: string;
  popularity?: number;
}

interface TidalTrackAttributes {
  title: string;
  duration: number;
  isrc?: string;
  popularity?: number;
}

interface TidalAlbumAttributes {
  title: string;
  releaseDate?: string;
  numberOfTracks?: number;
  duration?: number;
}

interface TidalPlaylistAttributes {
  name: string;
  description?: string;
  numberOfItems?: number;
  duration?: number;
  createdAt?: string;
  lastModifiedAt?: string;
}

interface TidalUserAttributes {
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  country?: string;
}

// Normalized types for easier consumption
export interface TidalArtist {
  id: string;
  name: string;
  popularity?: number;
}

export interface TidalTrack {
  id: string;
  title: string;
  duration: number;
  isrc?: string;
  artists: TidalArtist[];
  album?: {
    id: string;
    title: string;
  };
}

export interface TidalAlbum {
  id: string;
  title: string;
  releaseDate?: string;
  artists: TidalArtist[];
}

export interface TidalPlaylist {
  id: string;
  name: string;
  description?: string;
  numberOfItems: number;
}

export interface TidalUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
}

// PKCE helpers
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export class TidalService {
  private clientId: string;
  private clientSecret: string;
  private tokens: TidalTokens | null = null;
  private onTokenRefresh?: (tokens: TidalTokens) => void;
  private refreshPromise: Promise<void> | null = null; // Prevent concurrent refresh

  constructor(config: TidalConfig, onTokenRefresh?: (tokens: TidalTokens) => void) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.onTokenRefresh = onTokenRefresh;
    
    if (config.accessToken && config.refreshToken) {
      this.tokens = {
        accessToken: config.accessToken,
        refreshToken: config.refreshToken,
        expiresAt: config.expiresAt ? new Date(config.expiresAt).getTime() : 0,
      };
    }
  }

  /**
   * Generate PKCE code verifier and challenge
   * Used when the state needs to include the verifier before URL generation
   */
  static generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate OAuth authorization URL with PKCE
   * Returns URL and code_verifier (must be stored for token exchange)
   */
  getAuthUrl(redirectUri: string, state: string): { url: string; codeVerifier: string } {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Only request read scopes - we don't need write access
    const scopes = [
      'user.read',
      'playlists.read',
      'collection.read',
      'recommendations.read',
      'search.read',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: `https://login.tidal.com/authorize?${params}`,
      codeVerifier,
    };
  }

  /**
   * Generate OAuth authorization URL with pre-generated PKCE values
   */
  getAuthUrlWithPKCE(redirectUri: string, state: string, codeChallenge: string): string {
    const scopes = [
      'user.read',
      'playlists.read',
      'collection.read',
      'recommendations.read',
      'search.read',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://login.tidal.com/authorize?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TidalTokens> {
    const response = await fetchWithTimeout('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exchange authorization code: ${errorText}`);
    }

    const data = await response.json() as { 
      access_token: string; 
      refresh_token: string; 
      expires_in: number;
      token_type: string;
    };
    
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.onTokenRefresh?.(this.tokens);
    return this.tokens;
  }

  /**
   * Refresh the access token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    // If a refresh is already in progress, wait for it instead of starting another
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start the refresh and store the promise
    this.refreshPromise = this.doRefreshAccessToken();
    
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Actually perform the token refresh
   */
  private async doRefreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetchWithTimeout('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }

    const data = await response.json() as { 
      access_token: string; 
      refresh_token?: string; 
      expires_in: number;
    };
    
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.onTokenRefresh?.(this.tokens);
  }

  /**
   * Make authenticated API request to TIDAL OpenAPI
   */
  private async request<T>(endpoint: string): Promise<T> {
    if (!this.tokens) {
      throw new Error('Not authenticated with TIDAL');
    }

    // Refresh token if expired (with 1 minute buffer)
    if (Date.now() >= this.tokens.expiresAt - 60000) {
      await this.refreshAccessToken();
    }

    await rateLimit('tidal');

    const response = await fetchWithTimeout(`https://openapi.tidal.com/v2${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        Accept: 'application/vnd.api+json',
      },
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`TIDAL API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test connection by getting current user
   */
  async testConnection(): Promise<{ success: boolean; user?: string; error?: string }> {
    try {
      const me = await this.request<JsonApiResponse<TidalUserAttributes>>('/users/me');
      const user = me.data as JsonApiResource<TidalUserAttributes>;
      return { success: true, user: user.attributes.username };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Get current user profile
   */
  async getMe(): Promise<TidalUser> {
    const response = await this.request<JsonApiResponse<TidalUserAttributes>>('/users/me');
    const user = response.data as JsonApiResource<TidalUserAttributes>;
    return {
      id: user.id,
      username: user.attributes.username,
      firstName: user.attributes.firstName,
      lastName: user.attributes.lastName,
    };
  }

  // HELPER: Parse JSON:API resources

  private parseArtist(resource: JsonApiResource<TidalArtistAttributes>): TidalArtist {
    return {
      id: resource.id,
      name: resource.attributes.name,
      popularity: resource.attributes.popularity,
    };
  }

  private parseTrack(resource: JsonApiResource<TidalTrackAttributes>, included?: JsonApiResource[]): TidalTrack {
    const artists: TidalArtist[] = [];
    
    // Extract artists from relationships
    const artistRels = resource.relationships?.artists?.data;
    if (artistRels && included) {
      const artistIds = Array.isArray(artistRels) ? artistRels.map(r => r.id) : [artistRels.id];
      for (const id of artistIds) {
        const artistResource = included.find(i => i.type === 'artists' && i.id === id);
        if (artistResource) {
          artists.push(this.parseArtist(artistResource as unknown as JsonApiResource<TidalArtistAttributes>));
        }
      }
    }

    return {
      id: resource.id,
      title: resource.attributes.title,
      duration: resource.attributes.duration,
      isrc: resource.attributes.isrc,
      artists,
    };
  }

  private parseAlbum(resource: JsonApiResource<TidalAlbumAttributes>, included?: JsonApiResource[]): TidalAlbum {
    const artists: TidalArtist[] = [];
    
    const artistRels = resource.relationships?.artists?.data;
    if (artistRels && included) {
      const artistIds = Array.isArray(artistRels) ? artistRels.map(r => r.id) : [artistRels.id];
      for (const id of artistIds) {
        const artistResource = included.find(i => i.type === 'artists' && i.id === id);
        if (artistResource) {
          artists.push(this.parseArtist(artistResource as unknown as JsonApiResource<TidalArtistAttributes>));
        }
      }
    }

    return {
      id: resource.id,
      title: resource.attributes.title,
      releaseDate: resource.attributes.releaseDate,
      artists,
    };
  }

  private parsePlaylist(resource: JsonApiResource<TidalPlaylistAttributes>): TidalPlaylist {
    return {
      id: resource.id,
      name: resource.attributes.name,
      description: resource.attributes.description,
      numberOfItems: resource.attributes.numberOfItems || 0,
    };
  }

  // USER COLLECTIONS (Favorites)

  /**
   * Get user's favorite tracks
   */
  async getCollectionTracks(limit: number = 50): Promise<TidalTrack[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalTrackAttributes>>(
      `/userCollections/${me.id}/relationships/tracks?limit=${limit}&include=artists`
    );
    
    const tracks = Array.isArray(response.data) ? response.data : [response.data];
    return tracks.map(t => this.parseTrack(t as JsonApiResource<TidalTrackAttributes>, response.included));
  }

  /**
   * Get user's favorite albums
   */
  async getCollectionAlbums(limit: number = 50): Promise<TidalAlbum[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalAlbumAttributes>>(
      `/userCollections/${me.id}/relationships/albums?limit=${limit}&include=artists`
    );
    
    const albums = Array.isArray(response.data) ? response.data : [response.data];
    return albums.map(a => this.parseAlbum(a as JsonApiResource<TidalAlbumAttributes>, response.included));
  }

  /**
   * Get user's favorite artists
   */
  async getCollectionArtists(limit: number = 50): Promise<TidalArtist[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalArtistAttributes>>(
      `/userCollections/${me.id}/relationships/artists?limit=${limit}`
    );
    
    const artists = Array.isArray(response.data) ? response.data : [response.data];
    return artists.map(a => this.parseArtist(a as JsonApiResource<TidalArtistAttributes>));
  }

  // PLAYLISTS

  /**
   * Get user's playlists
   */
  async getPlaylists(limit: number = 50): Promise<TidalPlaylist[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalPlaylistAttributes>>(
      `/userCollections/${me.id}/relationships/playlists?limit=${limit}`
    );
    
    const playlists = Array.isArray(response.data) ? response.data : [response.data];
    return playlists.map(p => this.parsePlaylist(p as JsonApiResource<TidalPlaylistAttributes>));
  }

  /**
   * Get tracks from a specific playlist
   */
  async getPlaylistTracks(playlistId: string, limit: number = 50): Promise<TidalTrack[]> {
    const response = await this.request<JsonApiResponse<TidalTrackAttributes>>(
      `/playlists/${playlistId}/relationships/items?limit=${limit}&include=artists`
    );
    
    const tracks = Array.isArray(response.data) ? response.data : [response.data];
    return tracks.map(t => this.parseTrack(t as JsonApiResource<TidalTrackAttributes>, response.included));
  }

  // RECOMMENDATIONS

  /**
   * Get user's discovery mixes (like Spotify Discover Weekly)
   */
  async getDiscoveryMixes(): Promise<TidalPlaylist[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalPlaylistAttributes>>(
      `/userRecommendations/${me.id}/relationships/discoveryMixes`
    );
    
    const mixes = Array.isArray(response.data) ? response.data : [response.data];
    return mixes.map(m => this.parsePlaylist(m as JsonApiResource<TidalPlaylistAttributes>));
  }

  /**
   * Get user's personal mixes
   */
  async getMyMixes(): Promise<TidalPlaylist[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalPlaylistAttributes>>(
      `/userRecommendations/${me.id}/relationships/myMixes`
    );
    
    const mixes = Array.isArray(response.data) ? response.data : [response.data];
    return mixes.map(m => this.parsePlaylist(m as JsonApiResource<TidalPlaylistAttributes>));
  }

  /**
   * Get new arrival mixes
   */
  async getNewArrivalMixes(): Promise<TidalPlaylist[]> {
    const me = await this.getMe();
    const response = await this.request<JsonApiResponse<TidalPlaylistAttributes>>(
      `/userRecommendations/${me.id}/relationships/newArrivalMixes`
    );
    
    const mixes = Array.isArray(response.data) ? response.data : [response.data];
    return mixes.map(m => this.parsePlaylist(m as JsonApiResource<TidalPlaylistAttributes>));
  }

  /**
   * Get tracks from all discovery mixes
   */
  async getDiscoveryMixTracks(): Promise<TidalTrack[]> {
    const mixes = await this.getDiscoveryMixes();
    const allTracks: TidalTrack[] = [];
    
    for (const mix of mixes.slice(0, 3)) { // Limit to first 3 mixes
      const tracks = await this.getPlaylistTracks(mix.id, 50);
      allTracks.push(...tracks);
    }
    
    return allTracks;
  }

  /**
   * Get tracks from new arrival mixes
   */
  async getNewArrivalTracks(): Promise<TidalTrack[]> {
    const mixes = await this.getNewArrivalMixes();
    const allTracks: TidalTrack[] = [];
    
    for (const mix of mixes.slice(0, 3)) {
      const tracks = await this.getPlaylistTracks(mix.id, 50);
      allTracks.push(...tracks);
    }
    
    return allTracks;
  }

  // SEARCH

  /**
   * Search for artists
   */
  async searchArtists(query: string, limit: number = 25): Promise<TidalArtist[]> {
    const response = await this.request<JsonApiResponse<TidalArtistAttributes>>(
      `/searchResults/${encodeURIComponent(query)}/relationships/artists?limit=${limit}`
    );
    
    const artists = Array.isArray(response.data) ? response.data : [response.data];
    return artists.map(a => this.parseArtist(a as JsonApiResource<TidalArtistAttributes>));
  }

  /**
   * Search for tracks
   */
  async searchTracks(query: string, limit: number = 25): Promise<TidalTrack[]> {
    const response = await this.request<JsonApiResponse<TidalTrackAttributes>>(
      `/searchResults/${encodeURIComponent(query)}/relationships/tracks?limit=${limit}&include=artists`
    );
    
    const tracks = Array.isArray(response.data) ? response.data : [response.data];
    return tracks.map(t => this.parseTrack(t as JsonApiResource<TidalTrackAttributes>, response.included));
  }

  /**
   * Search for albums
   */
  async searchAlbums(query: string, limit: number = 25): Promise<TidalAlbum[]> {
    const response = await this.request<JsonApiResponse<TidalAlbumAttributes>>(
      `/searchResults/${encodeURIComponent(query)}/relationships/albums?limit=${limit}&include=artists`
    );
    
    const albums = Array.isArray(response.data) ? response.data : [response.data];
    return albums.map(a => this.parseAlbum(a as JsonApiResource<TidalAlbumAttributes>, response.included));
  }

  // SIMILAR ARTISTS

  /**
   * Get similar artists
   */
  async getSimilarArtists(artistId: string, limit: number = 25): Promise<TidalArtist[]> {
    const response = await this.request<JsonApiResponse<TidalArtistAttributes>>(
      `/artists/${artistId}/relationships/similarArtists?limit=${limit}`
    );
    
    const artists = Array.isArray(response.data) ? response.data : [response.data];
    return artists.map(a => this.parseArtist(a as JsonApiResource<TidalArtistAttributes>));
  }
}
