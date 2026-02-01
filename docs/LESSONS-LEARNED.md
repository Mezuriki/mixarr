# Lessons Learned: Software Development Principles

> Generalizable patterns discovered through real bugs, refactors, and technical debt remediation.

---

## API Design

### Route Order Matters in Express
Static routes must come before parameterized routes. Express matches top-down.

```typescript
// ✅ Correct
router.get('/types', typesHandler);   // Static first
router.get('/:id', getByIdHandler);   // Parameterized last

// ❌ Wrong - '/types' matches :id as "types"
router.get('/:id', getByIdHandler);
router.get('/types', typesHandler);
```

**Applies to:** Express, Koa, any route-matching framework with parameter capture.

---

### Never Return Raw ORM Models
Always transform database models through DTOs before returning from APIs.

Raw ORM models leak:
- Sensitive fields (passwords, API keys, tokens)
- Internal metadata (`_count`, relations, timestamps)
- Database schema coupling to frontend

```typescript
// ❌ Dangerous
res.json(await db.user.findMany());

// ✅ Safe
res.json(users.map(toUserDTO));
```

**Pattern for sensitive fields:**
```typescript
apiKey: record.apiKey ? maskSecret(record.apiKey) : null,  // "●●●●●●xyz"
```

**Applies to:** Any ORM (Prisma, TypeORM, Sequelize, Drizzle, SQLAlchemy, ActiveRecord).

---

### APIs Return Data, Frontends Format
APIs return codes/enums. Frontends map to human-readable text.

```typescript
// ❌ Backend returning UI text
return { label: "New Release", description: "Artists with new albums" };

// ✅ Backend returns code, frontend formats
return { event: "new_release" };
// Frontend: formatEventLabel("new_release") → "New Release"
```

**Benefits:**
- Enables localization/i18n
- Reduces API deployments for text changes
- Separates presentation from data
- Multiple frontends can format differently

**Applies to:** Any API serving multiple clients or requiring localization.

---

### Single Source of Truth for Metadata
When frontend renders options based on backend capabilities, serve metadata from API.

```typescript
// ✅ API endpoint for type metadata
GET /api/entities/types → [{ value, label, icon, requiredFields, description }]

// Frontend fetches and renders dynamically
const { types } = useEntityTypes();
```

**Prevents:**
- Drift between frontend hardcoded values and backend expectations
- Coordinated deploys for simple additions
- Inconsistent validation rules

**Applies to:** Subscription types, permission levels, status enums, feature flags.

---

## Architecture

### Service Layer Extraction
Routes should be thin (~10-20 lines). Business logic belongs in services.

```typescript
// ❌ God route (500+ lines)
router.get('/', async (req, res) => {
  const settings = await db.setting.findMany({ where: { userId: req.user.id } });
  const map = {};
  for (const s of settings) map[s.key] = s.value;
  res.json({ settings: map });
});

// ✅ Thin route + service
router.get('/', async (req, res) => {
  const settings = await SettingsService.getUserSettings(req.user.id);
  res.json({ settings });
});
```

**Route responsibilities:**
1. Parse/validate input
2. Call service
3. Format and return response

**Service responsibilities:**
- Business logic
- Database operations
- External API calls
- Complex transformations

**Applies to:** Express, Fastify, NestJS, Django, Rails, Spring—any MVC-style framework.

---

### Duplicate Code = Extract Signal
When copying a helper function to a second file, **STOP**. Extract to shared module immediately.

| Smell | Fix |
|-------|-----|
| Same function in 2+ routes | Create `services/` or `lib/` module |
| Same validation in 2+ places | Create schema in `schemas/` |
| Same transform in 2+ places | Create DTO in `dtos/` or `transformers/` |

**Why immediately?**
- Third occurrence is inevitable
- Bug fixes need N places updated
- Behavior diverges silently

**Applies to:** All codebases. Copy-paste is a design smell.

---

### God Components Need Decomposition
Signs of a God Component:
- 500+ lines
- Multiple unrelated concerns
- Users see all options simultaneously

**Solutions:**
- Tab-based separation with lazy loading
- Wizard flows for multi-step processes
- Extract sub-components by concern
- Progressive disclosure patterns

**Applies to:** React, Vue, Angular, Svelte—any component-based UI framework.

---

## Testing

### Fix Tests Before Refactoring
Broken tests = broken safety net. A broken net catches nothing.

**Before any refactor:**
1. Ensure all tests pass
2. Then refactor
3. Tests catch regressions

**Never refactor with failing tests**—you won't know if you broke something new or inherited a pre-existing failure.

**Applies to:** All codebases with test suites.

---

### TDD Catches Issues Before They Ship
Write tests before code. Test failures first, then happy paths.

**Priority order:**
1. Failure cases (null, empty, invalid)
2. Error paths (network, timeout, permission)
3. Attack vectors (injection, XSS, bypass)
4. Happy path (last!)

**Why failure-first?**
- Forces consideration of edge cases
- Documents expected behavior
- Prevents "works on my machine"

**Applies to:** All production code.

---

## Root Cause Pattern Recognition

| Root Cause | Symptoms | Prevention |
|------------|----------|------------|
| No service layer | Routes 500+ lines, logic duplication | Extract services from day 1 |
| Raw ORM returns | Frontend coupled to DB schema, data leaks | Always use DTOs |
| Frontend knows too much | Hardcoded configs, frontend/backend drift | API-served metadata |
| Happy path only | Broken tests, production edge cases | TDD with failure cases first |
| Quick copy-paste | Duplicate helpers across files | Extract immediately |
| No progressive disclosure | God components, cognitive overload | Tabs, wizards, lazy loading |
| Skipped root cause analysis | Same bug returns, patches accumulate | Mandatory investigation phase |

---

## The Meta-Lesson

**Quick fixes become permanent architecture.**

Every "I'll clean this up later" becomes:
- Debt that compounds
- Context that's forgotten
- Patterns that spread

Do it right the first time, or schedule the cleanup immediately with a failing test that forces the fix.
