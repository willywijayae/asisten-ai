# Application Flow & User Journeys

## 1. Core Interaction Model

```
User → Telegram bot
         ↓
      Webhook (POST /telegram)
         ↓
      Queue (async processing)
         ↓
      runAgent() [main agent]
         ↓
      Agent calls tools (add_task, search_memory, delegate_marketing, etc.)
         ↓
      D1 + Vectorize writes
         ↓
      Telegram reply message
```

**Key principle:** All messages are processed asynchronously via queue → tools are deterministic functions → side effects are explicit (database writes, message sends).

---

## 2. User Journey: Daily Task Management

### 2.1 Adding a Task

```
User (Telegram):
"Ingetin aku interview Ratna Jumat jam 2 siang"

→ Telegram webhook receives update
  update.message = {
    chat_id: 1001715052,
    text: "Ingetin aku interview Ratna...",
    date: 1728000000
  }

→ Queue consumer calls runAgent()
  
  Agent processes:
  - Extracts deadline: "Jumat jam 14:00" → datetime(local)
  - Recognize action: "ingetin aku" = add_task
  - Call tool: add_task({
      title: "Interview Ratna",
      due: "2026-10-04 14:00",  // Calculated from "Jumat"
      remind: "2026-10-04 13:00" // 60 min before
    })

→ Tool execution (db.ts):
  INSERT INTO tasks (user_id, title, due_at, remind_at, status)
  VALUES (1001715052, "Interview Ratna", ...)
  RETURNING id

→ Agent confirms:
  "Catat: Interview Ratna, Jumat 4 Oct 14:00. Diingetin jam 13:00. ✅"

→ Telegram.send(chatId, message)
```

### 2.2 Viewing Tasks

```
User: "/tugas"

→ Agent: list_tasks({ status: "open" })

→ DB query:
  SELECT id, title, due_at, priority
  FROM tasks
  WHERE user_id = 1001715052 AND status = 'open'
  ORDER BY due_at ASC

→ Format as:
  "1. Interview Ratna — Jumat 4 Oct 14:00 (HIGH)
   2. Kirim proposal ke Budi — Sat 5 Oct 18:00 (NORMAL)
   ..."

→ Telegram.send(chatId, formatted_list)
```

### 2.3 Marking Task Done

```
User: "Selesai interview"

→ Agent recognizes context (previous task "Interview Ratna")
  OR extract task ID from message

→ Agent: update_task(id, { status: "done" })

→ DB update:
  UPDATE tasks SET status = 'done', completed_at = NOW()
  WHERE id = 123

→ logActivity(chatId, "task_completed", { taskId: 123 })

→ Confirm: "✅ Interview Ratna — done"
```

---

## 3. User Journey: Forwarded Message (Extract Commitment)

```
User forwards WhatsApp chat excerpt:
"Budi: Kita meeting Senin 10 pagi?"
"Willy: Oke, deal"

→ Telegram message.text contains forwarded quote

→ Agent recognizes: forwarded message ≠ direct instruction
  → Use propose_tasks() instead of add_task()

→ Extract commitment:
  - Action: Meeting
  - Person: Budi
  - When: Monday 10:00 AM
  
→ Agent: propose_tasks([{
    title: "Meeting Budi",
    due: "2026-10-06 10:00",
    person: "Budi",
    notes: "From WhatsApp chat"
  }])

→ DB insert into `tasks` with status = 'pending'

→ Telegram reply with inline buttons:
  "Aku extract janji ini:
   📅 Meeting Budi — Senin 6 Oct 10:00
   
   [✅ Simpan] [❌ Buang]"

→ User clicks [✅ Simpan]
  → Callback query
  → update_task(id, { status: "open" })
  → React: "✅ Simpan tugas"

→ User clicks [❌ Buang]
  → update_task(id, { status: "cancelled" })
  → React: "❌ Tugas dibatalkan"
```

---

## 4. User Journey: Memory & Search

