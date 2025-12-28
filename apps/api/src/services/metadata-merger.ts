// apps/api/src/services/metadata-merger.ts

import type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
} from './metadata-enrichment.types.js';

/**
 * Merges metadata from multiple sources using "Best Quality" heuristics:
 * - Overview: Select longest (most detailed)
 * - Genres: Union all, deduplicate (case-insensitive)
 * - Images: Select highest resolution per type
 */
export class MetadataMerger {
  /**
   * Merge multiple metadata sources into one result
   */
  merge(sources: NormalizedArtistMetadata[]): MergedArtistMetadata {
    const result: MergedArtistMetadata = {
      genres: [],
      genreSources: [],
      images: [],
      sourcesUsed: [],
      mergedAt: new Date(),
    };

    if (sources.length === 0) {
      return result;
    }

    // Track sources used
    result.sourcesUsed = [...new Set(sources.map(s => s.source))];

    // Best Overview: longest non-empty
    const overviews = sources
      .filter(s => s.overview && s.overview.trim().length > 0)
      .sort((a, b) => (b.overview?.length || 0) - (a.overview?.length || 0));

    if (overviews.length > 0) {
      result.overview = overviews[0].overview;
      result.overviewSource = overviews[0].source;
    }

    // Union Genres: deduplicate case-insensitive
    const genreMap = new Map<string, { original: string; source: string }>();
    
    for (const source of sources) {
      if (source.genres) {
        for (const genre of source.genres) {
          const normalized = this.normalizeGenre(genre);
          if (normalized && !genreMap.has(normalized)) {
            genreMap.set(normalized, { original: normalized, source: source.source });
          }
        }
      }
    }

    result.genres = Array.from(genreMap.values()).map(g => g.original);
    result.genreSources = [...new Set(Array.from(genreMap.values()).map(g => g.source))];

    // Best Images: highest resolution per type
    type ImageWithSource = {
      url: string;
      width?: number;
      height?: number;
      type: 'poster' | 'banner' | 'fanart' | 'logo';
      source: string;
    };
    const imagesByType = new Map<string, ImageWithSource>();

    for (const source of sources) {
      if (source.images) {
        for (const img of source.images) {
          const existing = imagesByType.get(img.type);
          const imgResolution = (img.width || 0) * (img.height || 0);
          const existingResolution = existing ? (existing.width || 0) * (existing.height || 0) : 0;

          if (!existing || imgResolution > existingResolution) {
            imagesByType.set(img.type, { ...img, source: source.source });
          }
        }
      }
    }

    result.images = Array.from(imagesByType.values());

    return result;
  }

  /**
   * Normalize a genre string for deduplication
   */
  normalizeGenre(genre: string): string {
    return genre.trim().toLowerCase();
  }
}
