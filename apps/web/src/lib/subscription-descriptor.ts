/**
 * Build a human-readable descriptor for a subscription from its type and config.
 *
 * The descriptor serves as the primary identifier (e.g. "Last.fm Tag · rock"),
 * replacing the user-defined name as the main display label.
 *
 * @param type - The subscription type value (e.g. 'lastfm_tag')
 * @param config - The subscription config object
 * @param typeLabel - The human-readable type label (e.g. 'Last.fm Tag')
 * @returns A descriptor string like "Last.fm Tag · rock"
 */
export function buildSubscriptionDescriptor(
  type: string,
  config: Record<string, unknown>,
  typeLabel: string,
): string {
  const detail = getConfigDetail(type, config);
  if (detail) {
    return `${typeLabel} · ${detail}`;
  }
  return typeLabel;
}

/**
 * Extract the most distinguishing config detail for a subscription type.
 * Returns null for singleton types where the type label alone is sufficient.
 */
function getConfigDetail(type: string, config: Record<string, unknown>): string | null {
  switch (type) {
    // Tag-based types
    case 'lastfm_tag':
      return getString(config, 'tag');
    case 'spotify_category':
      return getString(config, 'categoryId');

    // Country/location types
    case 'lastfm_chart':
    case 'lastfm_geo': {
      const country = getString(config, 'country');
      return country && country !== 'global' ? country : null;
    }

    // Playlist types (prefer name over ID)
    case 'spotify_playlist':
    case 'deezer_playlist':
    case 'tidal_playlist':
      return getString(config, 'playlistName') || truncate(getString(config, 'playlistId'), 16);

    // Public playlist URL
    case 'spotify_public_playlist':
      return truncate(getString(config, 'playlistUrl'), 40);

    // Discogs
    case 'discogs_label':
      return getString(config, 'labelName') || truncate(getString(config, 'labelId'), 16);
    case 'discogs_style':
      return getString(config, 'style');

    // Bandcamp
    case 'bandcamp_tag':
    case 'bandcamp_new':
      return getString(config, 'tag');

    // ListenBrainz
    case 'listenbrainz_playlist':
      return truncate(getString(config, 'playlistId'), 16);
    case 'listenbrainz_radio':
      return getString(config, 'mode')
        || truncate(getString(config, 'seedMbid'), 16);

    // All other types are singletons — type label alone is sufficient
    default:
      return null;
  }
}

/** Safely extract a string from a config object */
function getString(config: Record<string, unknown>, key: string): string | null {
  const val = config[key];
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/** Truncate a string with ellipsis if longer than maxLen */
function truncate(value: string | null, maxLen: number): string | null {
  if (!value) return null;
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

/**
 * Check whether a subscription name is a "default" name that should be
 * suppressed in the UI (because the descriptor already conveys the same info).
 *
 * A name is considered default if it matches the type label exactly
 * (the auto-generated value from handleTypeChange) or if it matches
 * the full descriptor.
 */
export function isDefaultName(
  name: string,
  typeLabel: string,
  descriptor: string,
): boolean {
  const trimmed = name.trim();
  return trimmed === typeLabel || trimmed === descriptor;
}
