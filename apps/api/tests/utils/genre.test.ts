import { describe, it, expect } from 'vitest';
import { normalizeGenre, mergeGenres } from '../../src/utils/genre';

describe('Genre Utilities', () => {
  describe('normalizeGenre', () => {
    describe('hip-hop variations', () => {
      it('normalizes "hip-hop" to "Hip-Hop"', () => {
        expect(normalizeGenre('hip-hop')).toBe('Hip-Hop');
      });

      it('normalizes "hip hop" to "Hip-Hop"', () => {
        expect(normalizeGenre('hip hop')).toBe('Hip-Hop');
      });

      it('normalizes "hiphop" to "Hip-Hop"', () => {
        expect(normalizeGenre('hiphop')).toBe('Hip-Hop');
      });

      it('normalizes "HIP HOP" to "Hip-Hop"', () => {
        expect(normalizeGenre('HIP HOP')).toBe('Hip-Hop');
      });
    });

    describe('R&B variations', () => {
      it('normalizes "r&b" to "R&B"', () => {
        expect(normalizeGenre('r&b')).toBe('R&B');
      });

      it('normalizes "rnb" to "R&B"', () => {
        expect(normalizeGenre('rnb')).toBe('R&B');
      });

      it('normalizes "r and b" to "R&B"', () => {
        expect(normalizeGenre('r and b')).toBe('R&B');
      });

      it('normalizes "rhythm and blues" to "R&B"', () => {
        expect(normalizeGenre('rhythm and blues')).toBe('R&B');
      });

      it('normalizes "R&B" to "R&B"', () => {
        expect(normalizeGenre('R&B')).toBe('R&B');
      });
    });

    describe('Rock & Roll variations', () => {
      it('normalizes "rock \'n\' roll" to "Rock & Roll"', () => {
        expect(normalizeGenre("rock 'n' roll")).toBe('Rock & Roll');
      });

      it('normalizes "rock and roll" to "Rock & Roll"', () => {
        expect(normalizeGenre('rock and roll')).toBe('Rock & Roll');
      });

      it('normalizes "rock n roll" to "Rock & Roll"', () => {
        expect(normalizeGenre('rock n roll')).toBe('Rock & Roll');
      });
    });

    describe('Drum & Bass variations', () => {
      it('normalizes "drum \'n\' bass" to "Drum & Bass"', () => {
        expect(normalizeGenre("drum 'n' bass")).toBe('Drum & Bass');
      });

      it('normalizes "drum and bass" to "Drum & Bass"', () => {
        expect(normalizeGenre('drum and bass')).toBe('Drum & Bass');
      });

      it('normalizes "dnb" to "Drum & Bass"', () => {
        expect(normalizeGenre('dnb')).toBe('Drum & Bass');
      });

      it('normalizes "d&b" to "Drum & Bass"', () => {
        expect(normalizeGenre('d&b')).toBe('Drum & Bass');
      });
    });

    describe('Electronic variations', () => {
      it('normalizes "edm" to "Electronic"', () => {
        expect(normalizeGenre('edm')).toBe('Electronic');
      });

      it('normalizes "electronic dance music" to "Electronic"', () => {
        expect(normalizeGenre('electronic dance music')).toBe('Electronic');
      });

      it('normalizes "EDM" to "Electronic"', () => {
        expect(normalizeGenre('EDM')).toBe('Electronic');
      });
    });

    describe('default capitalization', () => {
      it('capitalizes first letter of each word for unknown genres', () => {
        expect(normalizeGenre('indie rock')).toBe('Indie Rock');
      });

      it('capitalizes single word genres', () => {
        expect(normalizeGenre('jazz')).toBe('Jazz');
      });

      it('handles multiple words', () => {
        expect(normalizeGenre('progressive metal')).toBe('Progressive Metal');
      });

      it('handles already capitalized genres', () => {
        expect(normalizeGenre('Pop')).toBe('Pop');
      });
    });

    describe('whitespace handling', () => {
      it('trims leading whitespace', () => {
        expect(normalizeGenre('  rock')).toBe('Rock');
      });

      it('trims trailing whitespace', () => {
        expect(normalizeGenre('rock  ')).toBe('Rock');
      });

      it('trims both leading and trailing whitespace', () => {
        expect(normalizeGenre('  rock  ')).toBe('Rock');
      });

      it('normalizes multiple spaces between words', () => {
        expect(normalizeGenre('indie   rock')).toBe('Indie Rock');
      });
    });

    describe('edge cases', () => {
      it('handles empty string', () => {
        expect(normalizeGenre('')).toBe('');
      });

      it('handles whitespace-only string', () => {
        expect(normalizeGenre('   ')).toBe('');
      });
    });
  });

  describe('mergeGenres', () => {
    it('merges genres from multiple sources', () => {
      const result = mergeGenres([
        ['hip-hop', 'rap', 'trap'],
        ['Hip Hop', 'Rap'],
        ['hip hop', 'electronic'],
      ]);

      // Hip-Hop: 3 occurrences, Rap: 2 occurrences, Trap: 1 (order 2), Electronic: 1 (order 3)
      expect(result).toEqual(['Hip-Hop', 'Rap', 'Trap', 'Electronic']);
    });

    it('deduplicates genres case-insensitively', () => {
      const result = mergeGenres([
        ['Rock', 'ROCK', 'rock'],
        ['rock'],
      ]);

      expect(result).toEqual(['Rock']);
    });

    it('sorts by occurrence count descending', () => {
      const result = mergeGenres([
        ['pop', 'rock'],
        ['jazz', 'rock'],
        ['rock', 'blues'],
      ]);

      // Rock appears 3 times, others appear once
      expect(result[0]).toBe('Rock');
    });

    it('returns top 5 genres only', () => {
      const result = mergeGenres([
        ['genre1', 'genre2', 'genre3', 'genre4', 'genre5', 'genre6', 'genre7'],
      ]);

      expect(result).toHaveLength(5);
    });

    it('handles empty source arrays', () => {
      const result = mergeGenres([[], [], []]);

      expect(result).toEqual([]);
    });

    it('handles single source', () => {
      const result = mergeGenres([['rock', 'pop', 'jazz']]);

      expect(result).toEqual(['Rock', 'Pop', 'Jazz']);
    });

    it('handles no sources', () => {
      const result = mergeGenres([]);

      expect(result).toEqual([]);
    });

    it('normalizes genres before deduplication', () => {
      const result = mergeGenres([
        ['hip-hop'],
        ['hip hop'],
        ['hiphop'],
      ]);

      // All three should normalize to Hip-Hop and count as 3 occurrences
      expect(result).toEqual(['Hip-Hop']);
    });

    it('filters out empty genres', () => {
      const result = mergeGenres([
        ['rock', '', '  '],
        ['pop'],
      ]);

      expect(result).toEqual(['Rock', 'Pop']);
    });

    it('maintains stable order for equal counts', () => {
      // When counts are equal, order should be based on first appearance
      const result = mergeGenres([
        ['rock', 'pop', 'jazz'],
      ]);

      expect(result).toEqual(['Rock', 'Pop', 'Jazz']);
    });

    it('handles mixed normalized variations', () => {
      const result = mergeGenres([
        ['r&b', 'electronic'],
        ['rnb', 'edm'],
        ['rhythm and blues', 'electronic dance music'],
      ]);

      // R&B appears 3 times, Electronic appears 3 times
      expect(result).toContain('R&B');
      expect(result).toContain('Electronic');
      expect(result).toHaveLength(2);
    });
  });
});
