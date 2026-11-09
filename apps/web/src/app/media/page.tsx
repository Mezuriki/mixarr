'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import Music from 'lucide-react/dist/esm/icons/music';
import Loader from 'lucide-react/dist/esm/icons/loader-2';
import Upload from 'lucide-react/dist/esm/icons/upload';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';

interface MediaAlbum { id: string; name: string; artist?: string; artistId?: string; year?: number; coverUrl?: string; }
interface MediaArtist { id: string; name: string; coverUrl?: string; imageUrl?: string; }
interface MediaTrack { id: string; title: string; artist?: string; duration?: number; hasLyrics: boolean; hasDecode: boolean; }
type Tab = 'albums' | 'artists';

function monogram(name: string): { letter: string; hue: number } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { letter: (name.trim()[0] || '?').toUpperCase(), hue: h };
}

function Mono({ name, round }: { name: string; round?: boolean }) {
  const { letter, hue } = monogram(name);
  return (
    <div
      className={`w-full flex items-center justify-center font-bold text-white ${round ? 'rounded-full aspect-square' : 'rounded aspect-square'}`}
      style={{ background: `hsl(${hue}, 30%, 30%)`, fontSize: round ? 20 : 34 }}
    >
      {letter}
    </div>
  );
}

export default function MediaPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>('albums');
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [artists, setArtists] = useState<MediaArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<{ album: MediaAlbum; tracks: MediaTrack[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [photoCandidates, setPhotoCandidates] = useState<string[]>([]);
  const [bio, setBio] = useState<{ summary: string; content?: string } | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<MediaArtist | null>(null);
  const [sidecar, setSidecar] = useState<{ title: string; kind: 'lyrics' | 'decode'; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const artistRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (tab === 'albums') {
      const res = await api.get<{ albums: MediaAlbum[] }>('/api/media/albums');
      if (res.data) setAlbums(res.data.albums || []);
      else if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
    } else {
      const res = await api.get<{ artists: MediaArtist[] }>('/api/media/artists');
      if (res.data) setArtists(res.data.artists || []);
      else if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
    }
    setLoading(false);
  }, [tab, addToast]);

  useEffect(() => { load(); }, [load]);

  // деталь рендерится ниже огромной сетки — сами доскролливаем до неё
  useEffect(() => {
    if (detail && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [detail]);
  useEffect(() => {
    if (selectedArtist && artistRef.current) {
      artistRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedArtist]);

  const openAlbum = async (a: MediaAlbum) => {
    try {
      setSidecar(null);
      setDetailLoading(true);
      setDetail(null);
      setCandidates([]);
      const res = await api.get<{ album: MediaAlbum; tracks: MediaTrack[] }>(`/api/media/album/${a.id}`);
      if (!res.data || !res.data.album) {
        if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
        setDetailLoading(false);
        return;
      }
      setDetail(res.data);
      setDetailLoading(false);
      // кандидаты грузим отдельно — карточка видна сразу
      api.get<{ candidates: string[] }>(
        `/api/media/album/${a.id}/cover-candidates?artist=${encodeURIComponent(a.artist || '')}&album=${encodeURIComponent(a.name)}`)
        .then((cand) => setCandidates((cand.data && cand.data.candidates) || []))
        .catch(() => setCandidates([]));
    } catch (e: any) {
      console.error('media openAlbum', e);
      addToast({ type: 'error', title: 'Медиа', message: e?.message || 'Ошибка открытия альбома' });
      setDetailLoading(false);
    }
  };

  const openArtist = async (ar: MediaArtist) => {
    try {
      setSelectedArtist(ar);
      setBio(null);
      setPhotoCandidates([]);
      const [pc, bioRes] = await Promise.all([
        api.get<{ candidates: string[] }>(`/api/media/artist/${ar.id}/photo-candidates?artist=${encodeURIComponent(ar.name)}`),
        api.get<{ summary: string; content?: string }>(`/api/media/artist/${encodeURIComponent(ar.name)}/bio`),
      ]);
      setPhotoCandidates((pc.data && pc.data.candidates) || []);
      setBio(bioRes.data || null);
    } catch (e: any) {
      console.error('media openArtist', e);
      addToast({ type: 'error', title: 'Медиа', message: e?.message || 'Ошибка открытия артиста' });
    }
  };

  const applyCover = async (payload: { url?: string; dataUrl?: string }) => {
    if (!detail) return;
    setBusy(true);
    const res = await api.post<{ status: string }>(`/api/media/album/${detail.album.id}/cover`, payload);
    if (res.data) {
      addToast({ type: 'success', title: 'Медиа', message: 'Обложка применена, библиотека обновляется' });
      load();
      openAlbum(detail.album);
    } else addToast({ type: 'error', title: 'Медиа', message: res.error || 'Ошибка применения' });
    setBusy(false);
  };

  const applyPhoto = async (payload: { url?: string; dataUrl?: string }) => {
    if (!selectedArtist) return;
    setBusy(true);
    const res = await api.post<{ status: string }>(`/api/media/artist/${selectedArtist.id}/photo`, payload);
    if (res.data) addToast({ type: 'success', title: 'Медиа', message: 'Фото применено' });
    else addToast({ type: 'error', title: 'Медиа', message: res.error || 'Ошибка применения' });
    setBusy(false);
  };

  const enrich = async (albumId: string, mode: 'lyrics' | 'decode', mediaFileId?: string) => {
    const res = await api.post<any>('/api/navidrome/enrich', {
      mode,
      ...(mediaFileId ? { mediaFileIds: [mediaFileId] } : { albumId }),
    });
    if (res.data) addToast({ type: 'success', title: 'Медиа', message: mode === 'lyrics' ? 'Текст: запрошена генерация' : 'Смысл: запрошена генерация' });
    else addToast({ type: 'error', title: 'Медиа', message: res.error || 'Не удалось запустить' });
  };

  const showSidecar = async (t: MediaTrack, kind: 'lyrics' | 'decode') => {
    const res = await api.get<{ content: string }>(`/api/media/sidecar?mediaFileId=${t.id}&kind=${kind}`);
    setSidecar({ title: t.title, kind, content: res.data?.content || '' });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>, apply: (p: { dataUrl?: string }) => void) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => apply({ dataUrl: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const filtered = (list: any[]) =>
    !q.trim() ? list : list.filter((x) => String(x.name || '').toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Music className="w-6 h-6" /> Медиа</h1>
        <div className="flex items-center gap-2">
          <Button variant={tab === 'albums' ? 'default' : 'outline'} size="sm" onClick={() => setTab('albums')}>Альбомы</Button>
          <Button variant={tab === 'artists' ? 'default' : 'outline'} size="sm" onClick={() => setTab('artists')}>Артисты</Button>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск…"
            className="border rounded px-3 py-1.5 text-sm w-48 bg-transparent"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 animate-spin" /></div>
      ) : tab === 'albums' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {filtered(albums).map((a) => (
            <button
              key={a.id}
              type="button"
              className="text-left rounded-card border bg-card text-card-foreground shadow-sm hover:ring-2 ring-primary transition cursor-pointer"
              onClick={() => openAlbum(a)}
            >
              <CardContent className="p-2 space-y-1.5">
                {a.coverUrl
                  ? <img src={a.coverUrl} alt="" className="w-full aspect-square object-cover rounded" loading="lazy" />
                  : <Mono name={a.name} />}
                <div className="text-sm font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground truncate">{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
              </CardContent>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
          {filtered(artists).map((ar) => (
            <button
              key={ar.id}
              type="button"
              className="rounded-card border bg-card text-card-foreground shadow-sm hover:ring-2 ring-primary transition cursor-pointer"
              onClick={() => openArtist(ar)}
            >
              <CardContent className="p-2 flex flex-col items-center gap-1.5">
                {ar.coverUrl
                  ? <img src={ar.coverUrl} alt="" className="w-16 h-16 rounded-full object-cover" loading="lazy" />
                  : <div className="w-16 h-16"><Mono name={ar.name} round /></div>}
                <div className="text-xs text-center truncate w-full">{ar.name}</div>
              </CardContent>
            </button>
          ))}
        </div>
      )}

      {detailLoading && <div className="flex justify-center py-6"><Loader className="w-6 h-6 animate-spin" /></div>}

      {detail && (
        <div ref={detailRef} className="scroll-mt-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              {detail.album.coverUrl
                ? <img src={detail.album.coverUrl} className="w-12 h-12 rounded object-cover" alt="" />
                : <div className="w-12 h-12"><Mono name={detail.album.name} /></div>}
              <CardTitle className="text-xl">{detail.album.name}</CardTitle>
              <span className="text-sm text-muted-foreground font-normal">{detail.album.artist}{detail.album.year ? ` · ${detail.album.year}` : ''}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="text-sm font-semibold mb-2">Обложки: можно выбрать</div>
              <div className="flex gap-3 flex-wrap">
                {detail.album.coverUrl && (
                  <div className="relative">
                    <img src={detail.album.coverUrl} className="w-24 h-24 rounded object-cover ring-2 ring-primary" alt="текущая" />
                    <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[10px] text-center rounded-b">текущая</span>
                  </div>
                )}
                {candidates.map((u, i) => (
                  <button key={u + i} disabled={busy} onClick={() => applyCover({ url: u })} className="group relative">
                    <img src={u} className="w-24 h-24 rounded object-cover group-hover:ring-2 ring-primary" alt="" loading="lazy" />
                  </button>
                ))}
                <label className="w-24 h-24 rounded border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary cursor-pointer text-xs gap-1">
                  <Upload className="w-5 h-5" /> своя
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e, applyCover)} />
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Треки</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => enrich(detail.album.id, 'lyrics')}><FileText className="w-4 h-4 mr-1" /> Дотекстовать всё</Button>
                  <Button size="sm" variant="outline" onClick={() => enrich(detail.album.id, 'decode')}><Sparkles className="w-4 h-4 mr-1" /> Досмыслить всё</Button>
                </div>
              </div>
              <div className="divide-y rounded border max-h-80 overflow-y-auto">
                {detail.tracks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1 truncate">{t.title}</span>
                    <button title="Текст" disabled={!t.hasLyrics} onClick={() => showSidecar(t, 'lyrics')}
                      className={`px-1.5 py-0.5 rounded text-xs ${t.hasLyrics ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground opacity-50'}`}>текст</button>
                    <button title="Смысл" disabled={!t.hasDecode} onClick={() => showSidecar(t, 'decode')}
                      className={`px-1.5 py-0.5 rounded text-xs ${t.hasDecode ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground opacity-50'}`}>смысл</button>
                    {!t.hasLyrics && <button onClick={() => enrich(detail.album.id, 'lyrics', t.id)} className="text-xs underline text-primary">текст?</button>}
                    {!t.hasDecode && <button onClick={() => enrich(detail.album.id, 'decode', t.id)} className="text-xs underline text-primary">смысл?</button>}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {sidecar && (
        <Card>
          <CardHeader><CardTitle className="text-base">{sidecar.title} — {sidecar.kind === 'lyrics' ? 'текст' : 'смысл'}</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">{sidecar.content || '(пусто)'}</pre>
          </CardContent>
        </Card>
      )}

      {selectedArtist && (
        <div ref={artistRef} className="scroll-mt-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              {selectedArtist.coverUrl
                ? <img src={selectedArtist.coverUrl} className="w-12 h-12 rounded-full object-cover" alt="" />
                : <div className="w-12 h-12"><Mono name={selectedArtist.name} round /></div>}
              <CardTitle className="text-xl">{selectedArtist.name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-semibold mb-2">Фото: текущее и кандидаты</div>
              <div className="flex gap-3 flex-wrap">
                {selectedArtist.coverUrl && (
                  <div className="relative">
                    <img src={selectedArtist.coverUrl} className="w-20 h-20 rounded-full object-cover ring-2 ring-primary" alt="текущее" />
                    <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[10px] text-center rounded-b">текущее</span>
                  </div>
                )}
                {photoCandidates.map((u, i) => (
                  <button key={u + i} disabled={busy} onClick={() => applyPhoto({ url: u })}>
                    <img src={u} className="w-20 h-20 rounded-full object-cover hover:ring-2 ring-primary" alt="" loading="lazy" />
                  </button>
                ))}
                <label className="w-20 h-20 rounded-full border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary cursor-pointer text-[10px] gap-1">
                  <Upload className="w-4 h-4" /> своя
                  <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e, applyPhoto)} />
                </label>
              </div>
            </div>
            {bio && (
              <div>
                <div className="text-sm font-semibold mb-1">Биография (Last.fm)</div>
                <div className="text-sm text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: bio.content || bio.summary || '(нет биографии)' }} />
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  );
}
