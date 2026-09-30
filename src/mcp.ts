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
import { localDayRange, nowContext } from "./time";

// Server MCP "Second Brain": membuka tugas, catatan, profil & preferensi pemilik ke Claude
// (atau klien MCP lain). Hanya bisa diakses dengan token OAuth yang disetujui pemilik.

const INSTRUCTIONS = `Second Brain milik Willy: tugas/pengingat, catatan, profil, dan preferensi. Data yang sama dipakai bot Telegram & website adminnya.
- Semua waktu dalam WIB (UTC+07:00). Isi waktu dengan format lokal "YYYY-MM-DD HH:mm"; kalau cuma tanggal, dianggap 09:00.
- "remind" = kapan bot Telegram mengirim pengingat. Kosong = 60 menit sebelum "due".
- Baca get_profile di awal untuk memahami pemilik, dan patuhi preferensinya.
- search_memory berisi fakta jangka panjang yang dikumpulkan dari obrolan (dengan tanggal; yang terbaru biasanya berlaku). Pakai remember_fact untuk menyimpan fakta penting baru tentang pemilik, timnya, atau bisnisnya.
- Sebelum menambah tugas, cek list_tasks supaya tidak dobel. Tambah beberapa tugas sekaligus dengan add_tasks.
- Setiap perubahan dikabarkan ke Telegram pemilik sebagai bukti.`;

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

const WRITES = new Set(["add_tasks", "update_task", "add_note", "update_note", "add_preference", "remember_fact"]);

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

function buildServer(env: Env): McpServer {
  const server = withActivity(env, new McpServer({ name: "second-brain", version: "1.0.0" }, { instructions: INSTRUCTIONS }));
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
  async fetch(req: Request, env: Env): Promise<Response> {
    const server = buildServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  },
};
