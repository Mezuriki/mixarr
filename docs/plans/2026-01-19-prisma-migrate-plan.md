# Prisma Migrate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `prisma db push` with `prisma migrate deploy` for production-safe database migrations with automatic baseline for existing users.

**Architecture:** A TypeScript migration script runs before app startup, detects database state (fresh/existing/migrated), baselines if needed, then runs pending migrations. Fail-fast on any error.

**Tech Stack:** TypeScript, Prisma CLI, Node.js child_process, MySQL

**Requirements:**
- Edge Cases: DB not ready, empty users table, corrupted migration table, missing migration files
- Security: Parameterized queries for table checks
- Data Integrity: Baseline must be atomic (all or none)
- Error Handling: Exit code 1 with clear message on any failure

---

## Task 1: Create migrate.ts with database wait logic

**Quality Requirements:**
- Edge Cases: DB not ready, connection timeout, max retries exceeded
- Attack Vectors: None (no user input)
- AI Slop Watch: Specific error messages, no magic numbers without constants

**Files:**
- Create: `apps/api/scripts/migrate.ts`
- Test: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for waitForDatabase**
```typescript
// apps/api/tests/scripts/migrate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll test the exported functions
describe('migrate script', () => {
  describe('waitForDatabase', () => {
    it('succeeds when database is ready', async () => {
      // Mock prisma.$queryRaw to succeed
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
        $disconnect: vi.fn(),
      };
      
      const { waitForDatabase } = await import('./migrate-utils');
      await expect(waitForDatabase(mockPrisma as any, 3, 10)).resolves.not.toThrow();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('retries on connection failure', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn()
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValue([{ 1: 1 }]),
        $disconnect: vi.fn(),
      };
      
      const { waitForDatabase } = await import('./migrate-utils');
      await expect(waitForDatabase(mockPrisma as any, 5, 10)).resolves.not.toThrow();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('throws after max retries exceeded', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        $disconnect: vi.fn(),
      };
      
      const { waitForDatabase } = await import('./migrate-utils');
      await expect(waitForDatabase(mockPrisma as any, 3, 10)).rejects.toThrow('max retries');
    });
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: FAIL (module not found)

**Step 3: Create migrate-utils.ts with waitForDatabase**
```typescript
// apps/api/scripts/migrate-utils.ts
import { PrismaClient } from '@prisma/client';

export async function waitForDatabase(
  prisma: PrismaClient,
  maxRetries: number = 30,
  retryDelayMs: number = 1000
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✓ Database connection established');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Waiting for database... (${attempt}/${maxRetries}) - ${message}`);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to connect to database after ${maxRetries} retries (max retries exceeded)`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 3 PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add waitForDatabase with retry logic

- Retries connection up to 30 times (configurable)
- Clear error message after max retries
- Tests cover success, retry, and failure cases"
```

---

## Task 2: Add table existence detection

**Quality Requirements:**
- Edge Cases: Table doesn't exist, information_schema query fails, empty result
- Attack Vectors: Table name injection → use parameterized query
- AI Slop Watch: Descriptive function names

**Files:**
- Modify: `apps/api/scripts/migrate-utils.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for checkTableExists**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
describe('checkTableExists', () => {
  it('returns true when table exists', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ count: BigInt(1) }]),
    };
    
    const { checkTableExists } = await import('./migrate-utils');
    const result = await checkTableExists(mockPrisma as any, 'users');
    expect(result).toBe(true);
  });

  it('returns false when table does not exist', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };
    
    const { checkTableExists } = await import('./migrate-utils');
    const result = await checkTableExists(mockPrisma as any, '_prisma_migrations');
    expect(result).toBe(false);
  });

  it('returns false on query error', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('Query failed')),
    };
    
    const { checkTableExists } = await import('./migrate-utils');
    const result = await checkTableExists(mockPrisma as any, 'users');
    expect(result).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 3 new FAIL

**Step 3: Implement checkTableExists**
```typescript
// Add to apps/api/scripts/migrate-utils.ts
export async function checkTableExists(
  prisma: PrismaClient,
  tableName: string
): Promise<boolean> {
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
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add checkTableExists utility

- Uses parameterized query to prevent injection
- Returns false on any error (safe default)
- Tests cover exists, not exists, and error cases"
```

