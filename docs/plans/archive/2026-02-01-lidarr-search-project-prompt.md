# Project: lidarr-search

Create a new Python project called `lidarr-search` - a minimal web application that solves one specific problem: Lidarr artist/album adds fail because SkyHook's cache (api.lidarr.audio) isn't warmed for many artists.

## The Problem

Lidarr uses SkyHook (api.lidarr.audio) as a caching proxy to MusicBrainz. SkyHook's cache was rebuilt ~7 months ago and many artists aren't cached. When users try to add an artist:
- Text searches return empty
- MBID searches return 503/empty/timeout
- Artists that exist in MusicBrainz can't be added to Lidarr

## The Solution

Pre-flight cache warming: Before adding an artist/album to Lidarr, hit SkyHook directly to trigger caching. Retry with exponential backoff until 200 OK (max 30 seconds).

### How SkyHook Cache Warming Works

SkyHook (api.lidarr.audio) is a **caching proxy** between Lidarr and MusicBrainz:

```
Lidarr request → SkyHook → [Cache Check]
                              ↓
                    Cached? → Return data (fast, 200 OK)
                    Not cached? → Fetch from MusicBrainz
                                  ↓
                           Success → Cache it, return 200
                           Still fetching → Return 503 (retry later)
                           Not found → Return 404
```

**The problem:** When an artist isn't in SkyHook's cache, Lidarr's add request fails because SkyHook returns 503/empty while it's fetching from MusicBrainz. Lidarr doesn't retry - it just fails.

**The solution:** We make the SkyHook request ourselves BEFORE telling Lidarr to add. We keep retrying (with exponential backoff) until SkyHook returns 200 - meaning the data is now cached. Then Lidarr's add request succeeds because it hits the warm cache.

```
Our app: GET api.lidarr.audio/api/v0.4/artist/{mbid}
         → 503 (cache miss, retry in 1s)
         → 503 (still fetching, retry in 2s)
         → 200 OK (cached now!)

Then: Tell Lidarr to add artist
      → Lidarr hits SkyHook → Cache hit → Success!
```

This is invisible to the user - they just see "Warming cache..." for a few seconds, then the artist is added successfully.

## Technical Requirements

### Stack
- **Python 3.11+** with **FastAPI**
- **Jinja2 templates** + **HTMX** for interactive UI (no JavaScript build step)
- **Tailwind CSS via CDN** for styling (dark theme, matches Lidarr aesthetic)
- **httpx** for async HTTP requests
- **uvicorn** as ASGI server
- **Docker** for deployment (also pip installable)

### Project Structure
```
lidarr-search/
├── pyproject.toml
├── Dockerfile
├── docker-compose.yml
├── README.md
├── .env.example
├── src/
│   └── lidarr_search/
│       ├── __init__.py
│       ├── main.py              # FastAPI app, routes, HTMX endpoints
│       ├── config.py            # Pydantic settings (env vars)
│       ├── services/
│       │   ├── __init__.py
│       │   ├── musicbrainz.py   # Search artists/releases via MusicBrainz API
│       │   ├── skyhook.py       # Cache warming with retry logic
│       │   └── lidarr.py        # Lidarr API client (profiles, folders, add)
│       └── templates/
│           ├── base.html        # Layout with HTMX, Tailwind CDN
│           ├── index.html       # Main search page
│           └── partials/
│               ├── results.html     # Search results grid (HTMX partial)
│               ├── add_modal.html   # Profile/folder selection modal
│               └── add_result.html  # Success/error after add
└── tests/
    ├── __init__.py
    ├── test_skyhook.py
    ├── test_musicbrainz.py
    └── test_lidarr.py
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Main search page (full HTML) |
| GET | `/search?q=...&type=artist\|album` | Search results partial (HTMX) |
| GET | `/lidarr/profiles` | Quality + metadata profiles (JSON) |
| GET | `/lidarr/folders` | Root folders (JSON) |
| GET | `/add-modal/{type}/{mbid}` | Render add modal with Lidarr options (HTMX) |
| POST | `/add` | Warm cache + add to Lidarr (HTMX, returns result partial) |
| GET | `/health` | Health check |

### Environment Variables

**Required:**
```bash
LIDARR_URL=http://lidarr:8686
LIDARR_API_KEY=your-api-key
MB_USER_AGENT=lidarr-search/1.0 (contact@example.com)
```

**Optional:**
```bash
PORT=8080
CACHE_WARM_TIMEOUT=30
LOG_LEVEL=INFO
```

### SkyHook Cache Warmer (Core Logic)

```python
SKYHOOK_API = "https://api.lidarr.audio/api/v0.4"

async def warm_cache(mbid: str, entity_type: Literal["artist", "album"], timeout: int = 30) -> WarmResult:
    """
    Warm SkyHook cache by hitting the API repeatedly until success.
    
    - URL: {SKYHOOK_API}/{entity_type}/{mbid}
    - Retry on: 503, 504, timeout, empty response, invalid JSON
    - Fail fast on: 404 (doesn't exist in MusicBrainz)
    - Success: 200 with valid JSON
    - Backoff: 1s, 2s, 4s, 8s (capped)
    - Timeout: 30 seconds default
    
    Returns:
        WarmResult(success: bool, attempts: int, cached: bool, error: str | None)
        - cached=True means first request returned 200 (was already cached)
    """
