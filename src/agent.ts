import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Env } from "./env";
import * as db from "./db";
import { localDayRange, localToUtc, nowContext } from "./time";

const SYSTEM_PROMPT = `Kamu adalah asisten pribadi (chief of staff) milik satu orang: pemilik bot Telegram ini.
Tugasmu: mencatat & mengawal komitmen, mengingatkan jadwal, merangkum informasi, riset singkat, dan menyimpan catatan (second brain).

Gaya bicara:
- Bahasa Indonesia santai tapi sopan, singkat, langsung ke inti. Ikuti gaya bahasa pemilik.
- Balasan tampil sebagai teks polos di Telegram: jangan pakai tabel atau heading markdown. Boleh pakai daftar dengan "-" dan emoji secukupnya.

Aturan kerja:
- Semua waktu dalam zona waktu pemilik. Tulis waktu untuk tool dalam format lokal "YYYY-MM-DD HH:mm". Tanggal relatif ("besok", "Jumat depan") hitung dari waktu sekarang yang diberikan di setiap pesan.
- Kalau pemilik secara langsung minta dicatat/diingatkan ("ingetin gue...", "catat tugas..."), pakai add_task.
- Kalau isinya pesan yang DITERUSKAN, voice note, atau foto/screenshot chat, JANGAN langsung add_task. Ekstrak komitmen, janji, deadline, atau permintaan yang relevan untuk pemilik, lalu pakai propose_tasks supaya pemilik bisa approve dulu. Setelah itu rangkum isi pesannya singkat.
- Kalau pemilik minta "catat bahwa...", "simpan info...", atau memberi fakta yang perlu diingat (nomor, alamat, preferensi, hasil meeting), pakai save_note.
- Sebelum menjawab pertanyaan tentang hal yang pernah dicatat, cari dulu dengan search_notes / list_tasks. Jangan mengarang data pribadi.
- Untuk riset atau informasi terbaru dari internet, pakai web_search lalu rangkum dengan sumbernya.
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

const TOOLS: BetaToolUnion[] = [
  {
    name: "add_task",
    description: "Tambah tugas/pengingat yang diminta langsung oleh pemilik. Langsung aktif.",
    input_schema: { type: "object", properties: TASK_PROPS, required: ["title"] },
  },
  {
    name: "propose_tasks",
    description:
      "Usulkan tugas yang diekstrak dari pesan diteruskan, voice note, atau screenshot. Tugas disimpan sebagai 'pending' dan pemilik akan menerima tombol Setujui/Buang untuk tiap tugas.",
    input_schema: {
      type: "object",
      properties: {
        tasks: { type: "array", items: { type: "object", properties: TASK_PROPS, required: ["title"] } },
      },
      required: ["tasks"],
    },
  },
  {
    name: "list_tasks",
    description: "Lihat daftar tugas.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "pending", "done", "all"], description: "Default open." },
        range: {
          type: "string",
          enum: ["today", "tomorrow", "week", "overdue", "any"],
          description: "Filter berdasarkan due. Default any.",
        },
      },
    },
  },
  {
    name: "update_task",
    description: "Ubah tugas (judul, jadwal, prioritas, status, dsb). Status 'done' untuk menandai selesai, 'cancelled' untuk batal.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        ...TASK_PROPS,
        status: { type: "string", enum: ["open", "done", "cancelled"] },
      },
      required: ["id"],
    },
  },
  {
    name: "save_note",
    description: "Simpan catatan/fakta ke second brain pemilik.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Isi catatan lengkap, bisa berdiri sendiri tanpa konteks obrolan." },
        tags: { type: "string", description: "Kata kunci dipisah koma, mis. 'klien, budi, harga'." },
      },
      required: ["content"],
    },
  },
  {
    name: "search_notes",
    description: "Cari catatan di second brain berdasarkan kata kunci. Query kosong = catatan terbaru.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
];

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
    priority: t.priority ?? "normal",
    status,
    source: ctx.source,
    due_at: localToUtc(t.due, tz),
    remind_at: localToUtc(t.remind, tz),
  });

  switch (name) {
    case "add_task": {
      const id = await db.addTask(env.DB, toTask(input, "open"));
      return `Tersimpan: ${db.formatTask((await db.getTask(env.DB, id))!, tz)}`;
    }
    case "propose_tasks": {
      const tasks: TaskInput[] = Array.isArray(input.tasks) ? input.tasks : [];
      const ids: number[] = [];
      for (const t of tasks.slice(0, 10)) ids.push(await db.addTask(env.DB, toTask(t, "pending")));
      ctx.proposed.push(...ids);
      return `${ids.length} usulan tugas dikirim ke pemilik untuk di-approve (id: ${ids.join(", ")}). Tidak perlu mengulang daftar lengkapnya di balasan.`;
    }
    case "list_tasks": {
      const status = input.status ?? "open";
      const filter: db.TaskFilter = {
        statuses: status === "all" ? undefined : [status],
      };
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
      const id = await db.addNote(env.DB, input.content, input.tags);
      return `Catatan #${id} tersimpan.`;
    }
    case "search_notes": {
      const rows = await db.searchNotes(env.DB, input.query ?? "");
      return rows.length
        ? rows.map((n) => `#${n.id} (${n.created_at.slice(0, 10)}) ${n.content}${n.tags ? ` [${n.tags}]` : ""}`).join("\n")
        : "Tidak ada catatan yang cocok.";
    }
    default:
      throw new Error(`Tool tidak dikenal: ${name}`);
  }
}

