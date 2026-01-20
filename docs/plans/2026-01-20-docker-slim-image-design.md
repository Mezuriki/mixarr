# Docker Slim Image Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Add a new `mixarr:slim` Docker image containing only API + Web, enabling power users to BYO database and Redis while keeping the existing unified image for beginners.

**Related Issue:** [#13 - Refactor Docker container: Remove bundled MariaDB, Redis, and Caddy](https://github.com/aquantumofdonuts/mixarr/issues/13)

**Approach:** Non-breaking. Add new slim image alongside existing unified image.

---

## Overview & Goals

**Problem Statement:**
The current unified Dockerfile bundles API, Web, MariaDB, Redis, and Caddy into a single container. This creates security, maintenance, and operational challenges while making it difficult for advanced users to integrate with their existing infrastructure.

**Goals:**
1. **Simplicity for beginners** - Unified image unchanged, one command to run
2. **Flexibility for power users** - New slim image for BYO database, redis, reverse proxy
3. **Container best practices** - Single responsibility, proper health checks, crash propagation
4. **Reduced maintenance burden** - Power users manage their own MariaDB/Redis versions

**Non-Goals:**
- Kubernetes Helm chart (out of scope, but refactor enables it)
- Multi-architecture builds (already supported, no changes)
- Breaking existing installations (unified image unchanged)
- SQLite support (adds complexity, MariaDB required)
- In-memory Redis fallback (future enhancement)

**Success Criteria:**
- Existing users can continue using `mixarr:latest` unchanged
- Power users can run `docker compose -f docker-compose.slim.yml up -d`
- k8s users can use slim image with external services
- Container crashes properly propagate to Docker daemon (slim only)

---

## Architecture

### Image Strategy: Two Images

| Tag | Contents | Dockerfile | Target User |
|-----|----------|------------|-------------|
| `mixarr:latest` | API + Web + MariaDB + Redis + Caddy | `Dockerfile.unified` (unchanged) | Beginners, existing users |
| `mixarr:slim` | API + Web only | `Dockerfile.slim` (new) | Power users, k8s, BYO infra |

### Slim Image Details

**Contains:**
- Node.js 20 runtime
- API server (Express)
- Web server (Next.js standalone)
- Prisma client
- tini (PID 1 init)

**Size:** ~200MB (vs ~800MB unified)

**Environment Variables (required):**
```bash
DATABASE_URL=mysql://user:pass@host:3306/mixarr
REDIS_URL=redis://host:6379
SESSION_SECRET=your-secret-here
```

### Process Management

Using **tini + Bash** for proper signal handling:

```
┌─────────────────────────────────────────────┐
│ Container                                   │
│  ┌─────────────────────────────────────┐    │
│  │ tini (PID 1)                        │    │
│  │  └── entrypoint.sh                  │    │
│  │       ├── API (node)                │    │
│  │       └── Web (node)                │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Either process exits → container exits     │
│  Docker sees real exit codes ✓              │
└─────────────────────────────────────────────┘
```

**Benefits over current supervisor approach:**
- `tini` handles SIGTERM properly (graceful shutdown)
- `wait -n` exits on first failure
- Docker/k8s sees real exit codes
- Restart policies work correctly

### Health Check

```
GET /api/health → { "status": "ok", "db": true, "redis": true }
```

---

## Compose Files

### docker-compose.slim.yml (Full stack with slim image)

```yaml
# Production stack using slim Mixarr image + external services
# Usage: docker compose -f docker-compose.slim.yml up -d

services:
  mixarr:
    image: aquantumofdonuts/mixarr:slim
    ports:
      - "3000:3000"
      - "3005:3005"
    environment:
      - DATABASE_URL=mysql://mixarr:mixarr@db:3306/mixarr
      - REDIS_URL=redis://redis:6379
      - SESSION_SECRET=${SESSION_SECRET:-please-change-this-secret}
    volumes:
      - mixarr-config:/app/config
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3005/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: mariadb:11
    environment:
      - MYSQL_DATABASE=mixarr
      - MYSQL_USER=mixarr
      - MYSQL_PASSWORD=mixarr
      - MYSQL_ROOT_PASSWORD=mixarr
    volumes:
      - mixarr-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - mixarr-redis:/data
    restart: unless-stopped

volumes:
  mixarr-config:
  mixarr-db:
  mixarr-redis:
```

### docker-compose.byo.yml (BYO infrastructure)

```yaml
# For users with existing database and Redis
# Usage: 
#   export DATABASE_URL=mysql://user:pass@your-db:3306/mixarr
#   export REDIS_URL=redis://your-redis:6379
#   export SESSION_SECRET=your-secret
#   docker compose -f docker-compose.byo.yml up -d

services:
  mixarr:
    image: aquantumofdonuts/mixarr:slim
    ports:
      - "3000:3000"
      - "3005:3005"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - SESSION_SECRET=${SESSION_SECRET}
    volumes:
      - mixarr-config:/app/config
    restart: unless-stopped

volumes:
  mixarr-config:
```

### Summary of Compose Files

| File | Image | Includes DB/Redis | Use Case |
|------|-------|-------------------|----------|
| `docker-compose.yml` | Build from source | Yes (dev) | Development |
| `docker-compose.slim.yml` | `mixarr:slim` | Yes (production) | New installs, power users |
| `docker-compose.byo.yml` | `mixarr:slim` | No | Existing infra, k8s |

---

## Dockerfile.slim

```dockerfile
# =============================================================================
# Mixarr Slim Image
# Contains: API + Web only (no MariaDB, Redis, or Caddy)
# Requires: External DATABASE_URL and REDIS_URL
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build API
# -----------------------------------------------------------------------------
FROM node:20-alpine AS api-builder

WORKDIR /build

# Install dependencies
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/prisma ./apps/api/prisma/

RUN npm ci --ignore-scripts

# Copy source and build
COPY apps/api ./apps/api
COPY packages/shared-types ./packages/shared-types

RUN npm run build --workspace=@mixarr/shared-types
RUN npm run build --workspace=api

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# -----------------------------------------------------------------------------
# Stage 2: Build Web
# -----------------------------------------------------------------------------
FROM node:20-alpine AS web-builder

WORKDIR /build

COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/

RUN npm ci --ignore-scripts

COPY apps/web ./apps/web
COPY packages/shared-types ./packages/shared-types
COPY packages/ui ./packages/ui

# Build Next.js in standalone mode
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=web

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Install tini for proper PID 1 handling
RUN apk add --no-cache tini bash curl

WORKDIR /app

# Copy API
COPY --from=api-builder /build/apps/api/dist ./api/dist
COPY --from=api-builder /build/apps/api/prisma ./api/prisma
COPY --from=api-builder /build/apps/api/node_modules/.prisma ./api/node_modules/.prisma
COPY --from=api-builder /build/apps/api/package.json ./api/
COPY --from=api-builder /build/node_modules ./node_modules

# Copy Web (Next.js standalone)
COPY --from=web-builder /build/apps/web/.next/standalone ./web
COPY --from=web-builder /build/apps/web/.next/static ./web/.next/static
COPY --from=web-builder /build/apps/web/public ./web/public

# Copy entrypoint
COPY docker/entrypoint-slim.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create non-root user
RUN addgroup -g 1000 mixarr && \
    adduser -u 1000 -G mixarr -s /bin/sh -D mixarr && \
    mkdir -p /app/config && \
    chown -R mixarr:mixarr /app

USER mixarr

# Expose ports
EXPOSE 3000 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
```

---

## Entrypoint Script

**File: `docker/entrypoint-slim.sh`**

```bash
#!/bin/bash
set -e

echo "🎵 Mixarr (slim) starting..."

# ============================================
# 1. Validate required environment
# ============================================
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL is required"
  exit 1
fi

if [ -z "$REDIS_URL" ]; then
  echo "❌ ERROR: REDIS_URL is required"
  exit 1
fi

# ============================================
# 2. Wait for dependencies
# ============================================
echo "⏳ Waiting for database..."
until node -e "
  const { PrismaClient } = require('/app/api/node_modules/.prisma/client');
  new PrismaClient().\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done
echo "✅ Database connected"

echo "⏳ Waiting for Redis..."
until node -e "
  const Redis = require('ioredis');
  const r = new Redis(process.env.REDIS_URL);
  r.ping().then(() => { r.disconnect(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done
echo "✅ Redis connected"

# ============================================
# 3. Sync database schema
# ============================================
echo "🔄 Syncing database schema..."
cd /app/api
npx prisma db push --accept-data-loss || echo "⚠️ Schema sync had issues, continuing..."
echo "✅ Schema sync complete"

# ============================================
# 4. Start services
# ============================================
cd /app

echo "🚀 Starting API server on :3005..."
node /app/api/dist/index.js &
API_PID=$!

echo "🌐 Starting Web server on :3000..."
node /app/web/server.js &
WEB_PID=$!

echo "✅ Mixarr ready at http://localhost:3000"

# ============================================
# 5. Wait for either process to exit
# ============================================
wait -n $API_PID $WEB_PID
EXIT_CODE=$?

echo "❌ Process exited with code $EXIT_CODE, shutting down..."

# Kill the other process
kill $API_PID $WEB_PID 2>/dev/null || true

exit $EXIT_CODE
```

---

## CI/CD Updates

Update `.github/workflows/publish-docker.yml` to build both images:

**New jobs to add:**
- `build-slim` - Build slim image for amd64 and arm64
- `merge-slim` - Merge manifests and tag

**Published Tags:**

| Tag | Image | Description |
|-----|-------|-------------|
| `latest` | Unified | Full stack, default |
| `v1.3.0` | Unified | Version-pinned full stack |
| `slim` | Slim | Latest slim image |
| `v1.3.0-slim` | Slim | Version-pinned slim |

---

## Documentation Updates

### README.md

Add deployment options section with image comparison table.

### docs/DEPLOYMENT.md (new)

Full deployment guide covering:
- Image variants explanation
- Compose file usage
- Environment variables
- Kubernetes example
- Reverse proxy examples (nginx, traefik)

### CHANGELOG.md

```markdown
### Added
- New `mixarr:slim` Docker image containing only API + Web
- `docker-compose.slim.yml` for production deployments
- `docker-compose.byo.yml` for BYO infrastructure
- Deployment documentation (`docs/DEPLOYMENT.md`)
- Health endpoint at `/api/health`

### Changed
- Slim image uses tini for proper signal handling
- Slim image runs as non-root user
```

---

## Implementation Tasks

### Phase 1: Core Infrastructure (~2 hours)
- Task 1.1: Create/verify health endpoint
- Task 1.2: Create entrypoint script
- Task 1.3: Create Dockerfile.slim

### Phase 2: Compose Files (~45 min)
- Task 2.1: Create docker-compose.slim.yml
- Task 2.2: Create docker-compose.byo.yml

### Phase 3: CI/CD (~2 hours)
- Task 3.1: Update publish-docker.yml
- Task 3.2: Test build locally

### Phase 4: Documentation (~1.75 hours)
- Task 4.1: Update README.md
- Task 4.2: Create docs/DEPLOYMENT.md
- Task 4.3: Update CHANGELOG.md

### Phase 5: Testing & Validation (~2.25 hours)
- Task 5.1: Local integration test
- Task 5.2: Respond to GitHub issue #13

**Total Estimate:** ~9 hours

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Prisma client path issues in slim | Medium | Test thoroughly, match unified patterns |
| Next.js standalone mode issues | Low | Already used in unified, proven |
| ARM64 build timeout | Low | Use native runners (already do) |
| Users confused by two images | Medium | Clear docs, FAQ |

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Two images vs one | Two (unified + slim) | Non-breaking for existing users |
| Process manager | tini + bash | Proper signal handling, crash propagation |
| SQLite support | Deferred | Adds complexity, MariaDB simpler |
| In-memory Redis | Deferred | Future enhancement |
| Caddy in slim | Excluded | User's responsibility, most have own proxy |
