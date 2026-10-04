import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { TgUpdate } from "./telegram";

/** Pesan antrean: update Telegram, atau pekerjaan latar belakang yang lama (mis. bikin konten). */
export type JobMessage =
  | TgUpdate
  | { type: "remix"; remixId: number }
  | { type: "studio"; projectId: number; stage: "avatar" | "produk" | "storyboard"; options?: Record<string, unknown> }
  | { type: "video"; clipId: number };

export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  AI: Ai;
  /** Indeks vektor memori jangka panjang & catatan. */
  VECTORIZE: Vectorize;
  /** Endpoint Hermes lokal (otak utama via smartcombo router). */
  HERMES_API_ENDPOINT: string;
  /** Token rahasia untuk memanggil Hermes (secret). */
  HERMES_API_KEY: string;
  /** Nama model di router lokal: tingkat cepat & ahli (juga label di dashboard). */
  MODEL_FAST: string;
  MODEL_SMART: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  /** Nama panggilan pemilik (dipakai di sapaan & prompt). Kosong = "pemilik". */
  OWNER_NAME?: string;
  /** Model Workers AI gratis sebagai cadangan. */
  FALLBACK_MODEL: string;
  TIMEZONE_OFFSET: string;
  /** URL publik Worker untuk metadata OAuth/MCP. Kosong = diambil dari alamat request. */
  PUBLIC_URL: string;
  /** Penyimpanan OAuth (konektor MCP) & helper yang disuntikkan OAuthProvider. */
  OAUTH_KV: KVNamespace;
  /** Media iklan kompetitor (gambar, sampul video, video pemenang). */
  MEDIA: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  /** OAuth client Google (opsional) untuk Gmail & Drive. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Kunci enkripsi token Google di database. */
  ENCRYPTION_KEY?: string;
  /** API key Jev AI (opsional) untuk menilai iklan kompetitor; tanpa ini dinilai tim AI sendiri. */
  JEV_API_KEY?: string;
  JEV_MODEL?: string;
  /** Kunci untuk mengirim hasil scan iklan kompetitor dari luar (mis. tugas terjadwal Claude). */
  INGEST_KEY?: string;
  /** Studio Konten, mode API (opsional): video otomatis lewat OpenAI Sora / xAI Grok Imagine. */
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  SORA_MODEL?: string;
  SORA_SIZE?: string;
  GROK_VIDEO_MODEL?: string;
  /** Meta Marketing API (opsional, bisa diisi dari Pengaturan): sinkronisasi iklan sendiri. */
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID?: string;
}
