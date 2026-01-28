# Prisma Migrate Implementation Design

**Date:** 2026-01-19  
**Target Release:** v1.3.0  
**Status:** Approved

## Overview

Replace `prisma db push --accept-data-loss` with `prisma migrate deploy` for production-safe, auditable database migrations.

## Goals

1. **Audit trail** — Track exactly which migrations ran and when
2. **Rollback capability** — Ability to revert database changes if needed
3. **Team coordination** — Multiple developers working on schema changes without conflicts
4. **Safety guarantees** — Prevent accidental data loss from `--accept-data-loss` flag
5. **Dev/prod parity** — Same migration workflow in all environments

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upgrade handling | Automatic baseline | Zero user action required, seamless upgrade |
| Error handling | Fail fast | Container exits with clear message, safest for data |
| Dev workflow | Migrations everywhere | Dev/prod parity catches issues before production |
| Target release | v1.3.0 | Allows v1.2.0 to establish known-good baseline state |

## Architecture

### Startup Flow

```
Container starts
    ↓
Run migrate.ts script
    ↓
Wait for database (up to 30 seconds)
    ↓
Check: Does _prisma_migrations table exist?
    ├─ YES → prisma migrate deploy (run pending migrations)
    └─ NO → Check: Does users table have data?
              ├─ YES → Baseline all migrations, then deploy
              └─ NO → Fresh install, deploy creates everything
    ↓
Success → Start application
Failure → Exit with error code + clear message
```

### Upgrade Scenarios

| Scenario | Detection | Action |
|----------|-----------|--------|
| Fresh install | No tables exist | `migrate deploy` creates everything |
| v1.2.0 → v1.3.0 | `users` has data, no `_prisma_migrations` | Baseline + deploy |
| v1.3.0 → v1.3.1+ | `_prisma_migrations` exists | Deploy pending only |

## Components

### New: `apps/api/scripts/migrate.ts`

```typescript
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('Database connection established.');
      return;
    } catch (error) {
      console.log(`Waiting for database... (${attempt}/${MAX_RETRIES})`);
      if (attempt === MAX_RETRIES) {
        console.error('Failed to connect to database after maximum retries.');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

async function checkTableExists(tableName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = ${tableName}
    `;
    return result[0]?.count > 0;
  } catch {
    return false;
  }
}

async function hasRows(tableName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM ${tableName} LIMIT 1`
    );
    return result[0]?.count > 0;
  } catch {
    return false;
  }
}

function getMigrationDirectories(): string[] {
  const migrationsPath = join(__dirname, '..', 'prisma', 'migrations');
  return readdirSync(migrationsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map(dirent => dirent.name)
    .sort();
}

async function baselineAllMigrations(): Promise<void> {
  const migrations = getMigrationDirectories();
  console.log(`Baselining ${migrations.length} migrations...`);
  
  for (const migration of migrations) {
    console.log(`  Marking as applied: ${migration}`);
    execSync(`npx prisma migrate resolve --applied ${migration}`, { 
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    });
  }
  
  console.log('Baseline complete.');
}

async function runMigrations(): Promise<void> {
  console.log('Running database migrations...');
  try {
    execSync('npx prisma migrate deploy', { 
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    });
    console.log('Migrations complete.');
  } catch (error) {
    console.error('Migration failed! Check logs above.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  try {
    // Step 1: Wait for database
    await waitForDatabase();
    
    // Step 2: Check migration state
    const hasMigrationTable = await checkTableExists('_prisma_migrations');
    const hasUserData = await checkTableExists('users') && await hasRows('users');
    
    if (!hasMigrationTable && hasUserData) {
      // Existing v1.2.0 user upgrading to v1.3.0+
      console.log('Detected existing database without migration history.');
      console.log('Baselining migrations for upgrade from v1.2.0...');
      await baselineAllMigrations();
    } else if (!hasMigrationTable) {
      console.log('Fresh installation detected.');
    } else {
      console.log('Migration history found, checking for pending migrations...');
    }
    
    // Step 3: Run pending migrations
    await runMigrations();
    
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

### Modified: `apps/api/package.json`

```json
{
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "tsx scripts/migrate.ts",
    "db:migrate:status": "prisma migrate status",
    "db:migrate:reset": "prisma migrate reset",
    "db:push": "prisma db push"
  }
}
```

### Modified: `docker-compose.yml`

```yaml
api:
  command: sh -c "npm run db:migrate:deploy && node dist/index.js"
