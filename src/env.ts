import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  JOBS: Queue<TgUpdate>;
  AI: Ai;
  /** Indeks vektor memori jangka panjang & catatan. */
  VECTORIZE: Vectorize;
  /** Token akun Puter (opsional). Kalau ada, otak utama = Claude via Puter. */
  PUTER_AUTH_TOKEN?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  /** Model Claude (Puter) untuk pekerjaan rutin, mis. claude-haiku-4-5. */
  MODEL_FAST: string;
  /** Model Claude (Puter) untuk permintaan rumit, mis. claude-opus-5-5. */
  MODEL_SMART: string;
  /** Model Workers AI gratis sebagai cadangan. */
  FALLBACK_MODEL: string;
  TIMEZONE_OFFSET: string;
  /** URL publik Worker, dipakai untuk metadata OAuth/MCP. */
  PUBLIC_URL: string;
  /** Penyimpanan OAuth (konektor MCP) & helper yang disuntikkan OAuthProvider. */
  OAUTH_KV: KVNamespace;
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
}
