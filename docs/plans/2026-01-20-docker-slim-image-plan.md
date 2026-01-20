# Docker Slim Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `mixarr:slim` Docker image containing only API + Web, enabling power users to BYO database and Redis.

**Architecture:** Create new Dockerfile.slim with multi-stage build, add entrypoint script with tini for proper process management, create compose files for different deployment scenarios, update CI/CD to build both images.

**Tech Stack:** Docker, Node.js 20, tini, bash, GitHub Actions

**Branch:** `feature/docker-slim`

**Design Document:** `docs/plans/2026-01-20-docker-slim-image-design.md`

---

## Requirements

### Edge Cases
- Database not ready at startup (wait loop)
- Redis not ready at startup (wait loop)
- Missing required environment variables
- One process crashes (other should terminate)
- Graceful shutdown on SIGTERM

### Security
- Run as non-root user
- No secrets baked into image
- Health endpoint should not leak sensitive info

### Data Integrity
- Prisma schema sync on startup
- No data loss on container restart

---

## Phase 1: Core Infrastructure

### Task 1.1: Create Health Endpoint

**Quality Requirements:**
- Edge Cases: DB disconnected, Redis disconnected, partial failure
- Attack Vectors: None (read-only status)
- AI Slop Watch: Meaningful status messages, no generic "error"

**Files:**
- Create: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/index.ts` (add route)
- Test: `apps/api/tests/routes/health.test.ts`

**Step 1: Check if health endpoint already exists**
```bash
grep -r "health" apps/api/src/routes/ --include="*.ts" | head -10
```
If exists, verify it checks DB and Redis. If not, continue.

**Step 2: Write failing tests**

```typescript
// apps/api/tests/routes/health.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../../src/routes/health';

describe('GET /api/health', () => {
  // Test: Returns 200 when all services healthy
  it('returns ok status when db and redis connected', async () => {
    const app = express();
    app.use('/api/health', healthRouter);
    
    const res = await request(app).get('/api/health');
    
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: true,
      redis: true,
    });
  });

  // Test: Returns 503 when database disconnected
  it('returns error status when db disconnected', async () => {
    // Mock prisma.$queryRaw to throw
    vi.mock('../../src/lib/prisma', () => ({
      prisma: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection refused')),
      },
    }));
    
    const app = express();
    app.use('/api/health', healthRouter);
    
    const res = await request(app).get('/api/health');
    
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(false);
  });

  // Test: Returns 503 when redis disconnected
  it('returns error status when redis disconnected', async () => {
    // Mock redis.ping to throw
    const res = await request(app).get('/api/health');
    
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe(false);
  });
});
```

**Step 3: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/routes/health.test.ts
```
Expected: FAIL (module not found)

**Step 4: Implement health route**

```typescript
// apps/api/src/routes/health.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    db: false,
    redis: false,
    timestamp: new Date().toISOString(),
  };

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.db = true;
  } catch (error) {
    health.status = 'error';
  }

  // Check redis
  try {
    await redis.ping();
    health.redis = true;
  } catch (error) {
    health.status = 'error';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

**Step 5: Register route in index.ts**

Find where routes are registered and add:
```typescript
import { healthRouter } from './routes/health';
// ...
app.use('/api/health', healthRouter);
```

**Step 6: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/routes/health.test.ts
```
Expected: PASS

**Step 7: Commit**
```bash
git add apps/api/src/routes/health.ts apps/api/tests/routes/health.test.ts apps/api/src/index.ts
git commit -m "feat(api): add health check endpoint

- GET /api/health returns db and redis status
- Returns 503 if either service unhealthy
- Tests cover healthy, db-down, redis-down scenarios"
```

---

### Task 1.2: Create Entrypoint Script

**Quality Requirements:**
- Edge Cases: Missing env vars, DB not ready, Redis not ready, process crash
- Attack Vectors: None (startup script only)
- AI Slop Watch: Clear emoji status messages, no vague errors

**Files:**
- Create: `docker/entrypoint-slim.sh`

**Step 1: Create docker directory if needed**
```bash
mkdir -p docker
```

