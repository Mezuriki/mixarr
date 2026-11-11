/**
 * Media routes — страница «Медиа» в Mixarr.
 * GET  /api/media/albums                     — список альбомов с обложками
 * GET  /api/media/artists                    — список артистов с фото
 * GET  /api/media/album/:id                  — детали альбома + треки + статусы текста/смысла
 * GET  /api/media/album/:id/cover-candidates — кандидаты обложек (Deezer + iTunes)
 * GET  /api/media/artist/:id/photo-candidates— кандидаты фото (Deezer)
 * GET  /api/media/artist/:name/bio           — биография Last.fm
 * GET  /api/media/sidecar?mediaFileId=&kind= — текст/смысл трека
 * POST /api/media/album/:id/cover            — применить обложку (url | multipart file)
 * POST /api/media/artist/:id/photo           — применить фото артиста (url | multipart file)
 */
import { Router } from 'express';
import { createLogger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

const log = createLogger('media');
import { MediaLibraryService } from '../services/media-library.js';
import { LastfmService } from '../services/lastfm.js';
import { ConnectionResolver } from '../lib/connection-resolver.js';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

async function buildService(userId: number): Promise<MediaLibraryService> {
  const conn = await ConnectionResolver.getConnection('lastfm', userId);
  const lastfm = new LastfmService({ apiKey: (conn?.config as any)?.apiKey || process.env.LASTFM_API_KEY || '' });
  return new MediaLibraryService(lastfm);
}

mediaRouter.get('/albums', async (req, res) => {
  try {
    res.json({ albums: await (await buildService(req.user!.id)).albums(req.user!.id) });
  } catch (e: any) {
    log.error(`media albums: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/artists', async (req, res) => {
  try {
    res.json({ artists: await (await buildService(req.user!.id)).artists(req.user!.id) });
  } catch (e: any) {
    log.error(`media artists: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/album/:id', async (req, res) => {
  try {
    res.json(await (await buildService(req.user!.id)).albumDetail(req.user!.id, req.params.id));
  } catch (e: any) {
    log.error(`media album detail: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/album/:id/cover-candidates', async (req, res) => {
  try {
    const artist = String(req.query.artist || '');
    const album = String(req.query.album || '');
    res.json({ candidates: await (await buildService(req.user!.id)).albumCoverCandidates(artist, album) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/artist/:id/photo-candidates', async (req, res) => {
  try {
    const artist = String(req.query.artist || '');
    res.json({ candidates: await (await buildService(req.user!.id)).artistPhotoCandidates(artist) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/artist/:name/bio', async (req, res) => {
  try {
    res.json(await (await buildService(req.user!.id)).artistBio(req.params.name));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/cover', async (req: any, res: any) => {
  try {
    const id = String(req.query.id || '');
    const size = Number(req.query.size) || 300;
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const svc = await buildService(req.user!.id);
    const { buf, contentType } = await svc.coverBytes(req.user!.id, id, size);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.get('/sidecar', async (req, res) => {
  try {
    const mediaFileId = String(req.query.mediaFileId || '');
    const kindParam = String(req.query.kind || '');
    const kind = (kindParam === 'decode' || kindParam === 'translation') ? kindParam : 'lyrics';
    res.json({ content: await (await buildService(req.user!.id)).sidecar(req.user!.id, mediaFileId, kind) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Candidates are applied by URL; a user file arrives from the web page as
// { dataUrl } (base64 data URL) — decoded here. Keeps the API JSON-only.
async function readUploadSource(req: any): Promise<{ url?: string; buffer?: Buffer; filename?: string }> {
  const body = req.body || {};
  if (body.dataUrl && String(body.dataUrl).startsWith('data:')) {
    const m = /^data:[^;]+;base64,(.+)$/.exec(String(body.dataUrl));
    if (m) {
      const ext = /image\/(png|webp|gif)/.exec(String(body.dataUrl));
      return { buffer: Buffer.from(m[1], 'base64'), filename: `cover.${ext ? ext[1] : 'jpg'}` };
    }
  }
  return { url: body.url };
}

mediaRouter.post('/album/:id/cover', async (req, res) => {
  try {
    const src = await readUploadSource(req);
    await (await buildService(req.user!.id)).applyAlbumCover(req.user!.id, req.params.id, src);
    res.json({ status: 'ok' });
  } catch (e: any) {
    log.error(`media apply album cover: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

mediaRouter.post('/artist/:id/photo', async (req, res) => {
  try {
    const src = await readUploadSource(req);
    await (await buildService(req.user!.id)).applyArtistPhoto(req.user!.id, req.params.id, src);
    res.json({ status: 'ok' });
  } catch (e: any) {
    log.error(`media apply artist photo: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});
