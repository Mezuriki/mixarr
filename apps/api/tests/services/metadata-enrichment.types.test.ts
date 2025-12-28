// apps/api/tests/services/metadata-enrichment.types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
  EnrichmentResult,
} from '../../src/services/metadata-enrichment.types.js';

describe('Metadata Enrichment Types', () => {
  it('should allow creating NormalizedArtistMetadata', () => {
    const metadata: NormalizedArtistMetadata = {
      source: 'lastfm',
      overview: 'Test bio',
      overviewLength: 8,
      genres: ['rock', 'indie'],
      fetchedAt: new Date(),
    };

    expect(metadata.source).toBe('lastfm');
    expect(metadata.genres).toContain('rock');
  });

  it('should allow creating MergedArtistMetadata', () => {
    const merged: MergedArtistMetadata = {
      overview: 'Longest bio wins',
      overviewSource: 'lastfm',
      genres: ['rock', 'indie', 'alternative'],
      genreSources: ['lastfm', 'deezer'],
      images: [],
      sourcesUsed: ['lastfm', 'deezer'],
      mergedAt: new Date(),
    };

    expect(merged.genres).toHaveLength(3);
    expect(merged.sourcesUsed).toContain('lastfm');
  });

  it('should allow creating EnrichmentResult', () => {
    const result: EnrichmentResult = {
      artistId: 123,
      artistName: 'Test Artist',
      success: true,
      updated: true,
      fieldsUpdated: ['overview', 'genres'],
      errors: [],
    };

    expect(result.success).toBe(true);
    expect(result.fieldsUpdated).toContain('overview');
  });
});
