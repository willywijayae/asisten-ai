import type { Env } from "./env";
import * as db from "./db";
import { localDayRange, localToUtc, nowContext } from "./time";

const SYSTEM_PROMPT = `Kamu adalah asisten pribadi (chief of staff) milik satu orang: pemilik bot Telegram ini.
Tugasmu: mencatat & mengawal komitmen, mengingatkan jadwal, merangkum informasi, dan menyimpan catatan (second brain).

Gaya bicara:
- Bahasa Indonesia santai tapi sopan, singkat, langsung ke inti. Ikuti gaya bahasa pemilik.
- Balasan tampil sebagai teks polos di Telegram: jangan pakai tabel, heading, atau **bold** markdown. Boleh pakai daftar dengan "-" dan emoji secukupnya.

Aturan kerja:
- Semua waktu dalam zona waktu pemilik. Tulis waktu untuk tool dalam format lokal "YYYY-MM-DD HH:mm". Tanggal relatif ("besok", "Jumat depan") hitung dari waktu sekarang yang diberikan di setiap pesan.
- Kalau pemilik secara langsung minta dicatat/diingatkan ("ingetin aku...", "catat tugas..."), pakai add_task.
- Kalau isinya pesan yang DITERUSKAN, voice note, atau foto/screenshot chat, JANGAN langsung add_task. Ekstrak komitmen, janji, deadline, atau permintaan yang relevan untuk pemilik, lalu pakai propose_tasks supaya pemilik bisa approve dulu. Setelah itu rangkum isi pesannya singkat.
- Kalau pemilik minta "catat bahwa...", "simpan info...", atau memberi fakta yang perlu diingat (nomor, alamat, preferensi, hasil meeting), pakai save_note.
- Sebelum menjawab pertanyaan tentang hal yang pernah dicatat, cari dulu dengan search_notes / list_tasks. Jangan mengarang data pribadi.
- Untuk menandai selesai/membatalkan/mengubah tugas, cari id-nya dulu dengan list_tasks kalau belum tahu, lalu pakai update_task.
- Kamu tidak punya akses internet. Kalau ditanya info terkini, jawab dari pengetahuanmu dan bilang bisa jadi sudah tidak update.
- Jangan pernah mengaku sudah mengirim email/pesan ke orang lain; kamu hanya bisa membuat draf untuk pemilik.
- Kalau ada yang ambigu dan penting (misal jam tidak jelas), tetap catat dengan tebakan terbaik lalu sebutkan asumsinya, daripada banyak bertanya.`;

const TASK_PROPS = {
  title: { type: "string", description: "Judul tugas yang singkat & jelas, diawali kata kerja." },
  due: { type: "string", description: 'Deadline/waktu kejadian, format lokal "YYYY-MM-DD HH:mm" (atau "YYYY-MM-DD" → dianggap 09:00). Kosongkan kalau tidak ada.' },
  remind: { type: "string", description: 'Kapan diingatkan, format lokal "YYYY-MM-DD HH:mm". Kosongkan untuk default (60 menit sebelum due).' },
  priority: { type: "string", enum: ["low", "normal", "high"] },
  person: { type: "string", description: "Orang yang terkait (klien, bos, dsb), kalau ada." },
  notes: { type: "string", description: "Detail tambahan / konteks." },
} as const;

const fn = (name: string, description: string, parameters: object) => ({
  type: "function" as const,
  function: { name, description, parameters },
});

const TOOLS = [
  fn("add_task", "Tambah tugas/pengingat yang diminta langsung oleh pemilik. Langsung aktif.", {
    type: "object",
    properties: TASK_PROPS,
    required: ["title"],
  }),
  fn(
    "propose_tasks",
    "Usulkan tugas yang diekstrak dari pesan diteruskan, voice note, atau screenshot. Tugas disimpan sebagai 'pending' dan pemilik menerima tombol Simpan/Buang untuk tiap tugas.",
    {
      type: "object",
      properties: {
        tasks: { type: "array", items: { type: "object", properties: TASK_PROPS, required: ["title"] } },
      },
      required: ["tasks"],
    },
  ),
  fn("list_tasks", "Lihat daftar tugas beserta id-nya.", {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "pending", "done", "all"], description: "Default open." },
      range: {
        type: "string",
        enum: ["today", "tomorrow", "week", "overdue", "any"],
        description: "Filter berdasarkan due. Default any.",
      },
    },
  }),
  fn(
    "update_task",
    "Ubah tugas (judul, jadwal, prioritas, status, dsb). Status 'done' untuk menandai selesai, 'cancelled' untuk batal.",
    {
      type: "object",
      properties: {
        id: { type: "integer" },
        ...TASK_PROPS,
        status: { type: "string", enum: ["open", "done", "cancelled"] },
      },
      required: ["id"],
    },
  ),
  fn("save_note", "Simpan catatan/fakta ke second brain pemilik.", {
    type: "object",
    properties: {
      title: { type: "string", description: "Judul singkat catatan." },
      content: { type: "string", description: "Isi catatan lengkap, bisa berdiri sendiri tanpa konteks obrolan." },
      tags: { type: "string", description: "Kata kunci dipisah koma, mis. 'klien, budi, harga'." },
    },
    required: ["content"],
  }),
  fn("search_notes", "Cari catatan di second brain berdasarkan kata kunci. Query kosong = catatan terbaru.", {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  }),
];

