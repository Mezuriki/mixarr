'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import Music from 'lucide-react/dist/esm/icons/music';
import Loader from 'lucide-react/dist/esm/icons/loader-2';
import Upload from 'lucide-react/dist/esm/icons/upload';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';

interface MediaAlbum { id: string; name: string; artist?: string; artistId?: string; year?: number; coverUrl?: string; }
interface MediaArtist { id: string; name: string; coverUrl?: string; imageUrl?: string; }
interface MediaTrack { id: string; title: string; artist?: string; duration?: number; hasLyrics: boolean; hasDecode: boolean; }
type Tab = 'albums' | 'artists';
const PAGE_SIZES = [10, 20, 50, 100] as const;

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

function BackBtn({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" onClick={() => router.push('/media')}>
      <ArrowLeft className="w-4 h-4 mr-1" /> {label}
    </Button>
  );
}

export default function MediaPage() {
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const albumId = searchParams.get('album');
  const artistId = searchParams.get('artist');

  const [tab, setTab] = useState<Tab>('albums');
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [artists, setArtists] = useState<MediaArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<{ album: MediaAlbum; tracks: MediaTrack[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [sidecar, setSidecar] = useState<{ title: string; kind: 'lyrics' | 'decode'; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedArtist, setSelectedArtist] = useState<MediaArtist | null>(null);
  const [photoCandidates, setPhotoCandidates] = useState<string[]>([]);
  const [bio, setBio] = useState<{ summary: string; content?: string } | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'albums') {
        const res = await api.get<{ albums: MediaAlbum[] }>('/api/media/albums');
        if (res.data) setAlbums(res.data.albums || []);
        else if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
      } else {
        const res = await api.get<{ artists: MediaArtist[] }>('/api/media/artists');
        if (res.data) setArtists(res.data.artists || []);
        else if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
      }
    } finally {
      setLoading(false);
    }
  }, [tab, addToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!albumId) { setDetail(null); setCandidates([]); setSidecar(null); return; }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetail(null);
      setCandidates([]);
      setSidecar(null);
      try {
        const res = await api.get<{ album: MediaAlbum; tracks: MediaTrack[] }>(`/api/media/album/${albumId}`);
        if (cancelled) return;
        if (res.data?.album) {
          setDetail(res.data);
          const cand = await api.get<{ candidates: string[] }>(
            `/api/media/album/${albumId}/cover-candidates?artist=${encodeURIComponent(res.data.album.artist || '')}&album=${encodeURIComponent(res.data.album.name)}`);
          if (!cancelled) setCandidates((cand.data && cand.data.candidates) || []);
        } else if (res.error) addToast({ type: 'error', title: 'Медиа', message: res.error });
      } catch (e: any) {
        if (!cancelled) addToast({ type: 'error', title: 'Медиа', message: e?.message || 'Ошибка открытия альбома' });
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [albumId, addToast]);

  useEffect(() => {
    if (!artistId) { setSelectedArtist(null); setPhotoCandidates([]); setBio(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const name = searchParams.get('name') || '';
        let list = artists;
        if (!list.length) {
          const r = await api.get<{ artists: MediaArtist[] }>('/api/media/artists');
          list = (r.data && r.data.artists) || [];
        }
        const [pc, bioRes] = await Promise.all([
          api.get<{ candidates: string[] }>(`/api/media/artist/${artistId}/photo-candidates?artist=${encodeURIComponent(name)}`),
          api.get<{ summary: string; content?: string }>(`/api/media/artist/${encodeURIComponent(name)}/bio`),
        ]);
        if (cancelled) return;
        setSelectedArtist(list.find((x) => x.id === artistId) || { id: artistId, name: name || 'Артист' });
        setPhotoCandidates((pc.data && pc.data.candidates) || []);
        setBio(bioRes.data || null);
      } catch (e: any) {
        if (!cancelled) addToast({ type: 'error', title: 'Медиа', message: e?.message || 'Ошибка открытия артиста' });
      }
    })();
    return () => { cancelled = true; };
  }, [artistId, artists, searchParams, addToast]);

  const applyCover = async (payload: { url?: string; dataUrl?: string }) => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await api.post<{ status: string }>(`/api/media/album/${detail.album.id}/cover`, payload);
      if (res.data) {
        addToast({ type: 'success', title: 'Медиа', message: 'Обложка применена' });
        const base = detail.album.coverUrl || `/api/media/cover?id=${detail.album.id}`;
        setDetail((d) => (d ? { ...d, album: { ...d.album, coverUrl: `${base}${base.includes('?') ? '&' : '?'}v=${Date.now()}` } } : d));
      } else addToast({ type: 'error', title: 'Медиа', message: res.error || 'Ошибка применения' });
    } finally {
      setBusy(false);
    }
  };

  const applyPhoto = async (payload: { url?: string; dataUrl?: string }) => {
    if (!selectedArtist) return;
    setBusy(true);
    try {
      const res = await api.post<{ status: string }>(`/api/media/artist/${selectedArtist.id}/photo`, payload);
      if (res.data) addToast({ type: 'success', title: 'Медиа', message: 'Фото применено' });
      else addToast({ type: 'error', title: 'Медиа', message: res.error || 'Ошибка применения' });
    } finally {
      setBusy(false);
    }
  };

  const enrich = async (id: string, mode: 'lyrics' | 'decode', mediaFileId?: string) => {
    const res = await api.post<any>('/api/navidrome/enrich', {
      mode,
      ...(mediaFileId ? { mediaFileIds: [mediaFileId] } : { albumId: id }),
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

  // ---------- детальная страница альбома ----------
  if (albumId) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Music className="w-6 h-6" /> Медиа</h1>
          <BackBtn label="К списку" />
        </div>
        {detailLoading && <div className="flex justify-center py-10"><Loader className="w-6 h-6 animate-spin" /></div>}
        {detail && (
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
                <div className="text-sm font-semibold mb-2">Обложки: текущая и кандидаты (клик — применить)</div>
                <div className="flex gap-3 flex-wrap">
                  {detail.album.coverUrl && (
                    <div className="relative">
                      <img src={detail.album.coverUrl} className="w-24 h-24 rounded object-cover ring-2 ring-primary" alt="текущая" />
                      <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[10px] text-center rounded-b">текущая</span>
                    </div>
                  )}
                  {candidates.map((u, i) => (
                    <button key={u + i} type="button" disabled={busy} onClick={() => applyCover({ url: u })} className="group">
                      <img src={u} className="w-24 h-24 rounded object-cover group-hover:ring-2 ring-primary" alt="" loading="lazy" />
                    </button>
                  ))}
                  <label className="w-24 h-24 rounded border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary cursor-pointer text-xs gap-1">
                    <Upload className="w-5 h-5" /> своя
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e, applyCover)} />
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
                      <button type="button" title="Текст" disabled={!t.hasLyrics} onClick={() => showSidecar(t, 'lyrics')}
                        className={`px-1.5 py-0.5 rounded text-xs ${t.hasLyrics ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground opacity-50'}`}>текст</button>
                      <button type="button" title="Смысл" disabled={!t.hasDecode} onClick={() => showSidecar(t, 'decode')}
                        className={`px-1.5 py-0.5 rounded text-xs ${t.hasDecode ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground opacity-50'}`}>смысл</button>
                      {!t.hasLyrics && <button type="button" onClick={() => enrich(detail.album.id, 'lyrics', t.id)} className="text-xs underline text-primary">текст?</button>}
                      {!t.hasDecode && <button type="button" onClick={() => enrich(detail.album.id, 'decode', t.id)} className="text-xs underline text-primary">смысл?</button>}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {sidecar && (
          <Card>
            <CardHeader><CardTitle className="text-base">{sidecar.title} — {sidecar.kind === 'lyrics' ? 'текст' : 'смысл'}</CardTitle></CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">{sidecar.content || '(пусто)'}</pre>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---------- детальная страница артиста ----------
  if (artistId) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Music className="w-6 h-6" /> Медиа</h1>
          <BackBtn label="К списку" />
        </div>
        {selectedArtist && (
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
                <div className="text-sm font-semibold mb-2">Фото: текущее и кандидаты (клик — применить)</div>
                <div className="flex gap-3 flex-wrap">
                  {photoCandidates.map((u, i) => (
                    <button key={u + i} type="button" disabled={busy} onClick={() => applyPhoto({ url: u })}>
                      <img src={u} className="w-20 h-20 rounded-full object-cover hover:ring-2 ring-primary" alt="" loading="lazy" />
                    </button>
                  ))}
                  <label className="w-20 h-20 rounded-full border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary cursor-pointer text-[10px] gap-1">
                    <Upload className="w-4 h-4" /> своя
                    <input ref={photoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e, applyPhoto)} />
                  </label>
                </div>
              </div>
              {bio && (
                <div>
                  <div className="text-sm font-semibold mb-1">Биография (Last.fm)</div>
                  <div className="text-sm text-muted-foreground max-h-64 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: bio.content || bio.summary || '(нет биографии)' }} />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---------- список с пагинацией ----------
  const filtered = (list: any[]) =>
    !q.trim() ? list : list.filter((x) => String(x.name || '').toLowerCase().includes(q.trim().toLowerCase()));
  const list = tab === 'albums' ? filtered(albums) : filtered(artists);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Music className="w-6 h-6" /> Медиа</h1>
        <div className="flex items-center gap-2">
          <Button variant={tab === 'albums' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('albums'); setPage(1) }}>Альбомы</Button>
          <Button variant={tab === 'artists' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('artists'); setPage(1) }}>Артисты</Button>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            placeholder="Поиск…"
            className="border rounded px-3 py-1.5 text-sm w-48 bg-transparent"
          />
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="border rounded px-2 py-1.5 text-sm bg-transparent"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / стр.</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 animate-spin" /></div>
      ) : tab === 'albums' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {pageItems.map((a) => (
            <button
              key={a.id}
              type="button"
              className="text-left rounded-card border bg-card text-card-foreground shadow-sm hover:ring-2 ring-primary transition cursor-pointer"
              onClick={() => router.push(`/media?album=${encodeURIComponent(a.id)}`)}
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
          {pageItems.map((ar) => (
            <button
              key={ar.id}
              type="button"
              className="rounded-card border bg-card text-card-foreground shadow-sm hover:ring-2 ring-primary transition cursor-pointer"
              onClick={() => router.push(`/media?artist=${encodeURIComponent(ar.id)}&name=${encodeURIComponent(ar.name)}`)}
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

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          {list.length} {tab === 'albums' ? 'альбомов' : 'артистов'} · страница {safePage} из {totalPages}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Назад</Button>
          <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Вперёд →</Button>
        </div>
      </div>
    </div>
  );
}
