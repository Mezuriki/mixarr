// apps/api/tests/services/adapters/deezer-adapter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeezerMetadataAdapter } from '../../../src/services/adapters/deezer-adapter.js';

// Mock the deezer service module
vi.mock('../../../src/services/deezer.js', () => ({
  searchDeezerArtists: vi.fn(),
  getDeezerArtist: vi.fn(),
}));

import { searchDeezerArtists, getDeezerArtist } from '../../../src/services/deezer.js';

describe('DeezerMetadataAdapter', () => {
  let adapter: DeezerMetadataAdapter;

  beforeEach(() => {
    adapter = new DeezerMetadataAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchMetadata', () => {
    it('should return normalized metadata with high-res image', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([
        {
          id: 399,
          name: 'Radiohead',
          picture: 'https://cdn.deezer.com/pictures/artist/small.jpg',
          picture_small: 'https://cdn.deezer.com/pictures/artist/small.jpg',
          picture_medium: 'https://cdn.deezer.com/pictures/artist/medium.jpg',
          picture_big: 'https://cdn.deezer.com/pictures/artist/big.jpg',
          picture_xl: 'https://cdn.deezer.com/pictures/artist/xl.jpg',
          nb_fan: 3000000,
        },
      ]);

      const result = await adapter.fetchMetadata('Radiohead');

      expect(result.source).toBe('deezer');
      expect(result.images).toHaveLength(1);
      expect(result.images![0].url).toBe('https://cdn.deezer.com/pictures/artist/xl.jpg');
      expect(result.images![0].type).toBe('poster');
      expect(result.images![0].width).toBe(1000);
    });

    it('should fall back to smaller images if xl not available', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([
        {
          id: 123,
          name: 'Test Artist',
          picture_big: 'https://cdn.deezer.com/big.jpg',
          picture_medium: 'https://cdn.deezer.com/medium.jpg',
          nb_fan: 1000,
        },
      ]);

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.images![0].url).toBe('https://cdn.deezer.com/big.jpg');
      expect(result.images![0].width).toBe(500);
    });

    it('should handle no search results', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([]);

      const result = await adapter.fetchMetadata('Unknown Artist');

      expect(result.source).toBe('deezer');
      expect(result.images).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(searchDeezerArtists).mockRejectedValue(new Error('API error'));

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.source).toBe('deezer');
      expect(result.images).toBeUndefined();
    });
  });
});
