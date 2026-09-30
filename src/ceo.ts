import type { Env } from "./env";
import * as db from "./db";
import * as profile from "./profile";
import * as memory from "./memory";
import { clip, logActivity } from "./activity";
import { complete } from "./agent";
import { opsReport } from "./ops";
import { Telegram } from "./telegram";
import { localDayRange } from "./time";
import { FOCUS_KEY, type WeeklyFocus } from "./profile";

// CEO: review mingguan seluruh tim + menetapkan "fokus minggu ini" yang ikut dibaca semua agen.

/** Ambil poin di bawah judul "FOKUS MINGGU INI". */
function parseFocus(text: string): string[] {
  const idx = text.toUpperCase().lastIndexOf("FOKUS MINGGU INI");
  if (idx < 0) return [];
  return text
    .slice(idx)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /^([-•*]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([-•*]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

const PROMPT = `Kamu CEO tim AI pribadi milik pemilik. Di bawahmu ada Manajer Operasional (Haiku, Opus, Whisper, Gemma, Pengingat, Briefing, Claude) dan Manajer Marketing (Copywriter, Perencana Konten, Analis Iklan, Riset).
Tugasmu: review mingguan yang jujur dan arahan yang konkret. Susun dalam teks biasa (tanpa tabel markdown, tanpa **tebal**):
1. Ringkasan minggu ini (pakai angka dari data).
2. Yang berjalan baik.
3. Yang tertinggal / risiko: tugas terlewat, hal yang menggantung, dan seberapa jauh dari target di profil pemilik.
4. Arahan untuk Manajer Operasional (1-3 poin) dan Manajer Marketing (1-3 poin).
5. Bagian terakhir berjudul persis "FOKUS MINGGU INI:" berisi 3 poin singkat, masing-masing diawali "- ".
Maksimal ~300 kata. Jangan mengarang angka; kalau data kosong, katakan apa adanya.`;

/** Review mingguan CEO: kirim ke Telegram, simpan sebagai catatan, dan tetapkan fokus minggu ini. */
export async function weeklyReview(env: Env): Promise<{ text: string; focus: string[]; noteId: number }> {
  const tz = env.TIMEZONE_OFFSET;
  const now = new Date().toISOString();
  const weekStart = localDayRange(tz, -6)[0];
  const [, weekEnd] = localDayRange(tz, 7);
  await logActivity(env, "ceo", "start", "Menyusun review mingguan", "board");

  const fmt = (ts: db.Task[]) => (ts.length ? ts.map((t) => "- " + db.formatTask(t, tz)).join("\n") : "(tidak ada)");
  const [done, overdue, upcoming, open, memories, marketing, work] = await Promise.all([
    db.listTasks(env.DB, { statuses: ["done"], doneFrom: weekStart, limit: 100 }),
    db.listTasks(env.DB, { statuses: ["open"], overdueBefore: now }),
    db.listTasks(env.DB, { statuses: ["open"], dueFrom: now, dueTo: weekEnd }),
    env.DB.prepare("SELECT count(*) AS n FROM tasks WHERE status = 'open'").first<{ n: number }>(),
    env.DB.prepare("SELECT content FROM memories WHERE created_at >= ? ORDER BY id DESC LIMIT 25")
      .bind(weekStart)
      .all<{ content: string }>(),
    db.searchNotes(env.DB, "", 30, "marketing"),
    env.DB.prepare("SELECT agent, count(*) AS n FROM activity WHERE kind = 'done' AND created_at >= ? GROUP BY agent")
      .bind(weekStart)
      .all<{ agent: string; n: number }>(),
  ]);
  const ops = await opsReport(env);
  await logActivity(env, "ceo", "step", "Membaca laporan divisi marketing", "mboard");
  const marketingWeek = marketing.filter((n) => n.created_at >= weekStart);

  const data = `SELESAI MINGGU INI (${done.length}):\n${fmt(done)}

TERLEWAT DEADLINE (${overdue.length}):\n${fmt(overdue)}

7 HARI KE DEPAN:\n${fmt(upcoming)}

Total tugas aktif: ${open?.n ?? 0}

FAKTA BARU DI MEMORI MINGGU INI:\n${memories.results.map((m) => `- ${m.content}`).join("\n") || "(tidak ada)"}

HASIL DIVISI MARKETING MINGGU INI (${marketingWeek.length}):\n${marketingWeek.map((n) => `- ${n.title ?? clip(n.content, 80)}`).join("\n") || "(tidak ada)"}

PEKERJAAN SELESAI PER AGEN (7 hari): ${work.results.map((w) => `${w.agent} ${w.n}`).join(", ") || "(tidak ada)"}

LAPORAN MANAJER OPERASIONAL (24 jam):\n${ops}`;

  const owner = await profile.ownerContext(env);
  let text: string;
  try {
    ({ text } = await complete(env, { system: PROMPT + owner, user: data, tier: "smart", actor: "ceo" }));
  } catch (err) {
    await logActivity(env, "ceo", "error", `Review gagal: ${String(err)}`);
    throw err;
  }

  const focus = parseFocus(text);
  const localDate = memory.localDate(env, now);
  const noteId = await db.addNote(env.DB, {
    title: `Review mingguan CEO — ${localDate}`,
    content: text,
    tags: "review mingguan, ceo",
  });
  await memory.indexNote(env, noteId);
  if (focus.length) await profile.setSetting(env, FOCUS_KEY, JSON.stringify({ items: focus, at: now, noteId } satisfies WeeklyFocus));

  if (env.OWNER_CHAT_ID) {
    await new Telegram(env.TELEGRAM_BOT_TOKEN)
      .send(env.OWNER_CHAT_ID, `👔 Review Mingguan CEO\n\n${text}`)
      .catch((err) => console.error("Gagal kirim review ke Telegram", err));
  }
  await logActivity(env, "ceo", "done", focus.length ? `Fokus minggu ini: ${focus.join(" · ")}` : `Review terkirim (catatan #${noteId})`);
  await Promise.all([
    logActivity(env, "manajer_ops", "done", "Menerima arahan CEO"),
    logActivity(env, "manajer_marketing", "done", "Menerima arahan CEO"),
  ]);
  return { text, focus, noteId };
}
