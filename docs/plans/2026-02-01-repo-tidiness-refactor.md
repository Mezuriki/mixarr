# Repository Tidiness Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce root directory clutter from 27 items to ~15 items for a cleaner first impression.

**Architecture:** Move configuration files into logical subdirectories while maintaining all functionality. Update references in README and scripts.

**Tech Stack:** Git, Docker Compose, shell scripts

---

## Pre-Implementation Checklist

- [ ] Ensure all tests pass before starting
- [ ] Create feature branch: `git checkout -b refactor/repo-tidiness`
- [ ] Verify Docker stack is stopped to avoid conflicts

---

## Phase 1: Quick Wins (No Breaking Changes)

### Task 1: Merge platform deploy templates

**Goal:** Consolidate `software/` and `unraid/` into single `deploy/` folder.

**Files:**
- Create: `deploy/` directory
- Move: `software/mixarr.yml` → `deploy/runtipi.yml` (rename for clarity)
- Move: `unraid/mixarr.xml` → `deploy/unraid.xml`
- Delete: `software/` (empty after move)
- Delete: `unraid/` (empty after move)

**Steps:**
1. `mkdir -p deploy`
2. `git mv software/mixarr.yml deploy/runtipi.yml`
3. `git mv unraid/mixarr.xml deploy/unraid.xml`
4. `rmdir software unraid`
5. `git add -A && git commit -m "refactor: consolidate deploy templates into deploy/ folder"`

**Verification:**
- `ls deploy/` shows `runtipi.yml` and `unraid.xml`
- `ls software/ unraid/` shows "No such file or directory"

---

### Task 2: Move Caddyfile into caddy folder

**Goal:** Group all Caddy-related files together.

**Files:**
- Move: `Caddyfile` → `caddy/Caddyfile`
- Modify: `docker-compose.yml` - update volume mount path
- Modify: `docker-compose.dev.yml` - update volume mount path
- Modify: `docker-compose.slim.yml` - update volume mount path (if applicable)

**Steps:**
1. `git mv Caddyfile caddy/Caddyfile`
2. Update volume mounts in all docker-compose files:
   ```yaml
   # Before
   - ./Caddyfile:/etc/caddy/Caddyfile
   # After
   - ./caddy/Caddyfile:/etc/caddy/Caddyfile
   ```
3. Validate: `docker compose config --quiet` for each compose file
4. `git add -A && git commit -m "refactor: move Caddyfile into caddy/ folder"`

**Verification:**
- `docker compose config` shows no errors
- `ls caddy/` shows `Caddyfile`, `Dockerfile`, `entrypoint.sh`

---

### Task 3: Move shell scripts to scripts folder

**Goal:** Consolidate all executable scripts in one location.

**Files:**
- Move: `start-dev.sh` → `scripts/start-dev.sh`
- Move: `test_e2e.sh` → `scripts/test_e2e.sh`
- Modify: `README.md` - update references to script paths
- Modify: `.github/instructions/CLAUDE.instructions.md` - update start-dev.sh reference

**Steps:**
1. `git mv start-dev.sh scripts/start-dev.sh`
2. `git mv test_e2e.sh scripts/test_e2e.sh`
3. Update README.md references from `./start-dev.sh` to `./scripts/start-dev.sh`
4. Update CLAUDE.instructions.md reference
5. `git add -A && git commit -m "refactor: move shell scripts to scripts/ folder"`

**Verification:**
- `./scripts/start-dev.sh` executes correctly
- `./scripts/test_e2e.sh` executes correctly (if stack running)
- README instructions still accurate

---

## Phase 2: Docker Consolidation (Medium Risk)

### Task 4: Move Dockerfiles to docker folder

**Goal:** Group all Docker build files together.

**Files:**
- Move: `Dockerfile.unified` → `docker/Dockerfile.unified`
- Move: `Dockerfile.slim` → `docker/Dockerfile.slim`
- Modify: `docker-compose.yml` - update build context
- Modify: `docker-compose.dev.yml` - update build context
- Modify: `docker-compose.slim.yml` - update build context
- Modify: `docker-compose.byo.yml` - update build context
- Modify: `README.md` - update build commands
- Modify: `.github/workflows/` - update CI build paths (if applicable)

**Steps:**
1. `git mv Dockerfile.unified docker/Dockerfile.unified`
2. `git mv Dockerfile.slim docker/Dockerfile.slim`
3. Update docker-compose files:
   ```yaml
   # Before
   build:
     context: .
     dockerfile: Dockerfile.unified
   # After
   build:
     context: .
     dockerfile: docker/Dockerfile.unified
   ```
