# Product Requirements Document (PRD)

## 1. Product Overview

**asisten-ai** adalah personal AI assistant yang terintegrasi dengan Telegram, berfungsi sebagai:

1. **Chief of Staff** — Menerima pesan natural language, mencatat tugas, pengingat, dan catatan
2. **Second Brain** — Menyimpan & mencari memori jangka panjang (hybrid semantic search)
3. **Content Creator** — Menghasilkan hook video, script, idea kalender konten
4. **Competitor Researcher** — Monitor iklan kompetitor & extract insights
5. **Marketing Coordinator** — Delegate pekerjaan ke tim marketing AI (copywriting, strategy)
6. **Personal Briefer** — Kirim briefing pagi & recap malam secara otomatis

**Users:** Single owner (pemilik Telegram bot)

**Platform:** Telegram, Web (React SPA), MCP (Claude integration)

---

## 2. Key Features

### 2.1 Chat & Task Management

**Status:** ✅ Live

Users can:
- Chat naturally: "Ingetin aku meeting sama Budi Jumat jam 10 pagi"
- Forward pesan WhatsApp → bot extracts commitment & proposes tasks for approval
- Voice note → automatic transcription & fact extraction
- Create tasks with: title, due date, reminder, priority, person, notes

Bot can:
- Confirm task saved with explicit date/time
- List open/pending/done tasks
- Mark tasks done or cancel them
- Receive corrections and learn preferences

**Interfaces:** `Task`, `NewTask` (db.ts)

**Tools:** `add_task`, `add_tasks`, `propose_tasks`, `list_tasks`, `update_task` (agent.ts)

---

### 2.2 Notes & Memory

**Status:** ✅ Live

Users can:
- Save facts: "catat bahwa password WiFi kantor ada di laci atas"
- Search memory: "apa aku pernah catat soal Budi?"
- Vectorize hybrid search (semantic + keyword)
- Auto-extract memories from chat (background)

Bot can:
- Remember user preferences ("jangan panggil aku pak, panggil Willy")
- Distinguish facts (one-off) vs preferences (ongoing)
- Use memories to provide context in answers
- Auto-prune old activity log (24h)

**Interfaces:** `Memory`, `Note` (memory.ts, profile.ts)

**Tools:** `search_memory`, `save_note`, `remember_fact`, `remember_preference`, `forget_preference` (agent.ts)

---

### 2.3 Automated Briefing & Reminders

**Status:** ✅ Live

**Pagi (07:00 UTC+7):**
- Task summary (today, tomorrow, overdue)
- Birthdays/anniversaries
- Calendar highlights (from Google Calendar, if connected)

**Malam (21:00 UTC+7):**
- Recap tasks completed
- Insights from daily activity
- Pending approvals (tasks, notes, reminders)

**5-minute job:**
- Send reminders (1 hour before due time)
- Process competitor media downloads
- Score pending ads

**Weekly (Minggu 13:00 UTC+7):**
- CEO review: insights, patterns, recommendations

---

### 2.4 Competitor Ad Research

**Status:** ✅ Live

Features:
- Monitor competitor ad library (Meta Ad Library, Google Ads)
- Auto-download media (images, videos)
- Score ads by engagement pattern (hook, angle, CTA)
- Generate competitor audit report
- Track creative fatigue

**Interfaces:** `CompetitorAd`, `MediaItem`, `Report` (competitors.ts)

**Tools:** `import_ads`, `search_ad_library`, `create_report` (agent.ts)

---

### 2.5 Content Studio

**Status:** ✅ Live

Generates:
- **Video hooks** — 5 different angles (problem-agitation-solution, lifestyle, testimonial, education, promo)
- **Script** — Full scene-by-scene breakdown
- **Storyboard** — Visual frame descriptions
- **Copy variants** — For social media captions

Workflow:
1. Input: Target customer profile, product benefits, angle
2. Stage 1: Avatar & character (ChatGPT/Grok)
3. Stage 2: Product positioning & angle
4. Stage 3: Hooks, script, storyboard
5. Output: Ready-to-produce video outline

