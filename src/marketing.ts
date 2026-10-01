import type { Env } from "./env";
import * as db from "./db";
import * as profile from "./profile";
import * as memory from "./memory";
import { clip, logActivity } from "./activity";
import { complete } from "./agent";

// Divisi marketing: Manajer Marketing menerima permintaan dari Haiku (resepsionis), menugaskan
// satu spesialis, lalu hasilnya disimpan sebagai catatan bertag "marketing" di Second Brain.

export const SPECIALISTS = {
  copywriter: {
    name: "Copywriter",
    role: "copy iklan, hook video, caption",
    brief: `Kamu Copywriter iklan di tim marketing pemilik.
Tugas: menulis copy iklan (Meta/TikTok), hook 3 detik pertama untuk video, headline, CTA, dan caption.
- Beri 3-5 variasi dengan angle berbeda (masalah → solusi, testimoni/social proof, edukasi, promo/urgensi, gaya hidup) dan beri label angle-nya.
- Bahasa sesuai audiens Indonesia; singkat, konkret, bikin berhenti scroll.
- Patuhi kebijakan iklan: tidak ada klaim menyembuhkan/menjamin hasil kesehatan, tidak ada before-after, tidak menyerang atribut pribadi ("Kamu gemuk?"). Kalau produknya suplemen/kesehatan, pakai bahasa yang aman.`,
  },
  konten: {
    name: "Perencana Konten",
    role: "ide & kalender konten",
    brief: `Kamu Perencana Konten di tim marketing pemilik.
Tugas: ide konten, pilar konten, dan kalender konten (Reels, TikTok, feed, story, live).
- Untuk kalender, tulis per hari: format · topik · hook · CTA. Seimbangkan edukasi, hiburan, social proof, dan jualan.
- Beri ide yang bisa langsung dieksekusi tim (editor/CS), bukan konsep umum.`,
  },
  analis: {
    name: "Analis Iklan",
    role: "analisis performa iklan & anggaran",
    brief: `Kamu Analis Iklan (performance marketing) di tim marketing pemilik.
Tugas: membaca data performa iklan dari pemilik (spend, CPM, CTR, CPC, CPL/CPA, ROAS, frekuensi, konversi), mendiagnosa masalah (kreatif, audiens, penawaran, funnel/landing), dan memberi rekomendasi konkret: scale / pertahankan / matikan / tes apa berikutnya, plus alokasi anggaran.
- JANGAN mengarang angka. Kalau data tidak diberikan, sebut data apa yang dibutuhkan dan beri kerangka analisisnya.
- Hitung ulang metrik turunan kalau datanya ada, dan tunjukkan hitungannya singkat.`,
  },
  riset: {
    name: "Riset",
    role: "riset pasar, kompetitor, persona, strategi",
    brief: `Kamu Periset & Strategis Marketing di tim pemilik.
Tugas: riset pasar, kompetitor, persona & insight audiens, positioning, angle penawaran, dan strategi funnel.
- Kamu TIDAK punya akses internet: jawab dari pengetahuanmu dan data pemilik, dan tandai bagian yang perlu divalidasi (tren/harga terbaru).
- Akhiri dengan 3 langkah tindak lanjut yang konkret.`,
  },
} as const;

export type SpecialistId = keyof typeof SPECIALISTS;

/** Penulis konten (copy & naskah) selalu pakai model ahli (Opus); analis & riset cukup model cepat. */
export const CONTENT_WRITERS: SpecialistId[] = ["copywriter", "konten"];

/** Nama pendek model untuk ditampilkan ke pemilik. */
export function modelLabel(env: Env, model: string): string {
  if (model === env.MODEL_SMART) return "Opus";
  if (model === env.MODEL_FAST) return "Haiku";
  return "Gemma (cadangan)";
}
export const SPECIALIST_IDS = Object.keys(SPECIALISTS) as SpecialistId[];

const TEAM_RULES = `

Aturan tim marketing:
- Bahasa Indonesia santai-profesional. Hasil dikirim lewat Telegram: teks biasa yang rapi (judul singkat, poin/bernomor), TANPA tabel markdown, tanpa **tebal**.
- Sesuaikan dengan bisnis, produk, target, dan preferensi pemilik di bawah. Pakai fakta dari memori/catatan kalau relevan.
- Kerjakan langsung; jangan balik bertanya kecuali datanya benar-benar tidak ada.`;

export async function runMarketing(
  env: Env,
  job: { specialist: string; request: string },
): Promise<{ text: string; noteId: number; name: string }> {
  const id: SpecialistId = (SPECIALIST_IDS as string[]).includes(job.specialist) ? (job.specialist as SpecialistId) : "riset";
  const sp = SPECIALISTS[id];
  const request = job.request.trim();
  if (!request) throw new Error("request wajib diisi");

  await logActivity(env, "manajer_marketing", "step", `Menugaskan ${sp.name}: ${clip(request, 90)}`, `visit:${id}`);
  await logActivity(env, id, "start", `Mengerjakan: ${clip(request, 100)}`, "mboard");

  const [owner, context, previous] = await Promise.all([
    profile.ownerContext(env),
    memory.autoContext(env, request),
    db.searchNotes(env.DB, "", 5, "marketing"),
  ]);
  const history = previous.length
    ? `\n\nHasil tim marketing sebelumnya (untuk konsistensi, jangan diulang):\n${previous.map((n) => `- ${n.title ?? clip(n.content, 80)}`).join("\n")}`
    : "";

  let result: { text: string; model: string };
  try {
    result = await complete(env, {
      system: sp.brief + TEAM_RULES + owner,
      user: `Tugas dari Manajer Marketing (permintaan pemilik):\n${request}${context ? `\n\n${context}` : ""}${history}`,
      tier: CONTENT_WRITERS.includes(id) ? "smart" : "fast",
      actor: id,
      maxTokens: CONTENT_WRITERS.includes(id) ? 6000 : undefined,
    });
  } catch (err) {
    await logActivity(env, id, "error", `Gagal mengerjakan: ${String(err)}`);
    throw err;
  }

  const noteId = await db.addNote(env.DB, {
    title: `${sp.name}: ${clip(request, 70)}`,
    content: result.text,
    tags: `marketing, ${id}`,
  });
  await memory.indexNote(env, noteId);
  await logActivity(env, id, "done", `Selesai (${modelLabel(env, result.model)}) → catatan #${noteId}: ${clip(result.text, 120)}`);
  await logActivity(env, "manajer_marketing", "done", `Menerima hasil ${sp.name} (catatan #${noteId})`);
  return { text: result.text, noteId, name: `${sp.name} · ${modelLabel(env, result.model)}` };
}
