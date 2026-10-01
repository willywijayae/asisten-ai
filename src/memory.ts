import type { Env } from "./env";
import * as db from "./db";
import { keywords } from "./profile";
import { logActivity } from "./activity";
import { nowContext, offsetMinutes } from "./time";

// Memori jangka panjang, meniru cara kerja mem0 tapi gratis di Cloudflare:
// - Setelah obrolan, Gemma (Workers AI) mengambil fakta tahan lama → disimpan ADD-only (tidak pernah ditimpa).
// - Pencarian gabungan: makna (bge-m3 + Vectorize) + kata kunci + nama/entitas, digabung dengan
//   reciprocal rank fusion, lalu fakta yang lebih baru sedikit diutamakan.
// Kalau embedding/Vectorize bermasalah, semuanya jatuh ke pencarian kata kunci biasa.

const EMBED_MODEL = "@cf/baai/bge-m3";
/** Di bawah skor ini hasil pencarian makna dianggap tidak relevan (bge-m3, cosine). */
const MIN_SCORE = 0.45;
/** Fakta baru yang semirip ini dengan fakta lama dianggap duplikat. */
const DUPLICATE_SCORE = 0.9;

export interface Memory {
  id: number;
  content: string;
  entities: string | null;
  source: string;
  created_at: string;
}

/** Tanggal lokal (WIB) "YYYY-MM-DD" dari timestamp UTC. */
export function localDate(env: Env, iso: string): string {
  return new Date(Date.parse(iso) + offsetMinutes(env.TIMEZONE_OFFSET) * 60_000).toISOString().slice(0, 10);
}

type Kind = "memory" | "note";
const vectorId = (kind: Kind, id: number) => `${kind === "memory" ? "m" : "n"}:${id}`;

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(EMBED_MODEL as any, { text: texts.map((t) => t.slice(0, 6000)) } as any)) as {
    data?: number[][];
  };
  if (!res.data || res.data.length !== texts.length) throw new Error("Embedding tidak lengkap");
  return res.data;
}

async function upsertVectors(env: Env, items: { kind: Kind; id: number; text: string }[]): Promise<void> {
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const vectors = await embed(env, batch.map((b) => b.text));
    await env.VECTORIZE.upsert(
      batch.map((b, j) => ({ id: vectorId(b.kind, b.id), values: vectors[j], metadata: { type: b.kind } })),
    );
  }
}

const noteText = (n: db.Note) => [n.title, n.content, n.tags ? `tag: ${n.tags}` : ""].filter(Boolean).join("\n");

/** Indeks ulang satu catatan setelah dibuat/diubah. Gagal → hanya di-log (catatan tetap tersimpan). */
export async function indexNote(env: Env, id: number): Promise<void> {
  try {
    const n = await db.getNote(env.DB, id);
    if (n) await upsertVectors(env, [{ kind: "note", id, text: noteText(n) }]);
  } catch (err) {
    console.error("Gagal mengindeks catatan", id, err);
  }
}

export async function unindexNote(env: Env, id: number): Promise<void> {
  await env.VECTORIZE.deleteByIds([vectorId("note", id)]).catch((err) => console.error("Gagal hapus vektor catatan", err));
}

/** Id + skor hasil pencarian makna, atau [] kalau Vectorize tidak tersedia. */
async function semantic(env: Env, vector: number[] | null, kind: Kind, topK: number): Promise<number[]> {
  if (!vector) return [];
  try {
    const res = await env.VECTORIZE.query(vector, { topK, filter: { type: kind }, returnMetadata: "none" });
    return res.matches.filter((m) => m.score >= MIN_SCORE).map((m) => Number(m.id.slice(2)));
  } catch (err) {
    console.error("Pencarian Vectorize gagal", err);
    return [];
  }
}

async function queryVector(env: Env, text: string): Promise<number[] | null> {
  try {
    return (await embed(env, [text]))[0];
  } catch (err) {
    console.error("Embedding query gagal", err);
    return null;
  }
}

