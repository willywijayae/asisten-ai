import type { Env } from "./env";

// Jejak kerja para agen, dibaca Kantor 3D di website admin. Mencatat aktivitas tidak boleh
// pernah menggagalkan pekerjaan utamanya, jadi semua error di sini hanya di-log.

export const AGENTS = [
  "ceo",
  "manajer_ops",
  "haiku",
  "opus",
  "gemma",
  "whisper",
  "pengingat",
  "briefing",
  "claude",
  "manajer_marketing",
  "copywriter",
  "konten",
  "analis",
  "riset",
] as const;
export type AgentId = (typeof AGENTS)[number];
export type ActivityKind = "start" | "step" | "done" | "error";
/** Tempat yang didatangi di kantor; "visit:<agen>" = menghampiri meja agen lain. */
export type Spot = "board" | "cabinet" | "mail" | "profile" | "mboard" | `visit:${string}`;

export interface Activity {
  id: number;
  agent: AgentId;
  kind: ActivityKind;
  summary: string;
  spot: Spot | null;
  created_at: string;
}

export const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
};

export async function logActivity(
  env: Env,
  agent: AgentId,
  kind: ActivityKind,
  summary: string,
  spot: Spot | null = null,
): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO activity (agent, kind, summary, spot) VALUES (?, ?, ?, ?)")
      .bind(agent, kind, clip(summary, 240), spot)
      .run();
  } catch (err) {
    console.error("Gagal mencatat aktivitas", err);
  }
}

/** Label aktivitas per tool agen + tempat yang didatangi di kantor. */
export const TOOL_ACTIVITY: Record<string, { label: string; spot?: Spot }> = {
  add_task: { label: "Mencatat tugas", spot: "board" },
  add_tasks: { label: "Mencatat beberapa tugas", spot: "board" },
  propose_tasks: { label: "Mengusulkan tugas", spot: "board" },
  list_tasks: { label: "Mengecek papan tugas", spot: "board" },
  update_task: { label: "Mengubah tugas", spot: "board" },
  save_note: { label: "Menyimpan catatan", spot: "cabinet" },
  add_note: { label: "Menyimpan catatan", spot: "cabinet" },
  update_note: { label: "Mengubah catatan", spot: "cabinet" },
  search_notes: { label: "Mencari di arsip catatan", spot: "cabinet" },
  get_overview: { label: "Melihat ringkasan hari ini", spot: "board" },
  remember_preference: { label: "Mengingat preferensi baru", spot: "profile" },
  add_preference: { label: "Mengingat preferensi baru", spot: "profile" },
  forget_preference: { label: "Menghapus preferensi", spot: "profile" },
  save_profile: { label: "Memperbarui profil", spot: "profile" },
  get_profile: { label: "Membaca profil pemilik", spot: "profile" },
  get_competitor_watchlist: { label: "Membaca daftar pantauan kompetitor", spot: "mboard" },
  save_competitor_ads: { label: "Menyetor hasil scan iklan kompetitor", spot: "visit:riset" },
  get_competitor_ads: { label: "Membaca iklan kompetitor", spot: "mboard" },
  track_competitor: { label: "Menambah kompetitor ke pantauan", spot: "mboard" },
  delegate_marketing: { label: "Menyerahkan ke tim marketing", spot: "visit:manajer_marketing" },
  search_memory: { label: "Mencari di memori jangka panjang", spot: "cabinet" },
  remember_fact: { label: "Mengingat fakta baru", spot: "cabinet" },
  gmail_search: { label: "Membuka Gmail", spot: "mail" },
  gmail_read: { label: "Membaca email", spot: "mail" },
  gmail_draft: { label: "Menulis draf email", spot: "mail" },
  drive_search: { label: "Mencari di Drive", spot: "mail" },
  drive_read: { label: "Membaca dokumen Drive", spot: "mail" },
  drive_save: { label: "Menyimpan ke Drive", spot: "mail" },
};

/** Catat pemanggilan tool; hasil tulis (baris pertama) ikut supaya jelas apa yang terjadi. */
export function logTool(env: Env, agent: AgentId, name: string, result?: string): Promise<void> {
  const info = TOOL_ACTIVITY[name] ?? { label: name };
  const first = result?.split("\n").find((l) => l.trim()) ?? "";
  const detail = first && !first.startsWith("ERROR") ? ` — ${clip(first, 120)}` : "";
  return logActivity(env, agent, first.startsWith("ERROR") ? "error" : "step", info.label + detail, info.spot ?? null);
}

export interface AgentState {
  id: AgentId;
  lastKind: ActivityKind | null;
  lastSummary: string | null;
  lastSpot: Spot | null;
  lastAt: string | null;
  today: number;
}

/** Keadaan kantor: status tiap agen (dari aktivitas terakhirnya) + umpan aktivitas terbaru. */
export async function officeState(env: Env, since: string): Promise<{ agents: AgentState[]; feed: Activity[] }> {
  const [latest, counts, feed] = await Promise.all([
    env.DB.prepare(
      "SELECT a.* FROM activity a JOIN (SELECT agent, max(id) AS id FROM activity GROUP BY agent) m ON a.id = m.id",
    ).all<Activity>(),
    env.DB.prepare("SELECT agent, count(*) AS n FROM activity WHERE created_at >= ? AND kind != 'step' GROUP BY agent")
      .bind(since)
      .all<{ agent: AgentId; n: number }>(),
    env.DB.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 40").all<Activity>(),
  ]);
  const byAgent = new Map(latest.results.map((a) => [a.agent, a]));
  const countBy = new Map(counts.results.map((c) => [c.agent, c.n]));
  return {
    agents: AGENTS.map((id) => {
      const a = byAgent.get(id);
      return {
        id,
        lastKind: a?.kind ?? null,
        lastSummary: a?.summary ?? null,
        lastSpot: a?.spot ?? null,
        lastAt: a?.created_at ?? null,
        today: countBy.get(id) ?? 0,
      };
    }),
    feed: feed.results,
  };
}

export async function pruneActivity(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  await env.DB.prepare("DELETE FROM activity WHERE created_at < ?").bind(cutoff).run();
}
