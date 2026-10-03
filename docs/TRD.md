# Technical Requirements Document (TRD)

## 1. Technology Stack

### 1.1 Frontend

| Layer | Tech | Purpose |
|-------|------|---------|
| Build | Vite 8 | Fast HMR, SPA build |
| Framework | React 18 + TypeScript | UI components |
| Styling | Tailwind CSS 4 | Utility CSS |
| Icons | Lucide React | SVG icons |
| HTTP | Fetch API | REST client |
| State | React hooks | Local component state |
| Storage | Fetch (server-side) | D1 persistence |

**Features:**
- Responsive design (mobile-first, `dvh`, `safe-area-inset`)
- No build-time state management (all server-driven)
- SPA routing (hash-based, fallback to `/index.html`)

**File size target:** < 400 KB gzip (current 380 KB)

---

### 1.2 Backend (Worker)

| Layer | Tech | Purpose |
|-------|------|---------|
| Runtime | Cloudflare Workers | Serverless compute |
| Language | TypeScript 5 | Type-safe code |
| Framework | Cloudflare APIs | Native bindings |
| Database | D1 (SQLite) | Relational data |
| Search | Vectorize | Semantic search |
| Cache | KV Namespace | OAuth sessions, media |
| Queue | Queues | Async jobs |
| Scheduler | Crons | Scheduled tasks |
| OAuth | workers-oauth-provider | MCP auth |
| MCP | MCP SDK (Node.js compat) | Claude integration |

**Constraints:**
- 30-second timeout (hard limit per request)
- ~50ms CPU time (soft)
- No file system (ephemeral)
- No persistent connections (serverless)

---

### 1.3 External APIs

| Service | Purpose | Auth | Rate Limit |
|---------|---------|------|-----------|
| Telegram Bot API | Bot webhook, send messages | Bot token | 30 msg/sec |
| Google APIs (Gmail/Drive) | Email & doc integration | OAuth 2.0 | 1M units/day |
| Claude API | LLM (via Hermes router) | Bearer token | N/A (local) |
| 9router | AI model router (Haiku/Opus) | Bearer token | Custom |
| Workers AI | Fallback LLM (Gemma) | Native | 1M req/day free |

---

## 2. Database Schema

See [BACKEND_SCHEMA.md](./BACKEND_SCHEMA.md) for full schema.

**Key tables:**
- `tasks` — User tasks (open, pending, done, cancelled)
- `notes` — Long-form memory entries
- `activity` — Chat/action snapshots (24h TTL)
- `memories` — Vectorized facts (hybrid search)
- `preferences` — User-specific settings
- `updates_processed` — Telegram update IDs (idempotency)
- `report_data` — Competitor ad snapshots
- `studio_projects` — Content generation sessions

**Migration strategy:**
- D1 auto-runs migrations on first deploy
- Version-numbered files in `/migrations`
- No schema breaking changes (add columns, never remove)

---

## 3. API Contracts

### 3.1 REST API (`/api/*`)

**Endpoint:** `https://asisten-ai.willywijaya46.workers.dev/api`