/** Isi pesan dari pemilik: teks dan/atau gambar (base64 JPEG). */
export type UserPart = { type: "text"; text: string } | { type: "image"; base64: string };

type ChatMessage =
  | { role: "system" | "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "user"; content: string | Array<Record<string, unknown>> }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string | Record<string, unknown> };
}

interface ChatResponse {
  choices?: { message: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
}

type TaskInput = { title: string; due?: string; remind?: string; priority?: db.Task["priority"]; person?: string; notes?: string };

export interface RunContext {
  source: string;
  /** Id tugas pending yang dibuat selama run ini (butuh tombol approval). */
  proposed: number[];
}

async function executeTool(env: Env, ctx: RunContext, name: string, input: any): Promise<string> {
  const tz = env.TIMEZONE_OFFSET;
  const toTask = (t: TaskInput, status: db.Task["status"]): db.NewTask => ({
    title: t.title,
    notes: t.notes || null,
    person: t.person || null,
    priority: ["low", "normal", "high"].includes(t.priority as string) ? t.priority : "normal",
    status,
    source: ctx.source,
    due_at: localToUtc(t.due, tz),
    remind_at: localToUtc(t.remind, tz),
  });

  switch (name) {
    case "add_task": {
      if (!input.title) throw new Error("title wajib diisi");
      const id = await db.addTask(env.DB, toTask(input, "open"));
      return `Tersimpan: ${db.formatTask((await db.getTask(env.DB, id))!, tz)}`;
    }
    case "propose_tasks": {
      const tasks: TaskInput[] = Array.isArray(input.tasks) ? input.tasks.filter((t: TaskInput) => t?.title) : [];
      const ids: number[] = [];
      for (const t of tasks.slice(0, 10)) ids.push(await db.addTask(env.DB, toTask(t, "pending")));
      ctx.proposed.push(...ids);
      return `${ids.length} usulan tugas dikirim ke pemilik untuk di-approve (id: ${ids.join(", ")}). Tidak perlu mengulang daftar lengkapnya di balasan.`;
    }
    case "list_tasks": {
      const status = input.status ?? "open";
      const filter: db.TaskFilter = { statuses: status === "all" ? undefined : [status] };
      const range = input.range ?? "any";
      if (range === "today" || range === "tomorrow") {
        const [from, to] = localDayRange(tz, range === "today" ? 0 : 1);
        Object.assign(filter, { dueFrom: from, dueTo: to });
      } else if (range === "week") {
        const [from] = localDayRange(tz, 0);
        const [, to] = localDayRange(tz, 6);
        Object.assign(filter, { dueFrom: from, dueTo: to });
      } else if (range === "overdue") {
        filter.overdueBefore = new Date().toISOString();
      }
      const rows = await db.listTasks(env.DB, filter);
      return rows.length ? rows.map((t) => db.formatTask(t, tz)).join("\n") : "Tidak ada tugas yang cocok.";
    }
    case "update_task": {
      const patch: Parameters<typeof db.updateTask>[2] = {};
      if (input.title) patch.title = input.title;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.person !== undefined) patch.person = input.person || null;
      if (input.priority) patch.priority = input.priority;
      if (input.status) patch.status = input.status;
      if (input.due !== undefined) patch.due_at = localToUtc(input.due, tz);
      if (input.remind !== undefined) patch.remind_at = localToUtc(input.remind, tz);
      const ok = await db.updateTask(env.DB, Number(input.id), patch);
      if (!ok) return `Tugas #${input.id} tidak ditemukan atau tidak ada perubahan.`;
      return `Diperbarui: ${db.formatTask((await db.getTask(env.DB, Number(input.id)))!, tz)}`;
    }
    case "save_note": {
      if (!input.content) throw new Error("content wajib diisi");
      const id = await db.addNote(env.DB, { content: input.content, tags: input.tags, title: input.title });
      return `Catatan #${id} tersimpan.`;
    }
    case "search_notes": {
      const rows = await db.searchNotes(env.DB, input.query ?? "");
      return rows.length
        ? rows
            .map((n) => `#${n.id} (${n.created_at.slice(0, 10)}) ${n.title ? n.title + ": " : ""}${n.content}${n.tags ? ` [${n.tags}]` : ""}`)
            .join("\n")
        : "Tidak ada catatan yang cocok.";
    }
    default:
      throw new Error(`Tool tidak dikenal: ${name}`);
  }
}

