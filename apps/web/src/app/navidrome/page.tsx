'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import Music from 'lucide-react/dist/esm/icons/music';
import Album from 'lucide-react/dist/esm/icons/album';
import Loader from 'lucide-react/dist/esm/icons/loader-2';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Zap from 'lucide-react/dist/esm/icons/zap';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';

interface Artist { id: string; name: string; albumCount?: number; }
interface AlbumInfo { id: string; name: string; artist?: string; songCount?: number; year?: number; }
interface MissingItem { mediaFileId: string; title: string; artist: string; hasLyrics: boolean; hasTranslation?: boolean; }
interface LibStats { total: number; withLyrics: number; withTranslation: number; withDecode: number; artistCount: number; }
type EnrichMode = 'lyrics' | 'decode';
interface QueueEntry { id: string; label: string; mode: EnrichMode; trackCount: number; }
interface EnrichJobStatus {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'idle' | null;
  queue: QueueEntry[]; total: number; processed: number; enriched: number; failed: number;
  currentTrack?: string; currentItem?: string; mode?: EnrichMode;
  failedItems?: Array<{ mediaFileId: string; title: string; error: string }>;
}

const POLL_MS = 2000;

export default function NavidromePage() {
  const { addToast } = useToast();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [noConnection, setNoConnection] = useState(false);
  const [stats, setStats] = useState<LibStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumInfo[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingItem[] | null>(null);
  const [missingMode, setMissingMode] = useState<EnrichMode>('lyrics');
  const [loadingMissing, setLoadingMissing] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<EnrichJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingItems, setCancellingItems] = useState<Set<string>>(new Set());
  // Per-artist enrichment stats: { total, withLyrics, withTranslation, withDecode }
  const [artistStats, setArtistStats] = useState<Record<string, LibStats>>({});

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    const { data, error } = await api.get<LibStats>('/api/navidrome/stats');
    setLoadingStats(false);
    if (!error && data) setStats(data);
  }, []);

  // Fetch per-artist enrichment stats (total / lyrics / RU / decode) by polling
  // the navidrome /missing endpoints. Done in parallel batches of 3 to avoid
  // overwhelming navidrome.
  const loadArtistStats = useCallback(async (artistList: Artist[]) => {
    const results: Record<string, LibStats> = {};
    const BATCH = 3;
    for (let i = 0; i < artistList.length; i += BATCH) {
      const batch = artistList.slice(i, i + BATCH);
      await Promise.all(batch.map(async (a) => {
        try {
          const [{ data: lyr }, { data: dec }] = await Promise.all([
            api.get<{ items: MissingItem[] }>(`/api/navidrome/missing?artistId=${a.id}&mode=lyrics`),
            api.get<{ items: MissingItem[] }>(`/api/navidrome/missing?artistId=${a.id}&mode=decode`),
          ]);
          const lItems = lyr?.items || [];
          const dItems = dec?.items || [];
          results[a.id] = {
            total: lItems.length,
            withLyrics: lItems.filter((t) => t.hasLyrics).length,
            withTranslation: lItems.filter((t) => t.hasTranslation).length,
            withDecode: dItems.filter((t) => t.hasLyrics).length,
            artistCount: 1,
          };
        } catch { /* skip */ }
      }));
      // Push incremental results so the UI fills in progressively.
      setArtistStats((prev) => ({ ...prev, ...results }));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingArtists(true);
      const { data, error } = await api.get<{ artists: Artist[] }>('/api/navidrome/library');
      setLoadingArtists(false);
      if (error) { if (/no navidrome connection/i.test(error)) setNoConnection(true); else addToast({ type: 'error', title: 'Failed to load library', message: error }); return; }
      const list = data?.artists || [];
      setArtists(list);
      loadArtistStats(list);
    })();
    loadStats();
    api.get<EnrichJobStatus>('/api/navidrome/enrich/status').then(({ data }) => { if (data && data.status && data.status !== 'idle') setJob(data); });
  }, [addToast, loadStats, loadArtistStats]);

  useEffect(() => {
    if (!expandedArtist) return;
    setLoadingAlbums(true); setAlbums([]); setSelectedAlbum(null); setMissing(null); setSelectedTrackIds(new Set());
    api.get<{ albums: AlbumInfo[] }>(`/api/navidrome/albums?artistId=${expandedArtist}`).then(({ data, error }) => {
      setLoadingAlbums(false);
      if (error) { addToast({ type: 'error', title: 'Failed to load albums', message: error }); return; }
      setAlbums(data?.albums || []);
    });
  }, [expandedArtist, addToast]);

  const loadMissing = useCallback(async (albumId: string, mode: EnrichMode) => {
    setLoadingMissing(true);
    const { data, error } = await api.get<{ items: MissingItem[] }>(`/api/navidrome/missing?albumId=${albumId}&mode=${mode}`);
    setLoadingMissing(false);
    if (error) { addToast({ type: 'error', title: 'Failed to load tracks', message: error }); return; }
    setMissing(data?.items || []); setSelectedTrackIds(new Set());
  }, [addToast]);

  useEffect(() => { if (selectedAlbum) loadMissing(selectedAlbum, missingMode); }, [selectedAlbum, missingMode, loadMissing]);

  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return;
    const poll = async () => {
      const { data } = await api.get<EnrichJobStatus>('/api/navidrome/enrich/status');
      if (data) {
        setJob(data);
        if (data.status === 'completed' || data.status === 'cancelled') {
          loadStats();
          if (artists.length > 0) loadArtistStats(artists);
          if (selectedAlbum) loadMissing(selectedAlbum, missingMode);
          setTimeout(() => setJob(null), 8000);
        }
      }
    };
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [job?.status, selectedAlbum, missingMode, loadStats, loadMissing, artists, loadArtistStats]);

  const enqueue = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const { data, error } = await api.post<EnrichJobStatus>('/api/navidrome/enrich', payload);
    setBusy(false);
    if (error) { addToast({ type: 'error', title: 'Failed to enqueue', message: error }); return; }
    if (data) { setJob(data); addToast({ type: 'success', title: 'Added to queue', message: `${data.queue?.length ?? 0} item(s)` }); }
  };

  const enqueueMulti = async (payloads: Record<string, unknown>[]) => {
    setBusy(true);
    for (const p of payloads) { await api.post('/api/navidrome/enrich', p); }
    setBusy(false);
    const { data } = await api.get<EnrichJobStatus>('/api/navidrome/enrich/status');
    if (data) setJob(data);
    addToast({ type: 'success', title: 'Added to queue', message: `${payloads.length} job(s)` });
  };

  const toggleTrack = (id: string) => setSelectedTrackIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const cancelJob = async () => { setCancelling(true); await api.post('/api/navidrome/enrich/cancel'); setCancelling(false); addToast({ type: 'info', title: 'Cancelling…' }); };
  const cancelItem = async (id: string, label: string) => {
    setCancellingItems((p) => new Set(p).add(id));
    await api.post(`/api/navidrome/enrich/cancel/${id}`);
    setCancellingItems((p) => { const n = new Set(p); n.delete(id); return n; });
    addToast({ type: 'info', title: 'Item cancelled', message: `"${label}" will be skipped` });
  };

  if (noConnection) {
    return (<div className="max-w-4xl mx-auto p-6"><Card><CardContent className="pt-6"><div className="flex items-center gap-3"><AlertCircle className="h-5 w-5 text-status-error" /><div><h3 className="font-medium">No Navidrome connection</h3><p className="text-sm text-muted-foreground">Add a Navidrome connection in <a href="/connections" className="underline">Connections</a> first.</p></div></div></CardContent></Card></div>);
  }

  const isActive = job?.status === 'running' || job?.status === 'queued';
  const missingCount = missing?.filter((m) => !m.hasLyrics).length ?? 0;
  const withLyrics = missing?.filter((m) => m.hasLyrics).length ?? 0;
  const missingRu = missingMode === 'lyrics' ? missing?.filter((m) => m.hasLyrics && !m.hasTranslation).length ?? 0 : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Music className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Navidrome Enrichment</h1>
      </div>

      {/* 1. Queue */}
      {job && job.status && job.status !== 'idle' && (
        <Card className="border-primary/50">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isActive ? <Loader className="h-4 w-4 animate-spin text-primary" /> : job.status === 'completed' ? <CheckCircle className="h-4 w-4 text-status-success" /> : <XCircle className="h-4 w-4 text-status-error" />}
                <span className="font-medium capitalize">{job.status} · {job.mode || ''}</span>
              </div>
              {isActive && <Button variant="ghost" size="sm" onClick={cancelJob} disabled={cancelling} className="text-status-error"><XCircle className="h-4 w-4 mr-1" />Cancel all</Button>}
            </div>
            {isActive && <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary transition-all duration-300" style={{ width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%` }} /></div>}
            <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
              <div className="flex items-center gap-4"><span>{job.processed} / {job.total}</span><span className="text-status-success">✓ {job.enriched}</span>{job.failed > 0 && <span className="text-status-error">✗ {job.failed}</span>}</div>
              <div className="flex items-center gap-4">{job.currentItem && <span className="truncate max-w-40">[{job.currentItem}]</span>}{job.currentTrack && <span className="truncate max-w-64">{job.currentTrack}</span>}</div>
            </div>
            {job.queue && job.queue.length > 0 && (
              <div className="border rounded-md divide-y">
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/50">Queue ({job.queue.length})</div>
                {job.queue.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="capitalize text-xs text-muted-foreground w-14 shrink-0">{q.mode}</span><span className="truncate flex-1">{q.label}</span>
                    {isActive && <Button variant="ghost" size="sm" className="h-6 px-2 text-status-error" disabled={cancellingItems.has(q.id)} onClick={() => cancelItem(q.id, q.label)}>{cancellingItems.has(q.id) ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}</Button>}
                  </div>
                ))}
              </div>
            )}
            {job.failedItems && job.failedItems.length > 0 && (
              <details className="text-xs"><summary className="cursor-pointer text-status-error">Failed ({job.failedItems.length})</summary><ul className="mt-2 space-y-1">{job.failedItems.map((f, i) => <li key={i} className="text-muted-foreground"><span className="text-status-error">✗</span> {f.title}: {f.error}</li>)}</ul></details>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2. Statistics + global fill button */}
      <Card>
        <CardHeader><div className="flex items-center justify-between"><CardTitle>Statistics</CardTitle><Button variant="ghost" size="sm" onClick={loadStats} disabled={loadingStats}><RefreshCw className={`h-4 w-4 ${loadingStats ? 'animate-spin' : ''}`} /></Button></div></CardHeader>
        <CardContent>
          {loadingStats ? <div className="text-sm text-muted-foreground">Loading…</div> : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <StatBox label="Tracks" value={stats.total} total={stats.total} color="text-foreground" />
                <StatBox label="Lyrics" value={stats.withLyrics} total={stats.total} color="text-status-success" />
                <StatBox label="RU translation" value={stats.withTranslation} total={stats.total} color="text-primary" />
                <StatBox label="Decoded" value={stats.withDecode} total={stats.total} color="text-status-warning" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || isActive} onClick={() => enqueueMulti([{ mode: 'lyrics', all: true }, { mode: 'decode', all: true }])}><Zap className="h-4 w-4 mr-1" />Fill all missing</Button>
                <Button size="sm" variant="outline" disabled={busy || isActive} onClick={() => enqueue({ mode: 'lyrics', all: true })}>Lyrics (ALL)</Button>
                <Button size="sm" variant="outline" disabled={busy || isActive} onClick={() => enqueue({ mode: 'decode', all: true })}>Decode (ALL)</Button>
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground">Failed to load stats.</div>}
        </CardContent>
      </Card>

      {/* 3. Artists */}
      <Card>
        <CardHeader><CardTitle>Artists</CardTitle></CardHeader>
        <CardContent>
          {loadingArtists ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
              {artists.map((a) => {
                const as = artistStats[a.id];
                return (
                  <div key={a.id} className={`rounded border ${expandedArtist === a.id ? 'border-primary bg-primary/5' : ''}`}>
                    <button onClick={() => setExpandedArtist(expandedArtist === a.id ? null : a.id)} className="flex items-center gap-2 p-2 w-full text-left">
                      <Album className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          {as ? (
                            <>
                              <span>{as.withLyrics}/{as.total} lyrics</span>
                              <span className="text-primary">{as.withTranslation}/{as.total} RU</span>
                              <span className="text-status-warning">{as.withDecode}/{as.total} decoded</span>
                            </>
                          ) : (
                            <span className="italic opacity-60">loading…</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Albums */}
      {expandedArtist && (
        <Card>
          <CardHeader><CardTitle>Albums</CardTitle></CardHeader>
          <CardContent>
            {loadingAlbums ? <div className="text-sm text-muted-foreground">Loading…</div> : albums.length === 0 ? <div className="text-sm text-muted-foreground">No albums.</div> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {albums.map((al) => (
                  <button key={al.id} onClick={() => setSelectedAlbum(al.id)} className={`text-left p-3 rounded border flex items-center gap-3 transition-colors ${selectedAlbum === al.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                    <Album className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0"><div className="text-sm font-medium truncate">{al.name}</div><div className="text-xs text-muted-foreground">{al.year ?? '—'} · {al.songCount ?? '?'} tracks</div></div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5. Tracks with stats + batch buttons */}
      {selectedAlbum && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Tracks</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <select className="text-xs border rounded px-2 py-1 bg-background" value={missingMode} onChange={(e) => setMissingMode(e.target.value as EnrichMode)}>
                  <option value="lyrics">lyrics</option><option value="decode">decode</option>
                </select>
                <Button size="sm" variant="ghost" onClick={() => setSelectedTrackIds(new Set(missing?.map((m) => m.mediaFileId) || []))}>All</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedTrackIds(new Set())}>None</Button>
                {selectedTrackIds.size > 0 && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => enqueue({ mode: missingMode, trackIds: Array.from(selectedTrackIds) })}>
                    Enrich selected ({selectedTrackIds.size})
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={() => enqueue({ mode: missingMode, albumIds: [selectedAlbum] })}>
                  Enrich album ({missingMode === 'decode' ? missingCount : (missing?.length ?? 0)})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMissing ? <div className="text-sm text-muted-foreground">Loading…</div> : missing && missing.length > 0 ? (
              <>
                <div className="text-xs text-muted-foreground mb-2 flex items-center gap-3 flex-wrap">
                  {missingMode === 'lyrics' ? (<><span className="text-status-error">{missingCount} no lyrics</span><span className="text-status-warning">{missingRu} missing RU</span><span className="text-status-success">{withLyrics - missingRu} complete</span></>) : (<><span className="text-status-warning">{missingCount} missing</span><span className="text-status-success">{withLyrics} done</span></>)}
                </div>
                <ul className="divide-y">
                  {missing.map((m) => {
                    const checked = selectedTrackIds.has(m.mediaFileId);
                    const ruMissing = missingMode === 'lyrics' && m.hasLyrics && !m.hasTranslation;
                    return (
                      <li key={m.mediaFileId} className="flex items-center gap-2 py-2 text-sm">
                        <input type="checkbox" checked={checked} onChange={() => toggleTrack(m.mediaFileId)} className="h-4 w-4 shrink-0" />
                        {missingMode === 'lyrics' ? (!m.hasLyrics ? <AlertCircle className="h-4 w-4 text-status-error shrink-0" /> : ruMissing ? <AlertCircle className="h-4 w-4 text-status-warning shrink-0" /> : <CheckCircle className="h-4 w-4 text-status-success shrink-0" />) : (m.hasLyrics ? <CheckCircle className="h-4 w-4 text-status-success shrink-0" /> : <AlertCircle className="h-4 w-4 text-status-warning shrink-0" />)}
                        <span className="truncate">{m.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{missingMode === 'lyrics' ? (!m.hasLyrics ? 'no lyrics' : ruMissing ? 'RU missing' : 'complete') : m.hasLyrics ? 'done' : 'missing'}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : <div className="text-sm text-muted-foreground">All tracks already have {missingMode}.</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatBox({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">of {total} ({pct}%)</div>
    </div>
  );
}