### 4.1 Save a Fact

```
User: "Catat bahwa password WiFi kantor ada di laci atas sebelah kanan"

→ Agent recognizes: "catat bahwa..." = save_note()

→ Agent: save_note({
  title: "WiFi password location",
  content: "Password WiFi kantor ada di laci atas sebelah kanan",
  tags: ["wifi", "kantor"]
})

→ DB insert:
  INSERT INTO notes (user_id, title, content, tags, created_at)
  VALUES (1001715052, ...)

→ Also auto-extract fact:
  remember_fact({
    fact: "WiFi password kantor location: top right drawer",
    importance: "medium"
  })
  → Vectorize embedding + store

→ Confirm: "✅ Catatan tersimpan"
```

### 4.2 Search Memory

```
User: "Apa aku pernah catat soal password WiFi kantor?"

→ Agent: search_memory("password WiFi kantor")

→ Vectorize hybrid search (semantic + keyword):
  SELECT * FROM memories
  WHERE user_id = 1001715052
  AND (
    MATCH(content, "password WiFi kantor")  // keyword
    OR vector_score(embedding, query_embedding) > 0.8  // semantic
  )
  LIMIT 5

→ Results:
  1. "WiFi password kantor location: top right drawer" (score: 0.95)
  2. "WiFi credentials written in blue notebook" (score: 0.72)

→ Agent: "Aku catat di laci atas sebelah kanan. Ada juga di blue notebook."
```

---

## 5. User Journey: Automated Briefing

```
SCHEDULED EVENT: 07:00 UTC+7 (event.cron = "0 0 * * *")

→ Worker scheduled() function triggered

→ sendBriefing(env, "morning") called

→ Gather data:
  - list_tasks({ range: "today", status: "open" })
  - Extract birthdays from memories
  - Google Calendar events (if connected)
  - Yesterday activity log

→ Generate briefing with Claude:
  SYSTEM: "Kamu adalah briefer pagi yang menyenangkan"
  CONTEXT: today's tasks, calendar, reminders
  PROMPT: "Buatkan briefing pagi singkat (< 5 menit baca)"

→ Format result:
  "🌅 Selamat pagi Willy!
  
  📋 Hari ini:
  • Interview Ratna — 14:00 (2 jam)
  • Submit proposal — 18:00
  • Dinner dengan Maya — 19:30
  
  🎂 Ulang tahun: (none)
  
  💡 Insight: Hari ramai, fokus ke interview dulu.
  
  Semangat! 🚀"

→ Telegram.send(OWNER_CHAT_ID, briefing_message)
```

---

## 6. User Journey: Marketing Request (Async Delegation)

```
User: "Bikinin 5 hook video untuk produk skincare aku, angle 'perut buncit hormonal'"

→ Agent recognizes MARKETING request
  → Use delegate_marketing()

→ Agent: delegate_marketing({
  request: "5 hooks untuk produk skincare, angle 'perut buncit hormonal'",
  context: {
    product: "skincare",
    angle: "perut buncit hormonal",
    count: 5
  }
})

→ Backend:
  - Queue job: type="marketing", request_id=UUID
  - Worker sends task to Hermes CEO agent
  - CEO reads memory (product details, target audience)
  - CEO delegates to Content Specialist:
    "Generate 5 video hooks: problem (perut buncit), agitation (hormonal), solution (skincare)"

→ Content Specialist generates:
  1. "Hormon turun, perut membuncit? Ini solusinya..." (problem-agitation-solution)
  2. "Cewek modern, perut ideal tanpa diet ketat..." (lifestyle)
  3. "Dermatologist tested: goodbye perut hormonal..." (authority/testimonial)
  4. Etc.

→ Results stored in job queue result
  → Sent back to main agent

→ Main agent (chief of staff) receives result:
  → Sends to Telegram with full output

→ User (Telegram):
  "✅ Lima hook ready! Lihat detail di link ini: [hook details]
  
  Bisa langsung dipake untuk video. Butuh script atau storyboard?"
```

