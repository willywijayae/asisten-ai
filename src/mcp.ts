import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Env } from "./env";
import * as db from "./db";
import * as profile from "./profile";
import { executeTool, receipt, type RunContext } from "./agent";
import { Telegram } from "./telegram";
import { logTool } from "./activity";
import * as memory from "./memory";
import * as competitors from "./competitors";
import * as meta from "./meta";
import { localDayRange, nowContext } from "./time";

// Server MCP "Second Brain": membuka tugas, catatan, profil & preferensi pemilik ke Claude
// (atau klien MCP lain). Hanya bisa diakses dengan token OAuth yang disetujui pemilik.

const INSTRUCTIONS = (owner: string) => `Second Brain milik ${owner}: tugas/pengingat, catatan, profil, dan preferensi. Data yang sama dipakai bot Telegram & website adminnya.
- Semua waktu dalam WIB (UTC+07:00). Isi waktu dengan format lokal "YYYY-MM-DD HH:mm"; kalau cuma tanggal, dianggap 09:00.
- "remind" = kapan bot Telegram mengirim pengingat. Kosong = 60 menit sebelum "due".
- Baca get_profile di awal untuk memahami pemilik, dan patuhi preferensinya.
- search_memory berisi fakta jangka panjang yang dikumpulkan dari obrolan (dengan tanggal; yang terbaru biasanya berlaku). Pakai remember_fact untuk menyimpan fakta penting baru tentang pemilik, timnya, atau bisnisnya.
- Sebelum menambah tugas, cek list_tasks supaya tidak dobel. Tambah beberapa tugas sekaligus dengan add_tasks.
- Setiap perubahan dikabarkan ke Telegram pemilik sebagai bukti.
- Riset kompetitor: ambil daftar pantauan dengan get_competitor_watchlist. Kalau kamu punya browser, buka halaman Ad Library per kata kunci (urut impresi) dan jalankan ekstraktor dari get_competitor_watchlist supaya dapat gambar/video/duplikat/urutan impresi; kalau tidak, pakai ads_library_search (konektor Meta). Kirim hasilnya apa adanya dengan save_competitor_ads (satu panggilan per kata kunci/halaman). Untuk laporan bedah iklan yang lengkap, analisis lalu simpan dengan save_competitor_report.`;

const taskShape = {
  title: z.string().describe("Judul tugas singkat, diawali kata kerja."),
  due: z.string().optional().describe('Deadline, "YYYY-MM-DD HH:mm" WIB.'),
  remind: z.string().optional().describe('Kapan diingatkan, "YYYY-MM-DD HH:mm" WIB.'),
  priority: z.enum(["low", "normal", "high"]).optional(),
  person: z.string().optional().describe("Orang terkait."),
  notes: z.string().optional().describe("Detail / konteks, mis. sumber email."),
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function newCtx(): RunContext {
  return { source: "claude", proposed: [], created: [], updated: [], notes: [], attachments: [] };
}

/** Jalankan tool tulis, lalu kabarkan buktinya ke Telegram pemilik. */
async function write(env: Env, name: string, input: unknown) {
  const ctx = newCtx();
  const result = await executeTool(env, ctx, name, input);
  const proof = await receipt(env, ctx);
  if (proof && env.OWNER_CHAT_ID) {
    await new Telegram(env.TELEGRAM_BOT_TOKEN)
      .send(env.OWNER_CHAT_ID, `🔗 Lewat Claude\n${proof}`)
      .catch((err) => console.error("Gagal kirim bukti ke Telegram", err));
  }
  return text(result);
}

const WRITES = new Set([
  "add_tasks",
  "update_task",
  "add_note",
  "update_note",
  "add_preference",
  "remember_fact",
  "save_competitor_ads",
  "save_competitor_report",
  "track_competitor",
]);

/** Setiap panggilan tool dari Claude tampil di Kantor 3D (karakter "Claude"). */
function withActivity(env: Env, server: McpServer): McpServer {
  type Result = { content: { type: string; text?: string }[] };
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: unknown }).registerTool = (
    name: string,
    config: unknown,
    cb: (...a: unknown[]) => Promise<Result>,
  ) =>
    register(name, config, async (...args: unknown[]) => {
      const res = await cb(...args);
      await logTool(env, "claude", name, WRITES.has(name) ? res.content[0]?.text : undefined);
      return res;
    });
  return server;
}

