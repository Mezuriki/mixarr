/**
 * Navidrome Enrichment Service (queue + multi-mode)
 *
 * Orchestrates a queue of enrichment jobs against Navidrome's AI pipeline.
 * Each job is a unit of work scoped to an artist/album (or an explicit list of
 * track ids) in one of two modes:
 *   - 'lyrics': fetch synced lyrics + Russian translation (LRCLIB + Gemini)
 *   - 'decode': generate a Markdown meaning-decode (Gemini)
 *
 * Multiple jobs can be queued at once (including "all artists"). A single
 * worker drains the queue sequentially with an inter-track delay to respect
 * Gemini's free-tier quota, and reports aggregate progress via Redis.
 *
 * Gemini calls and sidecar writes stay in Navidrome — this service only
 * schedules (POST /api/ai/lyrics/fetch | /api/ai/decode) and tracks status.
 */

import { redis } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';
import { addLogEntry } from '../routes/logs.js';
import { NavidromeService, type NavidromeMissingItem } from './navidrome.js';

const log = createLogger('NavidromeEnrichment');
const LOG_CATEGORY = 'navidrome';

// Persist an event to the Mixarr Logs page (DB) in addition to the console
// logger. addLogEntry swallows its own errors, so this is fire-and-forget; we
// don't await it to keep the worker moving.
function dbLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>,
): void {
  void addLogEntry(level, LOG_CATEGORY, message, metadata);
}

export type EnrichMode = 'lyrics' | 'decode';

export interface QueueItem {
  /**
   * Stable id so the UI can cancel a single queued item. Assigned by enqueue()
   * when the item is added to the queue; callers creating items do not need to
   * set it (it is optional on input, always present after enqueue).
   */
  id?: string;
  /** What the item refers to. */
  type: 'album' | 'artist' | 'tracks';
  /** The artist/album id (for type album/artist) — unused for 'tracks'. */
  ref?: string;
  /** Human label for the UI (e.g. "Back in Black — AC/DC"). */
  label: string;
  /** Explicit track list for type 'tracks'; otherwise resolved at run time. */
  trackIds?: string[];
  mode: EnrichMode;
}

interface ResolvedTarget {
  mediaFileId: string;
  title: string;
  artist?: string;
}

export interface EnrichJobStatus {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'idle';
  /** Items still waiting (id + label for the UI; per-item cancel needs the id). */
  queue: Array<{ id: string; label: string; mode: EnrichMode; trackCount: number }>;
  total: number; // total tracks across the whole queue
  processed: number;
  enriched: number;
  failed: number;
  currentTrack?: string;
  currentItem?: string;
  failedItems?: Array<{ mediaFileId: string; title: string; artist?: string; album?: string; error: string }>;
  enrichedItems?: Array<{ mediaFileId: string; title: string; artist?: string; album?: string }>;
  startedAt?: number;
  /** Unix ms of the last progress update, used to detect a dead worker. */
  updatedAt?: number;
  mode?: EnrichMode;
}

const JOB_TTL_SECONDS = 86_400; // queue may run for a long time on big libraries
// A "running" status whose updatedAt is older than this is treated as a dead
// worker (crashed/restarted), so a new enqueue is allowed to take over.
const STALE_RUNNING_MS = 30_000;
const CANCEL_TTL_SECONDS = 3_600;
const QUOTA_BACKOFF_BASE_MS = 30_000; // 30s, 60s, 120s
// Batch size for translate/decode: each song needs a separate Z.ai call (30-60s
// each), so BATCH_SIZE=2 keeps total under 120s — well within the 300s timeouts
// on both the Mixarr fetchAI and navidrome OpenAIProvider sides.
const BATCH_SIZE = 2;

class NavidromeEnrichmentService {
  private jobKey(userId: number): string {
    return `navidrome-enrich:job:${userId}`;
  }
  private cancelKey(userId: number): string {
    return `navidrome-enrich:cancel:${userId}`;
  }
  // Redis SET of cancelled item ids, so the worker can skip individual queued
  // items (per-item cancel) without aborting the whole queue.
  private cancelItemsKey(userId: number): string {
    return `navidrome-enrich:cancel-items:${userId}`;
  }