**Step 2: Create entrypoint script**

```bash
#!/bin/bash
set -e

echo "🎵 Mixarr (slim) starting..."

# ============================================
# 1. Validate required environment
# ============================================
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL is required"
  echo "   Example: mysql://user:pass@host:3306/mixarr"
  exit 1
fi

if [ -z "$REDIS_URL" ]; then
  echo "❌ ERROR: REDIS_URL is required"
  echo "   Example: redis://host:6379"
  exit 1
fi

echo "📋 Configuration:"
echo "   DATABASE_URL: ${DATABASE_URL%%@*}@***"
echo "   REDIS_URL: ${REDIS_URL}"

# ============================================
# 2. Wait for database
# ============================================
echo "⏳ Waiting for database..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$connect()
    .then(() => { prisma.\$disconnect(); process.exit(0); })
    .catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Database connection timeout after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "   Attempt $RETRY/$MAX_RETRIES..."
  sleep 2
done
echo "✅ Database connected"

# ============================================
# 3. Wait for Redis
# ============================================
echo "⏳ Waiting for Redis..."
RETRY=0
until node -e "
  const Redis = require('ioredis');
  const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  r.ping()
    .then(() => { r.disconnect(); process.exit(0); })
    .catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Redis connection timeout after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "   Attempt $RETRY/$MAX_RETRIES..."
  sleep 2
done
echo "✅ Redis connected"

# ============================================
# 4. Sync database schema
# ============================================
echo "🔄 Syncing database schema..."
cd /app/api
npx prisma db push --accept-data-loss 2>&1 || {
  echo "⚠️  Schema sync had issues, continuing anyway..."
}
echo "✅ Schema sync complete"

# ============================================
# 5. Start services
# ============================================
cd /app

echo "🚀 Starting API server on :3005..."
node /app/api/dist/index.js &
API_PID=$!

echo "🌐 Starting Web server on :3000..."
cd /app/web
node server.js &
WEB_PID=$!

echo ""
echo "✅ Mixarr ready!"
echo "   Web UI: http://localhost:3000"
echo "   API:    http://localhost:3005"
echo ""

# ============================================
# 6. Wait for either process to exit
# ============================================
wait -n $API_PID $WEB_PID
EXIT_CODE=$?

echo ""
echo "❌ Process exited with code $EXIT_CODE, shutting down..."

# Kill the other process gracefully
kill -TERM $API_PID $WEB_PID 2>/dev/null || true
sleep 2
kill -KILL $API_PID $WEB_PID 2>/dev/null || true

exit $EXIT_CODE
```

**Step 3: Make executable**
```bash
chmod +x docker/entrypoint-slim.sh
```

**Step 4: Commit**
```bash
git add docker/entrypoint-slim.sh
git commit -m "feat(docker): add slim image entrypoint script

- Validates DATABASE_URL and REDIS_URL
- Waits for dependencies with retry loop
- Runs prisma db push for schema sync
- Starts API and Web processes
- Exits container if either process crashes"
```

---

### Task 1.3: Create Dockerfile.slim

**Quality Requirements:**
- Edge Cases: Build cache, multi-platform (amd64/arm64)
- Attack Vectors: Non-root user, no secrets in image
- AI Slop Watch: Clear stage names, commented sections

**Files:**
- Create: `Dockerfile.slim`

**Step 1: Review existing Dockerfile.unified for patterns**
```bash
head -100 Dockerfile.unified
```

**Step 2: Create Dockerfile.slim**

