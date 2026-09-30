import type { Env } from "./env";
import * as db from "./db";

// Profil pemilik, preferensi permanen, dan konteks otomatis untuk setiap pesan.

const PROFILE_MAX = 4000;
const INTERVIEW_TTL_MS = 24 * 3600_000;

export async function getSetting(env: Env, key: string): Promise<{ value: string | null; updated_at: string } | null> {
  return env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = ?").bind(key).first();
}

export async function setSetting(env: Env, key: string, value: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(key, value)
    .run();
}

// --- Profil ---

export async function getProfile(env: Env): Promise<{ profile: string; updatedAt: string | null }> {
  const row = await getSetting(env, "profile");
  return { profile: row?.value ?? "", updatedAt: row?.value ? row.updated_at : null };
}

export async function saveProfile(env: Env, profile: string): Promise<void> {
  await setSetting(env, "profile", profile.trim().slice(0, PROFILE_MAX));
}

export const INTERVIEW_KICKOFF =
  "/profil — Mulai wawancara profil sekarang. Sapa singkat, jelaskan tujuannya dalam satu kalimat, lalu ajukan pertanyaan pertama.";

export async function startInterview(env: Env): Promise<void> {
  await setSetting(env, "interview_started_at", new Date().toISOString());
}

export async function stopInterview(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'interview_started_at'").run();
}

export async function interviewActive(env: Env): Promise<boolean> {
  const row = await getSetting(env, "interview_started_at");
  return !!row?.value && Date.now() - Date.parse(row.value) < INTERVIEW_TTL_MS;
}

// --- Preferensi ---

export interface Preference {
  id: number;
  content: string;
  created_at: string;
}

export async function listPreferences(env: Env): Promise<Preference[]> {
  const { results } = await env.DB.prepare("SELECT * FROM preferences ORDER BY id LIMIT 50").all<Preference>();
  return results;
}

export async function addPreference(env: Env, content: string): Promise<number> {
  const row = await env.DB.prepare("INSERT INTO preferences (content) VALUES (?) RETURNING id")
    .bind(content.trim().slice(0, 500))
    .first<{ id: number }>();
  return row!.id;
}

export async function deletePreference(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM preferences WHERE id = ?").bind(id).run();
  return res.meta.changes > 0;
}

/** Bagian system prompt tentang pemilik: profil + preferensi. */
export async function ownerContext(env: Env): Promise<string> {
  const [{ profile }, prefs] = await Promise.all([getProfile(env), listPreferences(env)]);
  let out = "";
  if (profile) out += `\n\nPROFIL PEMILIK (pakai untuk menyesuaikan jawaban, jangan diulang-ulang):\n${profile}`;
  if (prefs.length) {
    out += `\n\nPREFERENSI PEMILIK (wajib diikuti; id dalam kurung untuk forget_preference):\n${prefs
      .map((p) => `- (${p.id}) ${p.content}`)
      .join("\n")}`;
  }
  return out;
}

// --- Konteks otomatis (tanpa AI): cari catatan & tugas yang mungkin relevan ---

const STOPWORDS = new Set(
  (
    "yang dan di ke dari ini itu aku saya gue gua lo lu kamu anda kita kami dia mereka untuk dengan apa ada tidak gak ga nggak engga " +
    "sudah udah belum akan bisa mau tolong catat catatan ingetin ingatkan ingat besok lusa kemarin hari jam minggu bulan tahun dong ya " +
    "aja saja juga lagi buat bikin bikinin buatkan tentang soal kalau kalo atau tapi karena biar supaya agar pada sama oleh jadi " +
    "sih deh nih tuh kok kah pun lah para sebuah seperti kayak gimana bagaimana kapan dimana mana siapa berapa kenapa mengapa " +
    "semua banyak sedikit lebih paling sangat banget tadi nanti sekarang pagi siang sore malam tugas yang the and for with " +
    "tanya nanya pernah makasih terima kasih thanks oke brp gmn dgn utk yg tdk tolongin cek lihat liat kasih"
  ).split(/\s+/),
);

export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@.-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  // Kata yang lebih panjang biasanya lebih spesifik.
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 6);
}

/** Blok <konteks_otomatis> untuk disisipkan ke pesan, atau "" kalau tidak ada yang cocok. */
export async function autoContext(env: Env, text: string): Promise<string> {
  const words = keywords(text);
  if (!words.length) return "";

  const [notes, tasks] = await Promise.all([
    db.searchNotes(env.DB, words.join(" "), 4),
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

  if (!notes.length && !scoredTasks.length) return "";
  const lines: string[] = [];
  for (const n of notes) {
    const body = n.content.length > 400 ? n.content.slice(0, 400) + "…" : n.content;
    lines.push(`- catatan #${n.id}${n.title ? ` "${n.title}"` : ""}: ${body}${n.tags ? ` [${n.tags}]` : ""}`);
  }
  for (const t of scoredTasks) lines.push(`- ${db.formatTask(t, env.TIMEZONE_OFFSET)}`);
  return `<konteks_otomatis>\nHasil pencarian otomatis di second brain untuk pesan ini (bisa saja tidak relevan):\n${lines.join("\n")}\n</konteks_otomatis>`;
}
