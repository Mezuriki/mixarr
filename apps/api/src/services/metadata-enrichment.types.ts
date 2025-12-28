// apps/api/src/services/metadata-enrichment.types.ts

/**
 * Normalized metadata from any source (Last.fm, Deezer, Discogs)
 */
export interface NormalizedArtistMetadata {
  source: 'lastfm' | 'deezer' | 'discogs' | 'lidarr';
  overview?: string;
  overviewLength?: number;
  genres?: string[];
  images?: Array<{
    url: string;
    width?: number;
    height?: number;
    type: 'poster' | 'banner' | 'fanart' | 'logo';
  }>;
  mbid?: string;
  fetchedAt: Date;
}

/**
 * Merged metadata result using "Best Quality" heuristics
 */
export interface MergedArtistMetadata {
  overview?: string;
  overviewSource?: string;
  genres: string[];
  genreSources: string[];
  images: Array<{
    url: string;
    width?: number;
    height?: number;
    type: 'poster' | 'banner' | 'fanart' | 'logo';
    source: string;
  }>;
  sourcesUsed: string[];
  mergedAt: Date;
}

/**
 * Result from enrichment operation
 */
export interface EnrichmentResult {
  artistId: number;
  artistName: string;
  success: boolean;
  updated: boolean;
  fieldsUpdated: string[];
  errors: string[];
  metadata?: MergedArtistMetadata;
}

/**
 * Enrichment request options
 */
export interface EnrichmentOptions {
  /** Which sources to query (default: all connected) */
  sources?: ('lastfm' | 'deezer' | 'discogs')[];
  /** Update Lidarr directly or just return merged data */
  updateLidarr?: boolean;
  /** Force update even if metadata exists */
  forceUpdate?: boolean;
}
