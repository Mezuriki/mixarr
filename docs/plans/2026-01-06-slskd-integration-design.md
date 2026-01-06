# slskd Integration Design

**Date:** 2026-01-06  
**Status:** Approved  
**Author:** Claude (Brainstorming session with Chris)

## Overview

Full slskd integration that serves as both a discovery tool and an acquisition source, operating independently of Lidarr. Users can search for artists on the Soulseek network directly from Mixarr, download albums with rich quality/source filtering, and have files automatically organized into their Plex-compatible music library.

### Why Bypass Lidarr for slskd?

The music found on Soulseek is often exactly what Lidarr struggles with - rare releases, obscure artists, bootlegs, foreign pressings, high-quality vinyl rips. These are things MusicBrainz often lacks metadata for. If Lidarr could find the artist/album easily, users probably wouldn't need slskd in the first place.

### Integration Philosophy

slskd operates as a **parallel acquisition path** to Lidarr, not a separate workflow:
- Appears alongside Lidarr options wherever "Send to Lidarr" exists
- Subscriptions can target slskd as a destination
- Same UX patterns, just different backend

---

## Connection Configuration

Settings → Connections → Add slskd (optional connection, like Spotify/TIDAL):

### Connection Settings

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | Display name | "My slskd" |
| **slskd URL** | Base URL | `http://slskd:5030` |
| **API Key** | slskd API key | `abc123...` |
| **slskd Download Directory** | Where slskd places downloads (read access) | `/data/slskd/downloads` |
| **Music Library Directory** | Final destination (read/write access) | `/data/plex/music` |

### Quality Profile

| Setting | Options | Default |
|---------|---------|---------|
| **Minimum Quality** | Any, MP3-128+, MP3-256+, MP3-320+, Lossless Only | MP3-320+ |
| **Preferred Quality** | Highest Available, FLAC, MP3-320, etc. | Highest Available |
| **Require Complete Albums** | Toggle + minimum track threshold | Off |
| **Minimum Source Files** | User must have N+ files shared | 100 |

### Rate Limits

| Setting | Default | Purpose |
|---------|---------|---------|
| **Artists per Run** | 25 | Cap per subscription run |
| **Delay Between Searches** | 30 seconds | Network courtesy, result quality |

### Advanced

| Setting | Description |
|---------|-------------|
| **Webhook URL** | Auto-generated URL for slskd completion events |

### Connection Test

Verifies:
1. API connectivity and authentication
2. Read access to slskd download directory
3. Write access to music library directory

---

## File Flow

```
1. User queues download in Mixarr
2. slskd downloads to: /data/slskd/downloads/username/Artist - Album/
3. Mixarr detects completion (webhook or poll)
4. Mixarr moves + renames to: /data/plex/music/Artist/Album (year)/01 - Track.flac
5. Plex/Jellyfin scans and imports
```

### File Organization Format

```
/data/plex/music/
  └── Artist Name/
      └── Album Name (2024)/
          ├── 01 - Track Title.flac
          ├── 02 - Track Title.flac
          └── ...
```

---

## Subscription Integration

### New Subscription Modes

When slskd is connected, subscriptions gain new destination options:

| Mode | Behavior |
|------|----------|
| `slskd: Auto` | Search slskd, auto-download best match per quality profile |
| `slskd: Queue` | Search slskd, add results to review queue |
| `slskd: Preview` | Show what would be downloaded, no action |

### Subscription Run Behavior (Auto Mode)

1. **Fetch artists** from source (Spotify, TIDAL, etc.)
2. **Batch processing** - Take first N artists (per rate limit settings)
3. **For each artist:**
   - Search slskd: `POST /api/v0/searches` with artist name
   - Wait for search completion (poll until state = complete)
   - Score results against quality profile
   - If match found above threshold → queue download
   - If no match → mark as "not found on Soulseek"
4. **Delay** between searches (per rate limit settings)
5. **Queue remaining artists** for next run

### Rate Limiting Rationale

- **25 artists per run** - Manageable batch, ~12 min runtime
- **30 seconds between searches** - Respectful, allows result propagation
- Remaining artists queue for next scheduled run
- Status shown: "Processing 12/25 artists... 47 remaining"

### Multi-Destination Support

A subscription can target **both** Lidarr and slskd:
- Try Lidarr first (faster, curated sources)
- Fall back to slskd for artists Lidarr couldn't find

---

## UI Integration

### Action Buttons

Wherever "Send to Lidarr" exists, add parallel slskd option:

**Artist Cards (search results, discovery, subscription review):**
- Existing: `Add to Lidarr` button
- New: `Search slskd` button → opens slskd results modal

**Bulk Actions (multi-select):**
- Existing: `Send Selected to Lidarr`
- New: `Send Selected to slskd` (batch search + auto-download)

### slskd Search Modal

**Header:** Artist name, artwork

**Results List (per result):**
- Folder path/name (e.g., `Pink Floyd - The Wall (1979) [FLAC]`)
- Format badge (FLAC/MP3-320/etc.)
- Track count / Total size
- Source username + share stats
- **Download** button

