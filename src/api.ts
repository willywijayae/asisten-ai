import type { Env } from "./env";
import * as db from "./db";
import { runAgent } from "./agent";
import { isLoggedIn, logout, requestCode, sessionCookie, verifyCode } from "./auth";
import { sendBriefing } from "./briefing";
import { Telegram } from "./telegram";
import * as google from "./google";
import * as profile from "./profile";
import { localDayRange, localToUtc } from "./time";
import { officeState } from "./activity";
import * as memory from "./memory";
import { weeklyReview } from "./ceo";
import * as competitors from "./competitors";

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

export async function handleApi(req: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  try {
    return await route(req, env, url, ctx);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("API error", err);
    return json({ error: "Terjadi kesalahan di server" }, 500);
  }
}

async function route(req: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
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

  // Callback OAuth Google: datang dari redirect lintas situs (cookie Strict tidak ikut),
  // jadi divalidasi dengan state sekali pakai yang dibuat saat pemilik yang login menekan "Hubungkan".
  if (path === "/google/callback" && method === "GET") {
    const back = (params: Record<string, string>) =>
      Response.redirect(`${url.origin}/sistem?${new URLSearchParams(params)}`, 302);
    const err = url.searchParams.get("error");
    if (err) return back({ google: "error", message: err === "access_denied" ? "Akses tidak diizinkan" : err });
    try {
      const email = await google.handleCallback(env, url.origin, url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
      return back({ google: "ok", email });
    } catch (e) {
      return back({ google: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Hasil scan iklan kompetitor dari luar website (mis. tugas terjadwal Claude), pakai kunci rahasia.
  // Hasil scan iklan kompetitor dari luar website (tugas terjadwal Claude, halaman impor), pakai kunci rahasia.
  // Versi dengan sesi login: POST /competitors/import (di bawah).
  if (path === "/competitors/ingest" && method === "POST") {
    const key = req.headers.get("x-ingest-key") ?? "";
    const enc = new TextEncoder();
    const ok =
      !!env.INGEST_KEY &&
      key.length === env.INGEST_KEY.length &&
      crypto.subtle.timingSafeEqual(enc.encode(key), enc.encode(env.INGEST_KEY));
    if (!ok) throw new HttpError(403, "Kunci salah");
    return json(await ingestScans(env, ctx, await readJson(req), "jadwal"));
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

  // --- Kantor 3D: status tiap agen + aktivitas terbaru + angka untuk papan tugas ---
  if (path === "/office" && method === "GET") {
    const now = new Date().toISOString();
    const [todayStart] = localDayRange(env.TIMEZONE_OFFSET, 0);
    const [state, counts] = await Promise.all([
      officeState(env, todayStart),
      env.DB.prepare(
        `SELECT
           sum(status = 'open') AS open,
           sum(status = 'pending') AS pending,
           sum(status = 'open' AND due_at IS NOT NULL AND due_at < ?1) AS overdue,
           sum(status = 'done' AND done_at >= ?2) AS doneToday,
           (SELECT count(*) FROM notes) AS notes,
           (SELECT count(*) FROM notes WHERE (', ' || coalesce(tags, '') || ',') LIKE '%, marketing,%') AS marketing,
           (SELECT count(*) FROM notes WHERE (', ' || coalesce(tags, '') || ',') LIKE '%, marketing,%' AND created_at >= ?2) AS marketingToday,
           (SELECT count(*) FROM memories) AS memories
         FROM tasks`,
      )
        .bind(now, todayStart)
        .first<Record<string, number | null>>(),
    ]);
    return json({
      now,
      ...state,
      counts: {
        open: counts?.open ?? 0,
        pending: counts?.pending ?? 0,
        overdue: counts?.overdue ?? 0,
        doneToday: counts?.doneToday ?? 0,
        notes: counts?.notes ?? 0,
        marketing: counts?.marketing ?? 0,
        marketingToday: counts?.marketingToday ?? 0,
        memories: counts?.memories ?? 0,
      },
      focus: await profile.getFocus(env),
      models: { haiku: env.MODEL_FAST, opus: env.MODEL_SMART, gemma: env.FALLBACK_MODEL },
      puterConnected: !!env.PUTER_AUTH_TOKEN,
      timezone: env.TIMEZONE_OFFSET,
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
    const notes = await memory.searchNotesHybrid(
      env,
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
    await memory.indexNote(env, id);
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
      await memory.indexNote(env, id);
      return json({ note: await db.getNote(env.DB, id) });
    }
    if (method === "DELETE") {
      if (!(await db.deleteNote(env.DB, id))) throw new HttpError(404, "Catatan tidak ditemukan");
      await memory.unindexNote(env, id);
      return json({ ok: true });
    }
  }

  // --- Riset kompetitor (Meta Ad Library) ---
  if (path === "/competitors" && method === "GET") return json(await competitors.summary(env));
  if (path === "/competitors/ads" && method === "GET") {
    const p = url.searchParams;
    return json({
      ads: await competitors.listAds(env, {
        page: p.get("page") || undefined,
        angle: p.get("angle") || undefined,
        active: p.get("active") === "1",
        q: p.get("q")?.trim() || undefined,
        sort: p.get("sort") || undefined,
        limit: Number(p.get("limit")) || 100,
      }),
    });
  }
  if (path === "/competitors/watch" && method === "POST") {
    const b = await readJson(req);
    try {
      await competitors.addWatch(env, { kind: String(b.kind), value: String(b.value ?? ""), label: b.label, country: b.country });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    return json({ ok: true }, 201);
  }
  const watchMatch = /^\/competitors\/watch\/(\d+)$/.exec(path);
  if (watchMatch && method === "DELETE") {
    if (!(await competitors.deleteWatch(env, Number(watchMatch[1])))) throw new HttpError(404, "Tidak ditemukan");
    return json({ ok: true });
  }
  if (path === "/competitors/import" && method === "POST") return json(await ingestScans(env, ctx, await readJson(req), "browser"));
  if (path === "/competitors/score" && method === "POST") return json(await competitors.scorePending(env));
  if (path === "/competitors/media/save" && method === "POST") return json(await competitors.saveMedia(env));
  const mediaMatch = /^\/competitors\/media\/(\d+)\/(\d+)\/(image|poster|video)$/.exec(path);
  if (mediaMatch && method === "GET") {
    return competitors.serveMedia(env, mediaMatch[1], Number(mediaMatch[2]), mediaMatch[3] as "image" | "poster" | "video", req);
  }
  if (path === "/competitors/reports" && method === "GET") return json({ reports: await competitors.listReports(env) });
  if (path === "/competitors/reports" && method === "POST") {
    const { query } = await readJson(req);
    try {
      return json({ id: await competitors.generateReport(env, query ? String(query) : undefined) }, 201);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  const reportMatch = /^\/competitors\/reports\/(\d+)$/.exec(path);
  if (reportMatch && method === "GET") {
    const r = await competitors.getReport(env, Number(reportMatch[1]));
    if (!r) throw new HttpError(404, "Laporan tidak ditemukan");
    return json(r);
  }
  if (path === "/competitors/analyze" && method === "POST") {
    const { page } = await readJson(req);
    try {
      return json(await competitors.analyze(env, page ? String(page) : undefined));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }

  // --- Memori jangka panjang ---
  if (path === "/memories" && method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    const [memories, total] = await Promise.all([
      q ? memory.recallMemories(env, q, 30) : memory.listMemories(env, 300),
      env.DB.prepare("SELECT count(*) AS n FROM memories").first<{ n: number }>(),
    ]);
    return json({ memories, total: total?.n ?? 0 });
  }
  if (path === "/memories" && method === "POST") {
    const { content } = await readJson(req);
    if (String(content ?? "").trim().length < 5) throw new HttpError(400, "Tulis faktanya dulu");
    const res = await memory.addMemory(env, String(content), "manual");
    if (!res.id) throw new HttpError(409, `Sudah ada di memori: ${res.duplicateOf?.content ?? ""}`);
    return json({ id: res.id }, 201);
  }
  if (path === "/memories/reindex" && method === "POST") return json(await memory.reindexAll(env));
  const memMatch = /^\/memories\/(\d+)$/.exec(path);
  if (memMatch && method === "DELETE") {
    if (!(await memory.deleteMemory(env, Number(memMatch[1])))) throw new HttpError(404, "Memori tidak ditemukan");
    return json({ ok: true });
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
    if (text.toLowerCase().startsWith("/batal")) {
      const active = await profile.interviewActive(env);
      await profile.stopInterview(env);
      return json({ reply: active ? "Wawancara profil dibatalkan." : "Tidak ada yang sedang berjalan.", proposed: [] });
    }
    let input = text;
    if (text.toLowerCase().startsWith("/profil")) {
      await profile.startInterview(env);
      input = profile.INTERVIEW_KICKOFF;
    }
    const history = await db.getHistory(env.DB);
    const { text: reply, proposed, receipt, attachments } = await runAgent(env, [{ type: "text", text: input }], {
      source: "web",
      useTools: true,
      history,
    });
    await db.appendHistory(env.DB, "user", text);
    await db.appendHistory(env.DB, "assistant", reply);
    // Ambil fakta untuk memori jangka panjang setelah respons dikirim.
    if (input === text && !(await profile.interviewActive(env))) {
      ctx.waitUntil(memory.extractMemories(env, { user: text, reply, source: "web" }));
    }
    const tasks = (await Promise.all(proposed.map((id) => db.getTask(env.DB, id)))).filter(Boolean);
    return json({ reply: [reply, ...attachments].join("\n\n"), proposed: tasks, receipt });
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
      modelFast: env.MODEL_FAST,
      modelSmart: env.MODEL_SMART,
      fallbackModel: env.FALLBACK_MODEL,
      puterConnected: !!env.PUTER_AUTH_TOKEN,
      timezone: env.TIMEZONE_OFFSET,
    });
  }
  if (path === "/review" && method === "POST") {
    const { focus, noteId } = await weeklyReview(env);
    return json({ focus, noteId });
  }
  if (path === "/briefing" && method === "POST") {
    const { kind } = await readJson(req);
    await sendBriefing(env, kind === "evening" ? "evening" : "morning");
    return json({ ok: true });
  }
  // --- Profil & preferensi ---
  if (path === "/profile" && method === "GET") {
    const [p, preferences, interviewing] = await Promise.all([
      profile.getProfile(env),
      profile.listPreferences(env),
      profile.interviewActive(env),
    ]);
    return json({ ...p, preferences, interviewing });
  }
  if (path === "/profile" && method === "PATCH") {
    const b = await readJson(req);
    await profile.saveProfile(env, String(b.profile ?? ""));
    return json(await profile.getProfile(env));
  }
  if (path === "/preferences" && method === "POST") {
    const b = await readJson(req);
    if (!String(b.content ?? "").trim()) throw new HttpError(400, "Isi preferensi wajib diisi");
    const id = await profile.addPreference(env, String(b.content));
    return json({ id }, 201);
  }
  const prefMatch = /^\/preferences\/(\d+)$/.exec(path);
  if (prefMatch && method === "DELETE") {
    if (!(await profile.deletePreference(env, Number(prefMatch[1])))) throw new HttpError(404, "Preferensi tidak ditemukan");
    return json({ ok: true });
  }

  // --- Google (Gmail & Drive) ---
  if (path === "/google/status" && method === "GET") return json(await google.status(env));
  if (path === "/google/connect" && method === "GET") {
    if (!google.googleConfigured(env)) throw new HttpError(400, "GOOGLE_CLIENT_ID/SECRET belum diatur");
    return Response.redirect(await google.authUrl(env, url.origin), 302);
  }
  if (path === "/google/disconnect" && method === "POST") {
    await google.disconnect(env);
    return json({ ok: true });
  }

  if (path === "/history/clear" && method === "POST") {
    await db.clearHistory(env.DB);
    return json({ ok: true });
  }

  throw new HttpError(404, "Endpoint tidak ditemukan");
}

/** Simpan satu/lebih hasil scan (+ laporan opsional), lalu media & penilaian dicicil di latar belakang. */
async function ingestScans(env: Env, ctx: ExecutionContext, b: any, defaultSource: string) {
  const scans: { query?: string; country?: string; ads: unknown[] }[] = Array.isArray(b?.scans) ? b.scans : b?.ads ? [b] : [];
  const totals = { found: 0, added: 0, updated: 0, skipped: 0 };
  for (const s of scans.slice(0, 20)) {
    if (!Array.isArray(s.ads)) continue;
    const r = await competitors.ingestAds(env, { source: String(b.source ?? defaultSource), query: s.query, country: s.country, ads: s.ads });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
  }
  // Laporan bedah iklan dari Claude (opsional, dikirim bersama atau terpisah dari hasil scan).
  let reportId: number | null = null;
  if (b?.report?.data) {
    try {
      reportId = await competitors.saveReport(env, { title: String(b.report.title ?? ""), query: b.report.query, data: b.report.data, author: "claude" });
    } catch (e) {
      throw new HttpError(400, `Laporan tidak valid: ${e instanceof Error ? e.message : e}`);
    }
  }
  ctx.waitUntil(
    competitors
      .notifyScan(env, totals)
      .then(() => competitors.saveMedia(env))
      .then(() => competitors.scorePending(env, 15))
      .catch((err) => console.error("Pasca-ingest gagal", err)),
  );
  return { ...totals, reportId };
}