4. Validate all compose files: `docker compose -f <file> config --quiet`
5. Test build: `docker compose build`
6. `git add -A && git commit -m "refactor: move Dockerfiles to docker/ folder"`

**Verification:**
- `docker compose build` succeeds
- `docker compose -f docker-compose.slim.yml build` succeeds

---

### Task 5: Move docker-compose files to docker folder

**Goal:** All Docker configuration in one folder.

**Files:**
- Move: `docker-compose.yml` → `docker/docker-compose.yml`
- Move: `docker-compose.dev.yml` → `docker/docker-compose.dev.yml`
- Move: `docker-compose.slim.yml` → `docker/docker-compose.slim.yml`
- Move: `docker-compose.byo.yml` → `docker/docker-compose.byo.yml`
- Create: `docker-compose.yml` (symlink or wrapper in root for convenience)
- Modify: `scripts/start-dev.sh` - update compose file path
- Modify: `README.md` - update all docker compose commands
- Modify: `.github/instructions/CLAUDE.instructions.md` - update commands

**Steps:**
1. Move all compose files:
   ```bash
   git mv docker-compose.yml docker/docker-compose.yml
   git mv docker-compose.dev.yml docker/docker-compose.dev.yml
   git mv docker-compose.slim.yml docker/docker-compose.slim.yml
   git mv docker-compose.byo.yml docker/docker-compose.byo.yml
   ```
2. Create convenience symlink in root:
   ```bash
   ln -s docker/docker-compose.yml docker-compose.yml
   git add docker-compose.yml
   ```
3. Update scripts/start-dev.sh:
   ```bash
   # Before
   docker compose -f docker-compose.dev.yml up
   # After  
   docker compose -f docker/docker-compose.dev.yml up
   ```
4. Update README with new paths
5. Validate: `docker compose config --quiet`
6. `git add -A && git commit -m "refactor: move docker-compose files to docker/ folder"`

**Verification:**
- `docker compose up -d` works (via symlink)
- `./scripts/start-dev.sh` works
- README instructions accurate

---

## Phase 3: Documentation Updates

### Task 6: Update all documentation references

**Goal:** Ensure all docs reflect new file locations.

**Files:**
- Modify: `README.md` - comprehensive path updates
- Modify: `docs/DEPLOYMENT.md` (if exists) - path updates
- Modify: `.github/instructions/CLAUDE.instructions.md` - command updates

**Steps:**
1. Search for old paths: `grep -r "docker-compose.yml\|Dockerfile\|start-dev.sh" docs/ README.md .github/`
2. Update each reference to new location
3. Review changes: `git diff`
4. `git add -A && git commit -m "docs: update file paths after tidiness refactor"`

**Verification:**
- Manual review of README
- All example commands work when copy-pasted

---

## Final Structure

```
mixarr/
├── .dockerignore
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── README.md
├── docker-compose.yml          # Symlink → docker/docker-compose.yml
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── turbo.json
├── apps/
├── caddy/
│   ├── Caddyfile              # Moved from root
│   ├── Dockerfile
│   └── entrypoint.sh
├── deploy/                     # NEW - merged from software/ + unraid/
│   ├── runtipi.yml
│   └── unraid.xml
├── docker/
│   ├── Dockerfile.unified     # Moved from root
│   ├── Dockerfile.slim        # Moved from root
│   ├── docker-compose.yml     # Moved from root
│   ├── docker-compose.dev.yml
│   ├── docker-compose.slim.yml
│   ├── docker-compose.byo.yml
│   └── entrypoint-slim.sh
├── docs/
├── packages/
├── scripts/
│   ├── start-dev.sh           # Moved from root
│   ├── test_e2e.sh            # Moved from root
│   ├── lidarr-cancel-running-task.sh
│   └── lidarr-clear-queued-tasks.sh
└── website/
```

**Root items: 13** (down from 27)

---

## Rollback Plan

If issues arise:
```bash
git revert HEAD~N  # Revert N commits
# Or reset to before refactor:
git reset --hard <commit-before-refactor>
```

---

## Post-Implementation

- [ ] Run full test suite: `npm test`
- [ ] Test Docker build: `docker compose build`
- [ ] Test dev startup: `./scripts/start-dev.sh`
- [ ] Verify production compose: `docker compose up -d`
- [ ] Update any CI/CD pipelines if affected
- [ ] Merge to dev branch
