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

interface Artist {
  id: string;
  name: string;
  albumCount?: number;
}

interface AlbumInfo {
  id: string;
  name: string;
  artist?: string;
  songCount?: number;
  year?: number;
}

interface MissingItem {
  mediaFileId: string;
  title: string;
  artist: string;
  hasLyrics: boolean;
}

type EnrichMode = 'lyrics' | 'decode';

interface QueueEntry {
  label: string;
  mode: EnrichMode;
  trackCount: number;
}

interface EnrichJobStatus {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'idle' | null;
  queue: QueueEntry[];
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  currentTrack?: string;
  currentItem?: string;
  failedItems?: Array<{ mediaFileId: string; title: string; error: string }>;
  mode?: EnrichMode;
}

const POLL_INTERVAL_MS = 2000;
const JOB_DONE_DISPLAY_MS = 5000;

export default function NavidromePage() {
  const { addToast } = useToast();

  const [artists, setArtists] = useState<Artist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [noConnection, setNoConnection] = useState(false);

  // Multi-select at the artist level. Expanding an artist loads its albums
  // (single-select) to inspect the missing-lyrics preview.
  const [selectedArtistIds, setSelectedArtistIds] = useState<Set<string>>(new Set());
  // When true, enqueueing an artist/album adds BOTH a lyrics and a decode job.
  const [both, setBoth] = useState(false);
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumInfo[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingItem[] | null>(null);
  const [missingMode, setMissingMode] = useState<EnrichMode>('lyrics');
  const [loadingMissing, setLoadingMissing] = useState(false);

  const [job, setJob] = useState<EnrichJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Load artist list on mount.
  useEffect(() => {
    const load = async () => {
      setLoadingArtists(true);
      const { data, error } = await api.get<{ artists: Artist[] }>('/api/navidrome/library');
      setLoadingArtists(false);
      if (error) {
        if (/no navidrome connection/i.test(error)) {
          setNoConnection(true);
        } else {
          addToast({ type: 'error', title: 'Failed to load library', message: error });
        }
        return;
      }
      setArtists(data?.artists || []);
    };
    load();
  }, [addToast]);

  // Load any in-flight queue on mount.
  useEffect(() => {
    api.get<EnrichJobStatus>('/api/navidrome/enrich/status').then(({ data }) => {
      if (data && data.status && data.status !== 'idle') setJob(data);
    });
  }, []);

  // Load albums when an artist is expanded.
  useEffect(() => {
    if (!expandedArtist) return;
    setLoadingAlbums(true);
    setAlbums([]);
    setSelectedAlbum(null);
    setMissing(null);
    api
      .get<{ albums: AlbumInfo[] }>(`/api/navidrome/albums?artistId=${expandedArtist}`)
      .then(({ data, error }) => {
        setLoadingAlbums(false);
        if (error) {
          addToast({ type: 'error', title: 'Failed to load albums', message: error });
          return;
        }
        setAlbums(data?.albums || []);
      });
  }, [expandedArtist, addToast]);

  const loadMissing = useCallback(
    async (albumId: string, mode: EnrichMode) => {
      setLoadingMissing(true);
      const { data, error } = await api.get<{ items: MissingItem[] }>(
        `/api/navidrome/missing?albumId=${albumId}&mode=${mode}`,
      );
      setLoadingMissing(false);
      if (error) {
        addToast({ type: 'error', title: 'Failed to load tracks', message: error });
        return;
      }
      setMissing(data?.items || []);
    },
    [addToast],
  );

  useEffect(() => {
    if (!selectedAlbum) return;
    loadMissing(selectedAlbum, missingMode);
  }, [selectedAlbum, missingMode, loadMissing]);

  // Poll while queued/running.
  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return;
    const poll = async () => {
      const { data } = await api.get<EnrichJobStatus>('/api/navidrome/enrich/status');
      if (data) {
        setJob(data);
        if (data.status === 'completed' || data.status === 'cancelled') {
          if (selectedAlbum) loadMissing(selectedAlbum, missingMode);
          addToast({
            type: data.status === 'completed' ? 'success' : 'info',
            title: data.status === 'completed' ? 'Queue completed' : 'Queue cancelled',
            message: `Processed ${data.processed}/${data.total}. Enriched ${data.enriched}, failed ${data.failed}.`,
          });
          setTimeout(() => setJob(null), JOB_DONE_DISPLAY_MS);
        }
      }
    };
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [job?.status, selectedAlbum, missingMode, loadMissing, addToast]);

  const toggleArtist = (id: string) => {
    setSelectedArtistIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enqueue = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const { data, error } = await api.post<EnrichJobStatus>('/api/navidrome/enrich', payload);
    setBusy(false);
    if (error) {
      addToast({ type: 'error', title: 'Failed to enqueue', message: error });
      return;
    }
    if (data) {
      setJob(data);
      const running = data.status === 'running' || data.status === 'queued';
      addToast({
        type: 'success',
        title: running ? 'Added to queue' : 'Queued',
        message: `${data.queue?.length ?? 0} item(s) in the queue${running ? ' (appended to the running job)' : ''}`,
      });
    }
  };

  // Build the request payload for the selection/all, honoring the "both" flag.
  // When both is set, two jobs (lyrics + decode) are sent per artist so the
  // caller only needs to fire once.
  const buildPayload = (mode: EnrichMode, scope: 'selected' | 'all') => {
    const modes: EnrichMode[] = both ? ['lyrics', 'decode'] : [mode];
    const base = scope === 'all' ? { all: true } : { artistIds: Array.from(selectedArtistIds) };
    return modes.map((m) => ({ mode: m, ...base }));
  };

  // Fire one POST per mode (lyrics and/or decode). Each call appends to the
  // queue; if a job is already running the items are picked up by the worker.
  const enqueueMultiple = async (payloads: Record<string, unknown>[]) => {
    setBusy(true);
    let lastErr: string | null = null;
    let lastData: EnrichJobStatus | null = null;
    for (const p of payloads) {
      const { data, error } = await api.post<EnrichJobStatus>('/api/navidrome/enrich', p);
      if (error) lastErr = error;
      if (data) lastData = data;
    }
    setBusy(false);
    if (lastErr) {
      addToast({ type: 'error', title: 'Failed to enqueue', message: lastErr });
      return;
    }
    if (lastData) {
      setJob(lastData);
      const running = lastData.status === 'running' || lastData.status === 'queued';
      addToast({
        type: 'success',
        title: running ? 'Added to queue' : 'Queued',
        message: `${payloads.length} job(s)${both ? ' (lyrics + decode)' : ''}${running ? ' appended to the running queue' : ''}`,
      });
    }
  };

  const enrichSelected = (mode: EnrichMode) => {
    if (selectedArtistIds.size === 0) {
      addToast({ type: 'info', title: 'Nothing selected', message: 'Select at least one artist first' });
      return;
    }
    const payloads = buildPayload(mode, 'selected');
    enqueueMultiple(payloads);
  };

  const enrichAll = (mode: EnrichMode) => {
    const payloads = buildPayload(mode, 'all');
    enqueueMultiple(payloads);
  };

  const cancelJob = async () => {
    if (cancelling) return;
    setCancelling(true);
    const { error } = await api.post('/api/navidrome/enrich/cancel');
    setCancelling(false);
    if (error) addToast({ type: 'error', title: 'Failed to cancel', message: error });
    else addToast({ type: 'info', title: 'Cancelling…', message: 'The queue will stop after the current track' });
  };

  if (noConnection) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-status-error" />
              <div>
                <h3 className="font-medium">No Navidrome connection</h3>
                <p className="text-sm text-muted-foreground">
                  Add a Navidrome connection in <a href="/connections" className="underline">Connections</a> first.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isActive = job?.status === 'running' || job?.status === 'queued';
  const missingCount = missing?.filter((m) => !m.hasLyrics).length ?? 0;
  const withLyrics = missing?.filter((m) => m.hasLyrics).length ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Music className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Navidrome Enrichment</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Queue lyrics + translation or meaning-decode for your library. Select artists (or run “All”).
        Work runs in Navidrome&apos;s AI pipeline (Gemini + LRCLIB); this page only schedules and tracks it.
      </p>

      {/* Global actions */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground mr-2">
            {selectedArtistIds.size} artist(s) selected
          </span>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground mr-2 select-none">
            <input
              type="checkbox"
              checked={both}
              onChange={(e) => setBoth(e.target.checked)}
              className="h-4 w-4"
            />
            Both (lyrics + decode)
          </label>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => enrichSelected('lyrics')}>
            {both ? 'Enrich selected (lyrics + decode)' : 'Enrich lyrics (selected)'}
          </Button>
          {!both && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => enrichSelected('decode')}>
              Decode meaning (selected)
            </Button>
          )}
          <div className="mx-2 h-5 w-px bg-border" />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => enrichAll('lyrics')}>
            {both ? 'Enrich ALL (lyrics + decode)' : 'Enrich ALL lyrics'}
          </Button>
          {!both && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => enrichAll('decode')}>
              Decode ALL
            </Button>
          )}
          {isActive && (
            <span className="text-xs text-muted-foreground ml-auto">
              Queue running — new items will be appended
            </span>
          )}
        </CardContent>
      </Card>

      {/* Queue / progress */}
      {isActive && job && (
        <Card className="border-primary/50">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium capitalize">{job.mode || ''} queue</span>
              </div>
              <Button variant="ghost" size="sm" onClick={cancelJob} disabled={cancelling} className="text-status-error">
                <XCircle className={`h-4 w-4 mr-1 ${cancelling ? 'animate-spin' : ''}`} />
                {cancelling ? 'Cancelling…' : 'Cancel queue'}
              </Button>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-4">
                <span>{job.processed} / {job.total} tracks</span>
                <span className="text-status-success">✓ {job.enriched}</span>
                {job.failed > 0 && <span className="text-status-error">✗ {job.failed}</span>}
              </div>
              <div className="flex items-center gap-4">
                {job.currentItem && <span className="truncate max-w-40">[{job.currentItem}]</span>}
                {job.currentTrack && <span className="truncate max-w-64">{job.currentTrack}</span>}
              </div>
            </div>
            {job.queue && job.queue.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Queue ({job.queue.length} item(s))</summary>
                <ul className="mt-2 space-y-1">
                  {job.queue.map((q, i) => (
                    <li key={i}>{q.label} — {q.mode}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Artist picker (multi-select) */}
      <Card>
        <CardHeader><CardTitle>Artists</CardTitle></CardHeader>
        <CardContent>
          {loadingArtists ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
              {artists.map((a) => {
                const selected = selectedArtistIds.has(a.id);
                const expanded = expandedArtist === a.id;
                return (
                  <div key={a.id} className={`rounded border ${selected ? 'border-primary bg-primary/5' : ''}`}>
                    <div className="flex items-center gap-2 p-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleArtist(a.id)}
                        className="h-4 w-4"
                      />
                      <button
                        onClick={() => setExpandedArtist(expanded ? null : a.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        {a.albumCount !== undefined && (
                          <div className="text-xs text-muted-foreground">{a.albumCount} albums</div>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Albums of the expanded artist */}
      {expandedArtist && (
        <Card>
          <CardHeader><CardTitle>Albums</CardTitle></CardHeader>
          <CardContent>
            {loadingAlbums ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : albums.length === 0 ? (
              <div className="text-sm text-muted-foreground">No albums.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {albums.map((al) => (
                  <button
                    key={al.id}
                    onClick={() => setSelectedAlbum(al.id)}
                    className={`text-left p-3 rounded border flex items-center gap-3 transition-colors ${
                      selectedAlbum === al.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <Album className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{al.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {al.year ?? '—'} · {al.songCount ?? '?'} tracks
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Track preview for a single album + a single-album enqueue shortcut */}
      {selectedAlbum && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Tracks</CardTitle>
              <div className="flex items-center gap-2">
                <select
                  className="text-xs border rounded px-2 py-1 bg-background"
                  value={missingMode}
                  onChange={(e) => setMissingMode(e.target.value as EnrichMode)}
                >
                  <option value="lyrics">lyrics</option>
                  <option value="decode">decode</option>
                </select>
                <Button
                  size="sm"
                  disabled={busy || missingCount === 0}
                  onClick={() => {
                    if (both) {
                      enqueueMultiple([
                        { mode: 'lyrics', albumIds: [selectedAlbum] },
                        { mode: 'decode', albumIds: [selectedAlbum] },
                      ]);
                    } else {
                      enqueue({ mode: missingMode, albumIds: [selectedAlbum] });
                    }
                  }}
                >
                  {both ? `Enrich this album (lyrics + decode, ${missingCount} missing)` : `Enrich this album (${missingCount} missing)`}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMissing ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : missing && missing.length > 0 ? (
              <>
                <div className="text-xs text-muted-foreground mb-2">
                  {withLyrics} already have {missingMode} · {missingCount} missing
                </div>
                <ul className="divide-y">
                  {missing.map((m) => (
                    <li key={m.mediaFileId} className="flex items-center gap-2 py-2 text-sm">
                      {m.hasLyrics ? (
                        <CheckCircle className="h-4 w-4 text-status-success shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-status-warning shrink-0" />
                      )}
                      <span className="truncate">{m.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {m.hasLyrics ? 'done' : 'missing'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">All tracks already have {missingMode}.</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
