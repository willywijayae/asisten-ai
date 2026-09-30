import type { TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  JOBS: Queue<TgUpdate>;
  AI: Ai;
  /** Token akun Puter (opsional). Kalau ada, otak utama = Claude via Puter. */
  PUTER_AUTH_TOKEN?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  /** Model Claude di Puter, mis. claude-opus-5-5. */
  MODEL: string;
  /** Model Workers AI gratis sebagai cadangan. */
  FALLBACK_MODEL: string;
  TIMEZONE_OFFSET: string;
}