**Auth:** Bearer token (Hermes API key) OR logged-in session

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/chat` | Send chat message | Session |
| POST | `/task` | Create task | Session |
| GET | `/tasks` | List tasks | Session |
| PATCH | `/task/:id` | Update task | Session |
| GET | `/notes` | List notes | Session |
| POST | `/note` | Save note | Session |
| GET | `/memory/search` | Search memory | Session |
| POST | `/media/upload` | Upload competitor media | Bearer |
| GET | `/summary` | Task/pending counts | Session |

**Formats:** `application/json` only

---

### 3.2 Telegram Webhook (`POST /telegram`)

**Headers:**
- `x-telegram-bot-api-secret-token`: Must match `env.TELEGRAM_WEBHOOK_SECRET`

**Body:** `TgUpdate` (Telegram Update object)

**Response:** `200 OK` (async processing via queue)

**Queue consumer:** Processes TgMessage/TgCallbackQuery → calls `runAgent()` → sends reply via Telegram

---

### 3.3 OAuth Endpoints (MCP)

**OAuth 2.1 with PKCE** (handled by `@cloudflare/workers-oauth-provider`)

| Endpoint | Purpose |
|----------|---------|
| `POST /oauth/register` | Dynamic client registration (Claude, Cursor, etc.) |
| `GET /oauth/authorize` | User consent screen |
| `POST /oauth/token` | Access token issuance |
| `POST /mcp` | MCP server resource (OAuth-gated) |

**Scopes:**
- `mcp` — Access to MCP tools (read tasks, notes, memory)
- `offline_access` — Refresh tokens

---

## 4. Integration Points

### 4.1 Hermes Local Router

**Connection:** Cloudflare Quick Tunnel → localhost:3000

```
Worker → curl("http://localhost:3000/api/chat", {
  headers: { Authorization: "Bearer $HERMES_API_KEY" }
})
```

**Models:**
- Fast (Haiku): Keyword extraction, task parsing
- Smart (Opus): Complex reasoning, marketing strategy

**Fallback:** Workers AI (Gemma) if Hermes unreachable

---

### 4.2 Gmail & Google Drive

**Auth:** OAuth 2.0 (user account)

**Endpoints:**
- Gmail: `gmail.googleapis.com/gmail/v1/users/me/*`
- Drive: `www.googleapis.com/drive/v3/*`

**Operations:**
- Search: `messages.list` (Gmail operators), `files.list`
- Read: `messages.get`, `files.export` (JSON/text)
- Draft: `drafts.create`
- Save: `files.create`

---

### 4.3 Telegram Bot API

**Auth:** Bot token in `Authorization: Bearer` header

**Webhooks:**
- `POST /telegram/webhook` → receives updates
- Auto-register via `/setup` endpoint
- Webhook secret in X-Telegram-Bot-Api-Secret-Token header

**Rate:** 30 messages/sec per bot

---

## 5. Deployment & CI/CD

### 5.1 Build Process

```bash
npm run build
├── vite build (React SPA)
│   ├── Transpile TSX → JS
│   ├── Bundle & minify
│   └── Output: web/dist/
├── npm run deploy (Wrangler)
    ├── Upload Worker code (src/index.ts + deps)
    ├── Upload assets (web/dist → KV)
    ├── Run migrations (D1)
    ├── Deploy to account
    └── Output: https://asisten-ai.willywijaya46.workers.dev
```

### 5.2 Deployment

**Trigger:** Manual (`npm run deploy`)

**Auth:** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`

**Steps:**
1. Build (client + server)
2. Validation (TypeScript check)
3. Upload to Cloudflare
4. Run D1 migrations
5. Deploy worker + assets + crons
6. Trigger `/setup` to register Telegram webhook (optional)

**Time:** ~15 seconds

---

## 6. Scaling & Performance

### 6.1 Current Limits

| Resource | Limit | Current Use | Headroom |
|----------|-------|------------|----------|
| D1 (SQLite) | 10 GB | ~5 MB | ✅ Plenty |
| Vectorize | 1M dimensions | ~500 vectors | ✅ Plenty |
| KV | 1 GB/namespace | ~100 MB | ✅ Plenty |
| Workers CPU | 50ms soft, 30s hard | ~5s (smart), ~1s (fast) | ✅ OK |
| Requests/day | Unlimited | ~100-200 | ✅ OK |

### 6.2 Optimization Opportunities

1. **Vectorize:** Add query result caching (1h TTL in KV)
2. **D1:** Paginate task/note queries (currently no limit clause)
3. **Worker:** Defer non-critical tasks (competitor scoring → queue)
4. **Frontend:** Lazy load 3D office scene (currently ~1MB)

### 6.3 Multi-User Scaling (Future)

**Challenges:**
- Vectorize currently single namespace (would need per-user sharding)
- D1 row-level security (not built-in)
- Telegram: one bot per user or routing by chat ID

**Solution:** User ID partition key in queries + Vectorize namespace sharding

---

## 7. Error Handling & Resilience

### 7.1 Circuit Breaker Pattern

```javascript
// Pseudo-code
async function callHermes(msg) {
  try {
    return await fetch(..., { timeout: 5000 });
  } catch (err) {
    // Fallback to Workers AI
    return await callFallback(msg);
  }
}
```

### 7.2 Retry Logic

- Telegram send: 3 retries (exponential backoff)
- Google API: 2 retries (rate limit: 5s wait)
- D1 insert: 1 retry (conflict resolution)

### 7.3 Idempotency

- Telegram `update_id` tracking (`updates_processed` table)
- Task creation: `UNIQUE` constraint on (user_id, title, due_date)
- Job queue: Message acknowledgment after processing

---

## 8. Monitoring & Observability

### 8.1 Logs

**Sources:**
- `console.log()` → Cloudflare Tail
- `journalctl --user -u hermes-gateway` → Hermes agent logs

**Levels:** log, warn, error

---

### 8.2 Metrics

**Cloudflare Dashboard:**
- Worker requests/errors
- CPU time distribution
- Cache hit ratio
- Status code breakdown

**Custom tracking:**
- Task creation success rate (`logActivity`)
- Competitor media download count
- Briefing generation time
- Agent tool usage (`logTool`)

---

### 8.3 Alerts

**Trigger if:**
- Error rate > 5% (30 min window)
- Chat response > 20 seconds (p95)
- D1 connection failures
- Telegram webhook failures
- Briefing generation > 3 minutes

---

## 9. Security & Data Protection

See [SECURITY.md](./SECURITY.md) for detailed threat model.

**Key controls:**
- Telegram webhook secret validation (all POST /telegram)
- OAuth 2.1 for MCP clients (token + PKCE)
- D1 encryption at rest (Cloudflare managed)
- KV encryption (Cloudflare managed)
- No plaintext secrets in code/logs
- Env vars masked in dashboard

---

## 10. Browser Compatibility

**Supported:**
- Chrome/Edge 90+
- Firefox 88+
- Safari 15+
- Mobile browsers (iOS 14+, Android 10+)

**Requires:**
- ES2020+ (no IE11 support)
- Fetch API
- LocalStorage (for session token)

---

## 11. Dependency Management

**Production dependencies:**
- `@cloudflare/workers-oauth-provider` — OAuth
- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Schema validation

**Dev dependencies:**
- `vite` — Build tool
- `typescript` — Type checking
- `tailwindcss` — CSS framework
- `wrangler` — Cloudflare CLI

**Update strategy:**
- Security patches: ASAP (< 1 day)
- Minor updates: Monthly (test first)
- Major updates: Quarterly (if compatible)

---

## 12. Testing Strategy

See [TESTING.md](./TESTING.md) for detailed test plan.

**Levels:**
1. **Unit** — DB helpers, time utilities, formatters
2. **Integration** — Agent tools (add_task, search_memory, etc.)
3. **End-to-end** — Chat message → DB save → briefing generation
4. **Manual** — Telegram bot testing, UI flow validation

