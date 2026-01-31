<p align="center">
  <img src="apps/web/public/icons/icon-512x512.png" alt="Mixarr" width="128" height="128">
</p>

<h1 align="center">Mixarr</h1>

<p align="center">
  <strong>Music Discovery & Management for Lidarr</strong>
</p>

<p align="center">
  <a href="https://aquantumofdonuts.github.io/mixarr/"><img src="https://img.shields.io/badge/Website-mixarr-00d4aa?style=flat-square" alt="Website"></a>
  <a href="https://github.com/aquantumofdonuts/mixarr"><img src="https://img.shields.io/github/stars/aquantumofdonuts/mixarr?style=flat-square" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue?style=flat-square" alt="License"></a>
</p>

Mixarr connects to your music services (Spotify, Tidal, Last.fm, etc.) to discover new artists and automatically add them to Lidarr. It fills the gap between "listening" and "collecting" by providing a review queue, automated subscriptions, and advanced recommendations.

![Mixarr Dashboard](website/img/mixarr-discover.png)

## Quick Start

### Docker Compose (Recommended)

Create a `docker-compose.yml`:

```yaml
version: "3"
services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:latest
    container_name: mixarr
    ports:
      - "3443:443"  # HTTPS Access
      - "3010:3010" # Web UI (HTTP)
    volumes:
      - /path/to/data:/data
    environment:
      - SESSION_SECRET=replace_with_long_random_string
      - BASE_URL=https://YOUR_IP:3443
    restart: unless-stopped
```

Run it:
```bash
docker compose up -d
```

### Docker Run

```bash
docker run -d \
  --name mixarr \
  -p 3443:443 \
  -p 3010:3010 \
  -v ~/mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e BASE_URL="https://YOUR-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:latest
```

> **Note**: Access the web interface at **`https://YOUR-IP:3443`**. Accept the self-signed certificate warning if you haven't configured your own.

---

## Post-Installation Setup

1.  **Create Admin Account**: Follow the prompts on first launch.
2.  **Global Settings**: Go to **Settings > Global** and ensure `Base URL` is set correctly (e.g., `https://192.168.1.10:3443`). This is critical for OAuth callbacks.
3.  **Connect Lidarr**: Go to **Settings > Connections** and add your Lidarr URL and API Key.
4.  **Add Services**: Connect Spotify, Tidal, or Last.fm to start discovering music.

---

## Features

*   **Review Queue**: Discovered artists sit in a queue for your approval. No more junk in your library.
*   **Automated Subscriptions**: Sync standard playlists (Top 50), dynamic lists (Discover Weekly), or charts from Last.fm.
*   **Multi-Service Support**: 
    *   **Spotify & Tidal**: Full integration (Playlists, New Releases, Followed Artists).
    *   **Last.fm**: Charts, Tag/Genre feeds, User Library.
    *   **Plex & Jellyfin**: Recommendations based on listening history.
    *   **MusicBrainz & ListenBrainz**: Metadata and listening habits.
    *   **Discogs & Deezer**: Libraries, Playlists, and User Collections.
*   **AI Recommendations**: OpenAI, Anthropic, or Ollama integration for "smart" suggestions based on your existing library.
*   **Library Health**: Tools to analyze your Lidarr library for issues.

---

## AI Configuration

### Using Ollama or Custom OpenAI Providers

Mixarr supports any OpenAI-compatible API endpoint:

| Provider | Base URL | Model Example |
|----------|----------|---------------|
| OpenAI (default) | _(leave empty)_ | `gpt-3.5-turbo` |
| Ollama | `http://localhost:11434/v1` | `llama3.2` |
| LiteLLM | `http://localhost:4000/v1` | `gpt-4` |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3-8b` |

**Note**: For local Ollama, no API key is required. For cloud providers, enter your API key.

Configure these in **Settings → AI**.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SESSION_SECRET` | **Required.** Random string for session encryption. | - |
| `BASE_URL` | **Required.** The full URL to access Mixarr. Used for OAuth redirects. | - |
| `FRONTEND_URL` | Optional. If behind a reverse proxy, set this to the public URL. | - |
| `TZ` | Timezone for scheduled tasks. | `UTC` |

### Ports

| Port | Protocol | Usage |
|------|----------|-------|
| `3443` | HTTPS | **Primary Access**. Secured via internal Caddy. |
| `3010` | HTTP | Direct Node.js access (useful for reverse proxies like Traefik/Nginx). |

### Volumes

| Path | Description |
|------|-------------|
| `/data` | Stores SQLite database, Redis persistence, and logs. |

---

## Development

To build from source:

```bash
git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
cp .env.example .env
npm install
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

The stack includes Next.js (Frontend), Express (API), Redis (Queue), and MySQL (Dev DB).

---

## License

GPLv3. See [LICENSE](LICENSE) for details.