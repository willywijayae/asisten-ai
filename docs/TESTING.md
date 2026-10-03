# Testing Strategy & Test Cases

## 1. Test Pyramid

```
         ▲
        /|\
       / | \           E2E (10%)
      /  |  \          - Full chat flow
     /   |   \         - Task + briefing
    /    |    \        - Competitor research
   /     |     \
  /______|______\      Integration (30%)
 /        |      \     - Agent tools
/________|_______\     - DB queries
          |            - API endpoints
      Unit (60%)
      - DB helpers
      - Formatters
      - Validators
```

---

## 2. Unit Tests

### 2.1 Database Helpers (db.ts)

**Test:** `addTask()`
```typescript
describe("addTask", () => {
  it("should insert task with correct fields", async () => {
    const task = await addTask(db, "user-1", {
      title: "Test task",
      due: "2026-10-04 14:00"
    });
    
    expect(task.id).toBeDefined();
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("open");
  });

  it("should reject duplicate task", async () => {
    await addTask(db, "user-1", { title: "Test" });
    
    expect(() => addTask(db, "user-1", { title: "Test" }))
      .toThrow("duplicate");
  });

  it("should format due_at correctly", async () => {
    const task = await addTask(db, "user-1", {
      title: "Test",
      due: "2026-10-04 14:00"
    });
    
    expect(new Date(task.due_at).getHours()).toBe(14);
  });
});
```

**Test:** `listTasks()`
```typescript
describe("listTasks", () => {
  it("should filter by status", async () => {
    await addTask(db, "user-1", { title: "Open" });
    // ... create pending & done tasks

    const tasks = await listTasks(db, "user-1", { status: "open" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("open");
  });

  it("should filter by date range", async () => {
    // Create tasks for different dates
    const tasks = await listTasks(db, "user-1", { range: "today" });
    // Verify all are from today
  });

  it("should sort by due date ascending", async () => {
    // Create unsorted tasks
    const tasks = await listTasks(db, "user-1", {});
    expect(tasks[0].due_at).toBeLessThanOrEqual(tasks[1].due_at);
  });
});
```

### 2.2 Time Utilities (time.ts)

**Test:** `localToUtc()` & `offsetMinutes()`
```typescript
describe("time utilities", () => {
  it("should convert local to UTC correctly", () => {
    const offset = offsetMinutes("+07:00");
    const local = "2026-10-04 14:00";
    const utc = localToUtc(local, offset);
    
    expect(utc).toBe("2026-10-04T07:00:00Z");  // 14:00 +07:00 → 07:00 UTC
  });

  it("should handle negative offset", () => {
    const offset = offsetMinutes("-05:00");
    const utc = localToUtc("2026-10-04 10:00", offset);
    
    expect(utc).toBe("2026-10-04T15:00:00Z");  // 10:00 -05:00 → 15:00 UTC
  });
});
```

### 2.3 Activity Helpers (activity.ts)

**Test:** `logActivity()` & `clip()`
```typescript
describe("activity", () => {
  it("should log activity with correct kind", async () => {
    await logActivity(env, "user-1", "task_completed", { taskId: "123" });
    
    // Verify in DB
    const activity = await db.query(
      "SELECT * FROM activity WHERE kind = ?",
      ["task_completed"]
    );
    expect(activity.length).toBeGreaterThan(0);
  });

  it("should clip old activity", async () => {
    // Insert old activity (> 24h)
    await logActivity(env, "user-1", "test", {}, "2026-10-01T12:00:00Z");
    
    const pruned = await pruneActivity(env);
    expect(pruned).toBeGreaterThan(0);
  });
});
```

---

## 3. Integration Tests

### 3.1 Agent Tools

