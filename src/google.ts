import { Buffer } from "node:buffer";
import type { Env } from "./env";

// Integrasi Gmail & Google Drive lewat OAuth resmi dengan izin minimal:
// baca email + buat draf (tidak pernah mengirim), baca Drive + tulis file buatan app sendiri.
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

const FOLDER_NAME = "Second Brain";

export class GoogleNotConnected extends Error {
  constructor(message = "Google belum dihubungkan. Hubungkan dulu di website admin → Sistem.") {
    super(message);
  }
}

export const googleConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.ENCRYPTION_KEY);

// --- Enkripsi token (AES-GCM, kunci dari ENCRYPTION_KEY) ---

async function key(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), new TextEncoder().encode(plain));
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString("base64");
}

async function decrypt(env: Env, enc: string): Promise<string> {
  const buf = Buffer.from(enc, "base64");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await key(env), buf.subarray(12));
  return new TextDecoder().decode(pt);
}

// --- OAuth ---

const redirectUri = (origin: string) => `${origin}/api/google/callback`;

export async function authUrl(env: Env, origin: string): Promise<string> {
  const state = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)").bind(
      state,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    ),
  ]);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`Google token: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

/** Tukar kode OAuth → simpan token. Mengembalikan email akun. */
export async function handleCallback(env: Env, origin: string, code: string, state: string): Promise<string> {
  const row = await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING state")
    .bind(state, new Date().toISOString())
    .first();
  if (!row) throw new Error("Sesi penghubungan kedaluwarsa, coba lagi dari website.");

  const tok = await tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  if (!tok.refresh_token) throw new Error("Google tidak memberi refresh token. Cabut akses lama di myaccount.google.com lalu coba lagi.");

  const granted = (tok.scope ?? "").split(" ");
  const missing = SCOPES.filter((s) => !granted.includes(s));
  if (missing.length) {
    throw new Error("Semua izin (Gmail & Drive) perlu dicentang saat menghubungkan. Coba lagi dan centang semuanya.");
  }

  const profile = (await (
    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${tok.access_token}` },
    })
  ).json()) as { emailAddress?: string };

  await env.DB.prepare(
    `INSERT INTO google_auth (id, email, refresh_token_enc, access_token_enc, access_expires_at, scopes, folder_id)
     VALUES (1, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token_enc = excluded.refresh_token_enc,
       access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
       scopes = excluded.scopes, connected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(
      profile.emailAddress ?? null,
      await encrypt(env, tok.refresh_token),
      await encrypt(env, tok.access_token),
      new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString(),
      tok.scope ?? "",
    )
    .run();
  return profile.emailAddress ?? "(tidak diketahui)";
}

interface AuthRow {
  email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  folder_id: string | null;
  connected_at: string;
}

export async function status(env: Env): Promise<{ configured: boolean; email: string | null; connectedAt: string | null }> {
  const row = await env.DB.prepare("SELECT email, connected_at FROM google_auth WHERE id = 1").first<AuthRow>();
  return { configured: googleConfigured(env), email: row?.email ?? null, connectedAt: row?.connected_at ?? null };
}

export async function isConnected(env: Env): Promise<boolean> {
  if (!googleConfigured(env)) return false;
  return !!(await env.DB.prepare("SELECT 1 FROM google_auth WHERE id = 1").first());
}

export async function disconnect(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT refresh_token_enc FROM google_auth WHERE id = 1").first<AuthRow>();
  if (row) {
    const token = await decrypt(env, row.refresh_token_enc).catch(() => null);
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
    }
  }
  await env.DB.prepare("DELETE FROM google_auth").run();
}

async function accessToken(env: Env): Promise<string> {
  if (!googleConfigured(env)) throw new GoogleNotConnected("Integrasi Google belum dikonfigurasi.");
  const row = await env.DB.prepare("SELECT * FROM google_auth WHERE id = 1").first<AuthRow>();
  if (!row) throw new GoogleNotConnected();
  if (row.access_token_enc && row.access_expires_at && Date.parse(row.access_expires_at) > Date.now()) {
    return decrypt(env, row.access_token_enc);
  }
  let tok: TokenResponse;
  try {
    tok = await tokenRequest({
      refresh_token: await decrypt(env, row.refresh_token_enc),
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (String(err).includes("invalid_grant") || String(err).includes("expired or revoked")) {
      await env.DB.prepare("DELETE FROM google_auth").run();
      throw new GoogleNotConnected("Akses Google sudah dicabut/kedaluwarsa. Hubungkan ulang di website admin → Sistem.");
    }
    throw err;
  }
  await env.DB.prepare("UPDATE google_auth SET access_token_enc = ?, access_expires_at = ? WHERE id = 1")
    .bind(await encrypt(env, tok.access_token), new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString())
    .run();
  return tok.access_token;
}

async function gapi<T>(env: Env, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await accessToken(env)}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 300)}`);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

// --- Gmail ---

interface GmailPart {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  internalDate: string;
  payload: GmailPart;
}

