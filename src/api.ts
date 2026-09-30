import type { Env } from "./env";
import * as db from "./db";
import { runAgent } from "./agent";
import { isLoggedIn, logout, requestCode, sessionCookie, verifyCode } from "./auth";
import { sendBriefing } from "./briefing";
import { Telegram } from "./telegram";
import { localDayRange, localToUtc } from "./time";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const STATUSES = ["pending", "open", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high"] as const;

/** Body tugas dari website: waktu dalam format lokal "YYYY-MM-DDTHH:mm", "" = kosongkan. */
function taskPatch(env: Env, b: any): Parameters<typeof db.updateTask>[2] {
  const patch: Parameters<typeof db.updateTask>[2] = {};
  if (b.title !== undefined) {
    if (!String(b.title).trim()) throw new HttpError(400, "Judul tidak boleh kosong");
    patch.title = String(b.title).trim();
  }
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
  if (b.person !== undefined) patch.person = b.person ? String(b.person) : null;
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, "Prioritas tidak valid");
    patch.priority = b.priority;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, "Status tidak valid");
    patch.status = b.status;
  }
  for (const [key, col] of [
    ["due", "due_at"],
    ["remind", "remind_at"],
  ] as const) {
    if (b[key] === undefined) continue;
    if (!b[key]) patch[col] = null;
    else {
      const iso = localToUtc(String(b[key]), env.TIMEZONE_OFFSET);
      if (!iso) throw new HttpError(400, `Format waktu ${key} tidak valid`);
      patch[col] = iso;
    }
  }
  return patch;
}