```

### Modified: `docker-compose.dev.yml`

```yaml
api:
  command: sh -c "cd /app/apps/api && npx prisma generate && npm run db:migrate:deploy && cd /app && npm run dev --workspace=@mixarr/api"
```

### Modified: `Dockerfile.unified`

Replace:
```dockerfile
npx prisma db push --accept-data-loss || echo "Warning: Database migration had issues, continuing..."
```

With:
```dockerfile
npm run db:migrate:deploy
```

## Development Workflow

### Current (v1.2.0):
```bash
# Edit schema.prisma
npm run db:push        # Applies changes immediately, no migration file
```

### New (v1.3.0+):
```bash
# Edit schema.prisma
npm run db:migrate:dev -- --name add-feature-x
# Creates: prisma/migrations/YYYYMMDDHHMMSS_add_feature_x/migration.sql

git add apps/api/prisma/migrations/
git commit -m "feat: add feature X schema"
```

### Commands Reference

| Command | Environment | Purpose |
|---------|-------------|---------|
| `npm run db:migrate:dev -- --name <name>` | Development | Create new migration |
| `npm run db:migrate:deploy` | All | Apply pending migrations |
| `npm run db:migrate:status` | All | Check migration status |
| `npm run db:migrate:reset` | Development | Reset DB and re-run all migrations |
| `npm run db:push` | Emergency only | Direct schema push (deprecated) |

## Testing Strategy

### Unit Tests (`apps/api/tests/scripts/migrate.test.ts`)

| Test | Description |
|------|-------------|
| `waitForDatabase retries on connection failure` | Mock DB down, verify retry logic |
| `waitForDatabase succeeds when DB ready` | Mock DB up, verify immediate success |
| `waitForDatabase fails after max retries` | Mock DB always down, verify exit(1) |
| `detects fresh install correctly` | No tables exist → skip baseline |
| `detects existing v1.2.0 user correctly` | users has data, no _prisma_migrations → baseline |
| `detects already-migrated user correctly` | _prisma_migrations exists → skip baseline |
| `baseline marks all migrations as applied` | Verify migrate resolve called for each |
| `exits with error on migration failure` | Mock migrate deploy failure → exit(1) |

### Integration Tests

| Scenario | Setup | Expected |
|----------|-------|----------|
| Fresh install | Empty database | All migrations run, app starts |
| v1.2.0 upgrade | Seed with v1.2.0 schema | Baseline applied, app starts, data intact |
| v1.3.0 → v1.3.1 | DB with _prisma_migrations | Only new migrations run |
| Migration fails | Intentionally broken migration | Container exits, clear error |

### Manual Verification Checklist

- [ ] Spin up v1.2.0 with test data (users, connections, subscriptions)
- [ ] Upgrade to v1.3.0-rc
- [ ] Verify: all data intact
- [ ] Verify: `_prisma_migrations` table populated correctly
- [ ] Verify: new features work
- [ ] Verify: fresh install works
- [ ] Verify: migration failure shows clear error

## Documentation Updates

### README.md Changes

Update Development Setup section:
```markdown
### Schema Changes

When modifying `apps/api/prisma/schema.prisma`:

\`\`\`bash
# Create a migration
npm run db:migrate:dev -- --name descriptive-name

# Commit the migration file
git add apps/api/prisma/migrations/
git commit -m "feat: add X to schema"
\`\`\`
```

### New: `docs/DATABASE_MIGRATIONS.md`

Document:
- Why we use migrations
- Developer workflow
- Troubleshooting common issues
- How baseline works for v1.2.0 upgrades

## CHANGELOG Entry

```markdown
## [v1.3.0] - YYYY-MM-DD

### Changed
- **Database migrations**: Switched from `prisma db push` to `prisma migrate deploy`
  - Existing users: Automatic upgrade, no action required
  - New audit trail in `_prisma_migrations` table
  - Safer deployments with proper migration tracking
  - Development workflow now requires `npm run db:migrate:dev` for schema changes
```

## Implementation Tasks

1. Create `apps/api/scripts/migrate.ts`
2. Add unit tests for migrate.ts
3. Update `apps/api/package.json` scripts
4. Update `docker-compose.yml` command
5. Update `docker-compose.dev.yml` command
6. Update `Dockerfile.unified` command
7. Create `docs/DATABASE_MIGRATIONS.md`
8. Update README.md development section
9. Integration test: fresh install
10. Integration test: v1.2.0 upgrade
11. Integration test: migration failure handling
12. Update CHANGELOG.md
