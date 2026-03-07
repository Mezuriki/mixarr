/**
 * Shared Subscription Type Constants
 *
 * Centralized subscription type definitions shared between frontend and backend.
 * These provide runtime-accessible constants for subscription type validation.
 */

// ============================================================================
// Subscription Type Constants
// ============================================================================

export const SUBSCRIPTION_TYPES = {
  // Spotify
  SPOTIFY_PLAYLIST: 'spotify_playlist',
  SPOTIFY_PUBLIC_PLAYLIST: 'spotify_public_playlist',
  SPOTIFY_FOLLOWED: 'spotify_followed',
  SPOTIFY_SAVED_ALBUMS: 'spotify_saved_albums',
  SPOTIFY_LIKED_SONGS: 'spotify_liked_songs',
  SPOTIFY_NEW_RELEASES: 'spotify_new_releases',
  SPOTIFY_DISCOVER_WEEKLY: 'spotify_discover_weekly',
  SPOTIFY_RELEASE_RADAR: 'spotify_release_radar',
  SPOTIFY_DAILY_MIX: 'spotify_daily_mix',
  SPOTIFY_ON_REPEAT: 'spotify_on_repeat',
  SPOTIFY_FEATURED: 'spotify_featured',
  SPOTIFY_CATEGORY: 'spotify_category',
  SPOTIFY_LIBRARY: 'spotify_library',

  // Last.fm
  LASTFM_CHART: 'lastfm_chart',
  LASTFM_TAG: 'lastfm_tag',
  LASTFM_GEO: 'lastfm_geo',
  LASTFM_LIBRARY: 'lastfm_library',
  LASTFM_SIMILAR: 'lastfm_similar',
  LASTFM_TAG_ALBUMS: 'lastfm_tag_albums',
  LASTFM_TAG_SIMILAR: 'lastfm_tag_similar',
  LASTFM_USER_ALBUMS: 'lastfm_user_albums',
  LASTFM_WEEKLY_ARTISTS: 'lastfm_weekly_artists',
  LASTFM_WEEKLY_ALBUMS: 'lastfm_weekly_albums',

  // ListenBrainz
  LISTENBRAINZ_TOP: 'listenbrainz_top',
  LISTENBRAINZ_SIMILAR: 'listenbrainz_similar',
  LISTENBRAINZ_RECOMMENDATIONS: 'listenbrainz_recommendations',
  LISTENBRAINZ_FRESH_RELEASES: 'listenbrainz_fresh_releases',
  LISTENBRAINZ_WEEKLY_JAMS: 'listenbrainz_weekly_jams',
  LISTENBRAINZ_WEEKLY_EXPLORATION: 'listenbrainz_weekly_exploration',
  LISTENBRAINZ_YEAR: 'listenbrainz_year',
  LISTENBRAINZ_PLAYLIST: 'listenbrainz_playlist',
  LISTENBRAINZ_RADIO: 'listenbrainz_radio',
  LISTENBRAINZ_LOVED: 'listenbrainz_loved',

  // Deezer
  DEEZER_FAVORITES: 'deezer_favorites',
  DEEZER_HISTORY: 'deezer_history',
  DEEZER_FLOW: 'deezer_flow',
  DEEZER_PLAYLIST: 'deezer_playlist',
  DEEZER_PLAYLISTS: 'deezer_playlists',
  DEEZER_CHART: 'deezer_chart',
  DEEZER_GENRE: 'deezer_genre',
  DEEZER_SEARCH: 'deezer_search',

  // TIDAL
  TIDAL_FAVORITES: 'tidal_favorites',
  TIDAL_FOLLOWED_ARTISTS: 'tidal_followed_artists',
  TIDAL_PLAYLIST: 'tidal_playlist',
  TIDAL_PLAYLISTS: 'tidal_playlists',
  TIDAL_DISCOVERY: 'tidal_discovery',
  TIDAL_NEW_ARRIVALS: 'tidal_new_arrivals',
  TIDAL_MIX: 'tidal_mix',

  // Tautulli/Plex
  TAUTULLI_SIMILAR: 'tautulli_similar',

  // Jellyfin
  JELLYFIN_SIMILAR: 'jellyfin_similar',

  // Discogs
  DISCOGS_LABEL: 'discogs_label',
  DISCOGS_STYLE: 'discogs_style',

  // Bandcamp
  BANDCAMP_TAG: 'bandcamp_tag',
  BANDCAMP_NEW: 'bandcamp_new',

  // AI
  AI_RECOMMENDATION: 'ai_recommendation',

  // Combined
  COMBINED: 'combined',
} as const;

/**
 * Type derived from SUBSCRIPTION_TYPES values
 */
export type SubscriptionTypeValue = (typeof SUBSCRIPTION_TYPES)[keyof typeof SUBSCRIPTION_TYPES];

// ============================================================================
// Result Handling Constants
// ============================================================================

export const RESULT_HANDLING_OPTIONS = ['preview', 'queue', 'auto'] as const;

/**
 * Type for result handling options
 */
export type ResultHandlingValue = (typeof RESULT_HANDLING_OPTIONS)[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a string is a valid subscription type
 */
export function isValidSubscriptionType(value: string): value is SubscriptionTypeValue {
  return Object.values(SUBSCRIPTION_TYPES).includes(value as SubscriptionTypeValue);
}

/**
 * Check if a string is a valid result handling option
 */
export function isValidResultHandling(value: string): value is ResultHandlingValue {
  return RESULT_HANDLING_OPTIONS.includes(value as ResultHandlingValue);
}

/**
 * Get all subscription type values as an array
 */
export function getSubscriptionTypeValues(): SubscriptionTypeValue[] {
  return Object.values(SUBSCRIPTION_TYPES);
}