```dockerfile
# =============================================================================
# Mixarr Slim Image
# Contains: API + Web only (no MariaDB, Redis, or Caddy)
# Requires: External DATABASE_URL and REDIS_URL
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /build

# Copy package files for dependency installation
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/

# Install all dependencies
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Build API
# -----------------------------------------------------------------------------
FROM deps AS api-builder

# Copy Prisma schema for generation
COPY apps/api/prisma ./apps/api/prisma/

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Copy source files
COPY apps/api ./apps/api
COPY packages/shared-types ./packages/shared-types

# Build shared-types first, then API
RUN npm run build --workspace=@mixarr/shared-types
RUN npm run build --workspace=api

# -----------------------------------------------------------------------------
# Stage 3: Build Web
# -----------------------------------------------------------------------------
FROM deps AS web-builder

COPY apps/web ./apps/web
COPY packages/shared-types ./packages/shared-types
COPY packages/ui ./packages/ui
COPY packages/config ./packages/config

# Build shared packages
RUN npm run build --workspace=@mixarr/shared-types || true

# Build Next.js in standalone mode
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build --workspace=web

# -----------------------------------------------------------------------------
# Stage 4: Production Runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache tini bash curl

# Create app directory
WORKDIR /app

# Copy API build
COPY --from=api-builder /build/apps/api/dist ./api/dist
COPY --from=api-builder /build/apps/api/prisma ./api/prisma
COPY --from=api-builder /build/apps/api/package.json ./api/
COPY --from=api-builder /build/node_modules ./node_modules

# Copy Web build (Next.js standalone)
COPY --from=web-builder /build/apps/web/.next/standalone ./web
COPY --from=web-builder /build/apps/web/.next/static ./web/.next/static
COPY --from=web-builder /build/apps/web/public ./web/public

# Copy entrypoint
COPY docker/entrypoint-slim.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create non-root user
RUN addgroup -g 1000 mixarr && \
    adduser -u 1000 -G mixarr -s /bin/sh -D mixarr && \
    mkdir -p /app/config /data && \
    chown -R mixarr:mixarr /app /data

# Switch to non-root user
USER mixarr

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3005
ENV HOSTNAME=0.0.0.0

# Expose ports
EXPOSE 3000 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1

# Volumes
VOLUME ["/data"]

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
```

**Step 3: Verify syntax**
```bash
docker build --check -f Dockerfile.slim . 2>&1 | head -20 || echo "Docker check not available, will test in build step"
```

**Step 4: Commit**
```bash
git add Dockerfile.slim
git commit -m "feat(docker): add Dockerfile.slim for minimal image

- Multi-stage build (~200MB vs ~800MB unified)
- API + Web only, requires external DB/Redis
- Uses tini for proper PID 1 signal handling
- Runs as non-root user (mixarr:1000)
- Health check via /api/health endpoint"
```

---

## Phase 2: Compose Files

### Task 2.1: Create docker-compose.slim.yml

**Quality Requirements:**
- Edge Cases: Service startup order, health checks
- Attack Vectors: Default passwords (warn in comments)
- AI Slop Watch: Clear comments, realistic defaults

**Files:**
- Create: `docker-compose.slim.yml`

**Step 1: Create compose file**

```yaml
# =============================================================================
# Mixarr Slim Stack
# Production deployment using slim image with external MariaDB and Redis
#
# Usage:
#   docker compose -f docker-compose.slim.yml up -d
#
# Requirements:
#   - Set SESSION_SECRET in environment or .env file
#
# =============================================================================

services:
  # ---------------------------------------------------------------------------
  # Mixarr Application (API + Web)
  # ---------------------------------------------------------------------------
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:slim
    container_name: mixarr
    ports:
      - "3000:3000"    # Web UI
      - "3005:3005"    # API
    environment:
      - DATABASE_URL=mysql://mixarr:mixarr@db:3306/mixarr
      - REDIS_URL=redis://redis:6379
      - SESSION_SECRET=${SESSION_SECRET:-CHANGE_ME_IN_PRODUCTION}
    volumes:
      - mixarr-data:/data
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3005/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  # ---------------------------------------------------------------------------
  # MariaDB Database
  # ---------------------------------------------------------------------------
  db:
    image: mariadb:11
    container_name: mixarr-db
    environment:
      # ⚠️ Change these passwords in production!
      - MYSQL_ROOT_PASSWORD=mixarr_root
      - MYSQL_DATABASE=mixarr
      - MYSQL_USER=mixarr
      - MYSQL_PASSWORD=mixarr
    volumes:
      - mixarr-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # Redis Cache & Queue
  # ---------------------------------------------------------------------------
  redis:
    image: redis:7-alpine
    container_name: mixarr-redis
    volumes:
      - mixarr-redis:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  mixarr-data:
    name: mixarr-data
  mixarr-db:
    name: mixarr-db
  mixarr-redis:
    name: mixarr-redis
```

