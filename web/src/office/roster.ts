// Para "karyawan" AI di Kantor 3D. Tiap karakter = satu bagian nyata dari sistem asisten.

export type AgentId =
  | "ceo"
  | "manajer_ops"
  | "haiku"
  | "opus"
  | "gemma"
  | "whisper"
  | "pengingat"
  | "briefing"
  | "claude"
  | "manajer_marketing"
  | "copywriter"
  | "konten"
  | "analis"
  | "riset";
/** Tempat di kantor; "visit:<agen>" = menghampiri meja agen itu. */
export type Spot = "board" | "cabinet" | "mail" | "profile" | "mboard" | `visit:${AgentId}`;
export type Dept = "pimpinan" | "ops" | "marketing";

export const DEPT_LABEL: Record<Dept, string> = {
  pimpinan: "Pimpinan",
  ops: "Divisi Operasional",
  marketing: "Divisi Marketing",
};
export type ActivityKind = "start" | "step" | "done" | "error";

export interface Look {
  skin: string;
  hair: string;
  hairStyle: "short" | "long" | "spiky" | "bun" | "none";
  top: string;
  bottom: string;
  extra?: "glasses" | "headset" | "cap" | "tie" | "antenna" | "scarf" | "suit" | "beret";
  extraColor?: string;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  role: string;
  about: string;
  color: string;
  dept: Dept;
  /** Atasan langsung (untuk bagan organisasi). */
  reportsTo?: AgentId;
  look: Look;
  /** Posisi meja [x, z]; karakter duduk di belakangnya menghadap kamera. */
  desk: [number, number];
}