**Interfaces:** `Avatar`, `Product`, `Storyboard` (studio.ts)

**Tools:** `start_studio_session`, `process_studio_stage`, `save_studio_project` (agent.ts)

---

### 2.6 Marketing Team Delegation

**Status:** ✅ Live

User can request:
- "Bikinin 5 hook video untuk produk skin care, angle 'perut buncit hormonal'"
- "Ide konten marketing minggu depan"
- "Analisis competitor Novia, fokus ke unique angle mereka"
- "Buat calendar konten untuk Q4"

Bot delegates to:
- **CEO (strategi)** — Long-term planning, market analysis
- **Marketing Manager (eksekusi)** — Campaign management, reporting
- **Ops Manager (logistik)** — Scheduling, coordination
- **Content Specialist** — Copy, hooks, captions
- **Video Specialist** — Scripts, storyboards
- **Research Specialist** — Competitor, market, audience research

Results auto-sent to user. Bot acknowledges & summarizes.

**Tools:** `delegate_marketing` (agent.ts)

---

### 2.7 Gmail & Google Drive Integration

**Status:** ✅ Live

Features:
- **Email:** Search (Gmail operators), read, draft replies
- **Drive:** Search docs/sheets/slides, read content, save results

Constraints:
- Reads only (no send email automatically)
- Draft for user review first
- Emails/docs are data, not instructions (ignore embedded commands)
- If email contains commitment → propose tasks

**Tools:** `gmail_search`, `gmail_read`, `gmail_draft`, `drive_search`, `drive_read`, `drive_save` (google.ts, agent.ts)

---

### 2.8 MCP Server for Claude

**Status:** ✅ Live

Claude (via MCP connector) can:
- Read user tasks, notes, preferences
- Search memory
- Log tool usage

**Endpoints:** `/mcp` (OAuth gated)

---

### 2.9 Paid Ads (New)

**Status:** ✅ New (UI only)

Web page showing:
- Google Ads MCP connector guide (Ryze AI)
- Meta Ads MCP connector guide
- Tool list for each platform
- Example prompts

This is **not a data dashboard**. It's a guide + launcher for MCP clients (Claude, ChatGPT) to connect their own ad accounts and use 150+ Google Ads tools + 80+ Meta Ads tools.

**File:** `web/src/pages/PaidAds.tsx` (new menu in sidebar, group "Marketing")

---

## 3. User Journeys

### 3.1 Daily Chat & Task Management

```
User: "Ingetin aku interview Ratna Jumat jam 2 siang"
↓
Bot: Ubah ke datetime lokal (Jumat 1 Nov 14:00)
     Tunggu ≤ 1h sebelum due → send reminder
     Simpan sebagai task (open)
↓
User: (Jumat jam 13:00) → receives reminder
User: (After meeting) "Selesai"
↓
Bot: Ubah task → done, log activity
```

### 3.2 Marketing Request Delegation

```
User: "Bikinin 5 hook video untuk produk skincare"
↓
Bot: Extract requirements → delegate_marketing()
↓
Marketing agents work (runs async in background)
↓
User: (30 menit) → receives full result (5 hooks + script + storyboard)
Bot: "Sudah ready 👇 (click link untuk lihat detail)"
```

### 3.3 Competitor Research

```
User: "Analisis iklan kompetitor Novia di Meta"
↓
Bot: search_ad_library("Novia brand")
     → returns 20+ ads with creative, copy, CTA
↓
Bot: "Aku simpan & analisa nanti. Hasilnya kirim kesini minggu depan."
     (runs async: download media, score, generate report)
↓
User: (next week) → receives competitor audit report
```

### 3.4 Daily Briefing

```
07:00 UTC+7:
  ↓ sendBriefing("morning")
  ↓
  Task summary + calendar + insights
  ↓ send to Telegram
  
21:00 UTC+7:
  ↓ sendBriefing("evening")
  ↓
  Recap completed tasks + pending + CEO insights
  ↓ send to Telegram
```