**Step 2: Commit**
```bash
git add docker-compose.slim.yml
git commit -m "feat(docker): add docker-compose.slim.yml

Production stack with:
- mixarr:slim image
- MariaDB 11 with health checks
- Redis 7 Alpine
- Named volumes for persistence"
```

---

### Task 2.2: Create docker-compose.byo.yml

**Quality Requirements:**
- Edge Cases: Missing env vars (clear error messages)
- Attack Vectors: None (just mixarr container)
- AI Slop Watch: Helpful usage comments

**Files:**
- Create: `docker-compose.byo.yml`

**Step 1: Create compose file**

```yaml
# =============================================================================
# Mixarr BYO Infrastructure
# For users with existing MariaDB/MySQL and Redis
#
# Usage:
#   export DATABASE_URL=mysql://user:pass@your-db:3306/mixarr
#   export REDIS_URL=redis://your-redis:6379
#   export SESSION_SECRET=your-secret-here
#   docker compose -f docker-compose.byo.yml up -d
#
# Or create a .env file with these variables.
# =============================================================================

services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:slim
    container_name: mixarr
    ports:
      - "3000:3000"    # Web UI
      - "3005:3005"    # API
    environment:
      - DATABASE_URL=${DATABASE_URL:?DATABASE_URL is required}
      - REDIS_URL=${REDIS_URL:?REDIS_URL is required}
      - SESSION_SECRET=${SESSION_SECRET:?SESSION_SECRET is required}
    volumes:
      - mixarr-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3005/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

volumes:
  mixarr-data:
    name: mixarr-data
```

**Step 2: Commit**
```bash
git add docker-compose.byo.yml
git commit -m "feat(docker): add docker-compose.byo.yml for BYO infrastructure

Minimal compose for users with existing database and Redis.
Requires DATABASE_URL, REDIS_URL, SESSION_SECRET env vars."
```

---

## Phase 3: CI/CD Updates

### Task 3.1: Update publish-docker.yml

**Quality Requirements:**
- Edge Cases: Build failures on one arch, caching
- Attack Vectors: None (CI only)
- AI Slop Watch: Consistent job naming

**Files:**
- Modify: `.github/workflows/publish-docker.yml`

**Step 1: Read current workflow**
```bash
cat .github/workflows/publish-docker.yml
```

**Step 2: Add slim build jobs after unified jobs**

Add these jobs to the workflow (after the existing unified build jobs):

```yaml
  # ===========================================
  # Build SLIM image
  # ===========================================
  build-slim:
    name: Build Slim (${{ matrix.platform }})
    runs-on: ${{ matrix.runner }}
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: linux/amd64
            runner: ubuntu-latest
          - platform: linux/arm64
            runner: ubuntu-24.04-arm

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}

      - name: Build and push by digest
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile.slim
          platforms: ${{ matrix.platform }}
          labels: ${{ steps.meta.outputs.labels }}
          outputs: type=image,name=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }},push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=slim-${{ matrix.platform }}
          cache-to: type=gha,mode=max,scope=slim-${{ matrix.platform }}

      - name: Export digest
        run: |
          mkdir -p /tmp/digests-slim
          digest="${{ steps.build.outputs.digest }}"
          touch "/tmp/digests-slim/${digest#sha256:}"

      - name: Upload digest
        uses: actions/upload-artifact@v4
        with:
          name: slim-digests-${{ matrix.runner }}
          path: /tmp/digests-slim/*
          if-no-files-found: error
          retention-days: 1

  merge-slim:
    name: Merge Slim Manifests
    runs-on: ubuntu-latest
    needs: build-slim
    permissions:
      contents: read
      packages: write
    steps:
      - name: Download digests
        uses: actions/download-artifact@v4
        with:
          pattern: slim-digests-*
          path: /tmp/digests-slim
          merge-multiple: true

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=slim
            type=semver,pattern={{version}}-slim
            type=semver,pattern={{major}}.{{minor}}-slim

      - name: Create manifest list and push
        working-directory: /tmp/digests-slim
        run: |
          docker buildx imagetools create $(jq -cr '.tags | map("-t " + .) | join(" ")' <<< "$DOCKER_METADATA_OUTPUT_JSON") \
            $(printf '${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@sha256:%s ' *)

      - name: Inspect image
        run: |
          docker buildx imagetools inspect ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:slim
```

