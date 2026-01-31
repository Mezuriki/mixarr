import { describe, it, expect } from 'vitest';
import { classifyFileFormat } from '../../src/services/slskd-format.js';

describe('classifyFileFormat', () => {
  describe('lossless formats', () => {
    it('identifies FLAC', () => {
      expect(classifyFileFormat({ extension: 'flac' })).toEqual({ format: 'FLAC', isLossless: true });
    });

    it('identifies APE, WAV, ALAC as FLAC category', () => {
      expect(classifyFileFormat({ extension: 'ape' }).format).toBe('FLAC');
      expect(classifyFileFormat({ extension: 'wav' }).format).toBe('FLAC');
      expect(classifyFileFormat({ extension: 'alac' }).format).toBe('FLAC');
    });

    it('is case insensitive', () => {
      expect(classifyFileFormat({ extension: 'FLAC' }).format).toBe('FLAC');
    });
  });

  describe('MP3 variants', () => {
    it('identifies MP3-320 for 320kbps', () => {
      expect(classifyFileFormat({ extension: 'mp3', bitRate: 320 })).toEqual({ format: 'MP3-320', isLossless: false });
    });

    it('identifies MP3-256 for 256-319kbps', () => {
      expect(classifyFileFormat({ extension: 'mp3', bitRate: 256 }).format).toBe('MP3-256');
      expect(classifyFileFormat({ extension: 'mp3', bitRate: 300 }).format).toBe('MP3-256');
    });

    it('identifies MP3 for lower bitrates', () => {
      expect(classifyFileFormat({ extension: 'mp3', bitRate: 128 }).format).toBe('MP3');
      expect(classifyFileFormat({ extension: 'mp3' }).format).toBe('MP3');
    });
  });

  describe('other formats', () => {
    it('identifies OGG/Opus', () => {
      expect(classifyFileFormat({ extension: 'ogg' }).format).toBe('OGG');
      expect(classifyFileFormat({ extension: 'opus' }).format).toBe('OGG');
    });

    it('identifies AAC/M4A', () => {
      expect(classifyFileFormat({ extension: 'm4a' }).format).toBe('AAC');
    });

    it('returns uppercase extension for unknown formats', () => {
      expect(classifyFileFormat({ extension: 'wma' }).format).toBe('WMA');
    });
  });

  describe('edge cases', () => {
    it('extracts extension from filename if not provided', () => {
      expect(classifyFileFormat({ filename: 'song.flac' }).format).toBe('FLAC');
    });

    it('handles missing extension and filename', () => {
      expect(classifyFileFormat({}).format).toBe('');
    });
  });
});
