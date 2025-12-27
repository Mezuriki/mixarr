/**
 * Genre normalization utility for consistent display across multiple sources
 * (MusicBrainz, Last.fm, Spotify)
 */

// Mapping of lowercase variations to normalized genre names
const GENRE_NORMALIZATION_MAP: Record<string, string> = {
  // Hip-Hop variations
  'hip-hop': 'Hip-Hop',
  'hip hop': 'Hip-Hop',
  'hiphop': 'Hip-Hop',

  // R&B variations
  'r&b': 'R&B',
  'rnb': 'R&B',
  'r and b': 'R&B',
  'rhythm and blues': 'R&B',

  // Rock & Roll variations
  "rock 'n' roll": 'Rock & Roll',
  'rock and roll': 'Rock & Roll',
  'rock n roll': 'Rock & Roll',

  // Drum & Bass variations
  "drum 'n' bass": 'Drum & Bass',
  'drum and bass': 'Drum & Bass',
  'dnb': 'Drum & Bass',
  'd&b': 'Drum & Bass',

  // Electronic variations
  'edm': 'Electronic',
  'electronic dance music': 'Electronic',
};

/**
 * Normalizes a genre string to a consistent format
 *
 * @param genre - The genre string to normalize
 * @returns The normalized genre string
 *
 * @example
 * normalizeGenre('hip-hop') // 'Hip-Hop'
 * normalizeGenre('HIP HOP') // 'Hip-Hop'
 * normalizeGenre('indie rock') // 'Indie Rock'
 */
export function normalizeGenre(genre: string): string {
  // Trim whitespace and normalize multiple spaces
  const trimmed = genre.trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    return '';
  }

  // Check if it's a known variation (case-insensitive)
  const lowerGenre = trimmed.toLowerCase();
  const normalized = GENRE_NORMALIZATION_MAP[lowerGenre];

  if (normalized) {
    return normalized;
  }

  // Default: capitalize first letter of each word
  return trimmed
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Merges genre arrays from multiple sources into a deduplicated, sorted list
 *
 * @param sources - Array of genre arrays, one per source
 * @returns Top 5 genres sorted by occurrence count (most common first)
 *
 * @example
 * mergeGenres([
 *   ['hip-hop', 'rap', 'trap'],  // from Spotify
 *   ['Hip Hop', 'Rap'],           // from Last.fm
 *   ['hip hop', 'electronic']     // from MusicBrainz
 * ])
 * // Returns: ['Hip-Hop', 'Rap', 'Electronic', 'Trap']
 */
export function mergeGenres(sources: string[][]): string[] {
  // Map to track normalized genre counts and first appearance order
  const genreCounts = new Map<string, { count: number; order: number }>();
  let orderCounter = 0;

  // Process all sources
  for (const source of sources) {
    for (const genre of source) {
      const normalized = normalizeGenre(genre);

      // Skip empty genres
      if (!normalized) {
        continue;
      }

      const existing = genreCounts.get(normalized);
      if (existing) {
        existing.count++;
      } else {
        genreCounts.set(normalized, { count: 1, order: orderCounter++ });
      }
    }
  }

  // Convert to array and sort
  const sortedGenres = Array.from(genreCounts.entries())
    .sort((a, b) => {
      // Sort by count descending
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      // For equal counts, maintain first appearance order
      return a[1].order - b[1].order;
    })
    .map(([genre]) => genre);

  // Return top 5
  return sortedGenres.slice(0, 5);
}