function buildServer(env: Env, ctx?: ExecutionContext): McpServer {
  const server = withActivity(env, new McpServer({ name: "second-brain", version: "1.0.0" }, { instructions: INSTRUCTIONS(env.OWNER_NAME || "pemilik") }));
  const tz = env.TIMEZONE_OFFSET;
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "get_overview",
    {
      title: "Ringkasan hari ini",
      description: "Waktu sekarang, tugas hari ini, yang terlewat, yang menunggu approval, 7 hari ke depan, dan catatan terbaru.",
      annotations: readOnly,
    },
    async () => {
      const now = new Date().toISOString();
      const [, todayEnd] = localDayRange(tz, 0);
      const [, weekEnd] = localDayRange(tz, 6);
      const [today, overdue, pending, week, notes] = await Promise.all([
        db.listTasks(env.DB, { statuses: ["open"], dueFrom: now, dueTo: todayEnd }),
        db.listTasks(env.DB, { statuses: ["open"], overdueBefore: now }),
        db.listTasks(env.DB, { statuses: ["pending"] }),
        db.listTasks(env.DB, { statuses: ["open"], dueFrom: todayEnd, dueTo: weekEnd }),
        db.searchNotes(env.DB, "", 5),
      ]);
      const fmt = (ts: db.Task[]) => (ts.length ? ts.map((t) => "- " + db.formatTask(t, tz)).join("\n") : "(tidak ada)");
      return text(
        [
          `Sekarang: ${nowContext(tz)}`,
          `\nHARI INI:\n${fmt(today)}`,
          `\nTERLEWAT:\n${fmt(overdue)}`,
          `\nMENUNGGU APPROVAL:\n${fmt(pending)}`,
          `\n7 HARI KE DEPAN:\n${fmt(week)}`,
          `\nCATATAN TERBARU:\n${notes.map((n) => `- #${n.id} ${n.title ?? n.content.slice(0, 80)}`).join("\n") || "(tidak ada)"}`,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "list_tasks",
    {
      title: "Daftar tugas",
      description: "Lihat tugas beserta id-nya, dengan filter status, rentang waktu, dan kata kunci.",
      inputSchema: {
        status: z.enum(["open", "pending", "done", "cancelled", "all"]).optional().describe("Default open."),
        range: z.enum(["today", "tomorrow", "week", "overdue", "any"]).optional().describe("Default any."),
        query: z.string().optional().describe("Kata kunci pada judul, catatan, atau orang."),
      },
      annotations: readOnly,
    },
    async ({ status = "open", range = "any", query }) => {
      const filter: db.TaskFilter = { statuses: status === "all" ? undefined : [status], limit: 300 };
      if (range === "today" || range === "tomorrow") {
        const [dueFrom, dueTo] = localDayRange(tz, range === "today" ? 0 : 1);
        Object.assign(filter, { dueFrom, dueTo });
      } else if (range === "week") {
        Object.assign(filter, { dueFrom: localDayRange(tz, 0)[0], dueTo: localDayRange(tz, 6)[1] });
      } else if (range === "overdue") {
        filter.overdueBefore = new Date().toISOString();
      }
      let tasks = await db.listTasks(env.DB, filter);
      const q = query?.toLowerCase().trim();
      if (q) tasks = tasks.filter((t) => [t.title, t.notes, t.person].some((v) => v?.toLowerCase().includes(q)));
      return text(tasks.length ? tasks.map((t) => db.formatTask(t, tz)).join("\n") : "Tidak ada tugas yang cocok.");
    },
  );

  server.registerTool(
    "add_tasks",
    {
      title: "Tambah tugas",
      description: "Tambah satu atau beberapa tugas aktif (dengan pengingat Telegram). Tugas aktif berjudul sama tidak dibuat dobel.",
      inputSchema: { tasks: z.array(z.object(taskShape)).min(1).max(20) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ tasks }) => write(env, "add_tasks", { tasks }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Ubah tugas",
      description: "Ubah tugas: judul, jadwal, prioritas, catatan, atau status (done = selesai, cancelled = batal).",
      inputSchema: {
        id: z.number().int(),
        title: taskShape.title.optional(),
        due: taskShape.due,
        remind: taskShape.remind,
        priority: taskShape.priority,
        person: taskShape.person,
        notes: taskShape.notes,
        status: z.enum(["open", "done", "cancelled"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => write(env, "update_task", input),
  );

  server.registerTool(
    "search_notes",
    {
      title: "Cari catatan",
      description: "Cari catatan di Second Brain berdasarkan makna & kata kunci (judul, isi, tag). Query kosong = catatan terbaru.",
      inputSchema: {
        query: z.string().optional(),
        tag: z.string().optional().describe("Filter satu tag, mis. marketing."),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnly,
    },
    async ({ query = "", tag, limit = 15 }) => {
      const notes = await memory.searchNotesHybrid(env, query, limit, tag || undefined);
      return text(
        notes.length
          ? notes
              .map((n) => `#${n.id} (${n.created_at.slice(0, 10)})${n.title ? ` ${n.title}:` : ""} ${n.content}${n.tags ? ` [${n.tags}]` : ""}`)
              .join("\n\n")
          : "Tidak ada catatan yang cocok.",
      );
    },
  );

  server.registerTool(
    "add_note",
    {
      title: "Simpan catatan",
      description: "Simpan catatan/fakta/hasil riset ke Second Brain.",
      inputSchema: {
        content: z.string().min(1).describe("Isi lengkap, bisa berdiri sendiri."),
        title: z.string().optional(),
        tags: z.string().optional().describe("Dipisah koma, mis. marketing, riset."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => write(env, "save_note", input),
  );

  server.registerTool(
    "update_note",
    {
      title: "Ubah catatan",
      description: "Ubah judul, isi, atau tag catatan berdasarkan id.",
      inputSchema: {
        id: z.number().int(),
        content: z.string().min(1).optional(),
        title: z.string().optional(),
        tags: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      const ok = await db.updateNote(env.DB, id, patch);
      if (!ok) return text(`Catatan #${id} tidak ditemukan atau tidak ada perubahan.`);
      await memory.indexNote(env, id);
      const n = await db.getNote(env.DB, id);
      return text(`Catatan #${id} diperbarui${n?.title ? `: ${n.title}` : ""}.`);
    },
  );

  server.registerTool(
    "search_memory",
    {
      title: "Cari memori",
      description: "Cari fakta jangka panjang tentang pemilik, orang di sekitarnya, bisnis, dan rencananya (berdasarkan makna).",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(30).optional() },
      annotations: readOnly,
    },
    async ({ query, limit = 10 }) => {
      const rows = await memory.recallMemories(env, query, limit);
      return text(rows.length ? rows.map((m) => `(${memory.localDate(env, m.created_at)}) ${m.content}`).join("\n") : "Tidak ada memori yang cocok.");
    },
  );

  server.registerTool(
    "remember_fact",
    {
      title: "Simpan ke memori",
      description: "Simpan satu fakta penting ke memori jangka panjang. Fakta yang sudah ada tidak disimpan dobel.",
      inputSchema: {
        content: z.string().min(5).describe("Satu kalimat utuh, dengan tanggal absolut kalau ada waktu."),
        entities: z.array(z.string()).optional().describe("Nama orang/brand/tempat yang disebut."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ content, entities }) => {
      const res = await memory.addMemory(env, content, "claude", entities ?? []);
      return text(res.id ? `Fakta tersimpan di memori (${res.id}).` : `SUDAH ADA di memori: ${res.duplicateOf?.content}`);
    },
  );

  server.registerTool(
    "get_meta_ads_performance",
    {
      title: "Performa iklan Meta (live)",
      description:
        "Tarik data performa iklan akun Meta pemilik langsung dari Meta Marketing API (pakai token yang tersimpan): spend, purchase, CPA, ROAS, kontak, funnel per campaign/adset/ad, plus purchase harian dan impresi per wilayah. Pakai untuk analisa iklan sendiri. Tanggal format YYYY-MM-DD; kosongkan untuk 7 hari terakhir.",
      inputSchema: {
        level: z.enum(["campaign", "adset", "ad"]).optional().describe("Default ad."),
        since: z.string().optional(),
        until: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ level, since, until }) => {
      const lv = level ?? "ad";
      const rows = lv === "ad" ? await meta.getLiveDashboardData(env, "last_7d", since, until) : await meta.getLevelData(env, lv, "last_7d", since, until);
      const [daily, regions] = await Promise.all([
        meta.getDailyData(env, "last_7d", since, until).catch(() => []),
        meta.getRegionData(env, "last_7d", since, until).catch(() => []),
      ]);
      return text(JSON.stringify({ level: lv, rows, daily, regions }, null, 1));
    },
  );

  server.registerTool(
    "get_competitor_watchlist",
    {
      title: "Daftar pantauan kompetitor",
      description:
        "Kata kunci & halaman kompetitor yang harus dipindai di Meta Ad Library, plus ringkasan iklan yang sudah tersimpan. Pakai sebelum scan kompetitor.",
      annotations: readOnly,
    },
    async () => {
      const s = await competitors.summary(env);
      const watch = s.watch.length
        ? s.watch.map((w) => `- ${w.kind === "page" ? `halaman ${w.label ?? ""} (page_id ${w.value})` : `kata kunci "${w.value}"`} · negara ${w.country}`).join("\n")
        : "(kosong — tanyakan pemilik kompetitor/kata kunci apa yang mau dipantau, lalu pakai track_competitor)";
      return text(
        `DAFTAR PANTAUAN:\n${watch}\n\nTERSIMPAN: ${s.totals.ads} iklan dari ${s.totals.pages} halaman (${s.totals.active} aktif, ${s.totals.newWeek} baru minggu ini).\n\nCARA SCAN (terbaik, butuh browser): buka https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=<NEGARA>&q=<KATA KUNCI>&search_type=keyword_unordered&media_type=all&sort_data[direction]=desc&sort_data[mode]=total_impressions lalu jalankan ekstraktor JavaScript dari ${env.PUBLIC_URL}/adlibrary-extract.js (await adLibraryExtract({scrolls:3})) dan kirim field ads-nya ke save_competitor_ads. TANPA browser: ads_library_search (konektor Meta) dengan search_terms/page_ids, countries=[negara], ad_active_status="ACTIVE", limit 50 (tanpa gambar/video).`,
      );
    },
  );

  server.registerTool(
    "save_competitor_ads",
    {
      title: "Simpan iklan kompetitor",
      description:
        "Simpan hasil pencarian Meta Ad Library (array ads dari ads_library_search, apa adanya) ke modul Riset Kompetitor. Iklan baru akan dinilai otomatis (angle, hook, promo, klaim berisiko).",
      inputSchema: {
        query: z.string().optional().describe("Kata kunci atau nama halaman yang dicari."),
        country: z.string().length(2).optional().describe("Kode negara ISO-2, default ID."),
        ads: z.array(z.record(z.string(), z.unknown())).min(1).max(100).describe("Daftar iklan persis dari ads_library_search."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, country, ads }) => {
      const r = await competitors.ingestAds(env, { source: "claude", query, country, ads });
      const after = competitors
        .notifyScan(env, r)
        .then(() => competitors.saveMedia(env))
        .then(() => competitors.scorePending(env, 15));
      if (ctx) ctx.waitUntil(after.catch((err) => console.error("Pasca-simpan gagal", err)));
      else await after;
      return text(`Tersimpan: ${r.added} iklan baru, ${r.updated} diperbarui${r.skipped ? `, ${r.skipped} dilewati (tanpa id)` : ""}. Penilaian berjalan otomatis.`);
    },
  );

  server.registerTool(
    "get_competitor_ads",
    {
      title: "Lihat iklan kompetitor",
      description: "Iklan kompetitor tersimpan beserta lama tayang & penilaiannya. Urut default: paling lama tayang (biasanya iklan pemenang).",
      inputSchema: {
        page_id: z.string().optional(),
        query: z.string().optional().describe("Cari di nama halaman/judul/teks."),
        sort: z.enum(["lama", "baru", "hook"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: readOnly,
    },
    async ({ page_id, query, sort, limit = 30 }) => {
      const ads = await competitors.listAds(env, { page: page_id, q: query, sort, limit });
      return text(
        ads.length
          ? ads
              .map(
                (a) =>
                  `${a.page_name} · tayang ${a.days} hari${a.active ? " (aktif)" : ""} · angle ${a.angle ? competitors.ANGLES[a.angle] : "?"} · hook ${
                    a.hook != null ? competitors.HOOK_LEVELS[a.hook] : "?"
                  }${a.promo ? " · promo" : ""}${a.risky ? " · klaim berisiko" : ""}\n  ${[a.title, a.body].filter(Boolean).join(" — ").slice(0, 300)}\n  ${a.snapshot_url}`,
              )
              .join("\n")
          : "Belum ada iklan kompetitor yang cocok.",
      );
    },
  );

  server.registerTool(
    "save_competitor_report",
    {
      title: "Simpan laporan bedah iklan",
      description:
        "Simpan laporan 'Bedah Iklan Kompetitor' terstruktur supaya tampil di website (dengan gambar/video iklan pemenang). winners.ad_id harus id iklan yang sudah disimpan lewat save_competitor_ads.",
      inputSchema: {
        title: z.string().min(3),
        query: z.string().optional(),
        data: z.object({
          subtitle: z.string().optional(),
          stats: z.array(z.object({ value: z.string(), label: z.string() })).max(4).optional(),
          method: z.string().optional(),
          summary: z.array(z.string()).min(1).max(7),
          topics: z.array(z.object({ topic: z.string(), count: z.number(), hook: z.string() })).optional(),
          topics_note: z.string().optional(),
          winners: z.array(z.object({ ad_id: z.string(), title: z.string(), badge: z.string().optional(), hook: z.string().optional(), why: z.string() })),
          others: z.array(z.object({ page: z.string(), hook: z.string(), running: z.string(), signal: z.string() })).optional(),
          patterns: z.array(z.string()).optional(),
          warning: z.string().optional(),
          plan: z.array(z.object({ priority: z.string(), title: z.string(), steps: z.array(z.string()) })).optional(),
          data_note: z.string().optional(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, query, data }) => {
      const id = await competitors.saveReport(env, { title, query, data, author: "claude" });
      return text(`Laporan tersimpan (#${id}). Lihat di website → Riset Kompetitor → Laporan.`);
    },
  );

  server.registerTool(
    "track_competitor",
    {
      title: "Pantau kompetitor",
      description: "Tambahkan kata kunci atau halaman kompetitor (page_id dari Ad Library) ke daftar pantauan.",
      inputSchema: {
        kind: z.enum(["keyword", "page"]),
        value: z.string().min(1).describe("Kata kunci, atau page_id (angka)."),
        label: z.string().optional().describe("Nama halaman (untuk page)."),
        country: z.string().length(2).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (w) => {
      await competitors.addWatch(env, w);
      return text(`Ditambahkan ke daftar pantauan: ${w.kind === "page" ? `halaman ${w.label ?? w.value}` : `"${w.value}"`}.`);
    },
  );

  server.registerTool(
    "get_profile",
    {
      title: "Profil & preferensi",
      description: "Profil pemilik (peran, bisnis, target, tim, gaya kerja) dan preferensi yang wajib diikuti.",
      annotations: readOnly,
    },
    async () => {
      const [{ profile: p }, prefs] = await Promise.all([profile.getProfile(env), profile.listPreferences(env)]);
      return text(
        `PROFIL:\n${p || "(belum diisi — pemilik bisa menjalankan /profil di bot Telegram)"}\n\nPREFERENSI:\n${
          prefs.map((x) => `- (${x.id}) ${x.content}`).join("\n") || "(belum ada)"
        }`,
      );
    },
  );

  server.registerTool(
    "add_preference",
    {
      title: "Simpan preferensi",
      description: "Simpan preferensi/koreksi permanen pemilik tentang cara asisten bekerja.",
      inputSchema: { content: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ content }) => write(env, "remember_preference", { content }),
  );

  return server;
}

/** Handler /mcp (dipanggil OAuthProvider setelah token valid). Stateless: satu server per request. */
export const mcpHandler = {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const server = buildServer(env, ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  },
};
