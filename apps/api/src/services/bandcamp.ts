/**
 * Bandcamp Service
 * 
 * Handles interactions with Bandcamp's public data endpoints.
 * Bandcamp doesn't have an official API, but their tag discovery
 * pages return JSON that we can use for music discovery.
 * 
 * No authentication needed - all data is public.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

const API_TIMEOUT = 15_000;

// Response interfaces from Bandcamp's internal API (v3 discover)
interface BandcampDiscoverItem {
  id: number;
  type: string;  // 'a' for album, 't' for track
  band_id: number;
  primary_text: string;  // album/track title
  secondary_text: string;  // artist name
  art_id: number;
  is_preorder: boolean | null;
  genre_text?: string;
  url_hints: {
    subdomain: string;
    custom_domain: string | null;
    slug: string;
    item_type: string;
  };
}

interface BandcampDiscoverResponse {
  items: BandcampDiscoverItem[];
  more_available: boolean;
  result_count: number;
}

interface BandcampAutocompleteResult {
  type: string;
  id: number;
  name: string;
  band_name?: string;
  art_id?: number;
  img?: string;
  img_id?: number;
  url?: string;
  genre?: string;
  location?: string;
  is_label?: boolean;
}

interface BandcampAutocompleteResponse {
  auto: {
    results: BandcampAutocompleteResult[];
    time_ms: number;
    stat: string;
  };
}

// Normalized response interfaces for our subscription system
export interface BandcampRelease {
  id: number;
  type: string;
  bandId: number;
  title: string;
  artistName: string;
  imageUrl: string | null;
  isPreorder: boolean;
  genre?: string;
}

export interface BandcampArtist {
  id: number;
  name: string;
  url?: string;
  imageUrl: string | null;
  location?: string;
  genre?: string;
  isLabel: boolean;
}

export interface BandcampTagReleasesResponse {
  releases: BandcampRelease[];
  totalCount: number;
  batchSize: number;
}

export interface BandcampArtistSearchResponse {
  artists: BandcampArtist[];
}

export class BandcampService {
  private baseUrl = 'https://bandcamp.com';

  /**
   * Build an image URL from a Bandcamp art_id
   * @param artId - The art_id from Bandcamp
   * @param size - Image size (default: 10 = 350x350)
   */
  private getImageUrl(artId: number | undefined): string | null {
    if (!artId) return null;
    // Bandcamp image URL format: a{art_id}_10.jpg for 350x350 images
    return `https://f4.bcbits.com/img/a${artId}_10.jpg`;
  }

  /**
   * Get releases by tag with sorting options
   * Uses Bandcamp's discover API v3
   * @param tag - The tag to search for (e.g., 'electronic', 'ambient')
   * @param sort - Sort order: 'pop' for popular/top, 'date' for newest
   * @param page - Page number (default: 0)
   * @returns Paginated list of releases
   */
  async getTagReleases(
    tag: string,
    sort: 'pop' | 'date',
    page: number = 0
  ): Promise<BandcampTagReleasesResponse> {
    await rateLimit('bandcamp');

    // Map our sort values to Bandcamp's API
    // 'top' = best-selling, 'new' = newest, 'rec' = recommended
    const sortParam = sort === 'pop' ? 'top' : 'new';

    // Use the discover v3 API which is currently working
    // Parameters: s=sort, p=page, g=genre/tag, f=format, w=location (0=anywhere)
    const url = `${this.baseUrl}/api/discover/3/get_web?s=${sortParam}&p=${page}&g=${encodeURIComponent(tag)}&f=all&w=0`;
    
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`Bandcamp API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BandcampDiscoverResponse & { error?: boolean; error_message?: string };

    // Handle Bandcamp API errors (returns 200 with error in body)
    if (data.error) {
      throw new Error(`Bandcamp API error: ${data.error_message || 'Unknown error'}`);
    }

    // Handle missing items array
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error(`Bandcamp API returned no items for tag: ${tag}`);
    }

    return {
      releases: data.items.map((item) => ({
        id: item.id,
        type: item.type,
        bandId: item.band_id,
        title: item.primary_text,
        artistName: item.secondary_text,
        imageUrl: this.getImageUrl(item.art_id),
        isPreorder: item.is_preorder ?? false,
        genre: item.genre_text,
      })),
      totalCount: data.result_count ?? data.items.length,
      batchSize: data.items.length,
    };
  }

  /**
   * Search for artists/bands
   * @param query - Search query string
   * @returns List of matching artists
   */
  async searchArtists(query: string): Promise<BandcampArtistSearchResponse> {
    await rateLimit('bandcamp');

    const encodedQuery = encodeURIComponent(query);
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/fuzzysearch/2/autocomplete?q=${encodedQuery}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        timeout: API_TIMEOUT,
      }
    );

    if (!response.ok) {
      throw new Error(`Bandcamp API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BandcampAutocompleteResponse;

    // Filter for band/artist types and normalize
    const artists = data.auto.results
      .filter((result) => result.type === 'b' || result.type === 'a')
      .map((result) => ({
        id: result.id,
        name: result.name || result.band_name || '',
        url: result.url,
        imageUrl: result.img || this.getImageUrl(result.img_id),
        location: result.location,
        genre: result.genre,
        isLabel: result.is_label ?? false,
      }));

    return { artists };
  }

  /**
   * Test connection to Bandcamp
   * Since Bandcamp is public, we just try a simple tag search
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.getTagReleases('electronic', 'pop', 0);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}