  private genId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Append items to the user's queue and start the worker if it isn't running
   * yet. The caller passes the already-resolved NavidromeService so the worker
   * does not need to re-resolve the connection (and stays decoupled from
   * Prisma/connection-resolver). Returns the resulting status.
   */
  async enqueue(userId: number, items: QueueItem[], service: NavidromeService): Promise<EnrichJobStatus> {
    if (items.length === 0) {
      return this.getIdleStatus();
    }
    const existing = await this.getRawStatus(userId);
    // Treat a stale "running" (dead worker) as finished so a new worker can take
    // over instead of being blocked forever by a crashed predecessor.
    const wasRunning = existing?.status === 'running' && !this.isStaleRunning(existing);
    // If the previous run finished (completed/cancelled/idle/stale), start
    // fresh: clear any stale cancel flag and reset the counters. When appending
    // to a live running queue, keep the accumulating counters.
    const queue: QueueItem[] = wasRunning && existing?.queue ? this.queueFromRaw(existing.queue) : [];
    // Assign a stable id to every newly-enqueued item so the UI can cancel it.
    for (const it of items) {
      if (!it.id) it.id = this.genId();
    }
    queue.push(...items);
    if (!wasRunning) {
      await redis.del(this.cancelKey(userId));
      await redis.del(this.cancelItemsKey(userId));
    }

    // Seed the running status (or keep it running). We don't yet know track
    // counts for artist/album items; the worker fills total in as it resolves.
    const status: EnrichJobStatus = {
      status: wasRunning ? 'running' : 'queued',
      queue: queue.map((q) => ({ id: q.id || '', label: q.label, mode: q.mode, trackCount: q.trackIds?.length ?? 0 })),
      total: queue.reduce((n, q) => n + (q.trackIds?.length ?? 0), 0),
      processed: wasRunning ? (existing?.processed ?? 0) : 0,
      enriched: wasRunning ? (existing?.enriched ?? 0) : 0,
      failed: wasRunning ? (existing?.failed ?? 0) : 0,
      failedItems: wasRunning ? (existing?.failedItems ?? []) : [],
      startedAt: wasRunning ? (existing?.startedAt ?? Date.now()) : Date.now(),
    };
    await redis.set(this.jobKey(userId), JSON.stringify({ ...status, queue }), 'EX', JOB_TTL_SECONDS);
    const enqueueMsg = `Enqueued ${items.length} item(s) [${items
      .map((i) => `${i.label}:${i.mode}`)
      .join(', ')}] — queue now ${queue.length} item(s), ${wasRunning ? 'appended to running job' : 'starting fresh'}`;
    log.info(`[user ${userId}] ${enqueueMsg}`);
    dbLog('info', enqueueMsg, { userId, itemsAdded: items.length, queueLength: queue.length, appended: wasRunning });

    // Fire-and-forget the worker (it's a no-op if already running).
    setImmediate(async () => {
      try {
        await this.runWorker(userId, service);
        // After worker finishes, save the final status to history.
        const final = await this.getRawStatus(userId);
        if (final && (final.status === 'completed' || final.status === 'cancelled')) {
          await this.saveHistory(userId, final);
        }
      } catch (err) {
        log.error('Navidrome enrichment worker crashed:', err);
        // Even on crash, try to save what we have.
        const final = await this.getRawStatus(userId);
        if (final) { final.status = 'cancelled'; await this.saveHistory(userId, final); }
      }
    });

    return status;
  }

  async getStatus(userId: number): Promise<EnrichJobStatus> {
    const raw = await this.getRawStatus(userId);
    return raw ?? this.getIdleStatus();
  }

  async cancel(userId: number): Promise<boolean> {
    const status = await this.getRawStatus(userId);
    if (!status || (status.status !== 'running' && status.status !== 'queued')) return false;
    await redis.set(this.cancelKey(userId), '1', 'EX', CANCEL_TTL_SECONDS);
    log.info(`Cancel requested for user ${userId}`);
    return true;
  }

