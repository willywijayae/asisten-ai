// Penyimpanan kunci/token dari halaman Pengaturan. Nilai dienkripsi AES-GCM di tabel `settings` (D1),
// kuncinya diturunkan dari ENCRYPTION_KEY (cadangan: TELEGRAM_WEBHOOK_SECRET). Nilai tidak pernah dikirim
// kembali ke browser — hanya status "terisi" dan 4 karakter terakhir.
import type { Env } from "./env";
import * as profile from "./profile";

export interface FieldDef {
  key: string;
  label: string;
  group: "meta" | "ai" | "akses";
  secret: boolean;
  hint: string;
  placeholder?: string;
}

// Hanya kunci yang aman diganti dari web. Bot Telegram & Hermes sengaja tidak termasuk: salah isi = asisten terkunci.
export const FIELDS: FieldDef[] = [
  { key: "META_ACCESS_TOKEN", label: "Meta Access Token", group: "meta", secret: true, hint: "System User token (izin ads_read) dari Meta Business Settings. Dipakai sinkronisasi iklan sendiri." },
  { key: "META_AD_ACCOUNT_ID", label: "Meta Ad Account ID", group: "meta", secret: false, hint: "Angka akun iklan, dengan atau tanpa awalan act_.", placeholder: "act_1234567890" },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", group: "ai", secret: true, hint: "Studio Konten: video otomatis lewat Sora." },
  { key: "XAI_API_KEY", label: "xAI API key", group: "ai", secret: true, hint: "Studio Konten: video otomatis lewat Grok Imagine." },
  { key: "JEV_API_KEY", label: "Jev AI API key", group: "ai", secret: true, hint: "Opsional, penilaian iklan kompetitor. Kosong = dinilai tim AI sendiri." },
  { key: "INGEST_KEY", label: "Ingest key", group: "akses", secret: true, hint: "Kunci header x-ingest-key untuk skrip luar (scan kompetitor, iklan sendiri, VOC)." },
];
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));

const prefix = "cfg:";
const MCP_KEY = "cfg:mcp_connectors";

const material = (env: Env) => env.ENCRYPTION_KEY || env.TELEGRAM_WEBHOOK_SECRET || "";
export const canStore = (env: Env) => !!material(env);

async function cryptoKey(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cfg-v1:${material(env)}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(env), new TextEncoder().encode(plain));
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString("base64");
}

export async function decrypt(env: Env, enc: string): Promise<string> {
  const buf = Buffer.from(enc, "base64");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await cryptoKey(env), buf.subarray(12));
  return new TextDecoder().decode(pt);
}

const mask = (v: string) => (v.length < 16 ? "••••" : `••••${v.slice(-4)}`);

async function readStored(env: Env, key: string): Promise<string | null> {
  const row = await profile.getSetting(env, prefix + key);
  if (!row?.value) return null;
  try {
    return await decrypt(env, row.value);
  } catch {
    return null; // kunci enkripsi berubah / data rusak → anggap kosong
  }
}

// Menumpuk nilai tersimpan ke objek env (menang atas secret Worker). Di-cache singkat agar tidak query D1 tiap request.
type Mutable = Record<string, string | undefined>;
let cache: { at: number; values: Record<string, string> } | null = null;
const TTL_MS = 30_000;

export async function applyStoredConfig(env: Env): Promise<void> {
  if (!canStore(env)) return;
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const values: Record<string, string> = {};
    try {
      const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'cfg:%' AND key != ?").bind(MCP_KEY).all<{ key: string; value: string | null }>();
      for (const r of results) {
        const k = r.key.slice(prefix.length);
        if (!FIELD_KEYS.has(k) || !r.value) continue;
        try { values[k] = await decrypt(env, r.value); } catch { /* lewati */ }
      }
    } catch {
      return; // tabel belum ada / D1 error: pakai env apa adanya
    }
    cache = { at: Date.now(), values };
  }
  for (const [k, v] of Object.entries(cache.values)) (env as unknown as Mutable)[k] = v;
}

export function invalidate(): void {
  cache = null;
}

export interface FieldStatus {
  key: string; label: string; group: string; secret: boolean; hint: string; placeholder?: string;
  set: boolean; source: "web" | "worker" | null; preview: string | null;
}

export async function status(env: Env): Promise<{ canStore: boolean; fields: FieldStatus[] }> {
  const fields: FieldStatus[] = [];
  for (const f of FIELDS) {
    const stored = canStore(env) ? await readStored(env, f.key) : null;
    // Nilai env bisa sudah tertimpa oleh applyStoredConfig; bedakan dengan membandingkan ke stored.
    const envVal = (env as unknown as Mutable)[f.key];
    const set = !!(stored || envVal);
    const val = stored || envVal || "";
    fields.push({
      key: f.key, label: f.label, group: f.group, secret: f.secret, hint: f.hint, placeholder: f.placeholder,
      set, source: stored ? "web" : envVal ? "worker" : null,
      preview: set ? (f.secret ? mask(val) : val) : null,
    });
  }
  return { canStore: canStore(env), fields };
}