/**
 * Setelah fallback di tengah output, blok thinking/tool_use sebelum blok `fallback` terakhir
 * tidak boleh dikirim ulang.
 */
function echoable(content: BetaContentBlock[]): BetaContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFallback < 0) return content;
  const drop = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i > lastFallback || b.type === "fallback" || !drop.has(b.type));
}

export interface RunOptions {
  source: string;
  effort: "low" | "medium" | "high";
  useTools: boolean;
  history: { role: "user" | "assistant"; content: string }[];
}

/** Jalankan satu giliran agen sampai selesai. */
export async function runAgent(
  env: Env,
  userContent: BetaContentBlockParam[],
  opts: RunOptions,
): Promise<{ text: string; proposed: number[] }> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const ctx: RunContext = { source: opts.source, proposed: [] };

  const messages: BetaMessageParam[] = normalizeHistory(opts.history);
  messages.push({
    role: "user",
    content: [{ type: "text", text: `[Waktu sekarang: ${nowContext(env.TIMEZONE_OFFSET)}]` }, ...userContent],
  });

  let text = "";
  for (let i = 0; i < 12; i++) {
    const res = await client.beta.messages.create({
      model: env.MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: opts.effort },
      system: SYSTEM_PROMPT,
      ...(opts.useTools ? { tools: TOOLS } : {}),
      messages,
    });

    if (res.stop_reason === "refusal") {
      return { text: "Maaf, permintaan ini tidak bisa aku proses.", proposed: ctx.proposed };
    }

    messages.push({ role: "assistant", content: echoable(res.content) as BetaContentBlockParam[] });
    text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();

    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") break;

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    const results: BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (b) => {
        try {
          return { type: "tool_result", tool_use_id: b.id, content: await executeTool(env, ctx, b.name, b.input) } as const;
        } catch (err) {
          return { type: "tool_result", tool_use_id: b.id, content: String(err), is_error: true } as const;
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  if (!text && ctx.proposed.length) text = "Ada usulan tugas di bawah, silakan cek 👇";
  return { text: text || "Siap.", proposed: ctx.proposed };
}

/** Riwayat harus diawali user dan bergantian user/assistant. */
function normalizeHistory(history: { role: "user" | "assistant"; content: string }[]): BetaMessageParam[] {
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
