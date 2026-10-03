# Backend Schema & API Contracts

## 1. Database Schema (D1 SQLite)

### 1.1 Tasks Table

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at TEXT,  -- ISO 8601 (local time saved as string)
  remind_at TEXT,
  priority TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high'
  person TEXT,  -- Related person (client, boss, etc)
  tags TEXT,  -- Comma-separated
  status TEXT DEFAULT 'open',  -- 'open', 'pending', 'done', 'cancelled'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  UNIQUE(user_id, title, due_at)
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_due ON tasks(user_id, due_at);
```

### 1.2 Notes Table

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT,  -- Comma-separated
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_notes_user ON notes(user_id);
CREATE INDEX idx_notes_created ON notes(created_at DESC);
```

### 1.3 Memory Table (Vectorized Facts)

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  embedding BLOB NOT NULL,  -- Vector (1024 dims, Vectorize)
  importance TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high'
  source TEXT,  -- Where extracted from (chat, note, etc)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, fact)
);

CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_importance ON memories(user_id, importance);
```

### 1.4 Activity Log Table

```sql
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,  -- 'task_created', 'task_completed', 'note_saved', 'memory_extracted'
  data JSON NOT NULL,  -- { taskId, title, ... }
  created_at TEXT NOT NULL
);

-- Auto-delete after 24h via cron
CREATE INDEX idx_activity_user_time ON activity(user_id, created_at DESC);
```

### 1.5 Preferences Table

```sql
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- Examples:
-- (user_id, "language", "id")
-- (user_id, "timezone", "+07:00")
-- (user_id, "style", "santai")
```

### 1.6 Updates Processed (Idempotency)

```sql
CREATE TABLE updates_processed (
  update_id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX idx_updates_user ON updates_processed(user_id, processed_at DESC);
```

### 1.7 Report Data (Competitor Ads)

```sql
CREATE TABLE report_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  platform TEXT NOT NULL,  -- 'meta', 'google'
  title TEXT,
  body TEXT,
  creative_url TEXT,
  cta TEXT,
  hook_strength INT,  -- 0-10
  angle TEXT,  -- 'problem', 'lifestyle', 'testimonial', etc
  engagement_score FLOAT,
  media_path TEXT,  -- KV path
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_reports_user_brand ON report_data(user_id, brand);
CREATE INDEX idx_reports_created ON report_data(created_at DESC);
```

### 1.8 Studio Projects

```sql
CREATE TABLE studio_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,  -- 'avatar', 'product', 'hooks', 'script', 'complete'
  avatar_data JSON,  -- Customer profile + character
  product_data JSON,  -- Product, angle, big_idea
  hooks_data JSON,  -- Array of hooks
  script_data JSON,  -- Scene-by-scene breakdown
  storyboard_data JSON,  -- Frame descriptions
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_studio_user ON studio_projects(user_id);
```

### 1.9 Media Cache (KV Namespace Reference)

```
Schema (KV, not D1):
  key: "media/{project_id}/{file_id}"
  value: {
    url: "https://...",
    type: "image|video",
    size: 512000,
    expires_at: "2026-10-10T12:00:00Z"
  }
```

---

## 2. Data Types (TypeScript)

### 2.1 Task

```typescript
interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  due_at?: string;  // ISO 8601
  remind_at?: string;
  priority: "low" | "normal" | "high";
  person?: string;
  tags?: string[];
  status: "open" | "pending" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  notes?: string;
}

interface NewTask {
  title: string;
  description?: string;
  due?: string;  // Format: "YYYY-MM-DD HH:mm"
  remind?: string;
  priority?: "low" | "normal" | "high";
  person?: string;
  notes?: string;
}
```

### 2.2 Memory

```typescript
interface Memory {
  id: string;
  user_id: string;
  fact: string;
  embedding: number[];  // 1024 dimensions
  importance: "low" | "normal" | "high";
  source?: string;
  created_at: string;
  updated_at: string;
}

interface SearchMemoryResult {
  memories: Memory[];
  scores: number[];  // relevance score 0-1
}
```

### 2.3 Activity

```typescript
type ActivityKind = 
  | "task_created"
  | "task_completed"
  | "task_updated"
  | "note_saved"
  | "memory_extracted"
  | "tool_called"
  | "error";

interface Activity {
  id: string;
  user_id: string;
  kind: ActivityKind;
  data: Record<string, any>;
  created_at: string;
}
```

### 2.4 Report

```typescript
interface CompetitorAd {
  id: string;
  brand: string;
  title?: string;
  body?: string;
  creative_url?: string;
  cta?: string;
  platform: "meta" | "google";
  hook_strength: 0 | 1 | 2 | 3;  // Weak to very strong
  angle?: string;
  engagement_score?: number;
}

interface Report {
  id: string;
  brand: string;
  ads: CompetitorAd[];
  trends: string[];  // Extracted patterns
  gaps: string[];  // Opportunities
  recommendations: string[];
  generated_at: string;
}
```

---

## 3. REST API Endpoints

### 3.1 Tasks

**POST /api/task**
```
Request:
{
  "title": "Interview Ratna",
  "due": "2026-10-04 14:00",
  "remind": "2026-10-04 13:00",
  "priority": "high"
}

