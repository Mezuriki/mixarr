import { describe, it, expect } from 'vitest';
import {
  normalizeArtistName,
  deduplicateResults,
  type SubscriptionResult,
} from '../../src/utils/deduplication';

describe('normalizeArtistName', () => {
  it('should lowercase the name', () => {
    expect(normalizeArtistName('RADIOHEAD')).toBe('radiohead');
  });

  it('should remove leading "the "', () => {
    expect(normalizeArtistName('The Beatles')).toBe('beatles');
  });

  it('should remove leading "the " case-insensitively', () => {
    expect(normalizeArtistName('THE BLACK KEYS')).toBe('blackkeys');
  });

  it('should remove non-alphanumeric characters', () => {
    expect(normalizeArtistName('AC/DC')).toBe('acdc');
    expect(normalizeArtistName("Guns N' Roses")).toBe('gunsnroses');
  });

  it('should handle combined transformations', () => {
    expect(normalizeArtistName('The Black Keys')).toBe('blackkeys');
    expect(normalizeArtistName('The xx')).toBe('xx');
  });

  it('should handle empty string', () => {
    expect(normalizeArtistName('')).toBe('');
  });

  it('should handle names that are just "the"', () => {
    expect(normalizeArtistName('The')).toBe('');
  });

  it('should not remove "the" from middle of name', () => {
    expect(normalizeArtistName('Rage Against The Machine')).toBe('rageagainstthemachine');
  });

  it('should handle unicode and special characters', () => {
    expect(normalizeArtistName('Björk')).toBe('bjrk');
    expect(normalizeArtistName('Sigur Rós')).toBe('sigurrs');
  });
});

describe('deduplicateResults', () => {
  it('should return empty array for empty input', () => {
    expect(deduplicateResults([])).toEqual([]);
  });

  it('should return single item unchanged (with matchCount set)', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['spotify'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Radiohead');
    expect(result[0].matchCount).toBe(1);
  });

  it('should deduplicate by MBID (preferred)', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', mbid: 'abc-123', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'radiohead', mbid: 'abc-123', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].mbid).toBe('abc-123');
    expect(result[0].sources).toContain('spotify');
    expect(result[0].sources).toContain('lastfm');
    expect(result[0].matchCount).toBe(2);
  });

  it('should deduplicate by normalized name when no MBID', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'The Black Keys', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'Black Keys', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toContain('spotify');
    expect(result[0].sources).toContain('lastfm');
    expect(result[0].matchCount).toBe(2);
  });

  it('should prefer result with MBID when merging', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'Radiohead', mbid: 'abc-123', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].mbid).toBe('abc-123');
    expect(result[0].sources).toContain('spotify');
    expect(result[0].sources).toContain('lastfm');
  });

  it('should prefer result with more complete data', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['spotify'], matchCount: 0 },
      {
        id: 2,
        name: 'Radiohead',
        mbid: 'abc-123',
        spotifyId: 'sp-123',
        sources: ['lastfm'],
        matchCount: 0,
      },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].mbid).toBe('abc-123');
    expect(result[0].spotifyId).toBe('sp-123');
  });

  it('should merge sources without duplicates', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['spotify', 'lastfm'], matchCount: 0 },
      { id: 2, name: 'Radiohead', sources: ['lastfm', 'listenbrainz'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(3);
    expect(result[0].sources).toContain('spotify');
    expect(result[0].sources).toContain('lastfm');
    expect(result[0].sources).toContain('listenbrainz');
    expect(result[0].matchCount).toBe(3);
  });

  it('should sort by matchCount descending', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Artist A', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'Artist B', sources: ['spotify', 'lastfm', 'listenbrainz'], matchCount: 0 },
      { id: 3, name: 'Artist C', sources: ['spotify', 'lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Artist B');
    expect(result[0].matchCount).toBe(3);
    expect(result[1].name).toBe('Artist C');
    expect(result[1].matchCount).toBe(2);
    expect(result[2].name).toBe('Artist A');
    expect(result[2].matchCount).toBe(1);
  });

  it('should handle multiple groups of duplicates', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', mbid: 'mbid-1', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'The Beatles', mbid: 'mbid-2', sources: ['spotify'], matchCount: 0 },
      { id: 3, name: 'Radiohead', mbid: 'mbid-1', sources: ['lastfm'], matchCount: 0 },
      { id: 4, name: 'Beatles', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(2);
    // Both should have 2 sources each
    expect(result.every((r) => r.matchCount === 2)).toBe(true);
  });

  it('should handle case where MBID differs but name matches', () => {
    // Different MBIDs = different artists, even if names normalize the same
    const input: SubscriptionResult[] = [
      { id: 1, name: 'John Smith', mbid: 'mbid-1', sources: ['spotify'], matchCount: 0 },
      { id: 2, name: 'John Smith', mbid: 'mbid-2', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    // Should remain separate since MBIDs differ
    expect(result).toHaveLength(2);
  });

  it('should handle mixed MBID and non-MBID entries for same artist', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['listenbrainz'], matchCount: 0 },
      { id: 2, name: 'Radiohead', mbid: 'abc-123', sources: ['spotify'], matchCount: 0 },
      { id: 3, name: 'radiohead', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].mbid).toBe('abc-123');
    expect(result[0].sources).toHaveLength(3);
    expect(result[0].matchCount).toBe(3);
  });

  it('should preserve additional properties on the kept result', () => {
    const input: SubscriptionResult[] = [
      { id: 1, name: 'Radiohead', sources: ['spotify'], matchCount: 0, spotifyId: 'sp-123' },
      { id: 2, name: 'Radiohead', mbid: 'abc-123', sources: ['lastfm'], matchCount: 0 },
    ];
    const result = deduplicateResults(input);
    expect(result).toHaveLength(1);
    // Should keep the one with MBID but also have spotifyId merged
    expect(result[0].mbid).toBe('abc-123');
    expect(result[0].spotifyId).toBe('sp-123');
  });
});