---

## Task 3: Add row existence detection

**Quality Requirements:**
- Edge Cases: Empty table, table doesn't exist, query timeout
- Attack Vectors: Table name in raw query → validate against allowlist
- AI Slop Watch: Clear return types

**Files:**
- Modify: `apps/api/scripts/migrate-utils.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for hasRows**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
describe('hasRows', () => {
  it('returns true when table has data', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: BigInt(5) }]),
    };
    
    const { hasRows } = await import('./migrate-utils');
    const result = await hasRows(mockPrisma as any, 'users');
    expect(result).toBe(true);
  });

  it('returns false when table is empty', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };
    
    const { hasRows } = await import('./migrate-utils');
    const result = await hasRows(mockPrisma as any, 'users');
    expect(result).toBe(false);
  });

  it('returns false when table does not exist', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("Table doesn't exist")),
    };
    
    const { hasRows } = await import('./migrate-utils');
    const result = await hasRows(mockPrisma as any, 'nonexistent');
    expect(result).toBe(false);
  });

  it('rejects invalid table names', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn(),
    };
    
    const { hasRows } = await import('./migrate-utils');
    const result = await hasRows(mockPrisma as any, 'users; DROP TABLE users;--');
    expect(result).toBe(false);
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 4 new FAIL

**Step 3: Implement hasRows with table name validation**
```typescript
// Add to apps/api/scripts/migrate-utils.ts
const ALLOWED_TABLES = ['users', '_prisma_migrations'] as const;
type AllowedTable = typeof ALLOWED_TABLES[number];

function isAllowedTable(name: string): name is AllowedTable {
  return ALLOWED_TABLES.includes(name as AllowedTable);
}

export async function hasRows(
  prisma: PrismaClient,
  tableName: string
): Promise<boolean> {
  // Validate table name against allowlist to prevent injection
  if (!isAllowedTable(tableName)) {
    console.warn(`Invalid table name: ${tableName}`);
    return false;
  }
  
  try {
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM \`${tableName}\` LIMIT 1`
    );
    return result[0]?.count > 0;
  } catch {
    return false;
  }
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add hasRows utility with injection protection

- Allowlist validation prevents SQL injection
- Returns false on any error (safe default)
- Tests cover has data, empty, missing table, and injection attempt"
```

---

## Task 4: Add migration directory reader

**Quality Requirements:**
- Edge Cases: Directory doesn't exist, empty directory, non-directory entries
- Attack Vectors: None (reads from known path)
- AI Slop Watch: Filter out non-migration directories

**Files:**
- Modify: `apps/api/scripts/migrate-utils.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for getMigrationDirectories**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
import { vol } from 'memfs';

vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('getMigrationDirectories', () => {
  beforeEach(() => {
    vol.reset();
  });

  it('returns sorted migration directory names', () => {
    vol.fromJSON({
      '/app/prisma/migrations/20260106000001_first/migration.sql': '',
      '/app/prisma/migrations/20260117000002_second/migration.sql': '',
      '/app/prisma/migrations/20260105000001_zero/migration.sql': '',
      '/app/prisma/migrations/migration_lock.toml': '',
    });
    
    const { getMigrationDirectories } = require('./migrate-utils');
    const result = getMigrationDirectories('/app/prisma/migrations');
    
    expect(result).toEqual([
      '20260105000001_zero',
      '20260106000001_first',
      '20260117000002_second',
    ]);
  });

  it('returns empty array when no migrations exist', () => {
    vol.fromJSON({
      '/app/prisma/migrations/migration_lock.toml': '',
    });
    
    const { getMigrationDirectories } = require('./migrate-utils');
    const result = getMigrationDirectories('/app/prisma/migrations');
    
    expect(result).toEqual([]);
  });

  it('throws when directory does not exist', () => {
    const { getMigrationDirectories } = require('./migrate-utils');
    expect(() => getMigrationDirectories('/nonexistent')).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 3 new FAIL

**Step 3: Implement getMigrationDirectories**
```typescript
// Add to apps/api/scripts/migrate-utils.ts
import { readdirSync } from 'fs';
import { join } from 'path';

export function getMigrationDirectories(migrationsPath: string): string[] {
  const entries = readdirSync(migrationsPath, { withFileTypes: true });
  
  return entries
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name)
    .sort();
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add getMigrationDirectories utility

- Filters to only migration directories (YYYYMMDDHHMMSS_ prefix)
- Returns sorted list for consistent baseline order
- Throws on missing directory (expected to exist)"
```

---

## Task 5: Add baseline function

**Quality Requirements:**
- Edge Cases: No migrations to baseline, prisma CLI fails, partial baseline
- Attack Vectors: None (migration names from filesystem)
- AI Slop Watch: Clear logging of each step

**Files:**
- Modify: `apps/api/scripts/migrate-utils.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for baselineAllMigrations**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('baselineAllMigrations', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockClear();
  });

  it('marks all migrations as applied', () => {
    vol.fromJSON({
      '/app/prisma/migrations/20260105000001_first/migration.sql': '',
      '/app/prisma/migrations/20260106000001_second/migration.sql': '',
    });
    
    const { baselineAllMigrations } = require('./migrate-utils');
    baselineAllMigrations('/app/prisma/migrations', '/app');
    
    expect(execSync).toHaveBeenCalledTimes(2);
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate resolve --applied 20260105000001_first',
      expect.objectContaining({ cwd: '/app' })
    );
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate resolve --applied 20260106000001_second',
      expect.objectContaining({ cwd: '/app' })
    );
  });

  it('handles empty migrations directory', () => {
    vol.fromJSON({
      '/app/prisma/migrations/migration_lock.toml': '',
    });
    
    const { baselineAllMigrations } = require('./migrate-utils');
    baselineAllMigrations('/app/prisma/migrations', '/app');
    
    expect(execSync).not.toHaveBeenCalled();
  });

  it('throws on prisma CLI failure', () => {
    vol.fromJSON({
      '/app/prisma/migrations/20260105000001_first/migration.sql': '',
    });
    
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('prisma migrate resolve failed');
    });
    
    const { baselineAllMigrations } = require('./migrate-utils');
    expect(() => baselineAllMigrations('/app/prisma/migrations', '/app')).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 3 new FAIL

**Step 3: Implement baselineAllMigrations**
```typescript
// Add to apps/api/scripts/migrate-utils.ts
import { execSync } from 'child_process';

export function baselineAllMigrations(
  migrationsPath: string,
  cwd: string
): void {
  const migrations = getMigrationDirectories(migrationsPath);
  
  if (migrations.length === 0) {
    console.log('No migrations to baseline');
    return;
  }
  
  console.log(`Baselining ${migrations.length} migrations...`);
  
  for (const migration of migrations) {
    console.log(`  ✓ Marking as applied: ${migration}`);
    execSync(`npx prisma migrate resolve --applied ${migration}`, {
      stdio: 'inherit',
      cwd,
    });
  }
  
  console.log('Baseline complete');
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add baselineAllMigrations utility

- Marks each migration as applied in order
- Clear logging of progress
- Handles empty migrations directory
- Throws on CLI failure (fail-fast)"
```

---

## Task 6: Add migrate deploy wrapper

**Quality Requirements:**
- Edge Cases: Prisma CLI not found, migration SQL error, non-zero exit
- Attack Vectors: None
- AI Slop Watch: Clear success/failure messages

**Files:**
- Modify: `apps/api/scripts/migrate-utils.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing tests for runMigrations**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
describe('runMigrations', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockClear();
  });

  it('runs prisma migrate deploy', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    
    const { runMigrations } = require('./migrate-utils');
    runMigrations('/app');
    
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate deploy',
      expect.objectContaining({ cwd: '/app' })
    );
  });

  it('throws on migration failure', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Migration failed');
    });
    
    const { runMigrations } = require('./migrate-utils');
    expect(() => runMigrations('/app')).toThrow('Migration failed');
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 2 new FAIL

**Step 3: Implement runMigrations**
```typescript
// Add to apps/api/scripts/migrate-utils.ts
export function runMigrations(cwd: string): void {
  console.log('Running database migrations...');
  
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      cwd,
    });
    console.log('✓ Migrations complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Migration failed: ${message}`);
  }
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate-utils.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add runMigrations wrapper

