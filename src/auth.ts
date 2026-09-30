import type { Env } from "./env";
import { Telegram } from "./telegram";

// Login website admin tanpa password: kode 6 digit dikirim ke Telegram pemilik,
// lalu ditukar dengan cookie sesi. Di database hanya disimpan hash-nya.

const CODE_TTL_MS = 5 * 60_000;
const CODE_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
export const SESSION_TTL_S = 30 * 24 * 3600;

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashCode = (env: Env, code: string) => sha256(`${code}:${env.TELEGRAM_WEBHOOK_SECRET}`);

export async function requestCode(env: Env): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const last = await env.DB.prepare("SELECT created_at FROM login_codes ORDER BY id DESC LIMIT 1").first<{
    created_at: string;
  }>();
  const since = last ? Date.now() - Date.parse(last.created_at) : Infinity;
  if (since < CODE_COOLDOWN_MS) return { ok: false, retryAfter: Math.ceil((CODE_COOLDOWN_MS - since) / 1000) };

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes"),
    env.DB.prepare("INSERT INTO login_codes (code_hash, expires_at) VALUES (?, ?)").bind(
      await hashCode(env, code),
      new Date(Date.now() + CODE_TTL_MS).toISOString(),
    ),
  ]);
  await new Telegram(env.TELEGRAM_BOT_TOKEN).send(
    env.OWNER_CHAT_ID,
    `🔐 Kode login website admin: ${code}\n\nBerlaku 5 menit. Kalau kamu tidak sedang login, abaikan pesan ini.`,
  );
  return { ok: true };
}

/** Kode benar → token sesi baru. Salah → null. */
export async function verifyCode(env: Env, code: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id, code_hash, attempts FROM login_codes WHERE expires_at > ? ORDER BY id DESC LIMIT 1",
  )
    .bind(new Date().toISOString())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row) return null;

  if (row.attempts >= MAX_ATTEMPTS || (await hashCode(env, code.trim())) !== row.code_hash) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return null;
  }

  const token = randomToken();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes"),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").bind(
      await sha256(token),
      new Date(Date.now() + SESSION_TTL_S * 1000).toISOString(),
    ),
  ]);
  return token;
}

function readSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(cookie);
  return m ? m[1] : null;
}

export async function isLoggedIn(env: Env, req: Request): Promise<boolean> {
  const token = readSessionToken(req);
  if (!token) return false;
  const row = await env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), new Date().toISOString())
    .first();
  return !!row;
}

export async function logout(env: Env, req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export function sessionCookie(token: string | null): string {
  return token
    ? `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
    : "sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
