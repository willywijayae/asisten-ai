import type { TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  JOBS: Queue<TgUpdate>;
  AI: Ai;
  ANTHROPIC_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  MODEL: string;
  TIMEZONE_OFFSET: string;
}