- Wraps prisma migrate deploy with logging
- Clear error message on failure
- Inherits stdio for visible progress"
```

---

## Task 7: Create main migrate.ts script

**Quality Requirements:**
- Edge Cases: Fresh install, v1.2.0 upgrade, already migrated, partial state
- Attack Vectors: None (orchestration only)
- AI Slop Watch: Clear scenario logging

**Files:**
- Create: `apps/api/scripts/migrate.ts`
- Modify: `apps/api/tests/scripts/migrate.test.ts`

**Step 1: Write failing integration tests for main**
```typescript
// Add to apps/api/tests/scripts/migrate.test.ts
describe('migrate main', () => {
  let mockPrisma: any;
  let mockExit: any;
  
  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      $queryRawUnsafe: vi.fn(),
      $disconnect: vi.fn(),
    };
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('runs migrations directly for fresh install', async () => {
    // No tables exist
    mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    
    const { migrate } = require('./migrate');
    await migrate(mockPrisma, '/app');
    
    // Should NOT call baseline
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate deploy',
      expect.anything()
    );
  });

  it('baselines then migrates for v1.2.0 upgrade', async () => {
    vol.fromJSON({
      '/app/prisma/migrations/20260105000001_first/migration.sql': '',
    });
    
    // _prisma_migrations doesn't exist, users has data
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ 1: 1 }]) // DB ready
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // _prisma_migrations doesn't exist
      .mockResolvedValueOnce([{ count: BigInt(1) }]); // users exists
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(5) }]); // users has data
    
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    
    const { migrate } = require('./migrate');
    await migrate(mockPrisma, '/app');
    
    // Should call baseline then migrate
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('prisma migrate resolve'),
      expect.anything()
    );
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate deploy',
      expect.anything()
    );
  });

  it('migrates directly when already on migrate system', async () => {
    // _prisma_migrations exists
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ 1: 1 }]) // DB ready
      .mockResolvedValueOnce([{ count: BigInt(1) }]); // _prisma_migrations exists
    
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    
    const { migrate } = require('./migrate');
    await migrate(mockPrisma, '/app');
    
    // Should only call migrate deploy
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync).toHaveBeenCalledWith(
      'npx prisma migrate deploy',
      expect.anything()
    );
  });

  it('exits with code 1 on failure', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection failed'));
    
    const { migrate } = require('./migrate');
    await migrate(mockPrisma, '/app');
    
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
```

**Step 2: Run tests to verify they fail**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: 4 new FAIL

**Step 3: Create migrate.ts main script**
```typescript
// apps/api/scripts/migrate.ts
import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import {
  waitForDatabase,
  checkTableExists,
  hasRows,
  baselineAllMigrations,
  runMigrations,
} from './migrate-utils';

export async function migrate(
  prisma: PrismaClient,
  appRoot: string
): Promise<void> {
  const migrationsPath = join(appRoot, 'prisma', 'migrations');
  
  try {
    // Step 1: Wait for database
    await waitForDatabase(prisma);
    
    // Step 2: Detect migration state
    const hasMigrationTable = await checkTableExists(prisma, '_prisma_migrations');
    
    if (hasMigrationTable) {
      console.log('Migration history found, running pending migrations...');
    } else {
      // Check if this is an existing database (v1.2.0 upgrade) or fresh install
      const usersTableExists = await checkTableExists(prisma, 'users');
      const hasUserData = usersTableExists && await hasRows(prisma, 'users');
      
      if (hasUserData) {
        console.log('Detected existing database without migration history');
        console.log('Baselining migrations for upgrade from v1.2.0...');
        baselineAllMigrations(migrationsPath, appRoot);
      } else {
        console.log('Fresh installation detected');
      }
    }
    
    // Step 3: Run pending migrations
    runMigrations(appRoot);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`\n❌ Migration failed: ${message}\n`);
    console.error('Please check the logs above and fix any issues.');
    console.error('The application will not start until migrations succeed.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Main entry point when run directly
if (require.main === module) {
  const prisma = new PrismaClient();
  const appRoot = join(__dirname, '..');
  migrate(prisma, appRoot);
}
```

**Step 4: Run tests to verify they pass**
```bash
cd apps/api && npx vitest run tests/scripts/migrate.test.ts
```
Expected: All PASS

**Step 5: Commit**
```bash
git add apps/api/scripts/migrate.ts apps/api/tests/scripts/migrate.test.ts
git commit -m "feat(migrate): add main migrate script with state detection

- Detects fresh install, v1.2.0 upgrade, and already-migrated
- Automatic baseline for v1.2.0 users
- Clear error messages and exit code 1 on failure
- Integration tests cover all scenarios"
```

---

## Task 8: Update package.json scripts

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: Clear script names

**Files:**
- Modify: `apps/api/package.json`

**Step 1: Update package.json**
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

**Step 2: Verify tsx is available**
```bash
cd apps/api && npx tsx --version
```
Expected: Version number (already a dependency)

**Step 3: Test the script runs**
```bash
cd apps/api && npm run db:migrate:status
```
Expected: Shows migration status

**Step 4: Commit**
```bash
git add apps/api/package.json
git commit -m "feat(migrate): add db:migrate scripts to package.json

- db:migrate:dev for development
- db:migrate:deploy for production (uses migrate.ts)
- db:migrate:status and reset for debugging
- Keeps db:push for emergencies (deprecated)"
```

---

## Task 9: Update docker-compose.yml

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: Consistent command format

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Update API service command**

Change from:
```yaml
command: sh -c "npx prisma db push --accept-data-loss && node dist/index.js"
```

To:
```yaml
command: sh -c "npm run db:migrate:deploy && node dist/index.js"
```

**Step 2: Verify syntax**
```bash
docker compose config
```
Expected: Valid YAML output

**Step 3: Commit**
```bash
git add docker-compose.yml
git commit -m "feat(migrate): use prisma migrate in production docker-compose

- Replaces db push with migrate:deploy
- Enables audit trail and safer migrations"
```

---

## Task 10: Update docker-compose.dev.yml

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: Consistent with prod

**Files:**
- Modify: `docker-compose.dev.yml`

**Step 1: Update API service command**

Change from:
```yaml
command: sh -c "cd /app/apps/api && npx prisma generate && npx prisma db push --accept-data-loss && cd /app && npm run dev --workspace=@mixarr/api"
```

To:
```yaml
command: sh -c "cd /app/apps/api && npx prisma generate && npm run db:migrate:deploy && cd /app && npm run dev --workspace=@mixarr/api"
```

**Step 2: Verify syntax**
```bash
docker compose -f docker-compose.dev.yml config
```
Expected: Valid YAML output

**Step 3: Commit**
```bash
git add docker-compose.dev.yml
git commit -m "feat(migrate): use prisma migrate in dev docker-compose

- Dev/prod parity for migration workflow
- Consistent behavior across environments"
```

---

## Task 11: Update Dockerfile.unified

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: Remove --accept-data-loss

**Files:**
- Modify: `Dockerfile.unified`

**Step 1: Find and update the db push command**

Change from:
```dockerfile
npx prisma db push --accept-data-loss || echo "Warning: Database migration had issues, continuing..."
```

To:
```dockerfile
npm run db:migrate:deploy
```

**Step 2: Build to verify**
```bash
docker build -f Dockerfile.unified -t mixarr-test --target production .
```
Expected: Build succeeds

**Step 3: Commit**
```bash
git add Dockerfile.unified
git commit -m "feat(migrate): use prisma migrate in unified Dockerfile

- Removes --accept-data-loss flag
- Fail-fast on migration errors"
```

---

## Task 12: Create DATABASE_MIGRATIONS.md documentation

**Quality Requirements:**
- Edge Cases: Cover common issues
- Attack Vectors: None
- AI Slop Watch: Practical examples

**Files:**
- Create: `docs/DATABASE_MIGRATIONS.md`

**Step 1: Create documentation**
```markdown
# Database Migrations

Mixarr uses Prisma Migrate for database schema management. This provides:

- **Audit trail**: Every schema change is recorded
- **Safety**: No accidental data loss
- **Reproducibility**: Same migrations run in all environments

## For Users

### Upgrading Mixarr

Database migrations run automatically when you upgrade:

\`\`\`bash
git fetch --tags && git checkout latest
docker compose up -d --build
\`\`\`

The container will:
1. Wait for the database to be ready
2. Detect if you're upgrading from an older version
3. Apply any new migrations
4. Start the application

**No manual steps required.**

### Troubleshooting

**Migration failed error:**
- Check the logs: `docker compose logs api`
- Ensure database is accessible
- If the error persists, open a GitHub issue with the error message

**Database connection timeout:**
- The migration script waits up to 30 seconds for the database
- Increase database resources if needed

## For Developers

### Creating a Schema Change

1. Edit `apps/api/prisma/schema.prisma`

2. Create a migration:
   \`\`\`bash
   npm run db:migrate:dev -- --name descriptive-name
   \`\`\`

3. Review the generated SQL in `prisma/migrations/YYYYMMDDHHMMSS_descriptive-name/`

4. Commit the migration:
   \`\`\`bash
   git add apps/api/prisma/migrations/
   git commit -m "feat: add X to schema"
   \`\`\`

### Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run db:migrate:dev -- --name X` | Create new migration |
| `npm run db:migrate:deploy` | Apply pending migrations |
| `npm run db:migrate:status` | Check migration status |
| `npm run db:migrate:reset` | Reset DB (dev only) |

### Migration Best Practices

1. **One change per migration**: Easier to debug and rollback
2. **Descriptive names**: `add-user-email` not `update-schema`
3. **Test migrations**: Run on copy of production data before release
4. **No data migrations in schema migrations**: Use separate scripts

### How Baseline Works

When upgrading from v1.2.0 (which used `db push`) to v1.3.0+:

1. The migration script detects no `_prisma_migrations` table
2. It checks if the `users` table has data (existing installation)
3. If yes, it marks all existing migrations as "applied" without running them
4. Then runs any new migrations normally

This is transparent to users - their data is preserved.
```

**Step 2: Commit**
```bash
git add docs/DATABASE_MIGRATIONS.md
git commit -m "docs: add database migrations guide

- User upgrade instructions
- Developer workflow
- Troubleshooting common issues
- Explains baseline mechanism"
```

---

## Task 13: Update README.md development section

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: Concise changes only

**Files:**
- Modify: `README.md`

**Step 1: Add schema change instructions**

After the Local Development section, add:
```markdown
### Schema Changes

When modifying `apps/api/prisma/schema.prisma`:

\`\`\`bash
npm run db:migrate:dev -- --name descriptive-name
git add apps/api/prisma/migrations/
git commit -m "feat: add X to schema"
\`\`\`

See [Database Migrations](docs/DATABASE_MIGRATIONS.md) for details.
```

**Step 2: Commit**
```bash
git add README.md
git commit -m "docs: add schema change workflow to README"
```

---

## Task 14: Update CHANGELOG.md

**Quality Requirements:**
- Edge Cases: None
- Attack Vectors: None
- AI Slop Watch: User-focused language

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add v1.3.0 section or update existing**

Add to Changed section:
```markdown
### Changed
- **Database migrations**: Switched from `prisma db push` to `prisma migrate deploy`
  - Existing users: Automatic upgrade, no action required
  - New audit trail in `_prisma_migrations` table
  - Safer deployments with proper migration tracking
  - Development workflow now requires `npm run db:migrate:dev` for schema changes
```

**Step 2: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: add prisma migrate change to CHANGELOG"
```

---

## Task 15: Integration test - fresh install

**Quality Requirements:**
- Edge Cases: Empty database
- Attack Vectors: None
- AI Slop Watch: Specific verification steps

**Files:**
- None (manual testing)

**Step 1: Start fresh environment**
```bash
docker compose down -v  # Remove volumes
docker compose up -d --build
```

**Step 2: Check logs for migration output**
```bash
docker compose logs api | grep -E "(Fresh installation|Migration|✓)"
```
Expected:
```
Fresh installation detected
Running database migrations...
✓ Migrations complete
```

**Step 3: Verify _prisma_migrations table exists**
```bash
docker compose exec db mysql -u mixarr -p mixarr -e "SELECT * FROM _prisma_migrations LIMIT 5;"
```
Expected: List of applied migrations

**Step 4: Verify application works**
```bash
curl -k https://localhost:3443/api/health
```
Expected: `{"status":"ok"}`

---

## Task 16: Integration test - v1.2.0 upgrade

**Quality Requirements:**
- Edge Cases: Existing data preserved
- Attack Vectors: None
- AI Slop Watch: Data integrity verification

**Files:**
- None (manual testing)

**Step 1: Checkout v1.2.0 and seed data**
```bash
git stash
git checkout v1.2.0
docker compose down -v
docker compose up -d --build
# Wait for startup, create admin user via UI
# Add some test data (connections, subscriptions)
docker compose down
```

**Step 2: Upgrade to v1.3.0**
```bash
git checkout dev  # or v1.3.0 tag when released
git stash pop
docker compose up -d --build
```

**Step 3: Check logs for baseline**
```bash
docker compose logs api | grep -E "(Detected existing|Baselining|✓ Marking)"
```
Expected:
```
Detected existing database without migration history
Baselining migrations for upgrade from v1.2.0...
  ✓ Marking as applied: 20251218000001_add_lastfm_similar_subscription_type
  ...
Baseline complete
Running database migrations...
✓ Migrations complete
```

**Step 4: Verify data integrity**
```bash
# Login should work
# Existing connections should be visible
# Existing subscriptions should be visible
```

**Step 5: Verify _prisma_migrations populated**
```bash
docker compose exec db mysql -u mixarr -p mixarr -e "SELECT migration_name FROM _prisma_migrations ORDER BY started_at;"
```
Expected: All migrations listed as applied

---

## Task 17: Integration test - migration failure

**Quality Requirements:**
- Edge Cases: Broken migration
- Attack Vectors: None
- AI Slop Watch: Clear error message

**Files:**
- None (manual testing)

**Step 1: Create intentionally broken migration**
```bash
mkdir -p apps/api/prisma/migrations/99999999999999_broken
echo "INVALID SQL SYNTAX HERE;" > apps/api/prisma/migrations/99999999999999_broken/migration.sql
```

**Step 2: Attempt to start**
```bash
docker compose down
docker compose up api
```

**Step 3: Verify container exits with error**
```bash
docker compose ps api
```
Expected: Exit code 1, not running

**Step 4: Check logs for clear error**
```bash
docker compose logs api | tail -20
```
Expected: "❌ Migration failed" with error details

**Step 5: Clean up**
```bash
rm -rf apps/api/prisma/migrations/99999999999999_broken
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | waitForDatabase with retry | migrate-utils.ts, tests |
| 2 | checkTableExists | migrate-utils.ts, tests |
| 3 | hasRows with injection protection | migrate-utils.ts, tests |
| 4 | getMigrationDirectories | migrate-utils.ts, tests |
| 5 | baselineAllMigrations | migrate-utils.ts, tests |
| 6 | runMigrations wrapper | migrate-utils.ts, tests |
| 7 | Main migrate.ts script | migrate.ts, tests |
| 8 | package.json scripts | package.json |
| 9 | docker-compose.yml | docker-compose.yml |
| 10 | docker-compose.dev.yml | docker-compose.dev.yml |
| 11 | Dockerfile.unified | Dockerfile.unified |
| 12 | DATABASE_MIGRATIONS.md | docs/ |
| 13 | README.md update | README.md |
| 14 | CHANGELOG.md update | CHANGELOG.md |
| 15-17 | Integration tests | Manual |

**Estimated time:** 3-4 hours

**Dependencies:** None (can start immediately after v1.2.0 release)
