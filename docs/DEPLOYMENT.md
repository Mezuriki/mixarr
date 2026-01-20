# Mixarr Deployment Guide

This guide covers all deployment options for Mixarr, from simple single-container setups to production Kubernetes deployments.

## Image Variants

Mixarr provides two Docker image variants to suit different needs:

### Unified Image (`mixarr:latest`)

The unified image includes everything needed to run Mixarr:

- API server (Express)
- Web UI (Next.js)
- MariaDB database
- Redis cache/queue
- Caddy reverse proxy (with automatic HTTPS)

**Best for:** Quick demos, single-user setups, users new to Docker

### Slim Image (`mixarr:slim`)

The slim image contains only the Mixarr application:

- API server (Express)
- Web UI (Next.js)

**Requires:** External MariaDB/MySQL and Redis

**Best for:** Production deployments, Kubernetes, existing infrastructure

---

## Quick Start

### Using Unified Image

```bash
docker run -d \
  --name mixarr \
  -p 3443:443 \
  -p 3010:3010 \
  -v mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e BASE_URL="https://YOUR-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:latest
```

Access at https://YOUR-IP:3443

### Using Slim Image with Compose (equivalent to Unified Image)

```bash
# Download compose file
curl -sSL https://raw.githubusercontent.com/aquantumofdonuts/mixarr/prod/docker-compose.slim.yml \
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

### Optional (Both Images)

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | - | Public URL for OAuth callbacks |
| `FRONTEND_URL` | - | Public URL if behind reverse proxy |
| `PORT` | `3005` | API server port |
| `NODE_ENV` | `production` | Environment mode |
| `TZ` | `UTC` | Timezone for scheduled tasks |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Compose Files Reference

| File | Description | Use Case |
|------|-------------|----------|
| `docker-compose.yml` | Unified image (production) | Default deployment |
| `docker-compose.dev.yml` | Development stack (builds from source) | Local development |
| `docker-compose.slim.yml` | Slim + MariaDB + Redis | Production with separate services |
| `docker-compose.byo.yml` | Slim only | BYO database/Redis |

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
              path: /api/health/live
              port: 3005
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3005
            initialDelaySeconds: 30
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

### Health Check Endpoints

| Endpoint | Purpose | Returns 503 When |
|----------|---------|------------------|
| `/api/health` | Readiness probe | DB or Redis down |
| `/api/health/live` | Liveness probe | Never (always 200 if process running) |
| `/api/health/ready` | Legacy readiness | DB or Redis down |

---

## Reverse Proxy Examples

The slim image does not include a reverse proxy. Here are examples for common setups:

### Nginx

```nginx
upstream mixarr-web {
    server mixarr:3000;
}

upstream mixarr-api {
    server mixarr:3005;
}

server {
    listen 80;
    server_name mixarr.example.com;

    location / {
        proxy_pass http://mixarr-web;
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
        proxy_pass http://mixarr-api;
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

    handle /api/* {
        reverse_proxy mixarr:3005
    }
}
```

---

## Database Requirements

### MariaDB (Recommended)

- Version: 10.6+ or 11.x
- Character set: `utf8mb4`
- Collation: `utf8mb4_unicode_ci`

```sql
CREATE DATABASE mixarr
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'mixarr'@'%' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON mixarr.* TO 'mixarr'@'%';
FLUSH PRIVILEGES;
```

### MySQL

- Version: 8.0+
- Same configuration as MariaDB

### Redis

- Version: 6.0+ (7.x recommended)
- Persistence: Optional but recommended (`appendonly yes`)

---

## Troubleshooting

### Container exits immediately

Check logs:
```bash
docker logs mixarr
```

Common causes:
- Missing `DATABASE_URL` or `REDIS_URL` (slim image)
- Database/Redis not reachable
- Invalid connection string format

### Health check failing

```bash
curl http://localhost:3005/api/health
```

Response shows which service is down:
```json
{"status":"error","db":false,"redis":true,"timestamp":"..."}
```

### Database connection refused

1. Ensure database is running and accessible
2. Check network connectivity (same Docker network?)
3. Verify credentials in `DATABASE_URL`
4. The entrypoint waits up to 60 seconds for the database

### Schema sync issues

The slim image runs `prisma db push` on startup to sync the schema. If you see schema errors:

```bash
# Connect to container
docker exec -it mixarr sh

# Check schema status
cd /app/api
npx prisma db push --dry-run
```

### Process crashes

The slim image uses `tini` for proper signal handling. If a process crashes:

1. The container will exit (allowing orchestrators to restart it)
2. Check logs for the crash reason
3. Both API and Web must be healthy for the container to stay running

### CSS/Styling missing after upgrade

If the UI appears unstyled after upgrading Mixarr:

1. **Hard refresh**: Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. **Clear site data**: 
   - Open browser DevTools (F12)
   - Go to **Application** tab → **Storage**
   - Click **Clear site data**
3. **Open in incognito/private window** to bypass cache

This happens because the browser caches old CSS files with hash-based filenames that change on each build.

---

## Migration from Unified to Slim

1. **Backup your data**:
   ```bash
   docker exec mixarr mysqldump -u root -pmixarr_root mixarr > backup.sql
   ```

2. **Export Redis data** (optional):
   ```bash
   docker exec mixarr redis-cli BGSAVE
   docker cp mixarr:/data/redis/dump.rdb ./redis-backup.rdb
   ```

3. **Start slim stack**:
   ```bash
   docker compose -f docker-compose.slim.yml up -d db redis
   ```

4. **Import data**:
   ```bash
   docker exec -i mixarr-db mysql -u mixarr -pmixarr mixarr < backup.sql
   ```

5. **Start Mixarr**:
   ```bash
   docker compose -f docker-compose.slim.yml up -d mixarr
   ```

---

## Security Considerations

### Slim Image Security Features

- Runs as non-root user (`mixarr:1000`)
- No secrets baked into image
- Minimal attack surface (~700MB vs ~1.5GB)
- Uses `tini` for proper signal handling

### Recommendations

1. **Always set `SESSION_SECRET`** to a random 32+ character string
2. **Change default database passwords** in production
3. **Use HTTPS** via reverse proxy (Traefik, Nginx, Caddy)
4. **Restrict network access** to database and Redis
5. **Regular backups** of database and `/data` volume
