import { describe, it, expect } from 'vitest';
import { scoreSearchResult, isLosslessFormat } from '../../src/services/slskd-scoring.js';

describe('isLosslessFormat', () => {
  it('identifies FLAC as lossless', () => {
    expect(isLosslessFormat('flac')).toBe(true);
    expect(isLosslessFormat('FLAC')).toBe(true);
  });

  it('identifies APE, WAV, ALAC as lossless', () => {
    expect(isLosslessFormat('ape')).toBe(true);
    expect(isLosslessFormat('wav')).toBe(true);
    expect(isLosslessFormat('alac')).toBe(true);
  });

  it('identifies MP3 as lossy', () => {
    expect(isLosslessFormat('mp3')).toBe(false);
  });

  it('handles undefined/null gracefully', () => {
    expect(isLosslessFormat(undefined as unknown as string)).toBe(false);
    expect(isLosslessFormat('')).toBe(false);
  });
});

describe('scoreSearchResult', () => {
  const baseResult = {
    username: 'test',
    files: [{ filename: 'test.mp3', size: 1000, extension: 'mp3' }],
    uploadSpeed: 0,
    hasFreeUploadSlot: false,
    queueLength: 0,
  };

  it('gives +50 points for lossless files', () => {
    const lossless = scoreSearchResult({
      ...baseResult,
      files: [{ filename: 'test.flac', size: 1000, extension: 'flac' }],
    });
    const lossy = scoreSearchResult(baseResult);
    expect(lossless - lossy).toBe(50);
  });

  it('gives up to +30 points for fast upload speed', () => {
    const fast = scoreSearchResult({ ...baseResult, uploadSpeed: 5000000 });
    const slow = scoreSearchResult({ ...baseResult, uploadSpeed: 0 });
    expect(fast - slow).toBe(30);
  });

  it('gives +10 points for free upload slot', () => {
    const free = scoreSearchResult({ ...baseResult, hasFreeUploadSlot: true });
    const busy = scoreSearchResult({ ...baseResult, hasFreeUploadSlot: false });
    expect(free - busy).toBe(10);
  });

  it('penalizes up to -10 points for long queue', () => {
    const longQueue = scoreSearchResult({ ...baseResult, queueLength: 100 });
    const noQueue = scoreSearchResult({ ...baseResult, queueLength: 0 });
    expect(noQueue - longQueue).toBe(10);
  });

  it('returns a rounded integer score', () => {
    const score = scoreSearchResult({ ...baseResult, uploadSpeed: 1234567 });
    expect(Number.isInteger(score)).toBe(true);
  });
});