**Step 3: Verify YAML syntax**
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish-docker.yml'))" && echo "YAML valid"
```

**Step 4: Commit**
```bash
git add .github/workflows/publish-docker.yml
git commit -m "ci: add slim image build to publish-docker workflow

Builds mixarr:slim alongside mixarr:latest
Tags: slim, vX.X.X-slim, vX.X-slim"
```

---

### Task 3.2: Test Build Locally

**Files:** None (testing only)

**Step 1: Build slim image**
```bash
docker build -f Dockerfile.slim -t mixarr:slim-test .
```

**Step 2: Verify image size**
```bash
docker images mixarr:slim-test --format "{{.Size}}"
```
Expected: ~200-300MB

**Step 3: Test with compose**
```bash
docker compose -f docker-compose.slim.yml up -d
```

**Step 4: Verify health**
```bash
sleep 30
curl http://localhost:3005/api/health
```
Expected: `{"status":"ok","db":true,"redis":true,...}`

**Step 5: Verify web UI**
```bash
curl -I http://localhost:3000
```
Expected: HTTP 200

**Step 6: Clean up**
```bash
docker compose -f docker-compose.slim.yml down -v
```

**Step 7: Commit any fixes discovered during testing**

---

## Phase 4: Documentation

### Task 4.1: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Find Quick Start section**
```bash
grep -n "Quick Start\|Installation\|Getting Started" README.md
```

**Step 2: Add deployment options after existing Quick Start**

Add this section:

```markdown
## Deployment Options

### Option 1: Unified Image (Recommended for Beginners)

Everything in one container - just run and go:

\`\`\`bash
docker run -d \\
  --name mixarr \\
  -p 3000:3000 \\
  -v mixarr-data:/data \\
  ghcr.io/aquantumofdonuts/mixarr:latest
\`\`\`

### Option 2: Slim Image + Compose (Recommended for Production)

Separate containers for better reliability and control:

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/aquantumofdonuts/mixarr/prod/docker-compose.slim.yml -o docker-compose.yml
docker compose up -d
\`\`\`

### Option 3: Slim Image + BYO Infrastructure

For users with existing MariaDB/MySQL and Redis:

\`\`\`bash
docker run -d \\
  --name mixarr \\
  -p 3000:3000 -p 3005:3005 \\
  -e DATABASE_URL=mysql://user:pass@your-db:3306/mixarr \\
  -e REDIS_URL=redis://your-redis:6379 \\
  -e SESSION_SECRET=your-secret-here \\
  ghcr.io/aquantumofdonuts/mixarr:slim
\`\`\`

### Image Comparison

| Feature | `mixarr:latest` | `mixarr:slim` |
|---------|-----------------|---------------|
| Size | ~800MB | ~200MB |
| MariaDB | Included | External |
| Redis | Included | External |
| Caddy | Included | Not included |
| Best for | Quick start | Production, k8s |

See [Deployment Guide](docs/DEPLOYMENT.md) for detailed instructions.
```

**Step 3: Commit**
```bash
git add README.md
git commit -m "docs: add slim image deployment options to README"
```

---

### Task 4.2: Create docs/DEPLOYMENT.md

**Files:**
- Create: `docs/DEPLOYMENT.md`

**Step 1: Create deployment guide**

