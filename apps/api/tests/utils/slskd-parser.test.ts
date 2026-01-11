import { describe, it, expect } from 'vitest';

describe('slskd-parser', () => {
  describe('parseFilename', () => {
    it('should extract metadata from standard filename format', async () => {
      const { parseFilename } = await import('../../src/utils/slskd-parser.js');
      
      const result = parseFilename('01 - Breathe (In the Air).flac');
      
      expect(result.trackNumber).toBe(1);
      expect(result.title).toBe('Breathe (In the Air)');
      expect(result.extension).toBe('flac');
    });

    it('should handle filenames without track number', async () => {
      const { parseFilename } = await import('../../src/utils/slskd-parser.js');
      
      const result = parseFilename('Breathe.mp3');
      
      expect(result.trackNumber).toBeUndefined();
      expect(result.title).toBe('Breathe');
      expect(result.extension).toBe('mp3');
    });
  });

  describe('parseDirectoryPath', () => {
    it('should extract artist and album from path', async () => {
      const { parseDirectoryPath } = await import('../../src/utils/slskd-parser.js');
      
      const result = parseDirectoryPath('/Music/Pink Floyd/The Dark Side of the Moon (1973)');
      
      expect(result.artist).toBe('Pink Floyd');
      expect(result.album).toBe('The Dark Side of the Moon');
      expect(result.year).toBe(1973);
    });

    it('should handle path without year', async () => {
      const { parseDirectoryPath } = await import('../../src/utils/slskd-parser.js');
      
      const result = parseDirectoryPath('/Music/Pink Floyd/The Dark Side of the Moon');
      
      expect(result.artist).toBe('Pink Floyd');
      expect(result.album).toBe('The Dark Side of the Moon');
      expect(result.year).toBeUndefined();
    });
  });

  describe('getQualityFromExtension', () => {
    it('should return correct quality for lossless formats', async () => {
      const { getQualityFromExtension } = await import('../../src/utils/slskd-parser.js');
      
      expect(getQualityFromExtension('flac')).toBe('lossless');
      expect(getQualityFromExtension('wav')).toBe('lossless');
      expect(getQualityFromExtension('alac')).toBe('lossless');
    });

    it('should return correct quality for lossy formats', async () => {
      const { getQualityFromExtension } = await import('../../src/utils/slskd-parser.js');
      
      expect(getQualityFromExtension('mp3')).toBe('lossy');
      expect(getQualityFromExtension('aac')).toBe('lossy');
      expect(getQualityFromExtension('ogg')).toBe('lossy');
    });
  });

  describe('filterResultsByQuality', () => {
    it('should filter results by minimum quality', async () => {
      const { filterResultsByQuality } = await import('../../src/utils/slskd-parser.js');
      
      const files = [
        { filename: 'track1.flac', size: 45000000 },
        { filename: 'track2.mp3', size: 8000000 },
        { filename: 'track3.wav', size: 60000000 },
      ];

      const result = filterResultsByQuality(files, 'lossless');
      
      expect(result).toHaveLength(2);
      expect(result.map((f: { filename: string }) => f.filename)).toContain('track1.flac');
      expect(result.map((f: { filename: string }) => f.filename)).toContain('track3.wav');
    });
  });

  describe('groupFilesByAlbum', () => {
    it('should group files by directory', async () => {
      const { groupFilesByAlbum } = await import('../../src/utils/slskd-parser.js');
      
      const files = [
        { filename: '/Music/Artist/Album1/track1.flac', size: 40000000 },
        { filename: '/Music/Artist/Album1/track2.flac', size: 42000000 },
        { filename: '/Music/Artist/Album2/track1.flac', size: 38000000 },
      ];

      const result = groupFilesByAlbum(files);
      
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['/Music/Artist/Album1']).toHaveLength(2);
      expect(result['/Music/Artist/Album2']).toHaveLength(1);
    });
  });

  describe('scoreResult', () => {
    it('should score results based on quality factors', async () => {
      const { scoreResult } = await import('../../src/utils/slskd-parser.js');
      
      const highQuality = {
        files: [
          { filename: 'track1.flac', size: 45000000 },
          { filename: 'track2.flac', size: 42000000 },
        ],
        uploadSpeed: 100000,
        hasFreeUploadSlot: true,
      };

      const lowQuality = {
        files: [
          { filename: 'track1.mp3', size: 8000000 },
        ],
        uploadSpeed: 10000,
        hasFreeUploadSlot: false,
      };

      expect(scoreResult(highQuality)).toBeGreaterThan(scoreResult(lowQuality));
    });
  });
});
