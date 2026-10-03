# Code Style & Conventions

## 1. Language & Formatting

### 1.1 TypeScript

**Version:** 5.0+
**Strict mode:** Enabled in `tsconfig.json`
**Target:** ES2020

**Rules:**
```typescript
// ✅ Always use explicit types
const tasks: Task[] = [];
const name: string = "Willy";
const score: number | undefined = undefined;

// ❌ Avoid `any`
const result: any = fetch(...);  // NO

// ✅ Use union types instead
type Result = Task | Error;
const result: Result = ...;

// ✅ Use `const` by default, `let` only if reassigned
const userId = "user-123";  // const
let retries = 3;
while (retries--) { ... }  // let (reassigned)

// ❌ Avoid `var`
var oldStyle = true;  // NO
```

### 1.2 Formatting

**Prettier config (auto-format):**
```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "arrowParens": "avoid"
}
```

**Run before commit:**
```bash
prettier --write src/**/*.ts web/src/**/*.tsx
```

---

## 2. Naming Conventions

### 2.1 Variables & Constants

**Case:** camelCase
**Prefix:** none (unless boolean)

```typescript
// ✅ Good
const userName = "Willy";
const taskCount = 5;
const isOwner = true;
const hasError = false;

// ❌ Avoid
const user_name = "Willy";  // snake_case
const _private = ...;  // underscore prefix (not private in TS)
const USER_NAME = "Willy";  // ALL_CAPS (use for constants only)
```

### 2.2 Functions & Methods

**Case:** camelCase
**Action verb:** Start with verb (get, set, add, update, delete, is, has, can)

```typescript
// ✅ Good
async function addTask(db: D1Database, task: NewTask): Promise<Task>
function listTasks(status: string): Task[]
function isOwner(userId: string): boolean
async function claimUpdate(updateId: number): Promise<boolean>
const formatDate = (date: string, tz: string) => date;

// ❌ Avoid
async function task(db, t) { }  // Too vague
function tasks() { }  // No context (list? count?)
function checkIfOwner() { }  // "check if" redundant with "is"
```

### 2.3 Classes & Types

**Case:** PascalCase

```typescript
// ✅ Good
class UserSession { }
interface Task { }
type Status = "open" | "done";
enum Priority { LOW, NORMAL, HIGH }

// ❌ Avoid
class userSession { }
interface task { }
type status = ...
```

### 2.4 Files & Directories

**Case:** kebab-case (files), lowercase (dirs)
**Plural:** Usually singular (type/interface), plural for collections

```
src/
├── db.ts           # Database helpers
├── agent.ts        # Agent logic
├── api.ts          # API handlers
├── telegram.ts     # Telegram integration
├── memory.ts       # Memory functions
├── activity.ts     # Activity logging
└── types/          # Type definitions
    └── index.ts
```

### 2.5 Database

**Tables:** Plural, snake_case
**Columns:** Singular, snake_case
**IDs:** `{entity}_id`
**Timestamps:** `created_at`, `updated_at`

```sql
-- ✅ Good
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL
);

-- ❌ Avoid
CREATE TABLE Task (  -- Singular
  taskId TEXT,      -- camelCase
  createdDate TEXT  -- Not "_at"
);
```

---

## 3. Code Organization

### 3.1 File Structure

```typescript
// 1. Imports (external → internal)
import type { Request, Response } from "@cloudflare/workers-types";
import * as db from "./db";
import { SYSTEM_PROMPT } from "./agent";

// 2. Types & Interfaces
interface ApiRequest {
  user_id: string;
  action: string;
}

// 3. Constants
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;

// 4. Exported functions
export async function handleRequest(req: ApiRequest): Promise<Response> {
  ...
}

// 5. Internal/helper functions
async function validate(req: ApiRequest): Promise<boolean> {
  ...
}

// 6. Exports (re-export if needed)
export { validate };
```

### 3.2 Function Organization

**By responsibility:**
```typescript
// ✅ Single responsibility
async function addTask(db: D1Database, task: NewTask): Promise<Task> {
  // Only: insert task, return result
}

async function recordActivity(db: D1Database, activity: Activity): Promise<void> {
  // Only: log activity
}

// ❌ Mixed concerns
async function addTaskAndNotify(db: D1Database, task: NewTask): Promise<Task> {
  // Inserts task AND sends Telegram? Separate them!
}
```

### 3.3 Module Organization

**By feature:**
- `agent.ts` — Main agent + system prompt + tools
- `db.ts` — Database queries
- `api.ts` — REST endpoints
- `telegram.ts` — Telegram bot handler
- `memory.ts` — Vectorize search + extraction
- `marketing.ts` — Marketing team delegation

**Avoid:**
- Mixing fetch logic with formatting
- Mixing DB with API routing
- Long monolithic files (> 500 lines → split)

---

## 4. Comments & Documentation

### 4.1 JSDoc Comments

**For exported functions:**
```typescript
/**
 * Add a new task for the user.
 *
 * @param db D1 database instance
 * @param userId User ID
 * @param task Task data (title required)
 * @returns Created task with ID
 * @throws {Error} If title is missing or duplicate
 */
export async function addTask(
  db: D1Database,
  userId: string,
  task: NewTask,
): Promise<Task> {
  ...
}
```

### 4.2 Inline Comments

**When logic is non-obvious:**
```typescript
// Calculate reminder 60 minutes before due time (or custom value)
const remindAt = remind || new Date(due.getTime() - 60 * 60 * 1000);

// ✅ Good: explains why

// Don't comment obvious code
const name = "Willy";  // ❌ Set name to Willy (obvious, skip)
```

