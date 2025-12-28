// apps/api/tests/services/metadata-merger.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataMerger } from '../../src/services/metadata-merger.js';
import type { NormalizedArtistMetadata } from '../../src/services/metadata-enrichment.types.js';

describe('MetadataMerger', () => {
  let merger: MetadataMerger;

  beforeEach(() => {
    merger = new MetadataMerger();
  });

  describe('merge', () => {
    it('should select longest overview (Best Quality heuristic)', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          overview: 'Short bio.',
          overviewLength: 10,
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          overview: 'This is a much longer and more detailed biography that provides comprehensive information about the artist.',
          overviewLength: 105,
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      expect(result.overview).toContain('much longer');
      expect(result.overviewSource).toBe('deezer');
    });

    it('should union all genres and deduplicate', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          genres: ['rock', 'indie rock', 'alternative'],
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          genres: ['Rock', 'Indie', 'brit pop'],
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      // Should normalize case and dedupe
      expect(result.genres).toContain('rock');
      expect(result.genres).toContain('indie rock');
      expect(result.genres).toContain('alternative');
      expect(result.genres).toContain('indie');
      expect(result.genres).toContain('brit pop');
      // Should not have duplicate "Rock" and "rock"
      const rockCount = result.genres.filter((g: string) => g.toLowerCase() === 'rock').length;
      expect(rockCount).toBe(1);
    });

    it('should select highest resolution images by type', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          images: [
            { url: 'https://lastfm.com/small.jpg', width: 300, height: 300, type: 'poster' },
          ],
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          images: [
            { url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster' },
          ],
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe('https://deezer.com/xl.jpg');
      expect(result.images[0].source).toBe('deezer');
    });

    it('should track which sources were used', () => {
      const sources: NormalizedArtistMetadata[] = [
        { source: 'lastfm', overview: 'Bio', fetchedAt: new Date() },
        { source: 'deezer', genres: ['rock'], fetchedAt: new Date() },
      ];

      const result = merger.merge(sources);

      expect(result.sourcesUsed).toContain('lastfm');
      expect(result.sourcesUsed).toContain('deezer');
    });

    it('should handle empty sources gracefully', () => {
      const result = merger.merge([]);

      expect(result.overview).toBeUndefined();
      expect(result.genres).toEqual([]);
      expect(result.images).toEqual([]);
      expect(result.sourcesUsed).toEqual([]);
    });

    it('should skip sources with empty/missing data', () => {
      const sources: NormalizedArtistMetadata[] = [
        { source: 'lastfm', overview: '', fetchedAt: new Date() },
        { source: 'deezer', overview: 'Real bio here', fetchedAt: new Date() },
      ];

      const result = merger.merge(sources);

      expect(result.overview).toBe('Real bio here');
      expect(result.overviewSource).toBe('deezer');
    });
  });

  describe('normalizeGenre', () => {
    it('should lowercase and trim genres', () => {
      const normalized = merger.normalizeGenre('  Rock  ');
      expect(normalized).toBe('rock');
    });

    it('should handle hyphenated genres', () => {
      const normalized = merger.normalizeGenre('Hip-Hop');
      expect(normalized).toBe('hip-hop');
    });
  });
});