---

## 7. User Journey: Competitor Research

```
User: "Analisis iklan Novia di Meta Ad Library"

→ Agent: import_ads({
  brand: "Novia",
  platform: "meta",
  limit: 30
})

→ Backend:
  - Queue async job: type="remix", remixId="..."
  - Fetches Novia ads from Meta Ad Library
  - Downloads media (images, videos)
  - Scores each ad (hook strength, CTA clarity, etc.)
  - Stores in report_data table

→ Agent reply (immediate):
  "✅ Aku mulai analisa iklan Novia. 
  Download media + scoring akan jalan di background.
  Hasilnya kirim kesini besok atau minggu depan."

→ Later (async job completes):
  - Generate competitor report
  - Send comprehensive analysis to Telegram:
    "📊 Novia Competitor Analysis
    
    📈 Creative trends:
    - 80% use testimonial angle
    - Video hooks: 3-5 detik problem statement
    - CTA: WhatsApp link (strong urgency)
    
    🎬 Top performers:
    1. [Video] 'Perut buncit karena hormon?' — 150K views, engagement rate 8.2%
    2. [Image] Lifestyle transformation — 82K likes, 2.1K shares
    
    💡 Insights:
    - Strong community building (replies enabled)
    - Personal testimonials outperform product shots
    - Urgency + scarcity used in every ad
    
    🎯 Gaps:
    - No educational content
    - Limited value-first approach
    - Weak follow-up sequence
    
    Rekomendasi: Combine Novia's urgency + value-first education angle."

→ User can request follow-up:
  "Bikinin copy iklan dengan angle value-first tapi urgency tinggi"
  → Delegate to Marketing team
```

---

## 8. User Journey: Telegram Inline Buttons (Approval)

```
Agent proposes tasks:
  propose_tasks([
    { title: "Meeting Budi", due: "2026-10-06 10:00" },
    { title: "Submit proposal", due: "2026-10-07 18:00" }
  ])

→ Store in DB with status = 'pending'

→ Send Telegram message with inline buttons:
  
  "Aku extract 2 tugas dari chat kamu:
  
  1️⃣ Meeting Budi — Senin 6 Oct 10:00
     [✅ Simpan] [❌ Buang]
  
  2️⃣ Submit proposal — Selasa 7 Oct 18:00
     [✅ Simpan] [❌ Buang]"

→ User clicks [✅ Simpan] on task 1

→ Telegram CallbackQuery:
  {
    callback_query_id: "...",
    from: { id: 1001715052, ... },
    message: { message_id: 123, ... },
    data: "approve_task_1"
  }

→ Agent handles callback:
  - Extract task_1 ID
  - update_task(id, { status: "open" })
  - Edit message: "✅ Simpan: Meeting Budi"

→ User clicks [❌ Buang] on task 2

→ Agent:
  - update_task(id, { status: "cancelled" })
  - Edit message: "❌ Batalkan: Submit proposal"
```

---

## 9. Cron-Driven Flows

### 9.1 Every 5 Minutes (`*/5 * * * *`)

```
→ sendReminders(env)
  - Query reminders due in next 5 min
  - Send Telegram message for each
  - Mark as "reminded"

→ saveMedia(env, 12)
  - Download up to 12 pending media items
  - Store in KV
  - Update media table

→ scorePending(env, 12)
  - Score up to 12 pending ads
  - Update report_data with scores
```

### 9.2 Nightly (`0 0 * * *` = 00:00 UTC+7)

```
→ pruneActivity(env)
  - Delete activity log older than 24h
  - Archive old media links

→ sendBriefing(env, "morning")
  - Gather today's tasks
  - Generate morning briefing
  - Send to Telegram
```

### 9.3 Evening (`0 14 * * *` = 14:00 UTC+7)