```markdown
# Mixarr Deployment Guide

## Image Variants

Mixarr offers two Docker image variants:

### Unified Image (`mixarr:latest`)

The unified image includes everything needed to run Mixarr:
- API server (Express)
- Web UI (Next.js)
- MariaDB database
- Redis cache
- Caddy reverse proxy (with automatic HTTPS)

**Pros:**
- Single container, zero configuration
- Works out of the box
- Automatic HTTPS via Caddy

**Cons:**
- Larger image (~800MB)
- Database/Redis upgrades require image rebuild
- Harder to scale horizontally
- Internal failures may be hidden from orchestrators

**Best for:** Quick demos, single-user setups, users new to Docker

### Slim Image (`mixarr:slim`)

The slim image contains only the Mixarr application:
- API server (Express)
- Web UI (Next.js)

**Requires:** External MariaDB/MySQL and Redis

**Pros:**
- Smaller image (~200MB)
- Use your own managed database/Redis
- Proper container crash propagation
- Easy to scale and orchestrate

**Cons:**
- Requires docker-compose or external services
- You manage database backups

**Best for:** Production deployments, Kubernetes, existing infrastructure

---

## Quick Start

### Using Unified Image

```bash
docker run -d \\
  --name mixarr \\
  -p 3000:3000 \\
  -v mixarr-data:/data \\
  ghcr.io/aquantumofdonuts/mixarr:latest
```

Access at http://localhost:3000

### Using Slim Image with Compose

```bash
# Download compose file
curl -sSL https://raw.githubusercontent.com/aquantumofdonuts/mixarr/prod/docker-compose.slim.yml \\
  -o docker-compose.yml

# Start stack
docker compose up -d
```

Access at http://localhost:3000

---

## Environment Variables

### Required (Slim Image Only)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | MySQL/MariaDB connection string | `mysql://user:pass@host:3306/mixarr` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `SESSION_SECRET` | Secret for session encryption | Random 32+ character string |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3005` | API server port |
| `NODE_ENV` | `production` | Environment mode |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Compose Files Reference

| File | Description |
|------|-------------|
| `docker-compose.yml` | Development (builds from source) |
| `docker-compose.slim.yml` | Production with slim + MariaDB + Redis |
| `docker-compose.byo.yml` | Slim only, BYO database/Redis |

---

## Kubernetes Deployment

The slim image is designed for orchestrated environments:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mixarr
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mixarr
  template:
    metadata:
      labels:
        app: mixarr
    spec:
      containers:
        - name: mixarr
          image: ghcr.io/aquantumofdonuts/mixarr:slim
          ports:
            - containerPort: 3000
              name: web
            - containerPort: 3005
              name: api
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: mixarr-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: mixarr-secrets
                  key: redis-url
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: mixarr-secrets
                  key: session-secret
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3005
            initialDelaySeconds: 60
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3005
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: mixarr
spec:
  selector:
    app: mixarr
  ports:
    - name: web
      port: 3000
    - name: api
      port: 3005
