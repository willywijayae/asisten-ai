// Para "karyawan" AI di Kantor 3D. Tiap karakter = satu bagian nyata dari sistem asisten.

export type AgentId = "haiku" | "opus" | "gemma" | "whisper" | "pengingat" | "briefing" | "claude";
export type Spot = "board" | "cabinet" | "mail" | "profile";
export type ActivityKind = "start" | "step" | "done" | "error";

export interface Look {
  skin: string;
  hair: string;
  hairStyle: "short" | "long" | "spiky" | "bun" | "none";
  top: string;
  bottom: string;
  extra?: "glasses" | "headset" | "cap" | "tie" | "antenna" | "scarf";
  extraColor?: string;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  role: string;
  about: string;
  color: string;
  look: Look;
  /** Posisi meja [x, z]; karakter duduk di belakangnya menghadap kamera. */
  desk: [number, number];
}

export const ROSTER: AgentDef[] = [
  {
    id: "haiku",
    name: "Haiku",
    role: "Pencatat cepat",
    about: "Menerima semua pesan Telegram & website, mencatat tugas, catatan, dan pengingat.",
    color: "#22c55e",
    look: { skin: "#f1c27d", hair: "#2b1d14", hairStyle: "short", top: "#3b82f6", bottom: "#1e293b" },
    desk: [-3.5, -1.5],
  },
  {
    id: "opus",
    name: "Opus",
    role: "Ahli strategi",
    about: "Dipanggil Haiku (atau lewat /opus) untuk pekerjaan kompleks: analisis, perencanaan, strategi.",
    color: "#a855f7",
    look: { skin: "#e0ac69", hair: "#111827", hairStyle: "spiky", top: "#6d28d9", bottom: "#111827", extra: "glasses" },
    desk: [0, -1.5],
  },
  {
    id: "whisper",
    name: "Whisper",
    role: "Pendengar voice note",
    about: "Mengubah voice note Telegram jadi teks (Whisper di Workers AI), lalu diteruskan ke Haiku.",
    color: "#06b6d4",
    look: { skin: "#ffdbac", hair: "#7c2d12", hairStyle: "long", top: "#0e7490", bottom: "#334155", extra: "headset", extraColor: "#e2e8f0" },
    desk: [3.5, -1.5],
  },
  {
    id: "gemma",
    name: "Gemma",
    role: "Juru arsip & cadangan",
    about: "Model gratis Workers AI: mengarsipkan fakta penting dari tiap obrolan ke memori jangka panjang, dan menggantikan saat Claude lewat Puter tidak bisa dihubungi.",
    color: "#f59e0b",
    look: { skin: "#cbd5e1", hair: "#64748b", hairStyle: "none", top: "#475569", bottom: "#1f2937", extra: "antenna", extraColor: "#f59e0b" },
    desk: [7, -1.5],
  },
  {
    id: "pengingat",
    name: "Pengingat",
    role: "Penjaga jadwal",
    about: "Mengecek jadwal tiap 5 menit dan mengirim pengingat ke Telegram tepat waktu.",
    color: "#ef4444",
    look: { skin: "#8d5524", hair: "#0f0f0f", hairStyle: "short", top: "#dc2626", bottom: "#1e293b", extra: "cap", extraColor: "#1f2937" },
    desk: [-3.5, 2.5],
  },
  {
    id: "briefing",
    name: "Briefing",
    role: "Penyusun laporan",
    about: "Menyusun briefing pagi (07:00) dan rekap malam (21:00 WIB), termasuk email penting.",
    color: "#3b82f6",
    look: { skin: "#f1c27d", hair: "#3f2a1d", hairStyle: "bun", top: "#f8fafc", bottom: "#1e3a8a", extra: "tie", extraColor: "#2563eb" },
    desk: [0, 2.5],
  },
  {
    id: "claude",
    name: "Claude",
    role: "Tamu via MCP",
    about: "Claude di claude.ai yang terhubung lewat konektor Second Brain: baca & ubah tugas, catatan, profil.",
    color: "#d97757",
    look: { skin: "#f5d0b0", hair: "#5b3a29", hairStyle: "short", top: "#d97757", bottom: "#3f3f46", extra: "scarf", extraColor: "#fde68a" },
    desk: [3.5, 2.5],
  },
];

export const AGENT_BY_ID = Object.fromEntries(ROSTER.map((a) => [a.id, a])) as Record<AgentId, AgentDef>;

export interface AgentState {
  id: AgentId;
  lastKind: ActivityKind | null;
  lastSummary: string | null;
  lastSpot: Spot | null;
  lastAt: string | null;
  today: number;
}

export interface Activity {
  id: number;
  agent: AgentId;
  kind: ActivityKind;
  summary: string;
  spot: Spot | null;
  created_at: string;
}

export interface OfficeData {
  now: string;
  agents: AgentState[];
  feed: Activity[];
  counts: { open: number; pending: number; overdue: number; doneToday: number; notes: number };
  models: { haiku: string; opus: string; gemma: string };
  puterConnected: boolean;
}

export type Mood = "working" | "visiting" | "talking" | "error" | "idle" | "standby";

export interface Status {
  mood: Mood;
  /** Teks gelembung (kalau ada). */
  bubble: string | null;
  spot: Spot | null;
}

/** Terjemahkan aktivitas terakhir jadi suasana hati karakter. `skew` = jam server − jam browser. */
export function statusOf(a: AgentState | undefined, skew: number, puterConnected: boolean): Status {
  const idle: Status = { mood: a?.id === "gemma" && puterConnected ? "standby" : "idle", bubble: null, spot: null };
  if (!a?.lastAt || !a.lastKind) return idle;
  const age = (Date.now() + skew - Date.parse(a.lastAt)) / 1000;
  if (a.lastKind === "step" && a.lastSpot && age < 25) return { mood: "visiting", bubble: a.lastSummary, spot: a.lastSpot };
  if ((a.lastKind === "start" || a.lastKind === "step") && age < 180) return { mood: "working", bubble: a.lastSummary, spot: null };
  if (a.lastKind === "done" && age < 20) return { mood: "talking", bubble: a.lastSummary, spot: null };
  if (a.lastKind === "error" && age < 600) return { mood: "error", bubble: a.lastSummary, spot: null };
  return idle;
}

export const MOOD_LABEL: Record<Mood, string> = {
  working: "Sedang bekerja",
  visiting: "Sedang bekerja",
  talking: "Baru selesai",
  error: "Ada kendala",
  idle: "Santai",
  standby: "Siaga",
};