/** Reciprocal rank fusion: gabungkan beberapa daftar peringkat id. */
function fuse(lists: number[][], k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  return scores;
}

// --- Fakta (memori) ---

export async function listMemories(env: Env, limit = 200): Promise<Memory[]> {
  const { results } = await env.DB.prepare("SELECT * FROM memories ORDER BY id DESC LIMIT ?").bind(limit).all<Memory>();
  return results;
}

async function memoriesByIds(env: Env, ids: number[]): Promise<Memory[]> {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(`SELECT * FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<Memory>();
  return results;
}

/** Cari fakta: makna + kata kunci + entitas, lalu sedikit bonus untuk yang baru. */
export async function recallMemories(env: Env, query: string, limit = 6, vector?: number[] | null): Promise<Memory[]> {
  const words = keywords(query).slice(0, 6);
  const vec = vector === undefined ? await queryVector(env, query) : vector;

  const keywordIds = async (column: "content" | "entities", exact: boolean) => {
    if (!words.length) return [];
    const cond = exact
      ? words.map(() => `(', ' || coalesce(entities, '') || ',') LIKE ?`)
      : words.map(() => `instr(lower(${column}), ?) > 0`);
    const score = cond.map((c) => `(${c})`).join(" + ");
    const vals = exact ? words.map((w) => `%, ${w},%`) : words;
    const { results } = await env.DB.prepare(
      `SELECT id FROM memories WHERE (${score}) > 0 ORDER BY (${score}) DESC, id DESC LIMIT 10`,
    )
      .bind(...vals, ...vals)
      .all<{ id: number }>();
    return results.map((r) => r.id);
  };

  const [sem, kw, ent] = await Promise.all([
    semantic(env, vec, "memory", 10),
    keywordIds("content", false),
    keywordIds("entities", true),
  ]);
  const scores = fuse([sem, kw, ent]);
  const rows = await memoriesByIds(env, [...scores.keys()]);
  const now = Date.now();
  const ranked = rows
    .map((m) => {
      const ageDays = (now - Date.parse(m.created_at)) / 86_400_000;
      return { m, s: (scores.get(m.id) ?? 0) + 0.004 * Math.exp(-ageDays / 90) };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return ranked.map((r) => r.m);
}

/** Cari catatan: makna + kata kunci. Dipakai tool agen, MCP, dan website. */
export async function searchNotesHybrid(
  env: Env,
  query: string,
  limit = 15,
  tag?: string,
  vector?: number[] | null,
): Promise<db.Note[]> {
  if (!query.trim()) return db.searchNotes(env.DB, "", limit, tag);
  const vec = vector === undefined ? await queryVector(env, query) : vector;
  const [sem, kwNotes] = await Promise.all([semantic(env, vec, "note", 20), db.searchNotes(env.DB, query, 20, tag)]);
  const scores = fuse([sem, kwNotes.map((n) => n.id)]);
  const byId = new Map(kwNotes.map((n) => [n.id, n]));
  const missing = [...scores.keys()].filter((id) => !byId.has(id));
  for (const n of await Promise.all(missing.map((id) => db.getNote(env.DB, id)))) if (n) byId.set(n.id, n);
  const tagOk = (n: db.Note) => !tag || (n.tags ?? "").split(", ").includes(tag.toLowerCase());
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((n): n is db.Note => !!n && tagOk(n))
    .slice(0, limit);
}

/** Simpan fakta baru (dari agen, Claude, atau website). Mengembalikan id, atau null kalau duplikat. */
export async function addMemory(
  env: Env,
  content: string,
  source: string,
  entities: string[] = [],
): Promise<{ id: number | null; duplicateOf?: Memory }> {
  const text = content.trim();
  let vector: number[] | null = null;
  try {
    vector = (await embed(env, [text]))[0];
    const res = await env.VECTORIZE.query(vector, { topK: 1, filter: { type: "memory" }, returnMetadata: "none" });
    const top = res.matches[0];
    if (top && top.score >= DUPLICATE_SCORE) {
      const [dup] = await memoriesByIds(env, [Number(top.id.slice(2))]);
      if (dup) return { id: null, duplicateOf: dup };
    }
  } catch (err) {
    console.error("Cek duplikat memori gagal", err);
  }
  const ents = [...new Set(entities.map((e) => e.trim().toLowerCase()).filter(Boolean))].join(", ") || null;
  const row = await env.DB.prepare("INSERT INTO memories (content, entities, source) VALUES (?, ?, ?) RETURNING id")
    .bind(text, ents, source)
    .first<{ id: number }>();
  const id = row!.id;
  try {
    if (vector) await env.VECTORIZE.upsert([{ id: vectorId("memory", id), values: vector, metadata: { type: "memory" } }]);
  } catch (err) {
    console.error("Gagal menyimpan vektor memori", err);
  }
  return { id };
}

export async function deleteMemory(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  await env.VECTORIZE.deleteByIds([vectorId("memory", id)]).catch((err) => console.error("Gagal hapus vektor memori", err));
  return res.meta.changes > 0;
}

/** Bangun ulang seluruh indeks (catatan + memori). Dipanggil dari website. */
export async function reindexAll(env: Env): Promise<{ notes: number; memories: number }> {
  const notes = await db.searchNotes(env.DB, "", 5000);
  const memories = await listMemories(env, 5000);
  await upsertVectors(env, [
    ...notes.map((n) => ({ kind: "note" as const, id: n.id, text: noteText(n) })),
    ...memories.map((m) => ({ kind: "memory" as const, id: m.id, text: m.content })),
  ]);
  return { notes: notes.length, memories: memories.length };
}

// --- Ekstraksi otomatis dari obrolan ---

const EXTRACT_PROMPT = (owner: string) => `Kamu juru arsip memori jangka panjang untuk asisten pribadi ${owner} (pemilik).
Dari satu giliran percakapan, ambil FAKTA TAHAN LAMA yang berguna diingat berminggu-minggu ke depan:
tentang pemilik (rencana, keputusan, kondisi, target, kebiasaan), orang di sekitarnya (tim, klien, keluarga, peran & kabarnya), bisnis/brand/produk, angka penting, dan kesepakatan.

JANGAN catat:
- jadwal/pengingat/tugasnya sendiri (sudah dicatat sistem tugas). TAPI kalau pesan berisi tugas, tetap ambil fakta tahan lama di dalamnya: siapa orangnya, perannya/perusahaannya, kebutuhannya, preferensinya, kesepakatannya
- basa-basi, pertanyaan pemilik, isi jawaban asisten yang hanya umum/saran
- hal yang cuma berlaku hari ini
- rahasia: password, PIN, OTP, nomor kartu/rekening, nomor identitas
- fakta yang SUDAH ADA di daftar "Fakta tersimpan"

Aturan penulisan:
- Satu kalimat utuh per fakta, bisa dipahami tanpa konteks, sebut nama jelas (bukan "dia").
- Ubah waktu relatif jadi tanggal absolut memakai "Waktu sekarang".
- Hanya dari yang benar-benar dikatakan pemilik; jangan menebak.

Balas HANYA JSON: {"facts":[{"content":"...","entities":["Budi","NamaBrand"]}]}. Kalau tidak ada fakta baru: {"facts":[]}.`;

const SECRET = /(password|kata sandi|\bpin\b|\botp\b|cvv|\b\d{12,}\b)/i;

function parseFacts(raw: string): { content: string; entities: string[] }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return parsed.facts
      .map((f: any) => ({
        content: String(f?.content ?? "").trim(),
        // Model kadang menulis entitas sebagai objek {entity, label}.
        entities: Array.isArray(f?.entities)
          ? f.entities.map((e: any) => String(typeof e === "string" ? e : e?.entity ?? e?.name ?? "")).filter(Boolean).slice(0, 8)
          : [],
      }))
      .filter((f) => f.content.length >= 12 && f.content.length <= 400 && !SECRET.test(f.content))
      .slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Ambil fakta dari satu giliran obrolan dan simpan yang baru. Dipanggil setelah balasan terkirim,
 * jadi tidak memperlambat pemilik. Error apa pun hanya di-log.
 */
export async function extractMemories(env: Env, turn: { user: string; reply: string; source: string }): Promise<number> {
  const user = turn.user.trim();
  if (user.length < 15 || user.startsWith("/")) return 0;
  try {
    const known = await recallMemories(env, user, 8);
    const res = (await env.AI.run(env.FALLBACK_MODEL as any, {
      messages: [
        { role: "system", content: EXTRACT_PROMPT(env.OWNER_NAME || "pemilik") },
        {
          role: "user",
          content: `Waktu sekarang: ${nowContext(env.TIMEZONE_OFFSET)}\n\nFakta tersimpan:\n${
            known.map((m) => `- ${m.content}`).join("\n") || "(belum ada)"
          }\n\nPercakapan:\nPEMILIK: ${user.slice(0, 4000)}\nASISTEN: ${turn.reply.slice(0, 1500)}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
      // Tanpa mode "berpikir": 5x lebih cepat & hemat, dan tidak kehabisan token sebelum menjawab.
      chat_template_kwargs: { enable_thinking: false },
    } as any)) as { choices?: { message?: { content?: string | null } }[]; response?: string };
    const raw = res.choices?.[0]?.message?.content ?? res.response ?? "";
    const facts = parseFacts(typeof raw === "string" ? raw : JSON.stringify(raw));

    let saved = 0;
    const added: string[] = [];
    for (const f of facts) {
      const { id } = await addMemory(env, f.content, turn.source, f.entities);
      if (id) {
        saved++;
        added.push(f.content);
      }
    }
    if (saved) {
      await logActivity(env, "gemma", "step", `Mengarsipkan ${saved} fakta baru — ${added[0]}`, "cabinet");
    }
    console.log(`extractMemories: ${facts.length} kandidat, ${saved} baru`);
    return saved;
  } catch (err) {
    console.error("Ekstraksi memori gagal", err);
    return 0;
  }
}