**Test:** `add_task` tool
```typescript
describe("Agent: add_task", () => {
  it("should extract datetime from natural language", async () => {
    const context = {
      user_id: "user-1",
      tools: TOOLS,
      model: "claude",
      now: "2026-10-03T16:00:00Z"
    };

    const response = await runAgent(context, {
      content: "Ingetin aku meeting Budi Jumat jam 2 siang"
    });

    // Verify tool was called
    expect(response.tool_calls).toContainEqual({
      name: "add_task",
      arguments: expect.objectContaining({
        title: expect.stringMatching(/Budi|meeting/i),
        due: "2026-10-04 14:00"
      })
    });

    // Verify DB insert
    const tasks = await listTasks(env.DB, "user-1", {});
    expect(tasks).toContainEqual(
      expect.objectContaining({ title: expect.stringMatching(/Budi/) })
    );
  });

  it("should propose tasks for forwarded messages", async () => {
    const response = await runAgent(context, {
      content: "[Forwarded] Budi: Meeting Senin 10 pagi?"
    });

    // Should use propose_tasks, not add_task
    expect(response.tool_calls[0].name).toBe("propose_tasks");
  });
});
```

**Test:** `search_memory` tool
```typescript
describe("Agent: search_memory", () => {
  it("should find fact by semantic similarity", async () => {
    // Setup: save a memory
    await saveFact(env, "user-1", "WiFi password at top right drawer");

    const response = await runAgent(context, {
      content: "Where's the WiFi password at office?"
    });

    expect(response.text).toContainEqual(
      expect.stringMatching(/drawer|wifi/i)
    );
  });

  it("should return empty if no matches", async () => {
    const response = await runAgent(context, {
      content: "Tell me about the coffee machine"
    });

    expect(response.text).toContainEqual(/tidak ketemu|don't remember/i);
  });
});
```

### 3.2 API Endpoints

**Test:** `POST /api/task`
```typescript
describe("API: POST /api/task", () => {
  it("should create task and return 201", async () => {
    const response = await fetch("https://test.local/api/task", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        title: "Test task",
        due: "2026-10-04 14:00",
        priority: "high"
      })
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeDefined();
  });

  it("should validate required fields", async () => {
    const response = await fetch("https://test.local/api/task", {
      method: "POST",
      body: JSON.stringify({ due: "2026-10-04" })  // Missing title
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("missing_field");
  });
});
```

**Test:** `GET /api/summary`
```typescript
describe("API: GET /api/summary", () => {
  it("should return correct counts", async () => {
    // Setup: create 3 open, 2 pending, 1 done, 1 overdue
    await setupTestData();

    const response = await fetch("https://test.local/api/summary", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await response.json();
    expect(data.counts.open_tasks).toBe(3);
    expect(data.counts.pending_tasks).toBe(2);
    expect(data.counts.overdue_tasks).toBe(1);
  });
});
```

### 3.3 Queue Processing

**Test:** Telegram message processing
```typescript
describe("Queue: Telegram update", () => {
  it("should process update and send reply", async () => {
    const update: TgUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_CHAT_ID },
        from: { id: OWNER_CHAT_ID, is_bot: false },
        text: "Ingetin aku tugas"
      }
    };

    await handleUpdate(env, update);

    // Verify DB insert
    const tasks = await listTasks(env.DB, OWNER_CHAT_ID, {});
    expect(tasks.length).toBeGreaterThan(0);

    // Verify Telegram reply sent (mock check)
    expect(telegramMock.sendCalled).toBe(true);
  });

  it("should reject non-owner messages", async () => {
    const update: TgUpdate = {
      update_id: 2,
      message: {
        chat: { id: 999 },  // Not owner
        text: "Halo"
      }
    };

    await handleUpdate(env, update);

    // Should not process
    expect(agentMock.runCalled).toBe(false);
  });
});
```

---

## 4. End-to-End Tests

### 4.1 Full Chat + Task Flow