function parseArgs(args: ToolCall["function"]["arguments"]): Record<string, unknown> {
  if (typeof args !== "string") return args ?? {};
  try {
    return args.trim() ? JSON.parse(args) : {};
  } catch {
    throw new Error("Argumen tool bukan JSON yang valid");
  }
}

/** Beberapa model menyisipkan tag berpikir di content; buang sebelum dikirim ke Telegram. */
function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

type ModelMessage = { content?: string | null; tool_calls?: ToolCall[] };

class QuotaError extends Error {}

/** Claude lewat Puter (user-pays: memakai jatah akun Puter pemilik). */
async function callPuter(env: Env, messages: ChatMessage[], tools?: typeof TOOLS): Promise<ModelMessage> {
  const res = await fetch("https://api.puter.com/drivers/call", {
    method: "POST",
    headers: { "Content-Type": "text/plain;actually=json", Authorization: `Bearer ${env.PUTER_AUTH_TOKEN}` },
    body: JSON.stringify({
      interface: "puter-chat-completion",
      driver: "ai-chat",
      method: "complete",
      args: { messages, model: env.MODEL, max_tokens: 4096, normalize: true, ...(tools ? { tools } : {}) },
      auth_token: env.PUTER_AUTH_TOKEN,
    }),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (
    res.status === 402 ||
    json?.error?.code === "insufficient_funds" ||
    json?.error?.status === 402 ||
    json?.metadata?.usage_limited === true
  ) {
    throw new QuotaError("Jatah Puter habis");
  }
  if (!res.ok || !json || json.success === false) {
    throw new Error(`Puter ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
  }
  const result = json.result ?? json;
  if (!result.message) throw new Error(`Respons Puter tidak terduga: ${JSON.stringify(result).slice(0, 300)}`);
  return result.message;
}

/** Model gratis Workers AI (cadangan, atau utama kalau Puter tidak dipasang). */
async function callWorkersAI(env: Env, messages: ChatMessage[], tools?: typeof TOOLS): Promise<ModelMessage> {
  const res = (await env.AI.run(env.FALLBACK_MODEL as any, {
    messages,
    ...(tools ? { tools } : {}),
    max_tokens: 4096,
  } as any)) as ChatResponse;
  const msg = res.choices?.[0]?.message;
  if (!msg) throw new Error(`Respons Workers AI tidak terduga: ${JSON.stringify(res).slice(0, 300)}`);
  return msg;
}

export interface RunOptions {
  source: string;
  useTools: boolean;
  history: { role: "user" | "assistant"; content: string }[];
}

/** Jalankan satu giliran agen sampai selesai. */
export async function runAgent(env: Env, parts: UserPart[], opts: RunOptions): Promise<{ text: string; proposed: number[] }> {
  const ctx: RunContext = { source: opts.source, proposed: [] };

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: `[Waktu sekarang: ${nowContext(env.TIMEZONE_OFFSET)}]` },
    ...parts.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : { type: "image_url", image_url: { url: `data:image/jpeg;base64,${p.base64}` } },
    ),
  ];

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...normalizeHistory(opts.history),
    { role: "user", content: userContent },
  ];

  const tools = opts.useTools ? TOOLS : undefined;
  let usePuter = !!env.PUTER_AUTH_TOKEN;
  let notice = "";

  let text = "";
  for (let i = 0; i < 8; i++) {
    let msg: ModelMessage;
    if (usePuter) {
      try {
        msg = await callPuter(env, messages, tools);
      } catch (err) {
        // Sekali gagal, sisa giliran ini pakai cadangan supaya bot tetap jalan.
        console.error("Puter gagal, pindah ke Workers AI", err);
        usePuter = false;
        notice =
          err instanceof QuotaError
            ? "⚠️ Jatah Claude di Puter habis, balasan ini pakai otak cadangan (gratis)."
            : "⚠️ Claude lagi bermasalah, balasan ini pakai otak cadangan (gratis).";
        msg = await callWorkersAI(env, messages, tools);
      }
    } else {
      msg = await callWorkersAI(env, messages, tools);
    }
    text = cleanText(msg.content);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) break;

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls) {
      let result: string;
      try {
        result = await executeTool(env, ctx, call.function.name, parseArgs(call.function.arguments));
      } catch (err) {
        result = `ERROR: ${String(err)}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  if (!text && ctx.proposed.length) text = "Ada usulan tugas di bawah, silakan cek 👇";
  return { text: text || "Siap.", proposed: ctx.proposed };
}

/** Riwayat harus diawali user dan bergantian user/assistant. */
function normalizeHistory(history: { role: "user" | "assistant"; content: string }[]): ChatMessage[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of history) {
    const prev = out[out.length - 1];
    if (prev && prev.role === h.role) prev.content += "\n\n" + h.content;
    else out.push({ ...h });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // Pesan baru adalah user, jadi riwayat harus berakhir di assistant.
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}