```

### MusicBrainz Service

```python
MB_API = "https://musicbrainz.org/ws/2"

async def search_artists(query: str, limit: int = 25) -> list[Artist]:
    # GET /ws/2/artist?query={query}&fmt=json&limit={limit}
    # Must include User-Agent header per MusicBrainz rate limit policy
    # Return: id (mbid), name, disambiguation, country, type

async def search_release_groups(query: str, limit: int = 25) -> list[ReleaseGroup]:
    # GET /ws/2/release-group?query={query}&fmt=json&limit={limit}
    # Return: id (mbid), title, artist-credit[0].name, first-release-date, primary-type
```

### Lidarr Service

```python
async def get_quality_profiles() -> list[Profile]:
    # GET {LIDARR_URL}/api/v1/qualityprofile

async def get_metadata_profiles() -> list[Profile]:
    # GET {LIDARR_URL}/api/v1/metadataprofile

async def get_root_folders() -> list[RootFolder]:
    # GET {LIDARR_URL}/api/v1/rootfolder

async def search_artist(term: str) -> list[SearchResult]:
    # GET {LIDARR_URL}/api/v1/artist/lookup?term={term}
    # Used to check if artist already exists

async def add_artist(
    foreign_artist_id: str,  # MusicBrainz artist ID
    quality_profile_id: int,
    metadata_profile_id: int,
    root_folder_path: str,
    monitor: str = "all",
    search_for_missing_albums: bool = True
) -> Artist:
    # POST {LIDARR_URL}/api/v1/artist
```

### Add Flow (Full Sequence)

1. User clicks "Add" on search result → modal opens via HTMX
2. Modal fetches Lidarr profiles/folders, populates dropdowns
3. User selects options, clicks "Add"
4. POST /add triggers:
   a. Warm SkyHook cache for the artist MBID (or album's artist MBID)
   b. If album add: also warm the album MBID
   c. Call Lidarr add artist API
   d. Return success/error partial to replace modal content

### UI Requirements

**Main Page:**
- Centered search bar with placeholder "Search artists or albums..."
- Toggle buttons: "Artists" | "Albums" (default: Artists)
- Results appear below via HTMX without page reload
- Clean dark theme (#1a1a2e background, #eee text)

**Search Results:**
- Responsive card grid (1 col mobile, 2 col tablet, 3-4 col desktop)
- Artist cards: image, name, disambiguation (if any), country flag, type badge
- Album cards: cover art, title, artist name, year, type badge (Album/EP/Single)
- "Add" button on each card
- "Already in Lidarr" badge if present (check via Lidarr API)

**Add Modal:**
- Artist/album info summary at top
- Dropdowns: Quality Profile, Metadata Profile, Root Folder
- Loading state during cache warming: spinner + "Warming cache..."
- Success: green checkmark + "Added to Lidarr" + link to artist in Lidarr
- Error: red X + error message

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install .
COPY src/ src/
EXPOSE 8080
CMD ["uvicorn", "lidarr_search.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

```yaml
# docker-compose.yml
services:
  lidarr-search:
    build: .
    ports:
      - "8080:8080"
    environment:
      - LIDARR_URL=${LIDARR_URL}
      - LIDARR_API_KEY=${LIDARR_API_KEY}
      - MB_USER_AGENT=${MB_USER_AGENT}
```

### pyproject.toml

```toml
[project]
name = "lidarr-search"
version = "0.1.0"
description = "Search and add artists/albums to Lidarr with SkyHook cache warming"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "httpx>=0.26.0",
    "jinja2>=3.1.0",
    "pydantic-settings>=2.1.0",
    "python-dotenv>=1.0.0",
]

[project.scripts]
lidarr-search = "lidarr_search.main:run"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "pytest-httpx", "ruff"]
```

### README.md Structure

1. Brief description (one paragraph)
2. Why this exists (the SkyHook cache problem)
3. Quick start (Docker)
4. Configuration (env vars table)
5. Alternative install (pip)
6. How it works (cache warming explanation)
7. Screenshots (add later)
8. License (MIT)

### Testing Requirements

- Mock all external HTTP calls (MusicBrainz, SkyHook, Lidarr)
- Test cache warmer retry logic (success on 1st, 2nd, Nth attempt)
- Test cache warmer timeout
- Test cache warmer 404 fast-fail
- Test MusicBrainz search parsing
- Test Lidarr add flow

### Key Design Principles

1. **KISS** - This is a scalpel, not a swiss army knife
2. **Stateless** - No database, no persistence, no sessions
3. **Single purpose** - Search + cache warm + add. Nothing else.
4. **Works offline from Mixarr** - Completely standalone
5. **Matches Lidarr UX** - Similar look/feel to Lidarr's own search

## Deliverables

Create a complete, working project with:
1. All source files as specified
2. Working Docker setup
3. Basic tests for core services
4. README with usage instructions
5. .env.example with all variables documented

The project should be immediately runnable with `docker compose up` after setting environment variables.