  /**
   * Cancel a single queued item by id. The worker checks the cancel-items set
   * before processing each item and skips any whose id is present, so the rest
   * of the queue keeps running. The currently-processing item is NOT interrupted
   * (it finishes or hits the whole-queue cancel). Returns false if the item is
   * not found in the queue.
   */
  async cancelItem(userId: number, itemId: string): Promise<boolean> {
    const status = await this.getRawStatus(userId);
    const queue = this.queueFromRaw(status?.queue);
    const found = queue.some((q) => q.id === itemId);
    if (!found) return false;
    await redis.sadd(this.cancelItemsKey(userId), itemId);
    await redis.expire(this.cancelItemsKey(userId), CANCEL_TTL_SECONDS);
    log.info(`[user ${userId}] Cancel requested for item ${itemId}`);
    return true;
  }

  /** Whether a specific item id has been marked cancelled via cancelItem. */
  private async isItemCancelled(userId: number, itemId: string): Promise<boolean> {
    const isMember = await redis.sismember(this.cancelItemsKey(userId), itemId);
    return isMember === 1;
  }

  private getIdleStatus(): EnrichJobStatus {
    return { status: 'idle', queue: [], total: 0, processed: 0, enriched: 0, failed: 0 };
  }

  private async getRawStatus(userId: number): Promise<(EnrichJobStatus & { queue?: QueueItem[] }) | null> {
    const data = await redis.get(this.jobKey(userId));
    if (!data) return null;
    return JSON.parse(data) as EnrichJobStatus & { queue?: QueueItem[] };
  }

  private queueFromRaw(raw: unknown): QueueItem[] {
    if (!Array.isArray(raw)) return [];
    return raw as QueueItem[];
  }

  private async updateStatus(userId: number, status: EnrichJobStatus, queue: QueueItem[]): Promise<void> {
    status.updatedAt = Date.now();
    await redis.set(
      this.jobKey(userId),
      JSON.stringify({ ...status, queue }),
      'EX',
      JOB_TTL_SECONDS,
    );
  }

  private async isCancelled(userId: number): Promise<boolean> {
    return (await redis.get(this.cancelKey(userId))) === '1';
  }

