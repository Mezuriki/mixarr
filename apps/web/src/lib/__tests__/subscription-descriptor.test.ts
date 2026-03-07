import { describe, it, expect } from 'vitest';
import { buildSubscriptionDescriptor, isDefaultName } from '../subscription-descriptor';

// ============================================================================
// buildSubscriptionDescriptor
// ============================================================================

describe('buildSubscriptionDescriptor', () => {
  describe('tag-based types', () => {
    it('returns "Type · tag" for lastfm_tag', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: 'rock' }, 'Last.fm Tag'))
        .toBe('Last.fm Tag · rock');
    });

    it('returns "Type · categoryId" for spotify_category', () => {
      expect(buildSubscriptionDescriptor('spotify_category', { categoryId: 'indie_alt' }, 'Spotify Category'))
        .toBe('Spotify Category · indie_alt');
    });

    it('falls back to type label when tag is empty', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: '' }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
    });

    it('falls back to type label when tag is missing', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', {}, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
    });
  });

  describe('country/location types', () => {
    it('returns "Type · country" for lastfm_chart with country', () => {
      expect(buildSubscriptionDescriptor('lastfm_chart', { country: 'US' }, 'Last.fm Chart'))
        .toBe('Last.fm Chart · US');
    });

    it('omits "global" — returns type label only', () => {
      expect(buildSubscriptionDescriptor('lastfm_chart', { country: 'global' }, 'Last.fm Chart'))
        .toBe('Last.fm Chart');
    });

    it('returns type label when country is missing', () => {
      expect(buildSubscriptionDescriptor('lastfm_geo', {}, 'Last.fm Geo'))
        .toBe('Last.fm Geo');
    });
  });

  describe('playlist types', () => {
    it('prefers playlistName over playlistId', () => {
      expect(buildSubscriptionDescriptor('spotify_playlist', { playlistName: 'Chill Vibes', playlistId: 'abc123' }, 'Spotify Playlist'))
        .toBe('Spotify Playlist · Chill Vibes');
    });

    it('falls back to playlistId when no playlistName', () => {
      expect(buildSubscriptionDescriptor('deezer_playlist', { playlistId: 'xyz789' }, 'Deezer Playlist'))
        .toBe('Deezer Playlist · xyz789');
    });

    it('truncates long playlistId to 16 chars', () => {
      const longId = '12345678901234567890';
      const result = buildSubscriptionDescriptor('tidal_playlist', { playlistId: longId }, 'Tidal Playlist');
      expect(result).toBe('Tidal Playlist · 1234567890123456…');
    });

    it('returns type label when neither name nor id present', () => {
      expect(buildSubscriptionDescriptor('spotify_playlist', {}, 'Spotify Playlist'))
        .toBe('Spotify Playlist');
    });
  });

  describe('spotify public playlist', () => {
    it('shows truncated playlistUrl', () => {
      const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      const result = buildSubscriptionDescriptor('spotify_public_playlist', { playlistUrl: url }, 'Spotify Public Playlist');
      // truncate(url, 40) → first 40 chars + ellipsis
      expect(result).toBe(`Spotify Public Playlist · ${url.slice(0, 40)}…`);
    });

    it('shows short URL without truncation', () => {
      const url = 'https://open.spotify.com/short';
      const result = buildSubscriptionDescriptor('spotify_public_playlist', { playlistUrl: url }, 'Spotify Public Playlist');
      expect(result).toBe(`Spotify Public Playlist · ${url}`);
    });
  });

  describe('discogs types', () => {
    it('prefers labelName over labelId for discogs_label', () => {
      expect(buildSubscriptionDescriptor('discogs_label', { labelName: 'Warp Records', labelId: '233' }, 'Discogs Label'))
        .toBe('Discogs Label · Warp Records');
    });

    it('falls back to labelId for discogs_label', () => {
      expect(buildSubscriptionDescriptor('discogs_label', { labelId: '233' }, 'Discogs Label'))
        .toBe('Discogs Label · 233');
    });

    it('returns "Type · style" for discogs_style', () => {
      expect(buildSubscriptionDescriptor('discogs_style', { style: 'Ambient' }, 'Discogs Style'))
        .toBe('Discogs Style · Ambient');
    });
  });

  describe('bandcamp types', () => {
    it('returns "Type · tag" for bandcamp_tag', () => {
      expect(buildSubscriptionDescriptor('bandcamp_tag', { tag: 'electronic' }, 'Bandcamp Tag'))
        .toBe('Bandcamp Tag · electronic');
    });

    it('returns "Type · tag" for bandcamp_new', () => {
      expect(buildSubscriptionDescriptor('bandcamp_new', { tag: 'jazz' }, 'Bandcamp New'))
        .toBe('Bandcamp New · jazz');
    });
  });

  describe('listenbrainz types', () => {
    it('truncates playlistId for listenbrainz_playlist', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const result = buildSubscriptionDescriptor('listenbrainz_playlist', { playlistId: uuid }, 'ListenBrainz Playlist');
      expect(result).toBe('ListenBrainz Playlist · a1b2c3d4-e5f6-78…');
    });

    it('shows mode for listenbrainz_radio', () => {
      expect(buildSubscriptionDescriptor('listenbrainz_radio', { mode: 'easy', seedMbid: 'abc' }, 'ListenBrainz Radio'))
        .toBe('ListenBrainz Radio · easy');
    });

    it('falls back to truncated seedMbid when no mode', () => {
      const mbid = '12345678-1234-1234-1234-123456789012';
      const result = buildSubscriptionDescriptor('listenbrainz_radio', { seedMbid: mbid }, 'ListenBrainz Radio');
      expect(result).toBe('ListenBrainz Radio · 12345678-1234-12…');
    });
  });

  describe('singleton types', () => {
    it('returns type label only for unknown/singleton types', () => {
      expect(buildSubscriptionDescriptor('lastfm_similar', {}, 'Last.fm Similar'))
        .toBe('Last.fm Similar');
    });

    it('returns type label for ai_recommendation', () => {
      expect(buildSubscriptionDescriptor('ai_recommendation', { strategy: 'diverse' }, 'AI Recommendation'))
        .toBe('AI Recommendation');
    });

    it('returns type label for spotify_new_releases', () => {
      expect(buildSubscriptionDescriptor('spotify_new_releases', {}, 'Spotify New Releases'))
        .toBe('Spotify New Releases');
    });
  });

  describe('edge cases', () => {
    it('handles empty config', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', {}, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
    });

    it('handles whitespace-only config values', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: '   ' }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
    });

    it('trims config values', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: '  rock  ' }, 'Last.fm Tag'))
        .toBe('Last.fm Tag · rock');
    });

    it('handles non-string config values gracefully', () => {
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: 42 }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: null }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: undefined }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
      expect(buildSubscriptionDescriptor('lastfm_tag', { tag: true }, 'Last.fm Tag'))
        .toBe('Last.fm Tag');
    });
  });
});

// ============================================================================
// isDefaultName
// ============================================================================

describe('isDefaultName', () => {
  it('returns true when name matches typeLabel exactly', () => {
    expect(isDefaultName('Last.fm Tag', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(true);
  });

  it('returns true when name matches descriptor exactly', () => {
    expect(isDefaultName('Last.fm Tag · rock', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(true);
  });

  it('returns false when name differs from both', () => {
    expect(isDefaultName('My Rock Sub', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(false);
  });

  it('returns false for empty name', () => {
    expect(isDefaultName('', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(false);
  });

  it('trims whitespace before comparing', () => {
    expect(isDefaultName('  Last.fm Tag  ', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(isDefaultName('last.fm tag', 'Last.fm Tag', 'Last.fm Tag · rock')).toBe(false);
  });

  it('returns true when singleton descriptor equals typeLabel', () => {
    expect(isDefaultName('Last.fm Similar', 'Last.fm Similar', 'Last.fm Similar')).toBe(true);
  });
});
