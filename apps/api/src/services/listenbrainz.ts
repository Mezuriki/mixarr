/**
 * ListenBrainz Service
 * 
 * Handles all interactions with the ListenBrainz API for music tracking and recommendations.
 * ListenBrainz is an open-source alternative to Last.fm.
 */

import { rateLimit } from './rate-limiter.js';

// Valid time periods for statistics queries
export type ListenBrainzPeriod = 'week' | 'month' | 'quarter' | 'half_yearly' | 'year' | 'all_time';

// Valid recommendation types
export type ListenBrainzRecommendationType = 'top_artist' | 'similar_artist';

interface ListenBrainzArtist {
  artist_name: string;
  listen_count: number;
  artist_mbid?: string;
}

interface ListenBrainzRecommendation {
  recording_mbid: string;
  score?: number;
}

interface ListenBrainzSimilarUser {
  user_name: string;
  similarity: number;
}

interface TopArtistsResponse {
  payload: {
    artists: ListenBrainzArtist[];
    count: number;
    total_artist_count: number;
    range?: string;
    user_id?: string;
  };
}

interface RecommendationsResponse {
  payload: {
    mbids: ListenBrainzRecommendation[];
    count: number;
    user_name?: string;
  };
}

interface SimilarUsersResponse {
  payload: ListenBrainzSimilarUser[];
}

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Valid periods for validation
export const VALID_PERIODS: ListenBrainzPeriod[] = ['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time'];

export class ListenBrainzService {
  private username: string;
  private token?: string;
  private baseUrl = 'https://api.listenbrainz.org';
  private timeoutMs: number;

  constructor(username: string, token?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    if (!username || username.trim() === '') {
      throw new Error('ListenBrainz username is required');
    }
    this.username = username.trim();
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create a fetch request with timeout and optional authorization
   */
  private async fetchWithTimeout(url: string, useAuth: boolean = true): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (useAuth && this.token) {
      headers['Authorization'] = `Token ${this.token}`;
    }

    try {
      const response = await fetch(url, { 
        headers, 
        signal: controller.signal 
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(endpoint: string, useAuth: boolean = true): Promise<T> {
    await rateLimit('listenbrainz');

    const response = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`, useAuth);

    // Handle empty response bodies
    const text = await response.text();

    if (!response.ok) {
      // Try to extract error message from response body
      try {
        const errorData = JSON.parse(text) as { error?: string; code?: number };
        if (errorData.error) {
          throw new Error(`ListenBrainz API error: ${errorData.error}`);
        }
      } catch {
        // Ignore parse errors, fall through to generic message
      }
      throw new Error(`ListenBrainz API error: ${response.status} ${response.statusText}`);
    }

    if (!text || text.trim() === '') {
      throw new Error(`ListenBrainz API returned empty response for ${endpoint}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`ListenBrainz API returned invalid JSON for ${endpoint}: ${text.substring(0, 100)}`);
    }
  }

  /**
   * Validate if a user exists on ListenBrainz
   * If a token is provided, uses the validate-token endpoint (more reliable)
   * Otherwise, checks if the user profile exists
   * @returns true if user exists, false if not found
   */
  async validateUser(): Promise<boolean> {
    await rateLimit('listenbrainz');

    // If we have a token, use the validate-token endpoint with Authorization header
    // (not in URL to avoid token leakage in logs/caches)
    if (this.token) {
      try {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/1/validate-token`, true);

        if (!response.ok) {
          return false;
        }

        const data = await response.json() as { valid: boolean; user_name?: string };
        
        // Verify username matches the token (case-insensitive)
        if (data.user_name && data.user_name.toLowerCase() !== this.username.toLowerCase()) {
          return false; // Token doesn't match the provided username
        }
        
        return data.valid === true;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('ListenBrainz API request timed out');
        }
        throw error;
      }
    }

    // Without token, try to access user's public statistics
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/1/stats/user/${this.username}/artists?range=all_time&count=1`,
        false
      );

      if (response.status === 404) {
        return false;
      }

      if (!response.ok) {
        throw new Error(`ListenBrainz API error: ${response.status} ${response.statusText}`);
      }

      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('ListenBrainz API request timed out');
      }
      throw error;
    }
  }

  /**
   * Get top artists for the user
   * @param period - Time period for statistics
   * @param count - Number of artists to return (default: 25)
   */
  async getUserTopArtists(
    period: ListenBrainzPeriod,
    count: number = 25
  ): Promise<{
    artists: ListenBrainzArtist[];
    count: number;
    totalArtistCount: number;
  }> {
    const response = await this.request<TopArtistsResponse>(
      `/1/stats/user/${this.username}/artists?range=${period}&count=${count}`
    );

    return {
      artists: response.payload.artists,
      count: response.payload.count,
      totalArtistCount: response.payload.total_artist_count,
    };
  }

  /**
   * Get personalized recommendations for the user
   * @param type - Type of recommendations (top_artist or similar_artist)
   * @param count - Number of recommendations to return (default: 25)
   */
  async getRecommendations(
    type: ListenBrainzRecommendationType,
    count: number = 25
  ): Promise<{
    mbids: ListenBrainzRecommendation[];
    count: number;
  }> {
    const response = await this.request<RecommendationsResponse>(
      `/1/cf/recommendation/user/${this.username}/recording?artist_type=${type}&count=${count}`
    );

    return {
      mbids: response.payload.mbids,
      count: response.payload.count,
    };
  }

  /**
   * Get users with similar listening habits
   */
  async getSimilarUsers(): Promise<ListenBrainzSimilarUser[]> {
    const response = await this.request<SimilarUsersResponse>(
      `/1/user/${this.username}/similar-users`
    );

    return response.payload;
  }
}