const header = (m: GmailMessage, name: string) =>
  m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function findPart(part: GmailPart, mime: string): GmailPart | null {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function messageText(m: GmailMessage): string {
  const plain = findPart(m.payload, "text/plain");
  if (plain) return Buffer.from(plain.body!.data!, "base64url").toString("utf8");
  const html = findPart(m.payload, "text/html");
  if (html) {
    return Buffer.from(html.body!.data!, "base64url")
      .toString("utf8")
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return m.snippet;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export async function gmailSearch(env: Env, query: string, max = 10): Promise<EmailSummary[]> {
  const list = await gapi<{ messages?: { id: string }[] }>(
    env,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      q: query,
      maxResults: String(Math.min(Math.max(max, 1), 25)),
    })}`,
  );
  const msgs = await Promise.all(
    (list.messages ?? []).map((m) =>
      gapi<GmailMessage>(
        env,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );
  return msgs.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    from: header(m, "From"),
    subject: header(m, "Subject") || "(tanpa subjek)",
    date: new Date(Number(m.internalDate)).toISOString(),
    snippet: m.snippet,
    unread: m.labelIds?.includes("UNREAD") ?? false,
  }));
}

export async function gmailRead(env: Env, id: string) {
  const m = await gapi<GmailMessage>(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(m, "From"),
    to: header(m, "To"),
    cc: header(m, "Cc"),
    subject: header(m, "Subject"),
    date: new Date(Number(m.internalDate)).toISOString(),
    body: messageText(m).slice(0, 12_000),
  };
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Buat DRAF email (tidak mengirim). Dengan replyToId → draf balasan di thread yang sama. */
export async function gmailDraft(
  env: Env,
  d: { to?: string; subject?: string; body: string; replyToId?: string },
): Promise<{ draftId: string; link: string }> {
  let to = d.to ?? "";
  let subject = d.subject ?? "";
  let threadId: string | undefined;
  const extra: string[] = [];
  if (d.replyToId) {
    const orig = await gapi<GmailMessage>(
      env,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(d.replyToId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`,
    );
    threadId = orig.threadId;
    to ||= header(orig, "Reply-To") || header(orig, "From");
    const origSubject = header(orig, "Subject");
    subject ||= /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
    const msgId = header(orig, "Message-ID");
    if (msgId) extra.push(`In-Reply-To: ${msgId}`, `References: ${[header(orig, "References"), msgId].filter(Boolean).join(" ")}`);
  }
  if (!to) throw new Error("Penerima (to) wajib diisi untuk email baru.");

  const raw = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    ...extra,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(d.body, "utf8").toString("base64"),
  ].join("\r\n");

  const draft = await gapi<{ id: string }>(env, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { raw: Buffer.from(raw, "utf8").toString("base64url"), ...(threadId ? { threadId } : {}) } }),
  });
  return { draftId: draft.id, link: "https://mail.google.com/mail/u/0/#drafts" };
}

// --- Drive ---

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function driveSearch(env: Env, query: string, max = 10): Promise<DriveFile[]> {
  const words = query.trim();
  const filter = words
    ? `(name contains '${q(words)}' or fullText contains '${q(words)}') and trashed = false`
    : "trashed = false";
  const params = new URLSearchParams({
    q: filter,
    pageSize: String(Math.min(Math.max(max, 1), 25)),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  // Drive tidak mengizinkan orderBy bersama fullText; tanpa kata kunci → terbaru dulu.
  if (!words) params.set("orderBy", "modifiedTime desc");
  const res = await gapi<{ files: DriveFile[] }>(env, `https://www.googleapis.com/drive/v3/files?${params}`);
  return res.files;
}

const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

export async function driveRead(env: Env, id: string): Promise<{ name: string; mimeType: string; link: string; content: string }> {
  const meta = await gapi<DriveFile>(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,webViewLink&supportsAllDrives=true`,
  );
  let content: string;
  if (EXPORTS[meta.mimeType]) {
    content = await gapi<string>(
      env,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(EXPORTS[meta.mimeType])}`,
    );
  } else if (/^text\/|json|csv|markdown|xml/.test(meta.mimeType)) {
    content = await gapi<string>(env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    if (typeof content !== "string") content = JSON.stringify(content);
  } else {
    throw new Error(`Format ${meta.mimeType} belum bisa dibaca (yang didukung: Google Docs/Sheets/Slides dan file teks).`);
  }
  const LIMIT = 20_000;
  return {
    name: meta.name,
    mimeType: meta.mimeType,
    link: meta.webViewLink,
    content: content.length > LIMIT ? content.slice(0, LIMIT) + `\n\n[…dipotong, total ${content.length} karakter]` : content,
  };
}

async function folderId(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT folder_id FROM google_auth WHERE id = 1").first<{ folder_id: string | null }>();
  if (row?.folder_id) {
    // Pastikan foldernya masih ada (bisa saja dihapus pemilik).
    const ok = await gapi<{ trashed: boolean }>(env, `https://www.googleapis.com/drive/v3/files/${row.folder_id}?fields=trashed`)
      .then((f) => !f.trashed)
      .catch(() => false);
    if (ok) return row.folder_id;
  }
  const folder = await gapi<{ id: string }>(env, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  await env.DB.prepare("UPDATE google_auth SET folder_id = ? WHERE id = 1").bind(folder.id).run();
  return folder.id;
}

/** Simpan teks sebagai Google Doc baru di folder "Second Brain". */
export async function driveSaveDoc(env: Env, title: string, content: string): Promise<{ id: string; link: string }> {
  const boundary = `sb${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document", parents: [await folderId(env)] }),
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");
  const file = await gapi<{ id: string; webViewLink: string }>(
    env,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body },
  );
  return { id: file.id, link: file.webViewLink };
}