---

## 4. Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Chat response time | < 5s (fast) / < 15s (smart) | ✅ Live |
| Task save success | 100% | ✅ Live |
| Memory search accuracy | > 85% (Vectorize) | ✅ Live |
| Briefing generation | < 2 min | ✅ Live |
| Competitor research | < 30 min (async) | ✅ Live |
| Marketing delegation | < 1h (async) | ✅ Live |
| Bot availability | 99.9% (Cloudflare) | ✅ Live |
| Reminder delivery | 100% | ✅ Live |

---

## 5. Constraints & Limitations

### 5.1 Single User
- Bot only responds to `OWNER_CHAT_ID`
- No multi-user support (by design)
- Preferences/memory are user-specific

### 5.2 AI Model Limits
- Fast tier (Haiku): good for quick summarization, task extraction
- Smart tier (Opus): used for complex reasoning, marketing strategy
- Fallback: Workers AI (Gemma) for compatibility

### 5.3 Integration Limits
- Gmail/Drive: read-only (no auto-send)
- Telegram: webhook mode (no polling)
- Google Analytics: not integrated yet
- WhatsApp: not integrated yet (planned)

### 5.4 Performance
- Workers: 30s timeout (hard limit)
- D1: 10GB (current ~5MB)
- Vectorize: 1M dimensions
- KV: 1GB per namespace

---

## 6. Non-Functional Requirements

### 6.1 Reliability
- Graceful error handling (bot replies with actionable error message)
- Retry logic for external API calls (Gmail, Google Drive, Telegram)
- Job queue for async work (competitor research, marketing, video generation)

### 6.2 Security
- OAuth 2.1 for MCP clients (Claude, ChatGPT)
- Webhook secret validation (Telegram)
- Private D1 database (no public access)
- Env secrets never logged

### 6.3 Performance
- Vectorize hybrid search < 500ms
- Task add < 1s
- Briefing generation < 2 min (cron, off-peak)
- Chat response < 15s (smart) / < 5s (fast)

### 6.4 Scalability (Future)
- Multi-user support (future)
- Sharding by user (Vectorize)
- Rate limiting per user
- Cost optimization (model selection by task complexity)

---

## 7. Out of Scope (Future Releases)

- [ ] WhatsApp integration
- [ ] Slack integration
- [ ] Google Calendar deep integration (read/write events)
- [ ] Expense tracking
- [ ] Custom agent creation UI
- [ ] Workflow automation (if X then Y)
- [ ] Mobile app (native iOS/Android)
- [ ] Voice call support
- [ ] Video meeting integration (Zoom, Teams)
- [ ] Self-hosted deployment (currently Cloudflare-only)

---

## 8. Success Criteria

Product is successful if:

1. ✅ Bot responds to all user messages < 15 seconds
2. ✅ Tasks are saved accurately (100% successful add_task calls)
3. ✅ Daily briefing arrives on time (07:00 & 21:00)
4. ✅ Memory search returns relevant results (top 3 hits)
5. ✅ Competitor research completes daily (async)
6. ✅ Marketing requests are delegated & completed < 1 hour
7. ✅ No data loss (D1 backups working)
8. ✅ User preferences are remembered across sessions
9. ✅ Claude can access user memory via MCP
10. ✅ <1 error per 100 messages

---

## 9. Appendix: Tool Reference

See [AGENTS.md](./AGENTS.md) for full tool definitions.

Key tools:
- **Chat/Task:** `add_task`, `list_tasks`, `update_task`, `propose_tasks`
- **Memory:** `search_memory`, `save_note`, `remember_fact`
- **Email/Drive:** `gmail_search`, `gmail_draft`, `drive_search`, `drive_save`
- **Marketing:** `delegate_marketing`
- **Competitor:** `import_ads`, `create_report`
- **Studio:** `start_studio_session`, `process_studio_stage`