```typescript
describe("E2E: Chat → Task → Briefing", () => {
  it("should complete full workflow", async () => {
    // 1. User sends message
    const msg = "Ingetin aku interview Ratna Jumat jam 2, kirim portfolio dulu";
    await sendTelegramMessage(OWNER_CHAT_ID, msg);

    // 2. Bot replies (confirmation)
    const reply = await waitForTelegramReply(5000);
    expect(reply).toMatch(/Interview Ratna|Jumat/i);

    // 3. Task saved in DB
    const tasks = await listTasks(env.DB, OWNER_CHAT_ID, {});
    expect(tasks).toContainEqual(
      expect.objectContaining({
        title: expect.stringMatching(/Interview|Ratna/i),
        due_at: "2026-10-04T14:00:00Z"
      })
    );

    // 4. Scheduled briefing includes this task
    const briefing = await runScheduledBriefing(env, "morning");
    expect(briefing).toMatch(/Interview Ratna/i);
  });
});
```

### 4.2 Competitor Research Flow

```typescript
describe("E2E: Competitor Research", () => {
  it("should complete from request to report", async () => {
    // 1. User requests
    await sendTelegramMessage(
      OWNER_CHAT_ID,
      "Analisis iklan Novia di Meta"
    );

    // 2. Bot acknowledges
    const ack = await waitForTelegramReply(2000);
    expect(ack).toMatch(/mulai.*analisa|background/i);

    // 3. Async job runs (mock 5s)
    await sleep(5000);

    // 4. Report saved in DB
    const report = await getLatestReport(env.DB, OWNER_CHAT_ID);
    expect(report.brand).toBe("Novia");
    expect(report.ads.length).toBeGreaterThan(0);

    // 5. Briefing includes insights
    const briefing = await runScheduledBriefing(env, "evening");
    expect(briefing).toMatch(/Novia|competitor/i);
  });
});
```

---

## 5. Manual Testing Checklist

### 5.1 Chat & Tasks

- [ ] Send message → bot replies within 5s
- [ ] "Ingetin aku X Jumat 14:00" → task created with correct date
- [ ] "/tugas" → list shows all open tasks sorted by due date
- [ ] Click task in web UI → mark done
- [ ] "Batalkan" → cancel task from Telegram
- [ ] Edit task → update in DB immediately

### 5.2 Memory & Search

- [ ] "Catat bahwa..." → saves note
- [ ] Search note → returns in < 500ms
- [ ] "Apa aku pernah catat..." → finds relevant memory
- [ ] Preferences remembered across sessions

### 5.3 Briefing

- [ ] Morning briefing arrives at 07:00
- [ ] Lists today's tasks + calendar
- [ ] Evening briefing arrives at 14:00
- [ ] Recap shows completed tasks

### 5.4 Webhook & Telegram

- [ ] Bot responds to message within 5s
- [ ] Forwarded message → proposes tasks with buttons
- [ ] Click button → task added or rejected
- [ ] `/status` → shows bot + webhook health
- [ ] `/setup` → re-registers webhook

### 5.5 Errors

- [ ] Kill Hermes API → fallback to Gemma
- [ ] D1 connection error → graceful error message
- [ ] Task duplicate → error message + suggestion
- [ ] Network timeout → bot retries

---

## 6. Performance Benchmarks

| Operation | Target | Test Method |
|-----------|--------|-------------|
| Chat response | < 15s | Send message, measure reply time |
| Task add | < 1s | POST /api/task, measure latency |
| Memory search | < 500ms | GET /api/memory/search, measure latency |
| Briefing generation | < 2 min | Trigger cron, measure time |
| Competitor fetch | < 30s (async) | Import ads, check progress |

---

## 7. Coverage Goals

**Target:** 80% code coverage

**Priority:**
1. ✅ Core business logic (agent tools, DB helpers) — 95%+
2. ✅ API endpoints — 90%+
3. ⚠️ Error handling — 70%
4. ⚠️ Cron jobs — 60% (harder to test asynchronously)

---

## 8. Test Execution

**Run unit tests:**
```bash
npm test
```

**Run integration tests:**
```bash
npm run test:integration
```

**Run E2E tests (requires deployed Worker):**
```bash
npm run test:e2e
```

**Manual testing:**
- Open bot in Telegram
- Web UI at https://asisten-ai.willywijaya46.workers.dev
- Check logs: `journalctl --user -u hermes-gateway -f`