export const ROSTER: AgentDef[] = [
  {
    id: "ceo",
    name: "CEO",
    role: "Pimpinan tim AI",
    about: "Review mingguan seluruh tim tiap Minggu 20:00 WIB (atau /review), memberi arahan ke kedua manajer, dan menetapkan \"fokus minggu ini\" yang dibaca semua agen.",
    color: "#0f172a",
    dept: "pimpinan",
    look: { skin: "#e0ac69", hair: "#1f2937", hairStyle: "short", top: "#1e293b", bottom: "#0f172a", extra: "suit", extraColor: "#b91c1c" },
    desk: [18.8, -4.2],
  },
  {
    id: "manajer_ops",
    name: "Mgr. Operasional",
    role: "Manajer operasional",
    about: "Membawahi Haiku, Opus, Whisper, Gemma, Pengingat, Briefing, dan Claude. Memeriksa kesehatan tim tiap briefing dan menghampiri agen yang sedang ada kendala.",
    color: "#0d9488",
    dept: "ops",
    reportsTo: "ceo",
    look: { skin: "#c68642", hair: "#111827", hairStyle: "short", top: "#0f766e", bottom: "#1e293b", extra: "glasses" },
    desk: [0, 5.2],
  },
  {
    id: "haiku",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Haiku",
    role: "Pencatat cepat",
    about: "Menerima semua pesan Telegram & website, mencatat tugas, catatan, dan pengingat.",
    color: "#22c55e",
    look: { skin: "#f1c27d", hair: "#2b1d14", hairStyle: "short", top: "#3b82f6", bottom: "#1e293b" },
    desk: [-3.5, -1.5],
  },
  {
    id: "opus",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Opus",
    role: "Ahli strategi",
    about: "Dipanggil Haiku (atau lewat /opus) untuk pekerjaan kompleks: analisis, perencanaan, strategi.",
    color: "#a855f7",
    look: { skin: "#e0ac69", hair: "#111827", hairStyle: "spiky", top: "#6d28d9", bottom: "#111827", extra: "glasses" },
    desk: [0, -1.5],
  },
  {
    id: "whisper",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Whisper",
    role: "Pendengar voice note",
    about: "Mengubah voice note Telegram jadi teks (Whisper di Workers AI), lalu diteruskan ke Haiku.",
    color: "#06b6d4",
    look: { skin: "#ffdbac", hair: "#7c2d12", hairStyle: "long", top: "#0e7490", bottom: "#334155", extra: "headset", extraColor: "#e2e8f0" },
    desk: [3.5, -1.5],
  },
  {
    id: "gemma",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Gemma",
    role: "Juru arsip & cadangan",
    about: "Model gratis Workers AI: mengarsipkan fakta penting dari tiap obrolan ke memori jangka panjang, dan menggantikan saat Claude lewat Puter tidak bisa dihubungi.",
    color: "#f59e0b",
    look: { skin: "#cbd5e1", hair: "#64748b", hairStyle: "none", top: "#475569", bottom: "#1f2937", extra: "antenna", extraColor: "#f59e0b" },
    desk: [7, -1.5],
  },
  {
    id: "pengingat",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Pengingat",
    role: "Penjaga jadwal",
    about: "Mengecek jadwal tiap 5 menit dan mengirim pengingat ke Telegram tepat waktu.",
    color: "#ef4444",
    look: { skin: "#8d5524", hair: "#0f0f0f", hairStyle: "short", top: "#dc2626", bottom: "#1e293b", extra: "cap", extraColor: "#1f2937" },
    desk: [-3.5, 2.5],
  },
  {
    id: "briefing",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Briefing",
    role: "Penyusun laporan",
    about: "Menyusun briefing pagi (07:00) dan rekap malam (21:00 WIB), termasuk email penting.",
    color: "#3b82f6",
    look: { skin: "#f1c27d", hair: "#3f2a1d", hairStyle: "bun", top: "#f8fafc", bottom: "#1e3a8a", extra: "tie", extraColor: "#2563eb" },
    desk: [0, 2.5],
  },
  {
    id: "claude",
    dept: "ops",
    reportsTo: "manajer_ops",
    name: "Claude",
    role: "Tamu via MCP",
    about: "Claude di claude.ai yang terhubung lewat konektor Second Brain: baca & ubah tugas, catatan, profil.",
    color: "#d97757",
    look: { skin: "#f5d0b0", hair: "#5b3a29", hairStyle: "short", top: "#d97757", bottom: "#3f3f46", extra: "scarf", extraColor: "#fde68a" },
    desk: [3.5, 2.5],
  },
  {
    id: "manajer_marketing",
    name: "Mgr. Marketing",
    role: "Manajer marketing",
    about: "Menerima permintaan marketing dari Haiku, menugaskan spesialis yang tepat, dan menerima hasilnya ke Second Brain (tag marketing).",
    color: "#db2777",
    dept: "marketing",
    reportsTo: "ceo",
    look: { skin: "#f1c27d", hair: "#1f2937", hairStyle: "bun", top: "#be185d", bottom: "#1f2937", extra: "glasses" },
    desk: [12.5, 5.2],
  },
  {
    id: "copywriter",
    name: "Copywriter",
    role: "Copy iklan, hook, caption",
    about: "Menulis copy iklan Meta/TikTok, hook 3 detik pertama, headline, CTA, dan caption dengan beberapa angle.",
    color: "#e11d48",
    dept: "marketing",
    reportsTo: "manajer_marketing",
    look: { skin: "#ffdbac", hair: "#7c2d12", hairStyle: "long", top: "#f43f5e", bottom: "#334155", extra: "beret", extraColor: "#111827" },
    desk: [12.5, -1.5],
  },
  {
    id: "analis",
    name: "Analis Iklan",
    role: "Analisis performa iklan",
    about: "Membaca data iklan (spend, CTR, CPL, ROAS…), mendiagnosa masalah, dan merekomendasikan scale/matikan/tes serta alokasi anggaran.",
    color: "#7c3aed",
    dept: "marketing",
    reportsTo: "manajer_marketing",
    look: { skin: "#8d5524", hair: "#0f0f0f", hairStyle: "short", top: "#6d28d9", bottom: "#1e293b", extra: "glasses" },
    desk: [16, -1.5],
  },
  {
    id: "konten",
    name: "Perencana Konten",
    role: "Ide & kalender konten",
    about: "Menyusun ide konten, pilar konten, dan kalender konten (Reels, TikTok, feed, story, live) yang siap dieksekusi tim.",
    color: "#ea580c",
    dept: "marketing",
    reportsTo: "manajer_marketing",
    look: { skin: "#f1c27d", hair: "#3f2a1d", hairStyle: "spiky", top: "#f97316", bottom: "#1f2937", extra: "headset", extraColor: "#fde68a" },
    desk: [12.5, 2.5],
  },
  {
    id: "riset",
    name: "Riset",
    role: "Riset pasar & strategi",
    about: "Riset pasar, kompetitor, persona audiens, positioning, dan strategi funnel (dari pengetahuan AI & data kamu, tanpa internet).",
    color: "#0891b2",
    dept: "marketing",
    reportsTo: "manajer_marketing",
    look: { skin: "#e0ac69", hair: "#4b5563", hairStyle: "short", top: "#0e7490", bottom: "#334155", extra: "cap", extraColor: "#0f172a" },
    desk: [16, 2.5],
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
  counts: {
    open: number;
    pending: number;
    overdue: number;
    doneToday: number;
    notes: number;
    marketing: number;
    marketingToday: number;
    memories: number;
  };
  focus: { items: string[]; at: string; noteId?: number } | null;
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
  // "start" tanpa "done" = masih bekerja; "step" tanpa kelanjutan (mis. tool MCP, arsip memori) cukup sebentar.
  if ((a.lastKind === "start" && age < 180) || (a.lastKind === "step" && age < 60)) return { mood: "working", bubble: a.lastSummary, spot: null };
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