Response (201):
{
  "id": "task-123",
  "title": "Interview Ratna",
  "status": "open",
  "due_at": "2026-10-04T14:00:00Z",
  "created_at": "2026-10-03T16:00:00Z"
}
```

**GET /api/tasks?status=open&range=week**
```
Response (200):
{
  "tasks": [
    {
      "id": "task-123",
      "title": "Interview Ratna",
      "due_at": "2026-10-04T14:00:00Z",
      "priority": "high"
    },
    ...
  ],
  "total": 3
}
```

**PATCH /api/task/:id**
```
Request:
{
  "status": "done",
  "priority": "low"
}

Response (200):
{
  "id": "task-123",
  "status": "done",
  "updated_at": "2026-10-03T16:30:00Z"
}
```

**DELETE /api/task/:id**
```
Response (204): No content
```

---

### 3.2 Notes

**POST /api/note**
```
Request:
{
  "title": "WiFi password",
  "content": "Top right drawer",
  "tags": ["wifi", "kantor"]
}

Response (201):
{
  "id": "note-456",
  "title": "WiFi password",
  "created_at": "2026-10-03T16:00:00Z"
}
```

**GET /api/notes?search=wifi**
```
Response (200):
{
  "notes": [
    {
      "id": "note-456",
      "title": "WiFi password",
      "content": "Top right drawer"
    }
  ]
}
```

---

### 3.3 Memory Search

**GET /api/memory/search?q=password%20wifi**
```
Response (200):
{
  "results": [
    {
      "fact": "WiFi password location: top right drawer",
      "score": 0.95,
      "source": "note",
      "created_at": "2026-10-01T10:00:00Z"
    },
    {
      "fact": "WiFi credentials written in blue notebook",
      "score": 0.72,
      "source": "chat",
      "created_at": "2026-09-28T15:00:00Z"
    }
  ]
}
```

---

### 3.4 Summary (Dashboard)

**GET /api/summary**
```
Response (200):
{
  "counts": {
    "open_tasks": 5,
    "pending_tasks": 2,
    "overdue_tasks": 1,
    "today_tasks": 3
  },
  "next_reminder": {
    "task_id": "task-123",
    "title": "Interview Ratna",
    "remind_at": "2026-10-04T13:00:00Z"
  },
  "briefing_scheduled": {
    "morning": "2026-10-04T00:00:00Z",
    "evening": "2026-10-03T14:00:00Z"
  }
}
```

---

### 3.5 Chat

**POST /api/chat**
```
Request (via Telegram webhook, forwarded by agent):
{
  "user_id": "1001715052",
  "message": "ingetin aku meeting Budi Jumat jam 10",
  "context": {
    "recent_tasks": [...],
    "recent_memories": [...]
  }
}

Response (async via Telegram):
Message sent to user.
```

---

## 4. Error Responses

**400 Bad Request**
```json
{
  "error": "missing_field",
  "message": "Field 'title' is required",
  "field": "title"
}
```

**401 Unauthorized**
```json
{
  "error": "unauthorized",
  "message": "Invalid or missing auth token"
}
```

**403 Forbidden**
```json
{
  "error": "forbidden",
  "message": "User 12345 is not allowed to access this resource"
}
```

**409 Conflict**
```json
{
  "error": "duplicate",
  "message": "Task with same title and due date already exists"
}
```

**500 Internal Server Error**
```json
{
  "error": "internal_error",
  "message": "Database connection failed",
  "request_id": "req-xyz-123"
}
```

---

## 5. D1 Query Helpers (db.ts)

```typescript
// Add task
export async function addTask(
  db: D1Database,
  userId: string,
  task: NewTask
): Promise<Task>

// List tasks
export async function listTasks(
  db: D1Database,
  userId: string,
  options: { status?: string; range?: string }
): Promise<Task[]>

// Update task
export async function updateTask(
  db: D1Database,
  userId: string,
  taskId: string,
  updates: Partial<Task>
): Promise<Task>

// Search notes
export async function searchNotes(
  db: D1Database,
  userId: string,
  query: string
): Promise<Note[]>

// Get reminders due now
export async function getDueReminders(
  db: D1Database,
  userId: string,
  minuteWindow: number
): Promise<Task[]>

// Claim update (idempotency)
export async function claimUpdate(
  db: D1Database,
  updateId: number
): Promise<boolean>
```

---

## 6. Migration Files

Located in `/migrations/`:

```
migrations/
├── 0001_initial_schema.sql
├── 0002_add_studio_projects.sql
├── 0003_add_preferences.sql
└── ...
```

Example migration:

```sql
-- migrations/0001_initial_schema.sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ...
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  ...
);

-- Wrangler auto-runs these on deploy
-- Status check: wrangler d1 execute asisten-ai-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 7. KV Namespace Schema

**Namespace: `MEDIA`** (OAuth & media cache)

```
Key: "session/{user_id}"
Value: {
  "token": "...",
  "expires_at": "2026-10-04T16:00:00Z"
}

Key: "media/{project_id}/image_{index}"
Value: {
  "url": "https://cdn.example.com/img.jpg",
  "size": 512000,
  "type": "image/jpeg"
}
```

**TTL:** 7 days for media, 24 hours for sessions

---

## 8. Vectorize Schema

**Index:** `asisten-ai-memory`

**Dimensions:** 1024

**Metric:** cosine

**Vector lifecycle:**
```
Fact → embed (Claude API) → store in Vectorize
      ↓
      search_memory(query) → embed query → vector search → top K results
```