export async function save(env: Env, values: Record<string, unknown>): Promise<{ saved: string[]; cleared: string[] }> {
  if (!canStore(env)) throw new Error("Set dulu ENCRYPTION_KEY (secret Worker) agar kunci bisa disimpan terenkripsi.");
  const saved: string[] = [];
  const cleared: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (!FIELD_KEYS.has(key)) throw new Error(`Kunci tidak dikenal: ${key}`);
    if (raw === null) { // hapus nilai tersimpan → kembali ke secret Worker (kalau ada)
      await profile.setSetting(env, prefix + key, null);
      cleared.push(key);
      continue;
    }
    let v = String(raw).trim();
    if (!v) continue; // kosong = tidak diubah
    if (v.length > 2000 || /[\r\n]/.test(v)) throw new Error(`${key}: nilai tidak valid`);
    if (key === "META_AD_ACCOUNT_ID") {
      v = v.replace(/^act_/i, "");
      if (!/^\d{5,20}$/.test(v)) throw new Error("Ad Account ID harus berupa angka (boleh diawali act_).");
    }
    if (key === "INGEST_KEY" && v.length < 16) throw new Error("Ingest key minimal 16 karakter.");
    await profile.setSetting(env, prefix + key, await encrypt(env, v));
    saved.push(key);
  }
  invalidate();
  return { saved, cleared };
}

export function generateKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(b).toString("base64url");
}

// --- Konektor MCP (mis. Meta Ads / Ryze): daftar URL + token opsional, token terenkripsi ---

export interface McpConnector { id: string; name: string; url: string; token: string | null; added_at: string }
export interface McpPublic { id: string; name: string; url: string; has_token: boolean; token_preview: string | null; added_at: string }

async function loadMcp(env: Env): Promise<McpConnector[]> {
  const row = await profile.getSetting(env, MCP_KEY);
  if (!row?.value) return [];
  try {
    const list = JSON.parse(await decrypt(env, row.value)) as McpConnector[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function storeMcp(env: Env, list: McpConnector[]): Promise<void> {
  await profile.setSetting(env, MCP_KEY, list.length ? await encrypt(env, JSON.stringify(list)) : null);
}

export async function listMcp(env: Env): Promise<McpPublic[]> {
  if (!canStore(env)) return [];
  return (await loadMcp(env)).map((c) => ({
    id: c.id, name: c.name, url: c.url, has_token: !!c.token, token_preview: c.token ? mask(c.token) : null, added_at: c.added_at,
  }));
}

export async function addMcp(env: Env, name: string, url: string, token: string): Promise<McpPublic[]> {
  if (!canStore(env)) throw new Error("Set dulu ENCRYPTION_KEY (secret Worker) agar token bisa disimpan terenkripsi.");
  name = name.trim().slice(0, 60);
  if (!name) throw new Error("Nama konektor wajib diisi.");
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new Error("URL tidak valid."); }
  if (u.protocol !== "https:") throw new Error("URL harus https://");
  if (u.username || u.password) throw new Error("Jangan taruh kredensial di URL; isi di kolom token.");
  const list = await loadMcp(env);
  if (list.length >= 20) throw new Error("Maksimal 20 konektor.");
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error("Nama konektor sudah dipakai.");
  list.push({ id: crypto.randomUUID().slice(0, 8), name, url: u.toString(), token: token.trim() || null, added_at: new Date().toISOString() });
  await storeMcp(env, list);
  return listMcp(env);
}

export async function removeMcp(env: Env, id: string): Promise<boolean> {
  const list = await loadMcp(env);
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  await storeMcp(env, next);
  return true;
}

// Uji koneksi: kirim JSON-RPC `initialize` (MCP streamable HTTP). 401 tanpa token = server hidup tapi butuh OAuth/token.
export async function testMcp(env: Env, id: string): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const c = (await loadMcp(env)).find((x) => x.id === id);
  if (!c) throw new Error("Konektor tidak ditemukan");
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "asisten-ai", version: "1" } } }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = (await res.text()).slice(0, 400);
    if (res.ok) return { ok: true, status: res.status, detail: /serverInfo|"result"/.test(text) ? "Server MCP merespons initialize." : "Server merespons, tetapi bukan jawaban initialize yang dikenali." };
    if (res.status === 401 || res.status === 403)
      return { ok: false, status: res.status, detail: c.token ? "Token ditolak server." : "Server hidup, tetapi butuh token/OAuth (isi token, atau pakai OAuth lewat klien MCP)." };
    return { ok: false, status: res.status, detail: `Server membalas ${res.status}.` };
  } catch (e) {
    return { ok: false, status: null, detail: `Tidak terjangkau: ${e instanceof Error ? e.message : String(e)}` };
  }
}