**Filters:**
- Format dropdown: All, Lossless, MP3-320+
- Sort: Quality, Size, Track Count, Source Reliability

**Bulk Actions:**
- Select multiple → "Download Selected"

### Discovery Page

Add "Soulseek" as a discovery source option for power users.

---

## Download Tracking

### Database Model

**SlskdDownload table:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | Int | Primary key |
| `slskdTransferId` | String | slskd's internal transfer ID |
| `artistName` | String | Artist we searched for |
| `albumName` | String? | Parsed album name |
| `sourceUser` | String | Soulseek username |
| `sourcePath` | String | Original share path |
| `status` | Enum | queued, downloading, completed, failed, organized |
| `queuedAt` | DateTime | When queued |
| `completedAt` | DateTime? | When download finished |
| `organizedAt` | DateTime? | When moved to library |
| `destinationPath` | String? | Final library path |

### Completion Detection

**Dual approach:**

1. **Webhooks (primary)** - slskd calls Mixarr on `DownloadDirectoryComplete`
2. **Polling (fallback)** - Background job every 5 minutes checks for completed transfers

### File Organization Process

1. Locate files in slskd download directory
2. Parse metadata (ID3/FLAC tags)
3. Determine destination path
4. Move files to music library
5. Update database status
6. Cleanup empty source directories

---

## Backend Architecture

### New Services

**SlskdService** (`apps/api/src/services/slskd.ts`):
```typescript
- testConnection(config)
- search(query, options)
- getSearchResults(searchId)
- queueDownload(username, files)
- getDownloads()
- cancelDownload(id)
```

**SlskdOrganizerService** (`apps/api/src/services/slskd-organizer.ts`):
```typescript
- processCompletedDownload(transferInfo)
- parseMetadata(filePath)
- determineDestination(metadata, config)
- moveAndRename(source, destination)
- cleanupEmptyDirs(path)
```

### New API Routes

**`/api/slskd/`:**
- `POST /search` - Search slskd
- `GET /search/:id` - Get search results
- `POST /download` - Queue download
- `GET /downloads` - List tracked downloads
- `DELETE /downloads/:id` - Cancel download
- `POST /webhook` - Receive completion events

### New Background Jobs

**SlskdPollJob** (every 5 minutes):
- Check for completed downloads
- Trigger organization

**SlskdSubscriptionProcessor:**
- Integrated into existing subscription worker
- Handles slskd-targeted subscriptions with rate limiting

### Database Migrations

New additions:
- `slskd` added to `ConnectionType` enum
- `slskd_auto`, `slskd_queue`, `slskd_preview` added to result handling options
- `slskd_downloads` table created

All migrations are non-destructive - existing data preserved.

---

## Implementation Phases

### Phase 1: Foundation (MVP)

**Goal:** Basic slskd connection and manual search/download

- [ ] slskd connection in Settings
- [ ] Connection test endpoint
- [ ] Manual "Search slskd" from artist cards
- [ ] Search results modal with filtering
- [ ] Queue downloads to slskd
- [ ] Basic download tracking

**Deliverable:** Users can manually search and download.

### Phase 2: File Organization

**Goal:** Automatic post-download processing

- [ ] Download completion detection (polling)
- [ ] Metadata parsing (ID3/FLAC tags)
- [ ] File organization to Plex structure
- [ ] Activity log entries
- [ ] Webhook endpoint (optional)

**Deliverable:** Downloads auto-organize into library.

### Phase 3: Subscription Integration

**Goal:** slskd as subscription destination

- [ ] Add slskd modes to subscriptions
- [ ] Rate-limited batch processing
- [ ] Auto-selection scoring
- [ ] Progress tracking
- [ ] "Not found" status handling

**Deliverable:** Full automation via subscriptions.

### Phase 4: Polish & Discovery

**Goal:** Enhanced UX

- [ ] slskd as discovery source
- [ ] Download progress UI
- [ ] Retry failed downloads
- [ ] Statistics/history view

---

## slskd API Reference

Key endpoints used:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v0/searches` | POST | Start search |
| `/api/v0/searches/{id}` | GET | Get search status/results |
| `/api/v0/transfers/downloads/{username}` | POST | Queue download |
| `/api/v0/transfers/downloads` | GET | List all downloads |
| `/api/v0/transfers/downloads/{username}/{id}` | DELETE | Cancel download |

slskd uses API key authentication via `X-API-Key` header.

---

## Open Questions / Future Considerations

1. **Duplicate detection** - What if album already exists in library?
2. **Failed download retry** - Automatic retry with different source?
3. **Soulseek user blocking** - Track problematic sources?
4. **Download speed limits** - Respect slskd's configured limits?

---

## Summary

slskd integration provides Mixarr users with access to the Soulseek network as a parallel acquisition source to Lidarr. It's particularly valuable for rare/obscure music that traditional indexers don't have. The integration follows existing Mixarr patterns (connections, subscriptions, result handling) and uses proper database migrations for safe upgrades.
