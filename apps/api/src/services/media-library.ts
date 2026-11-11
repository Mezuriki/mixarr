/**
 * Media Library Service — данные для страницы «Медиа» в Mixarr:
 * библиотека Navidrome (альбомы/артисты с обложками), текущие обложки,
 * кандидаты обложек (Deezer + iTunes), текст/смысл треков (sidecar),
 * биографии (Last.fm), применение выбранной обложки (загрузка в Navidrome).
 */
// @ts-nocheck
import type { LastfmService } from './lastfm.js';
import { fetchItunesArtwork, fetchItunesCandidates } from './itunes.js';
import { fetchDeezerAlbumCandidates } from './deezer.js';
import { ConnectionResolver } from '../lib/connection-resolver.js';

export interface MediaTrack {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  hasLyrics: boolean;
  hasDecode: boolean;
  hasTranslation: boolean;
}

export interface MediaAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  year?: number;
  coverUrl?: string;
}

export interface MediaArtist {
  id: string;
  name: string;
  coverUrl?: string;
  imageUrl?: string;
}

export class MediaLibraryService {
  constructor(private lastfm: LastfmService) {}

  private async nd(userId: number) {
    const service = await ConnectionResolver.getNavidromeService(userId);
    if (!service) throw new Error('Navidrome connection is not configured');
    return service;
  }

  /** Same-origin cover proxy path (avoids mixed content on https pages). */
  private coverProxyUrl(coverArtId: string): string {
    return `/api/media/cover?id=${encodeURIComponent(coverArtId)}`;
  }

  /** Cover bytes for the proxy route. */
  async coverBytes(userId: number, coverArtId: string, size?: number): Promise<{ buf: Buffer; contentType: string }> {
    const nd = await this.nd(userId);
    return nd.fetchCover(coverArtId, size || 300);
  }

  /** Album list with playable cover URLs (subsonic getCoverArt). */
  async albums(userId: number): Promise<MediaAlbum[]> {
    const nd = await this.nd(userId);
    const list = await nd.getAlbumList2({ type: 'alphabeticalByName', size: 500 });
    return (list || []).map((a) => ({
      id: a.id,
      name: a.name,
      artist: a.artist,
      artistId: a.artistId,
      year: a.year,
      coverUrl: a.coverArtId ? this.coverProxyUrl(a.coverArtId) : undefined,
    }));
  }

  /** Artist list (subsonic getArtists). */
  async artists(userId: number): Promise<MediaArtist[]> {
    const nd = await this.nd(userId);
    const list = await nd.getArtistsFlat();
    // no eager Deezer lookups here (rate limits): photo candidates are
    // fetched lazily when the artist card is opened
    return (list || []).map((a) => ({
      id: a.id,
      name: a.name,
      coverUrl: a.coverArtId ? nd.coverArtUrl(a.coverArtId) : undefined,
    }));
  }

  /** Album detail: meta + tracks with sidecar status. */
  async albumDetail(userId: number, albumId: string): Promise<{ album: MediaAlbum; tracks: MediaTrack[] }> {
    const nd = await this.nd(userId);
    const { album, songs } = await nd.getAlbum(albumId);
    const token = await nd.login();
    // Use /missing endpoints (bulk) instead of per-track sidecar calls —
    // they return hasLyrics/hasTranslation/hasDecode for ALL tracks in one request.
    const [lyr, dec] = await Promise.all([
      nd.getMissingLyrics(token, { albumId }),
      nd.getMissingDecode(token, { albumId }),
    ]);
    const lyrMap = new Map(lyr.map((t) => [t.mediaFileId, t]));
    const decMap = new Map(dec.map((t) => [t.mediaFileId, t.hasLyrics]));
    const tracks: MediaTrack[] = (songs || []).map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      duration: s.duration,
      hasLyrics: lyrMap.get(s.id)?.hasLyrics ?? false,
      hasTranslation: lyrMap.get(s.id)?.hasTranslation ?? false,
      hasDecode: decMap.get(s.id) ?? false,
    }));
    return {
      album: {
        id: album.id,
        name: album.name,
        artist: album.artist,
        artistId: album.artistId,
        year: album.year,
        coverUrl: (album as any).coverArt ? this.coverProxyUrl((album as any).coverArt) : undefined,
      },
      tracks,
    };
  }

  /** Cover candidates for an album: Deezer albums + iTunes albums. */
  async albumCoverCandidates(artist: string, album: string): Promise<string[]> {
    const [dz, it] = await Promise.all([
      fetchDeezerAlbumCandidates(artist, album),
      fetchItunesCandidates(artist, album),
    ]);
    return [...dz, ...it];
  }

  /** Photo candidates for an artist: Deezer artist images. */
  async artistPhotoCandidates(artist: string): Promise<string[]> {
    const { fetchDeezerArtistCandidates } = await import('./deezer.js');
    return fetchDeezerArtistCandidates(artist);
  }

  /** Biography (Last.fm). */
  async artistBio(artist: string): Promise<{ summary: string; content?: string; url?: string }> {
    const info = await this.lastfm.getArtistInfo(artist);
    return {
      summary: info?.bio?.summary || '',
      content: info?.bio?.content,
      url: info?.url,
    };
  }

  /** Sidecar content (lyrics .lrc / decode .ai.decode.md). */
  async sidecar(userId: number, mediaFileId: string, kind: 'lyrics' | 'decode' | 'translation'): Promise<string> {
    const nd = await this.nd(userId);
    const token = await nd.login();
    return nd.sidecarContent(token, mediaFileId, kind);
  }

  /** Apply a cover to a Navidrome album: upload file (multipart) by URL or Buffer. */
  async applyAlbumCover(userId: number, albumId: string, source: { url?: string; buffer?: Buffer; filename?: string }): Promise<void> {
    const nd = await this.nd(userId);
    const token = await nd.login();
    let buf: Buffer | undefined = source.buffer;
    let filename = source.filename || 'cover.jpg';
    if (!buf && source.url) {
      const resp = await fetch(source.url);
      if (!resp.ok) throw new Error(`Не удалось скачать изображение (${resp.status})`);
      buf = Buffer.from(await resp.arrayBuffer());
      const urlExt = /\.(jpe?g|png|webp)\b/i.exec(source.url)?.[1]?.toLowerCase();
      filename = `cover.${urlExt || 'jpg'}`;
    }
    if (!buf) throw new Error('Нет данных изображения');
    await nd.uploadAlbumArt(token, albumId, buf, filename);
  }

  /** Apply an artist photo via the existing artist image upload. */
  async applyArtistPhoto(userId: number, artistId: string, source: { url?: string; buffer?: Buffer; filename?: string }): Promise<void> {
    const nd = await this.nd(userId);
    const token = await nd.login();
    let buf: Buffer | undefined = source.buffer;
    let filename = source.filename || 'artist.jpg';
    if (!buf && source.url) {
      const resp = await fetch(source.url);
      if (!resp.ok) throw new Error(`Не удалось скачать изображение (${resp.status})`);
      buf = Buffer.from(await resp.arrayBuffer());
      filename = 'artist.jpg';
    }
    filename = filename.includes('.') ? filename : `${filename}.jpg`;
    if (!buf) throw new Error('Нет данных изображения');
    await nd.uploadArtistImage(token, artistId, buf, filename);
  }
}

export { fetchItunesArtwork };