```
→ sendBriefing(env, "evening")
  - Recap completed tasks
  - Show pending approvals
  - Evening summary
```

### 9.4 Weekly (`0 13 * * SUN` = 13:00 UTC+7 Sunday)

```
→ weeklyReview(env)
  - CEO agent analyzes week
  - Extract patterns (productivity, focus areas)
  - Generate insights
  - Send comprehensive review
```

---

## 10. Web UI Navigation Flow

```
/login
  ↓ [Login with auth token]
  ↓
/dashboard (default home)
  ├─ Sidebar: Asisten (Beranda, Kantor 3D, Tugas, Second Brain, Chat, Profil)
  ├─ Sidebar: Marketing (Riset Kompetitor, Studio Konten, Paid Ads)
  ├─ Sidebar: Lainnya (Sistem)
  ├─ Mobile: Bottom nav (same items)
  
/tugas
  ├─ List open/pending/done tasks
  ├─ Filter by date (today, week, overdue)
  ├─ Inline buttons: Selesai, Edit, Hapus
  └─ [+ Tambah Tugas]

/catatan (Second Brain)
  ├─ List all notes
  ├─ Search bar (hybrid search)
  ├─ Click note → view/edit
  └─ [+ Tambah Catatan]

/chat
  ├─ Chat interface (messages flow)
  ├─ Input field (type & send)
  └─ Auto-scroll to latest

/kompetitor
  ├─ Reports list
  ├─ Click report → view analysis + media grid
  └─ [+ Import Iklan]

/studio
  ├─ Projects list
  ├─ Click project → stages (avatar, product, hooks, script)
  ├─ Stage editor (fill form → generate)
  └─ [+ Buat Project]

/paid-ads (NEW)
  ├─ Tab: Google Ads (guide + tool list + prompts)
  ├─ Tab: Meta Ads (guide + tool list + prompts)
  └─ [Links to external MCP connector]

/profil
  ├─ User info (name, preferences)
  ├─ Linked accounts (Gmail, Google Drive)
  └─ [Edit Preferences]

/sistem
  ├─ Logs
  ├─ Webhook status
  ├─ Database stats
  └─ [Reset conversation]
```

---

## 11. Error Recovery Flows

### 11.1 Telegram Webhook Failure

```
Telegram sends update → Webhook POST times out

→ Telegram retries (up to 30s)

→ If persistent:
  - Update accumulated in Telegram's queue
  - Manual fix: /status endpoint shows pending count
  - User: call /setup to re-register webhook

→ Worker error reply to user:
  "⚠️ Maaf, pesan terakhir gagal diproses.
   Silakan coba kirim lagi."
```

### 11.2 Hermes API Down

```
Agent tries: fetch(HERMES_API_ENDPOINT)

→ Connection refused

→ Fallback to Workers AI (Gemma model)

→ Reply: "Otak AI sedang sibuk, pakai mode simple."

→ Can still:
  - add_task (deterministic)
  - list_tasks (DB read)
  - save_note

→ Cannot:
  - Complex reasoning (marketing strategy)
  - Natural language understanding
```

### 11.3 D1 Write Conflict

```
User sends two messages simultaneously:
  "Add tugas 1"
  "Add tugas 2"

→ Both processed in parallel via queue

→ If UNIQUE constraint violation:
  → Retry with new title (append timestamp)
  OR
  → Return error to user

→ User re-tries with clarification
```

---

## 12. State Transitions

### Task State Machine

```
        [open]
          ↓
    [pending] ← (needs approval)
          ↓
       [open] ← (approved or direct entry)
          ↓
      [done] ← (user marks complete)
    
    [open] → [cancelled] (user cancels)
    [pending] → [cancelled] (user rejects)
```

### Activity Lifecycle

```
[created] → (24h) → [auto-deleted/archived]
```

### Media Job State

```
[queued] → [downloading] → [downloaded] → [scored] → [complete]
   ↓                          ↓
  [error] → (retry) ────────────
```