// --- Konteks otomatis untuk setiap pesan ---

/** Blok <konteks_otomatis> berisi fakta, catatan, dan tugas yang relevan dengan pesan, atau "". */
export async function autoContext(env: Env, text: string): Promise<string> {
  const words = keywords(text);
  if (!words.length) return "";
  const vector = await queryVector(env, text);
  const [memories, notes, tasks] = await Promise.all([
    recallMemories(env, text, 6, vector),
    searchNotesHybrid(env, text, 4, undefined, vector),
    db.listTasks(env.DB, { statuses: ["open", "pending"], limit: 300 }),
  ]);
  const scoredTasks = tasks
    .map((t) => {
      const hay = [t.title, t.notes, t.person].join(" ").toLowerCase();
      return { t, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.t);

  if (!memories.length && !notes.length && !scoredTasks.length) return "";
  const lines: string[] = [];
  for (const m of memories) lines.push(`- memori (dicatat ${localDate(env, m.created_at)}): ${m.content}`);
  for (const n of notes) {
    const body = n.content.length > 400 ? n.content.slice(0, 400) + "…" : n.content;
    lines.push(`- catatan #${n.id}${n.title ? ` "${n.title}"` : ""}: ${body}${n.tags ? ` [${n.tags}]` : ""}`);
  }
  for (const t of scoredTasks) lines.push(`- ${db.formatTask(t, env.TIMEZONE_OFFSET)}`);
  return `<konteks_otomatis>\nHasil pencarian otomatis di memori, catatan, dan tugas untuk pesan ini (bisa saja tidak relevan):\n${lines.join("\n")}\n</konteks_otomatis>`;
}
