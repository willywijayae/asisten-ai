# Architecture & System Design

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                       │
│  Telegram Bot @asisten_ai_bot  │  Web UI (React SPA)  │  MCP    │
└──────────────┬──────────────────────────┬─────────────────────┬──┘
               │ POST /telegram            │ fetch /api/*        │ POST /mcp
               │ (webhook)                 │ (session auth)      │ (OAuth)
               ▼                           ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER (asisten-ai)               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Entry Point (index.ts)                                  │   │
│  │ ├─ HTTP Routing (fetch handler)                         │   │
│  │ ├─ Queue Consumer (batch processor)                     │   │
│  │ └─ Cron Handler (scheduled jobs)                        │   │
│  └──────────┬──────────────────────────────────────────────┘   │
│             │                                                    │
│  ┌──────────▼──────────────────────────────────────────────┐   │
│  │ Application Layer                                        │   │
│  │ ├─ handleUpdate() → runAgent() [main agent]             │   │
│  │ ├─ handleApi() → API endpoints (/api/*)                 │   │
│  │ ├─ mcpHandler() → MCP resource server                   │   │
│  │ └─ oauth provider (automatic)                           │   │
│  └──────────┬───────────────┬──────────────────────────────┘   │
│             │               │                                   │
│  ┌──────────▼────────┐ ┌────▼────────────────────────────┐     │
│  │ Agent System      │ │ Async Processing                │     │
│  │ ├─ agent.ts       │ │ ├─ competitors.ts               │     │
│  │ ├─ marketing.ts   │ │ ├─ studio.ts                    │     │
│  │ ├─ ceo.ts         │ │ └─ briefing.ts                  │     │
│  │ └─ tools (25+)    │ │                                 │     │
│  └──────────────────┘ └─────────────────────────────────┘     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Data & Integration Layer                                 │   │
│  │ ├─ db.ts (D1 queries)                                    │   │
│  │ ├─ memory.ts (Vectorize search)                          │   │
│  │ ├─ activity.ts (audit log)                              │   │
│  │ ├─ google.ts (Gmail/Drive)                              │   │
│  │ ├─ telegram.ts (bot commands)                           │   │
│  │ └─ oauth.ts (auth provider)                             │   │
│  └──────────┬──────────────────────────────────────────────┘   │
│             │                                                    │
└─────────────┼────────────────────────────────────────────────────┘
              │
        ┌─────┴──────────┬────────────┬──────────────┐
        │                │            │              │
        ▼                ▼            ▼              ▼
    ┌────────┐  ┌──────────────┐  ┌──────────┐  ┌────────┐
    │ D1 DB  │  │  Vectorize   │  │ KV Ns    │  │ Queues │
    │(SQLite)│  │(Vector Search)│  │(OAuth)   │  │(Async) │
    └────────┘  └──────────────┘  └──────────┘  └────────┘

    ┌──────────────────────────────────────────────────────┐
    │ External Services (via API/OAuth)                    │
    │ ├─ Telegram Bot API (send messages)                  │
    │ ├─ Google APIs (Gmail, Drive)                        │
    │ ├─ Claude API (via local Hermes tunnel)              │
    │ ├─ 9router (AI model router: Haiku/Opus)             │
    │ └─ Workers AI (Gemma fallback)                       │
    └──────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Layers

### 2.1 User Chat Message

```
User (Telegram)
  ↓ message "Ingetin aku meeting..."
Telegram Bot API
  ↓ webhook POST /telegram
Cloudflare Worker
  ├─ Verify secret token
  ├─ Check ownership
  ├─ Queue update (batch)
  │  ↓
  └─ Queue Consumer
     ├─ Claim update (idempotency)
     ├─ Extract context (memory, tasks)
     │  ├─ search_memory() → Vectorize
     │  └─ list_tasks() → D1
     ├─ runAgent()
     │  ├─ System prompt
     │  ├─ Current context
     │  ├─ Tool definitions
     │  └─ Call external model (Hermes → 9router → Haiku/Opus)
     ├─ Tool execution (add_task, update_task, etc)
     │  └─ DB writes to D1
     ├─ Extract memories (async)
     │  └─ Vectorize insert
     ├─ Log activity
     │  └─ D1 activity table
     └─ Send reply
        ├─ Telegram.send()
        └─ Web UI update (if subscribed)
```

### 2.2 Scheduled Cron Job

```
Cron event (0 0 * * *)
  ↓ 00:00 UTC+7 (midnight local)
sendBriefing(env, "morning")
  ├─ Gather data
  │  ├─ list_tasks() → today's & tomorrow's
  │  ├─ search_memory("briefing") → top memories
  │  ├─ list_activity() → yesterday's summary
  │  └─ Optional: Google Calendar (if integrated)
  ├─ Generate briefing
  │  └─ Claude (Opus) with gathered context
  ├─ Format & send
  │  └─ Telegram.send(OWNER_CHAT_ID, briefing)
  └─ Log completion
     └─ activity table
```

### 2.3 Async Background Job (Queue)

```
User: "Analisis iklan Novia"
  ↓
delegate_marketing() / import_ads()
  ├─ Queue job: { type: "remix", remixId: "..." }
  └─ Reply: "Mulai analisa..."
    ↓ (Worker continues to next request)
[ASYNC BACKGROUND]
  ├─ Pull job from queue
  ├─ runRemix(env, remixId)
  │  ├─ Fetch Novia ads (Meta Ad Library)
  │  ├─ Download media
  │  │  └─ Save to KV (7-day TTL)
  │  ├─ Score each ad
  │  │  └─ Update report_data (D1)
  │  └─ Generate insights
  │     └─ Claude analysis
  └─ Send result
     ├─ Telegram message with report
     └─ Update activity log
```

---

## 3. Module Dependencies

```
index.ts (entry point)
├─ agent.ts (main agent)
│  ├─ db.ts (queries)
│  ├─ memory.ts (search)
│  ├─ activity.ts (logging)
│  ├─ google.ts (Gmail/Drive)
│  ├─ marketing.ts (delegation)
│  ├─ telegram.ts (send messages)
│  └─ profile.ts (preferences)
├─ api.ts (REST endpoints)
│  ├─ db.ts
│  └─ memory.ts
├─ mcp.ts (MCP server)
│  ├─ db.ts
│  └─ memory.ts
├─ telegram.ts (webhook handler)
│  └─ agent.ts
├─ briefing.ts (daily briefing)
│  ├─ db.ts
│  ├─ agent.ts
│  └─ memory.ts
├─ competitors.ts (ad research)
│  ├─ db.ts
│  └─ activity.ts
├─ studio.ts (content generation)
│  ├─ db.ts
│  └─ agent.ts
├─ ceo.ts (weekly review)
│  ├─ db.ts
│  ├─ agent.ts
│  └─ memory.ts
├─ memory.ts (vectorize)
│  └─ (Vectorize API)
├─ db.ts (database)
│  └─ (D1 API)
└─ ...utilities
   ├─ time.ts
   ├─ env.ts
   └─ profile.ts
```

**Dependency rule:** No circular dependencies (enforced by linter)

---

## 4. Storage Architecture

### 4.1 D1 Database (SQLite)

```
Primary data store (relational):
├─ tasks (user task list)
├─ notes (long-form notes)
├─ memories (vectorized facts)
├─ activity (audit log, 24h TTL)
├─ preferences (user settings)
├─ updates_processed (idempotency)
└─ report_data (competitor ads snapshot)
```

**Access pattern:**
```
Worker
  ├─ Query: SELECT * FROM tasks WHERE user_id = ? AND status = 'open'
  ├─ Insert: INSERT INTO tasks (...) VALUES (...)
  ├─ Update: UPDATE tasks SET status = 'done' WHERE id = ?
  └─ Delete: DELETE FROM activity WHERE created_at < NOW() - INTERVAL 1 DAY
```

**Limitations:**
- 10GB max (current ~5MB)
- Single-region (Cloudflare datacenter)
- No transactions across multiple statements (SQLite limitation)

### 4.2 Vectorize Index

```
Vector storage (embedding-based search):
├─ Namespace: asisten-ai-memory
├─ Dimensions: 1024
├─ Metric: cosine similarity
└─ Vector count: ~1k per user

Storage structure:
  vector_id → { fact, user_id, score, created_at, source }

Query: search_memory("password wifi")
  ├─ Embed query (1024 dims)
  ├─ Find top K (cosine similarity)
  ├─ Filter by user_id
  ├─ Hybrid: combine semantic + keyword scores
  └─ Return top 5 results
```

**Limitations:**
- 1M dimensions per namespace
- Not searchable by metadata (only vector)
- TTL not directly supported (manage via D1 memories table)

### 4.3 KV Namespace

```
Key-value store (fast ephemeral data):
├─ OAuth sessions: session/{user_id}
├─ Media cache: media/{project_id}/{file_id}
├─ Temp computation results
└─ Rate limiting counters

TTL strategy:
  ├─ OAuth: 24 hours
  ├─ Media: 7 days
  └─ Counters: 60 seconds
```

**Limitations:**
- 1GB per namespace
- No query API (get/put/delete only)
- Not suitable for structured data

### 4.4 Queue (Jobs)

```
Message queue (async processing):
├─ Job type: "remix" (competitor research)
├─ Job type: "studio" (content generation)
├─ Job type: "video" (video creation)
└─ Job type: "telegram" (telegram update)

Message lifecycle:
  1. Producer: Worker enqueue(job)
  2. Consumer: Worker receive batch
  3. Processing: Execute job logic (retries if fail)
  4. Ack: Mark as processed
  5. Dead letter: After 3 retries, log error
```

**Batch settings:**
```
max_batch_size: 100
max_retry_attempts: 3
max_wait_ms: 30000
```

---

## 5. Scalability & Bottlenecks

### 5.1 Current Limits (Single User)

| Component | Limit | Usage | Headroom |
|-----------|-------|-------|----------|
| D1 | 10 GB | ~5 MB | ✅ 2000× |
| Vectorize | 1M dims | ~1k vecs | ✅ 1000× |
| KV | 1 GB/ns | ~100 MB | ✅ 10× |
| Worker CPU | 30s hard | ~5s avg | ✅ 6× |
| Requests/day | Unlimited | ~100-200 | ✅ Unlimited |

### 5.2 Bottlenecks (If Multi-User)

**Vectorize:**
- Single namespace = shared index
- Solution: per-user namespace + routing

**D1:**
- No row-level security
- Solution: user_id partition key + enforce in queries

**Worker:**
- 30s timeout per request
- Solution: move heavy work to queue

**Memory search:**
- Vectorize latency if too many vectors
- Solution: LRU cache + pagination

---

## 6. Deployment Pipeline

```
Local development
  ├─ npm install
  ├─ npm run build (Vite + TypeScript)
  └─ Testing (unit + integration)

Deploy to staging
  ├─ wrangler deploy --env staging
  ├─ Run D1 migrations
  └─ Test in staging environment

Deploy to production
  ├─ npm run deploy (wrangler + assets)
  ├─ Verify webhook (/status endpoint)
  ├─ Smoke tests (send message to bot, check reply)
  └─ Monitor (logs, errors)

Monitoring
  ├─ Cloudflare dashboard (requests, errors, CPU time)
  ├─ Tail logs (journalctl for Hermes)
  ├─ Alerts (error rate > 5%, response time > 20s)
  └─ Maintenance (token rotation, backups)
```

---

## 7. Error Handling Strategy

### 7.1 Circuit Breaker (Hermes API)

```
try {
  // Attempt Hermes (fast path)
  response = await fetch(HERMES_API_ENDPOINT + "/chat", ...)
} catch (HermesError) {
  // Fallback to Workers AI (slower, but available)
  console.warn("Hermes unavailable, using fallback");
  response = await callWorkersAI(...)
}
```

### 7.2 Retry Logic

```
// Telegram send (3 retries, exponential backoff)
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    return await telegram.send(chatId, message);
  } catch (err) {
    if (attempt === 2) throw err;  // Last attempt, fail
    await sleep(Math.pow(2, attempt) * 1000);  // 1s, 2s, 4s
  }
}
```

### 7.3 Idempotency (Telegram Updates)

```
if (await db.claimUpdate(update_id)) {
  // First time seeing this update
  await processUpdate(...);
} else {
  // Duplicate (Telegram retried), skip
  console.log("Duplicate update, skipping");
}
```

---

## 8. Security Boundaries

```
┌─ BOUNDARY 1: Telegram Webhook ─┐
│ Verify: x-telegram-bot-api-secret-token header
│ Verify: message.chat.id == OWNER_CHAT_ID
│ Access: Public endpoint, protected by secrets
└────────────────────────────────┘

┌─ BOUNDARY 2: OAuth (MCP Clients) ─┐
│ Verify: OAuth token (Bearer header)
│ Scope: "mcp" (read-only)
│ Access: Read tasks, notes, memory (no write)
└────────────────────────────────┘

┌─ BOUNDARY 3: Internal APIs ─┐
│ No auth: Worker-to-Worker (D1, Vectorize)
│ No auth: Worker-to-Cloudflare (KV, Queue)
│ Encrypted: TLS 1.3 (internal network)
└────────────────────────────────┘

┌─ BOUNDARY 4: External APIs ─┐
│ Auth: Bearer token (Hermes, Claude)
│ Auth: OAuth (Google APIs)
│ Auth: Bot token (Telegram)
│ Encrypted: TLS 1.3
└────────────────────────────────┘
```

---

## 9. Future Scalability (Multi-User)

**Changes needed:**
1. **Vectorize:** Per-user namespace + routing layer
2. **D1:** Row-level security or separate DB per user
3. **Worker:** Rate limiting per user
4. **Queue:** Job routing by user_id (fair share)
5. **Auth:** Account system + session management
6. **Billing:** Usage tracking per user

**Expected effort:** 40-60 hours of development & testing

