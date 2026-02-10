# API Route Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Phase 2 and Phase 4.2 from the original code quality refactoring design — extract remaining inline route handlers to controller and standardize error logging.

**Architecture:** Move remaining 6 inline route handlers to `SubscriptionController`, standardize all catch blocks with structured logging.

**Tech Stack:** TypeScript, Express, Vitest

**Current State:**
- `subscriptions.ts`: 1,452 lines (goal: <100)
- 6 routes use controller, 6 routes still inline
- 5 catch blocks, only 1 uses `logger.error`

---

## Task 1: Extract run history endpoints to controller

**Quality Requirements:**
- Edge Cases: Invalid IDs, missing subscriptions, pagination bounds
- AI Slop Watch: Keep exact same response format

**Files:**
- Modify: `apps/api/src/controllers/subscriptions.controller.ts`
- Modify: `apps/api/src/services/subscriptions.service.ts`
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Add service methods for run history**

Add to `apps/api/src/services/subscriptions.service.ts`:

```typescript
async getRunHistory(
  subscriptionId: number,
  userId: number,
  limit: number = 20,
  offset: number = 0
): Promise<{ runs: SubscriptionRun[]; total: number }> {
  const subscription = await this.findById(subscriptionId, userId);
  if (!subscription) {
    throw new NotFoundError('Subscription not found');
  }

  const [runs, total] = await Promise.all([
    prisma.subscriptionRun.findMany({
      where: { subscriptionId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.subscriptionRun.count({ where: { subscriptionId } }),
  ]);

  return { runs, total };
}

async getRunDetails(
  subscriptionId: number,
  runId: number,
  userId: number
): Promise<SubscriptionRun | null> {
  const subscription = await this.findById(subscriptionId, userId);
  if (!subscription) {
    throw new NotFoundError('Subscription not found');
  }

  return prisma.subscriptionRun.findFirst({
    where: { id: runId, subscriptionId },
  });
}
```

**Step 2: Add controller methods**

Add to `apps/api/src/controllers/subscriptions.controller.ts`:

```typescript
async getRunHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid subscription ID' });
    }
    
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const result = await subscriptionService.getRunHistory(id, req.user!.id, limit, offset);
    res.json({ ...result, limit, offset });
  } catch (error) {
    next(error);
  }
}

async getRunDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params.id);
    const runId = parseInt(req.params.runId);
    
    if (isNaN(id) || isNaN(runId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    
    const run = await subscriptionService.getRunDetails(id, runId, req.user!.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    
    res.json(run);
  } catch (error) {
    next(error);
  }
}
```

**Step 3: Update routes to use controller**

Replace inline handlers (lines 39-126) with:

```typescript
subscriptionsRouter.get('/:id/runs', subscriptionController.getRunHistory);
subscriptionsRouter.get('/:id/runs/:runId', subscriptionController.getRunDetails);
```

**Step 4: Run tests**
```bash
cd apps/api && npm test
```
Expected: All tests pass

**Step 5: Commit**
```bash
git add apps/api/src/controllers/subscriptions.controller.ts apps/api/src/services/subscriptions.service.ts apps/api/src/routes/subscriptions.ts
git commit -m "refactor(api): extract run history endpoints to controller"
```

---

## Task 2: Extract results endpoints to controller

**Quality Requirements:**
- Edge Cases: Invalid result IDs, already approved/rejected, Lidarr connection failures
- AI Slop Watch: Preserve all existing response fields

**Files:**
- Modify: `apps/api/src/controllers/subscriptions.controller.ts`
- Modify: `apps/api/src/services/subscriptions.service.ts`
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Add service methods for results**

Add to service:
- `getResults(subscriptionId, userId, filters)` — lines 128-222
- `approveResult(subscriptionId, resultId, userId)` — lines 223-393
- `rejectResult(subscriptionId, resultId, userId)` — lines 394-427

**Step 2: Add controller methods**

Add:
- `getResults(req, res, next)`
- `approveResult(req, res, next)`
- `rejectResult(req, res, next)`

**Step 3: Update routes**

Replace inline handlers with:
```typescript
subscriptionsRouter.get('/:id/results', subscriptionController.getResults);
subscriptionsRouter.post('/:id/results/:resultId/approve', subscriptionController.approveResult);
subscriptionsRouter.post('/:id/results/:resultId/reject', subscriptionController.rejectResult);
```

**Step 4: Run tests and commit**
```bash
cd apps/api && npm test
git commit -m "refactor(api): extract results endpoints to controller"
```

---

## Task 3: Extract presets endpoint to controller

**Quality Requirements:**
- Edge Cases: None (static data)
- AI Slop Watch: Keep exact format

**Files:**
- Modify: `apps/api/src/controllers/subscriptions.controller.ts`
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Add controller method**

```typescript
async getPresets(_req: Request, res: Response, next: NextFunction) {
  try {
    // Move preset data from route to controller or service
    res.json(SUBSCRIPTION_PRESETS);
  } catch (error) {
    next(error);
  }
}
```

**Step 2: Update route**

```typescript
subscriptionsRouter.get('/presets/list', subscriptionController.getPresets);
```

**Step 3: Commit**
```bash
git commit -m "refactor(api): extract presets endpoint to controller"
```

---

## Task 4: Standardize error logging in controller

**Quality Requirements:**
- Edge Cases: Different error types (validation, not found, internal)
- AI Slop Watch: Consistent format, meaningful context

**Files:**
- Modify: `apps/api/src/controllers/subscriptions.controller.ts`

**Step 1: Update all catch blocks**

Standard pattern for each catch:

```typescript
catch (error) {
  logger.error('Failed to [action]', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    subscriptionId: req.params.id,
    userId: req.user?.id,
  });
  next(error);
}
```

**Step 2: Verify logging**
```bash
cd apps/api && npm test
```

**Step 3: Commit**
```bash
git commit -m "refactor(api): standardize error logging in subscription controller"
```

---

## Task 5: Clean up routes file

**Quality Requirements:**
- Verify routes file is now thin
- Remove any dead code

**Files:**
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Remove extracted inline handlers**

After Tasks 1-3, the routes file should only contain:
- Imports
- Router creation
- Route definitions (one-liners pointing to controller)
- Export

**Step 2: Verify line count**
```bash
wc -l apps/api/src/routes/subscriptions.ts
```
Expected: <150 lines (down from 1,452)

**Step 3: Run full test suite**
```bash
cd apps/api && npm test
```

**Step 4: Commit**
```bash
git commit -m "refactor(api): clean up subscriptions routes file

- Reduced from 1,452 to ~100 lines
- All handlers delegated to controller
- Standardized error logging"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Extract run history endpoints | 30 min |
| 2 | Extract results endpoints | 45 min |
| 3 | Extract presets endpoint | 15 min |
| 4 | Standardize error logging | 30 min |
| 5 | Clean up routes file | 15 min |

**Total:** ~2.5 hours

**Success Criteria:**
- [ ] `subscriptions.ts` reduced to <150 lines
- [ ] All routes delegate to controller
- [ ] All catch blocks use `logger.error` with consistent format
- [ ] All tests pass
