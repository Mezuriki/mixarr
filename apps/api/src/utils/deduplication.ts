/**
 * Deduplication utilities for subscription results
 * Handles merging duplicate artists from multiple sources
 */

export interface SubscriptionResult {
  id: number;
  name: string;
  mbid?: string;
  spotifyId?: string;
  sources: string[];
  matchCount: number;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Normalizes an artist name for comparison purposes
 * - Lowercases the name
 * - Removes leading "the "
 * - Removes non-alphanumeric characters
 *
 * @example
 * normalizeArtistName("The Black Keys") // "blackkeys"
 * normalizeArtistName("AC/DC") // "acdc"
 */
export function normalizeArtistName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase();

  // Remove leading "the " (with space) or standalone "the"
  if (normalized.startsWith('the ')) {
    normalized = normalized.slice(4);
  } else if (normalized === 'the') {
    normalized = '';
  }

  // Remove non-alphanumeric characters
  normalized = normalized.replace(/[^a-z0-9]/g, '');

  return normalized;
}

/**
 * Counts how many defined properties an object has from a specific set
 */
function countDefinedProperties(
  obj: SubscriptionResult,
  props: (keyof SubscriptionResult)[]
): number {
  return props.filter((prop) => obj[prop] !== undefined && obj[prop] !== null).length;
}

/**
 * Merges two SubscriptionResult objects, preferring defined values
 */
function mergeResults(
  primary: SubscriptionResult,
  secondary: SubscriptionResult
): SubscriptionResult {
  const merged = { ...primary };

  // Merge undefined properties from secondary
  for (const key of Object.keys(secondary)) {
    if (merged[key] === undefined || merged[key] === null) {
      merged[key] = secondary[key];
    }
  }

  // Merge sources (unique values only)
  const allSources = [...new Set([...primary.sources, ...secondary.sources])];
  merged.sources = allSources;
  merged.matchCount = allSources.length;

  return merged;
}

/**
 * Determines which result should be the primary (kept) one
 * Prefers: 1) Has MBID, 2) More complete data
 */
function selectPrimaryResult(
  a: SubscriptionResult,
  b: SubscriptionResult
): { primary: SubscriptionResult; secondary: SubscriptionResult } {
  const importantProps: (keyof SubscriptionResult)[] = ['mbid', 'spotifyId'];

  const aHasMbid = !!a.mbid;
  const bHasMbid = !!b.mbid;

  // Prefer the one with MBID
  if (aHasMbid && !bHasMbid) {
    return { primary: a, secondary: b };
  }
  if (bHasMbid && !aHasMbid) {
    return { primary: b, secondary: a };
  }

  // Both have or neither has MBID - prefer more complete data
  const aCount = countDefinedProperties(a, importantProps);
  const bCount = countDefinedProperties(b, importantProps);

  if (bCount > aCount) {
    return { primary: b, secondary: a };
  }

  return { primary: a, secondary: b };
}

/**
 * Generates a unique key for grouping artists
 * Uses MBID if available, otherwise normalized name
 */
function getGroupKey(result: SubscriptionResult): string {
  if (result.mbid) {
    return `mbid:${result.mbid}`;
  }
  return `name:${normalizeArtistName(result.name)}`;
}

/**
 * Deduplicates subscription results from multiple sources
 *
 * Matching strategy:
 * 1. MBID exact match (preferred)
 * 2. Normalized name match (fallback)
 *
 * When duplicates are found:
 * - Keeps the result with most complete data (prefers MBID)
 * - Merges sources arrays from all duplicates
 * - Sets matchCount to number of unique sources
 *
 * Results are sorted by matchCount descending (most recommended first)
 */
export function deduplicateResults(results: SubscriptionResult[]): SubscriptionResult[] {
  if (results.length === 0) return [];

  // Group results by their dedup key
  const groups = new Map<string, SubscriptionResult[]>();

  for (const result of results) {
    const key = getGroupKey(result);

    const existing = groups.get(key);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(key, [result]);
    }
  }

  // For entries without MBID, check if they should merge with an MBID group
  // by matching normalized names
  const mbidGroups = new Map<string, string>(); // normalized name -> mbid key
  for (const [key, group] of groups) {
    if (key.startsWith('mbid:') && group.length > 0) {
      const normalizedName = normalizeArtistName(group[0].name);
      mbidGroups.set(normalizedName, key);
    }
  }

  // Merge name-based groups into MBID groups where applicable
  for (const [key, group] of [...groups.entries()]) {
    if (key.startsWith('name:')) {
      const normalizedName = key.slice(5); // Remove "name:" prefix
      const mbidKey = mbidGroups.get(normalizedName);
      if (mbidKey && groups.has(mbidKey)) {
        // Merge into MBID group
        groups.get(mbidKey)!.push(...group);
        groups.delete(key);
      }
    }
  }

  // Merge each group into a single result
  const deduplicated: SubscriptionResult[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      // Single item, just update matchCount
      const result = { ...group[0] };
      result.matchCount = new Set(result.sources).size;
      deduplicated.push(result);
    } else {
      // Multiple items, merge them
      let merged = group[0];
      for (let i = 1; i < group.length; i++) {
        const { primary, secondary } = selectPrimaryResult(merged, group[i]);
        merged = mergeResults(primary, secondary);
      }
      deduplicated.push(merged);
    }
  }

  // Sort by matchCount descending
  deduplicated.sort((a, b) => b.matchCount - a.matchCount);

  return deduplicated;
}
