// apps/api/tests/services/adapters/lastfm-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LastfmMetadataAdapter } from '../../../src/services/adapters/lastfm-adapter.js';
import type { LastfmService } from '../../../src/services/lastfm.js';

describe('LastfmMetadataAdapter', () => {
  let adapter: LastfmMetadataAdapter;
  let mockLastfmService: Partial<LastfmService>;

  beforeEach(() => {
    mockLastfmService = {
      getArtistInfo: vi.fn(),
    };
    adapter = new LastfmMetadataAdapter(mockLastfmService as LastfmService);
  });

  describe('fetchMetadata', () => {
    it('should return normalized metadata from Last.fm artist info', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        url: 'https://www.last.fm/music/Radiohead',
        bio: {
          summary: 'Radiohead are an English rock band from Abingdon, Oxfordshire.',
        },
        tags: {
          tag: [
            { name: 'alternative rock' },
            { name: 'indie' },
          ],
        },
        stats: { listeners: '3000000', playcount: '500000000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Radiohead');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toContain('English rock band');
      expect(result.genres).toContain('alternative rock');
      expect(result.genres).toContain('indie');
      expect(result.mbid).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711');
    });

    it('should handle missing bio gracefully', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Unknown Artist',
        url: 'https://www.last.fm/music/Unknown+Artist',
        stats: { listeners: '100', playcount: '1000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Unknown Artist');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockRejectedValue(
        new Error('Artist not found')
      );

      const result = await adapter.fetchMetadata('Nonexistent Artist');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toBeUndefined();
      expect(result.genres).toBeUndefined();
    });

    it('should clean HTML from bio summary', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Test Artist',
        url: 'https://www.last.fm/music/Test+Artist',
        bio: {
          summary: 'Artist bio with <a href="link">HTML tags</a> and more text.',
        },
        stats: { listeners: '1000', playcount: '10000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.overview).not.toContain('<a');
      expect(result.overview).not.toContain('</a>');
      expect(result.overview).toContain('Artist bio');
    });
  });
});