  // A "running" status is stale when its last update is older than the
  // heartbeat window — that means the worker died (crash/restart) and the slot
  // is free for a new worker to take over.
  private isStaleRunning(s: EnrichJobStatus | null): boolean {
    if (!s || s.status !== 'running') return false;
    const age = Date.now() - (s.updatedAt ?? s.startedAt ?? 0);
    return age > STALE_RUNNING_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * The single queue drainer. Guarded by the status.status field: if another
   * run is already in progress, this call is a no-op. The caller provides the
   * resolved NavidromeService.
   */
  private async runWorker(userId: number, service: NavidromeService): Promise<void> {
   const current = await this.getRawStatus(userId);
   // Only one live worker at a time. A stale "running" (dead worker) does not
    // count, so this call can take over and recover the queue.
    if (current?.status === 'running' && !this.isStaleRunning(current)) return;

    let token = await service.login();
    const failedItems: EnrichJobStatus['failedItems'] = [];
    const enrichedItems: EnrichJobStatus['enrichedItems'] = [];
    const queue: QueueItem[] = current?.queue ? this.queueFromRaw(current.queue) : [];
    const interTrackDelay = NavidromeService.interTrackDelayMs();

    const status: EnrichJobStatus = current
      ? { ...current, status: 'running' as const }
      : this.getIdleStatus();
    status.status = 'running';
    status.startedAt = status.startedAt ?? Date.now();
    await this.updateStatus(userId, status, queue);
    log.info(
      `[user ${userId}] Worker started: ${queue.length} item(s) in queue`,
    );
    dbLog('info', `Enrichment started: ${queue.length} item(s) in queue`, { userId, queueLength: queue.length });

    while (queue.length > 0) {
      if (await this.isCancelled(userId)) {
        status.status = 'cancelled';
        await this.updateStatus(userId, status, queue);
        const cancelMsg = `Cancelled at ${status.processed}/${status.total} (remaining items: ${queue.length})`;
        log.info(`[user ${userId}] ${cancelMsg}`);
        dbLog('warn', cancelMsg, { userId, processed: status.processed, total: status.total, remaining: queue.length });
        return;
      }

      const item = queue.shift()!;
      // Per-item cancel: skip items the user cancelled individually without
      // aborting the rest of the queue.
      if (item.id && (await this.isItemCancelled(userId, item.id))) {
        const skipMsg = `Skipping cancelled item "${item.label}" (${item.mode})`;
        log.info(`[user ${userId}] ${skipMsg}`);
        dbLog('info', skipMsg, { userId, itemId: item.id });
        status.currentItem = undefined;
        status.currentTrack = undefined;
        await this.updateStatus(userId, status, queue);
        continue;
      }
      status.currentItem = item.label;
      status.mode = item.mode;
      await this.updateStatus(userId, status, queue);
      log.info(
        `[user ${userId}] Next item: "${item.label}" (${item.mode}) — ${queue.length} item(s) still queued`,
      );

      // Resolve the targets for this item.
      let targets: ResolvedTarget[];
      try {
        targets = await this.resolveTargets(service, token, item);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(
          `[user ${userId}] Failed to resolve targets for "${item.label}" (${item.mode}):`,
          errMsg,
        );
        dbLog('error', `Failed to resolve tracks for "${item.label}" (${item.mode}): ${errMsg}`, { userId, item: item.label, mode: item.mode });
        continue; // drop the item, keep going
      }
      log.info(
        `[user ${userId}] "${item.label}" (${item.mode}): ${targets.length} track(s) to process`,
      );
      dbLog('info', `Processing "${item.label}" (${item.mode}): ${targets.length} track(s)`, { userId, item: item.label, mode: item.mode, trackCount: targets.length });
      // Grow the total to include newly discovered tracks.
      status.total += targets.length;
      await this.updateStatus(userId, status, queue);

      // ─── 3-phase processing ───
      // For lyrics mode: Phase A (LRCLIB originals, one at a time, no AI) then
      // Phase B (translate to RU, batches of BATCH_SIZE in one Z.ai call).
      // For decode mode: Phase C (decode meaning, batches of BATCH_SIZE).
      if (item.mode === 'lyrics') {
        // Phase A: fetch original lyrics (LRCLIB only, 1 track at a time, no AI).
        for (const t of targets) {
          if (await this.isCancelled(userId)) { status.status = 'cancelled'; await this.updateStatus(userId, status, queue); return; }
          status.currentTrack = `${t.title}`;
          await this.updateStatus(userId, status, queue);
          try {
            await service.fetchOriginalLyrics(token, t.mediaFileId);
            status.processed += 1;
            status.enriched += 1;
            enrichedItems.push({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist, album: item.label });
            status.enrichedItems = enrichedItems;
            log.info(`[user ${userId}] (lrclib) "${t.title}" — done`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/401|token|unauthorized/i.test(msg)) { token = await service.login(); continue; }
            status.processed += 1;
            status.failed += 1;
            failedItems.push({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist, album: item.label, error: msg });
            status.failedItems = failedItems;
            log.warn(`[user ${userId}] (lrclib) "${t.title}" — failed: ${msg}`);
          }
          await this.updateStatus(userId, status, queue);
        }

        // Phase B: translate to RU in batches of BATCH_SIZE (one Z.ai call per batch).
        // Build batch items — translateBatch on navidrome side reads .lrc itself.
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
          if (await this.isCancelled(userId)) { status.status = 'cancelled'; await this.updateStatus(userId, status, queue); return; }
          const batch = targets.slice(i, i + BATCH_SIZE);
          status.currentTrack = `translating: ${batch.map((t) => t.title).join(' | ')}`;
          await this.updateStatus(userId, status, queue);
          try {
            const items = batch.map((t) => ({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist || '', lyrics: '' }));
            const trackMap = new Map(batch.map((t) => [t.mediaFileId, t]));
            const results = await service.translateBatch(token, items);
            for (const r of results) {
              const t = trackMap.get(r.mediaFileId);
              if (r.ok) {
                status.enriched += 1;
                enrichedItems.push({ mediaFileId: r.mediaFileId, title: t?.title || r.mediaFileId, artist: t?.artist, album: item.label });
                status.enrichedItems = enrichedItems;
                log.info(`[user ${userId}] (translate) ${t?.title || r.mediaFileId} — ok`);
              }
              else if (!r.skipped) {
                status.failed += 1;
                failedItems.push({ mediaFileId: r.mediaFileId, title: t?.title || r.mediaFileId, artist: t?.artist, album: item.label, error: r.error || 'failed' });
                status.failedItems = failedItems;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/401|token|unauthorized/i.test(msg)) { token = await service.login(); i -= BATCH_SIZE; continue; }
            if (this.looksLikeQuotaError(msg)) {
              const backoff = QUOTA_BACKOFF_BASE_MS;
              log.warn(`[user ${userId}] (translate-batch) quota/overload, retry in ${backoff}ms (${msg})`);
              await this.cancelableSleep(backoff, () => this.isCancelled(userId));
              i -= BATCH_SIZE; continue;
            }
            log.warn(`[user ${userId}] (translate-batch) failed: ${msg}`);
            for (const t of batch) { failedItems.push({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist, album: item.label, error: msg }); }
            status.failed += batch.length;
            status.failedItems = failedItems;
          }
          await this.updateStatus(userId, status, queue);
          if (interTrackDelay > 0 && i + BATCH_SIZE < targets.length) {
            await this.cancelableSleep(interTrackDelay, () => this.isCancelled(userId));
          }
        }
      } else {
        // Phase C: decode meaning in batches of BATCH_SIZE (one Z.ai call per batch).
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
          if (await this.isCancelled(userId)) { status.status = 'cancelled'; await this.updateStatus(userId, status, queue); return; }
          const batch = targets.slice(i, i + BATCH_SIZE);
          status.currentTrack = `decoding: ${batch.map((t) => t.title).join(' | ')}`;
          status.processed += batch.length;
          await this.updateStatus(userId, status, queue);
          try {
            const items = batch.map((t) => ({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist || '', album: item.label, lyrics: '' }));
            const trackMap = new Map(batch.map((t) => [t.mediaFileId, t]));
            const results = await service.decodeBatch(token, items);
            for (const r of results) {
              const t = trackMap.get(r.mediaFileId);
              if (r.ok) {
                status.enriched += 1;
                enrichedItems.push({ mediaFileId: r.mediaFileId, title: t?.title || r.mediaFileId, artist: t?.artist, album: item.label });
                status.enrichedItems = enrichedItems;
                log.info(`[user ${userId}] (decode) ${t?.title || r.mediaFileId} — ok`);
              }
              else if (!r.skipped) {
                status.failed += 1;
                failedItems.push({ mediaFileId: r.mediaFileId, title: t?.title || r.mediaFileId, artist: t?.artist, album: item.label, error: r.error || 'failed' });
                status.failedItems = failedItems;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/401|token|unauthorized/i.test(msg)) { token = await service.login(); status.processed -= batch.length; i -= BATCH_SIZE; continue; }
            if (this.looksLikeQuotaError(msg)) {
              const backoff = QUOTA_BACKOFF_BASE_MS;
              log.warn(`[user ${userId}] (decode-batch) quota/overload, retry in ${backoff}ms (${msg})`);
              status.processed -= batch.length;
              await this.cancelableSleep(backoff, () => this.isCancelled(userId));
              i -= BATCH_SIZE; continue;
            }
            log.warn(`[user ${userId}] (decode-batch) failed: ${msg}`);
            for (const t of batch) { failedItems.push({ mediaFileId: t.mediaFileId, title: t.title, artist: t.artist, album: item.label, error: msg }); }
            status.failed += batch.length;
            status.failedItems = failedItems;
          }
          await this.updateStatus(userId, status, queue);
          if (interTrackDelay > 0 && i + BATCH_SIZE < targets.length) {
            await this.cancelableSleep(interTrackDelay, () => this.isCancelled(userId));
          }
        }
      }
    }

    status.status = 'completed';
    status.currentTrack = undefined;
    status.currentItem = undefined;
    await this.updateStatus(userId, status, queue);
    await this.saveHistory(userId, status);
    const doneMsg = `Queue completed: ${status.enriched} enriched, ${status.failed} failed of ${status.total} track(s)`;
    log.info(`[user ${userId}] ${doneMsg}`);
    dbLog('info', doneMsg, { userId, enriched: status.enriched, failed: status.failed, total: status.total });
  }

  private historyKey(userId: number): string {
    return `navidrome-enrich:history:${userId}`;
  }

  /** Save a finished job to the history list (keeps last 10). */
  private async saveHistory(userId: number, status: EnrichJobStatus): Promise<void> {
    try {
      const entry = JSON.stringify({
        ...status,
        finishedAt: Date.now(),
      });
      const key = this.historyKey(userId);
      await redis.lpush(key, entry);
      await redis.ltrim(key, 0, 9); // keep last 10
      await redis.expire(key, 86400 * 7); // 7 days
    } catch {
      // history is best-effort; don't fail the worker
    }
  }

  /** Return up to 10 past finished jobs. */
  async getHistory(userId: number): Promise<EnrichJobStatus[]> {
    try {
      const raw = await redis.lrange(this.historyKey(userId), 0, 9);
      return raw.map((r) => JSON.parse(r) as EnrichJobStatus);
    } catch {
      return [];
    }
  }

  // sleep that wakes up early if the queue was cancelled, so backoff does not
  // block a cancel for up to two minutes.
  private async cancelableSleep(
    ms: number,
    isCancelled: () => Promise<boolean>,
  ): Promise<void> {
    const step = 1000;
    let remaining = ms;
    while (remaining > 0) {
      if (await isCancelled()) return;
      await this.sleep(Math.min(step, remaining));
      remaining -= step;
    }
  }

  private async resolveTargets(
    service: NavidromeService,
    token: string,
    item: QueueItem,
  ): Promise<ResolvedTarget[]> {
    if (item.type === 'tracks' && item.trackIds) {
      return item.trackIds.map((id) => ({ mediaFileId: id, title: id }));
    }
    const params = item.type === 'album' ? { albumId: item.ref } : { artistId: item.ref };
    // The navidrome /missing endpoints return ALL tracks of the scope, each
    // flagged with hasLyrics (whether the sidecar already exists). We previously
    // filtered out tracks where hasLyrics was true — but for lyrics mode that
    // dropped tracks that had the ORIGINAL .lrc but no RU translation, so a
    // "translate only" pass was impossible. The navidrome /lyrics/fetch pipeline
    // is idempotent (it skips re-fetching the original and only fills the gap),
    // so for lyrics mode we now process every track. Decode mode still only
    // needs the tracks without a .ai.decode.md, so it keeps the filter.
    const missing: NavidromeMissingItem[] =
      item.mode === 'lyrics'
        ? await service.getMissingLyrics(token, params)
        : await service.getMissingDecode(token, params);
    // Filter client-side so we DON'T send already-complete tracks to navidrome
    // (which would re-stat the sidecars over the network share for nothing).
    //  - decode mode: process tracks without .ai.decode.md (!hasLyrics)
    //  - lyrics mode: process tracks that lack original (.lrc) OR RU (.ru.lrc).
    //    A track with BOTH hasLyrics and hasTranslation is fully done → skip.
    const targets =
      item.mode === 'decode'
        ? missing.filter((m) => !m.hasLyrics)
        : missing.filter((m) => !(m.hasLyrics && m.hasTranslation));
    return targets.map((m) => ({ mediaFileId: m.mediaFileId, title: m.title, artist: m.artist }));
  }

  private looksLikeQuotaError(msg?: string): boolean {
    if (!msg) return false;
    const m = msg.toLowerCase();
    return (
      m.includes('quota') ||
      m.includes('rate limit') ||
      m.includes('429') ||
      m.includes('resource_exhausted') ||
      m.includes('high demand') ||
      m.includes('overloaded') ||
      m.includes('try again later') ||
      m.includes('status unavailable') ||
      m.includes(' 503')
    );
  }
}

export const navidromeEnrichmentService = new NavidromeEnrichmentService();