function rangeFilter(env: Env, range: string | null): db.TaskFilter {
  const tz = env.TIMEZONE_OFFSET;
  if (range === "today" || range === "tomorrow") {
    const [dueFrom, dueTo] = localDayRange(tz, range === "today" ? 0 : 1);
    return { dueFrom, dueTo };
  }
  if (range === "week") return { dueFrom: localDayRange(tz, 0)[0], dueTo: localDayRange(tz, 6)[1] };
  if (range === "overdue") return { overdueBefore: new Date().toISOString() };
  return {};
}

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body harus JSON");
  }
}

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    return await route(req, env, url);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("API error", err);
    return json({ error: "Terjadi kesalahan di server" }, 500);
  }
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;

  // Semua request yang mengubah data wajib JSON: form lintas situs tidak bisa mengirim ini tanpa CORS.
  if (method !== "GET" && !(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new HttpError(415, "Content-Type harus application/json");
  }

  // --- Auth (tanpa sesi) ---
  if (path === "/auth/request" && method === "POST") {
    const res = await requestCode(env);
    return res.ok ? json({ ok: true }) : json({ error: `Tunggu ${res.retryAfter} detik`, retryAfter: res.retryAfter }, 429);
  }
  if (path === "/auth/verify" && method === "POST") {
    const { code } = await readJson(req);
    const token = await verifyCode(env, String(code ?? ""));
    if (!token) throw new HttpError(401, "Kode salah atau sudah kedaluwarsa");
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }
  if (path === "/auth/logout" && method === "POST") {
    await logout(env, req);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(null) });
  }

  if (!(await isLoggedIn(env, req))) throw new HttpError(401, "Belum login");

  if (path === "/me") return json({ ok: true });

  if (path === "/summary" && method === "GET") {
    const now = new Date().toISOString();
    const [, todayEnd] = localDayRange(env.TIMEZONE_OFFSET, 0);
    const weekStart = localDayRange(env.TIMEZONE_OFFSET, -6)[0];
    const [today, overdue, pending, open, doneWeek, notes, noteCount] = await Promise.all([
      db.listTasks(env.DB, { statuses: ["open"], dueFrom: now, dueTo: todayEnd }),
      db.listTasks(env.DB, { statuses: ["open"], overdueBefore: now }),
      db.listTasks(env.DB, { statuses: ["pending"] }),
      db.listTasks(env.DB, { statuses: ["open"], limit: 500 }),
      db.listTasks(env.DB, { statuses: ["done"], doneFrom: weekStart, limit: 500 }),
      db.searchNotes(env.DB, "", 5),
      env.DB.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>(),
    ]);
    return json({
      counts: {
        open: open.length,
        today: today.length,
        overdue: overdue.length,
        pending: pending.length,
        doneWeek: doneWeek.length,
        notes: noteCount?.n ?? 0,
      },
      today,
      overdue,
      pending,
      recentNotes: notes,
    });
  }

  // --- Tugas ---
  if (path === "/tasks" && method === "GET") {
    const status = url.searchParams.get("status") ?? "open";
    const filter: db.TaskFilter = {
      ...rangeFilter(env, url.searchParams.get("range")),
      statuses: status === "all" ? undefined : [status as db.Task["status"]],
      limit: 500,
    };
    let tasks = await db.listTasks(env.DB, filter);
    const q = url.searchParams.get("q")?.toLowerCase().trim();
    if (q) tasks = tasks.filter((t) => [t.title, t.notes, t.person].some((v) => v?.toLowerCase().includes(q)));
    return json({ tasks });
  }
  if (path === "/tasks" && method === "POST") {
    const b = await readJson(req);
    const patch = taskPatch(env, { ...b, status: b.status ?? "open" });
    if (!patch.title) throw new HttpError(400, "Judul wajib diisi");
    const id = await db.addTask(env.DB, { ...patch, title: patch.title, source: "web" });
    return json({ task: await db.getTask(env.DB, id) }, 201);
  }
  const taskMatch = /^\/tasks\/(\d+)$/.exec(path);
  if (taskMatch) {
    const id = Number(taskMatch[1]);
    if (method === "PATCH") {
      if (!(await db.getTask(env.DB, id))) throw new HttpError(404, "Tugas tidak ditemukan");
      await db.updateTask(env.DB, id, taskPatch(env, await readJson(req)));
      return json({ task: await db.getTask(env.DB, id) });
    }
    if (method === "DELETE") {
      if (!(await db.deleteTask(env.DB, id))) throw new HttpError(404, "Tugas tidak ditemukan");
      return json({ ok: true });
    }
  }

  // --- Catatan (second brain) ---
  if (path === "/notes" && method === "GET") {
    const notes = await db.searchNotes(
      env.DB,
      url.searchParams.get("q") ?? "",
      Math.min(Number(url.searchParams.get("limit") ?? 200), 500),
      url.searchParams.get("tag") || undefined,
    );
    return json({ notes });
  }
  if (path === "/notes/tags" && method === "GET") return json({ tags: await db.noteTags(env.DB) });
  if (path === "/notes" && method === "POST") {
    const b = await readJson(req);
    if (!String(b.content ?? "").trim()) throw new HttpError(400, "Isi catatan wajib diisi");
    const id = await db.addNote(env.DB, { content: String(b.content), title: b.title, tags: b.tags });
    return json({ note: await db.getNote(env.DB, id) }, 201);
  }
  const noteMatch = /^\/notes\/(\d+)$/.exec(path);
  if (noteMatch) {
    const id = Number(noteMatch[1]);
    if (method === "PATCH") {
      const b = await readJson(req);
      if (b.content !== undefined && !String(b.content).trim()) throw new HttpError(400, "Isi catatan wajib diisi");
      if (!(await db.getNote(env.DB, id))) throw new HttpError(404, "Catatan tidak ditemukan");
      await db.updateNote(env.DB, id, { content: b.content, title: b.title, tags: b.tags });
      return json({ note: await db.getNote(env.DB, id) });
    }
    if (method === "DELETE") {
      if (!(await db.deleteNote(env.DB, id))) throw new HttpError(404, "Catatan tidak ditemukan");
      return json({ ok: true });
    }
  }

  // --- Riwayat & chat ---
  if (path === "/history" && method === "GET") {
    const before = Number(url.searchParams.get("before")) || null;
    return json({ messages: await db.historyPage(env.DB, before, 50) });
  }
  if (path === "/chat" && method === "POST") {
    const { message } = await readJson(req);
    const text = String(message ?? "").trim();
    if (!text) throw new HttpError(400, "Pesan kosong");
    const history = await db.getHistory(env.DB);
    const { text: reply, proposed } = await runAgent(env, [{ type: "text", text }], {
      source: "web",
      useTools: true,
      history,
    });
    await db.appendHistory(env.DB, "user", text);
    await db.appendHistory(env.DB, "assistant", reply);
    const tasks = (await Promise.all(proposed.map((id) => db.getTask(env.DB, id)))).filter(Boolean);
    return json({ reply, proposed: tasks });
  }

  // --- Sistem ---
  if (path === "/system" && method === "GET") {
    const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
    const [bot, webhook] = await Promise.all([
      tg.call<{ username: string }>("getMe", {}).catch(() => null),
      tg.call<{ pending_update_count: number; last_error_message?: string; last_error_date?: number }>(
        "getWebhookInfo",
        {},
      ).catch(() => null),
    ]);
    return json({
      bot: bot ? `@${bot.username}` : null,
      webhook: webhook && {
        pending: webhook.pending_update_count,
        lastError: webhook.last_error_message ?? null,
        lastErrorAt: webhook.last_error_date ? new Date(webhook.last_error_date * 1000).toISOString() : null,
      },
      model: env.MODEL,
      fallbackModel: env.FALLBACK_MODEL,
      puterConnected: !!env.PUTER_AUTH_TOKEN,
      timezone: env.TIMEZONE_OFFSET,
    });
  }
  if (path === "/briefing" && method === "POST") {
    const { kind } = await readJson(req);
    await sendBriefing(env, kind === "evening" ? "evening" : "morning");
    return json({ ok: true });
  }
  if (path === "/history/clear" && method === "POST") {
    await db.clearHistory(env.DB);
    return json({ ok: true });
  }

  throw new HttpError(404, "Endpoint tidak ditemukan");
}
