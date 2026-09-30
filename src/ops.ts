import type { Env } from "./env";
import * as db from "./db";
import { logActivity } from "./activity";

// Manajer Operasional: memeriksa kesehatan tim AI (tanpa AI, murni dari data) untuk briefing.

const NAMES: Record<string, string> = {
  haiku: "Haiku",
  opus: "Opus",
  gemma: "Gemma",
  whisper: "Whisper",
  pengingat: "Pengingat",
  briefing: "Briefing",
  claude: "Claude (MCP)",
  copywriter: "Copywriter",
  konten: "Perencana Konten",
  analis: "Analis Iklan",
  riset: "Riset",
};

/** Laporan singkat 24 jam terakhir: kendala per agen, jatah Puter, beban kerja, tugas yang tertinggal. */
export async function opsReport(env: Env): Promise<string> {
  await logActivity(env, "manajer_ops", "start", "Memeriksa kesehatan tim", "board");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const now = new Date().toISOString();
  const [errors, work, overdue, pending] = await Promise.all([
    env.DB.prepare(
      "SELECT agent, count(*) AS n, max(summary) AS last FROM activity WHERE kind = 'error' AND created_at >= ? GROUP BY agent",
    )
      .bind(since)
      .all<{ agent: string; n: number; last: string }>(),
    env.DB.prepare("SELECT agent, count(*) AS n FROM activity WHERE kind = 'done' AND created_at >= ? GROUP BY agent ORDER BY n DESC")
      .bind(since)
      .all<{ agent: string; n: number }>(),
    db.listTasks(env.DB, { statuses: ["open"], overdueBefore: now }),
    db.listTasks(env.DB, { statuses: ["pending"] }),
  ]);

  const lines: string[] = [];
  const puterOut = errors.results.some((e) => e.last.includes("Jatah Puter habis"));
  if (puterOut) lines.push("- Jatah Claude (Puter) habis: tim memakai otak cadangan Gemma sampai jatahnya terisi lagi.");
  for (const e of errors.results.filter((e) => !e.last.includes("Jatah Puter habis"))) {
    lines.push(`- ${NAMES[e.agent] ?? e.agent}: ${e.n} kendala, terakhir "${e.last.slice(0, 120)}"`);
  }
  if (!lines.length) lines.push("- Semua agen normal, tidak ada kendala.");
  if (work.results.length) {
    lines.push(`- Pekerjaan selesai 24 jam: ${work.results.map((w) => `${NAMES[w.agent] ?? w.agent} ${w.n}`).join(", ")}.`);
  }
  if (overdue.length) lines.push(`- ${overdue.length} tugas pemilik terlewat deadline.`);
  if (pending.length) lines.push(`- ${pending.length} usulan tugas menunggu approval pemilik.`);

  const issues = errors.results.length;
  await logActivity(env, "manajer_ops", "done", issues ? `Cek tim: ${issues} agen ada kendala` : "Cek tim: semua normal");
  return lines.join("\n");
}