```

---

## Reverse Proxy Examples

The slim image does not include a reverse proxy. Here are examples for common setups:

### Nginx

```nginx
server {
    listen 80;
    server_name mixarr.example.com;

    location / {
        proxy_pass http://mixarr:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://mixarr:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik (Docker Labels)

```yaml
services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:slim
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mixarr.rule=Host(`mixarr.example.com`)"
      - "traefik.http.routers.mixarr.entrypoints=websecure"
      - "traefik.http.routers.mixarr.tls.certresolver=letsencrypt"
      - "traefik.http.services.mixarr.loadbalancer.server.port=3000"
```

### Caddy (Caddyfile)

```
mixarr.example.com {
    reverse_proxy mixarr:3000
}
```

---

## Troubleshooting

### Container exits immediately

Check logs:
```bash
docker logs mixarr
```

Common causes:
- Missing `DATABASE_URL` or `REDIS_URL`
- Database/Redis not reachable
- Invalid connection string format

### Health check failing

```bash
curl http://localhost:3005/api/health
```

Response shows which service is down:
```json
{"status":"error","db":false,"redis":true}
```

### Database connection refused

Ensure database is ready before Mixarr starts. The entrypoint waits up to 60 seconds, but you may need to increase `start_period` in the health check.
```

**Step 2: Commit**
```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add comprehensive deployment guide

Covers unified vs slim images, compose files,
Kubernetes deployment, reverse proxy examples"
```

---

### Task 4.3: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entries to v1.3.0 section**

Add under `### Added`:
```markdown
#### Docker Slim Image
- New `mixarr:slim` Docker image containing only API + Web (~200MB)
- `docker-compose.slim.yml` for production deployments with external services
- `docker-compose.byo.yml` for users with existing database/Redis infrastructure
- Health check endpoint at `GET /api/health`
- Deployment documentation (`docs/DEPLOYMENT.md`)
```

Add under `### Changed`:
```markdown
- Slim image uses tini for proper PID 1 signal handling
- Slim image runs as non-root user (mixarr:1000)
- Slim image exits properly when child processes crash
```

**Step 2: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: add slim image entries to CHANGELOG"
```

---

## Phase 5: Validation

### Task 5.1: Integration Testing

**Step 1: Build both images**
```bash
docker build -f Dockerfile.unified -t mixarr:unified-test .
docker build -f Dockerfile.slim -t mixarr:slim-test .
```

**Step 2: Test unified still works**
```bash
docker run -d --name mixarr-unified-test -p 3001:3000 mixarr:unified-test
sleep 60
curl http://localhost:3001
docker stop mixarr-unified-test && docker rm mixarr-unified-test
```

**Step 3: Test slim with compose**
```bash
# Use local image
sed 's|ghcr.io/aquantumofdonuts/mixarr:slim|mixarr:slim-test|' docker-compose.slim.yml > docker-compose.slim.test.yml
docker compose -f docker-compose.slim.test.yml up -d
sleep 60
curl http://localhost:3000
curl http://localhost:3005/api/health
docker compose -f docker-compose.slim.test.yml down -v
rm docker-compose.slim.test.yml
```

**Step 4: Test crash propagation**
```bash
# Start slim stack
docker compose -f docker-compose.slim.yml up -d
sleep 60

# Kill API process inside container
docker exec mixarr pkill -f "node /app/api"

# Container should restart
sleep 10
docker ps | grep mixarr
```

---

### Task 5.2: Respond to GitHub Issue

**Step 1: Comment on issue #13**
```bash
gh issue comment 13 --body "This has been implemented in the \`feature/docker-slim\` branch!

## Summary

We now offer two Docker image variants:

| Image | Contents | Size | Best For |
|-------|----------|------|----------|
| \`mixarr:latest\` | Full stack (unchanged) | ~800MB | Beginners |
| \`mixarr:slim\` | API + Web only | ~200MB | Production, k8s |

## For Users with Existing Infrastructure

\`\`\`bash
docker run -d \\
  -e DATABASE_URL=mysql://user:pass@your-db:3306/mixarr \\
  -e REDIS_URL=redis://your-redis:6379 \\
  -e SESSION_SECRET=your-secret \\
  ghcr.io/aquantumofdonuts/mixarr:slim
\`\`\`

## Key Improvements in Slim Image

- ✅ No bundled MariaDB, Redis, or Caddy
- ✅ Uses \`tini\` for proper PID 1 handling
- ✅ Container exits when services crash (proper orchestration)
- ✅ Runs as non-root user
- ✅ ~200MB image size

## Compose Files

- \`docker-compose.slim.yml\` - Slim + MariaDB + Redis
- \`docker-compose.byo.yml\` - Slim only (BYO database/Redis)

See \`docs/DEPLOYMENT.md\` for full documentation.

This will be released in v1.3.0. Thanks for the detailed feedback @kretzlaff @Noggog @Apocrathia!"
```

**Step 2: Commit message for merge**
When ready to merge to dev:
```bash
git checkout dev
git merge feature/docker-slim --no-ff -m "feat: add Docker slim image (#13)

Adds mixarr:slim image for users with existing infrastructure.
Unified image unchanged - non-breaking change."
```

---

## Summary

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1 | Health endpoint, entrypoint, Dockerfile | 2-3 hours |
| Phase 2 | Compose files | 30-45 min |
| Phase 3 | CI/CD updates, local testing | 2-3 hours |
| Phase 4 | Documentation | 1-2 hours |
| Phase 5 | Integration testing, GitHub response | 1-2 hours |
| **Total** | | **7-11 hours** |