### 4.3 TODO & FIXME

```typescript
// TODO: Add rate limiting for task creation
// FIXME: Search memory times out for large datasets
// HACK: Telegram API returns empty for media sometimes, retry 3x
```

---

## 5. Error Handling

### 5.1 Error Types

```typescript
// ✅ Define specific error types
class DuplicateTaskError extends Error {
  constructor(title: string) {
    super(`Task "${title}" already exists`);
    this.name = "DuplicateTaskError";
  }
}

// Use them
try {
  await addTask(...);
} catch (err) {
  if (err instanceof DuplicateTaskError) {
    // Handle duplicate
  }
}
```

### 5.2 Error Messages

**User-facing:**
```typescript
// ✅ Clear, actionable
"Task sudah ada. Mau update yang lama atau buat baru?"

// ❌ Technical/confusing
"Constraint violation on (user_id, title, due_date)"
"Unexpected error at line 123"
```

**Logs (internal):**
```typescript
// ✅ Include context
console.error("Failed to add task", {
  userId: "user-123",
  title: "Interview",
  error: err.message,
  code: err.code,
});

// ❌ Vague
console.error("Error");
console.error(err);  // No context
```

### 5.3 Try-Catch Pattern

```typescript
// ✅ Handle specific errors
try {
  return await db.prepare(...).bind(...).first();
} catch (err) {
  if (err.message.includes("UNIQUE")) {
    throw new DuplicateTaskError(...);
  } else if (err.message.includes("ECONNREFUSED")) {
    console.error("D1 connection failed, retrying...");
    return retry();
  } else {
    throw new Error(`Unexpected DB error: ${err.message}`);
  }
}

// ❌ Swallow errors
try {
  return await db.prepare(...).bind(...).first();
} catch (err) {
  return null;  // Silent failure, hard to debug
}
```

---

## 6. Testing

### 6.1 Test File Naming

```
src/
├── db.ts
├── db.test.ts      // Unit tests for db.ts
├── db.integration.test.ts  // Integration tests
└── ...
```

### 6.2 Test Structure

```typescript
describe("addTask", () => {
  it("should insert task and return ID", async () => {
    // Arrange: set up data
    const task = { title: "Test", due: "2026-10-04" };

    // Act: execute
    const result = await addTask(db, "user-1", task);

    // Assert: verify
    expect(result.id).toBeDefined();
    expect(result.status).toBe("open");
  });

  it("should reject duplicate task", async () => {
    // ...
    expect(() => addTask(...)).toThrow(DuplicateTaskError);
  });
});
```

---

## 7. Git Commit Messages

**Format:** `<type>: <subject> [#<issue>]`

```
feat: add task deletion
fix: memory search timeout
docs: update API schema
test: add task creation tests
refactor: split agent.ts into smaller modules
chore: update dependencies
```

**Rules:**
- ✅ Imperative mood ("add", not "adds" or "added")
- ✅ < 50 chars for subject
- ✅ Lowercase first letter
- ✅ No period at end
- ✅ Reference issue if applicable (#123)

**Example:**
```
feat: add task deletion via API (#45)

Allow users to permanently delete tasks via PATCH /api/task/:id with status="cancelled".

- Add cascade delete for related activity log
- Validate user ownership before deletion
- Log deletion in activity log
```

---

## 8. Performance Considerations

### 8.1 Database Queries

```typescript
// ✅ Indexed column
db.prepare("SELECT * FROM tasks WHERE user_id = ?");

// ⚠️ Slow (full scan)
db.prepare("SELECT * FROM tasks WHERE title = ?");  // Add index

// ✅ Limit results
db.prepare("SELECT * FROM tasks LIMIT 100");

// ❌ Unbounded
db.prepare("SELECT * FROM tasks");  // Could fetch millions
```

### 8.2 Async Operations

```typescript
// ✅ Parallel when independent
const [tasks, notes] = await Promise.all([
  listTasks(db),
  listNotes(db),
]);

// ❌ Sequential when not needed
const tasks = await listTasks(db);
const notes = await listNotes(db);  // Waits for tasks first
```

### 8.3 API Calls

```typescript
// ✅ Timeout + retry
const response = await fetch(url, {
  signal: AbortSignal.timeout(5000),
});

// ❌ No timeout
const response = await fetch(url);  // Hangs forever
```

---

## 9. Avoid Common Pitfalls

| Pitfall | ❌ Bad | ✅ Good |
|---------|--------|--------|
| Type coercion | `if (userId)` | `if (userId !== undefined)` |
| Null vs undefined | `task ?? undefined` | `task ?? null` |
| String comparison | `status == "open"` | `status === "open"` |
| Floating point | `0.1 + 0.2 === 0.3` | Use integers or `Decimal` lib |
| Async await | `await Promise.all([...])` (parallelizes) | `for (const x of arr) await f(x)` (serializes) |
| Error swallowing | `.catch(() => null)` | `.catch(err => { throw err; })` |

---

## 10. Pre-Commit Checklist

Before pushing:

- [ ] `npm run build` succeeds (no TS errors)
- [ ] `npm run test` passes (if tests exist)
- [ ] `prettier --write` formatted
- [ ] No `console.log`, `debugger` statements
- [ ] No hardcoded secrets
- [ ] Commit message follows format
- [ ] Tests added for new features

