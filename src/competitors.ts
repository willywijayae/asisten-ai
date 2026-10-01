import type { Env } from "./env";
import * as profile from "./profile";
import { clip, logActivity } from "./activity";
import { runMarketing } from "./marketing";
import { complete } from "./agent";
import * as db from "./db";
import * as memory from "./memory";
import { Telegram } from "./telegram";

// Riset kompetitor dari Meta Ad Library.
// Pemindaian dilakukan Claude lewat konektor Meta (server ini tidak punya akses Ad Library
// untuk iklan komersial Indonesia), lalu hasilnya dikirim ke sini lewat MCP atau endpoint ingest.
// Tiap iklan dinilai Jev AI; kalau kredit Jev habis / belum diatur → dinilai AI tim sendiri (gratis).

export const ANGLES: Record<string, string> = {
  masalah_solusi: "Masalah → solusi",
  testimoni: "Testimoni / bukti sosial",
  edukasi: "Edukasi / tips",
  promo: "Promo / harga",
  gaya_hidup: "Gaya hidup / aspirasi",
  otoritas: "Ahli / otoritas",
  lainnya: "Lainnya",
};
export const HOOK_LEVELS = ["lemah", "biasa", "kuat", "sangat kuat"];

export interface CompetitorAd {
  id: string;
  page_id: string | null;
  page_name: string | null;
  title: string | null;
  body: string | null;
  caption: string | null;
  snapshot_url: string | null;
  platforms: string | null;
  country: string | null;
  currency: string | null;
  query: string | null;
  started_at: string | null;
  stopped_at: string | null;
  active: number;
  first_seen: string;
  last_seen: string;
  angle: string | null;
  hook: number | null;
  promo: number | null;
  risky: number | null;
  confidence: number | null;
  scored_by: string | null;
  scored_at: string | null;
  media: string | null;
  media_type: string | null;
  media_saved: number;
  link_url: string | null;
  cta: string | null;
  duplicates: number | null;
  impression_rank: number | null;
  video_duration: string | null;
  page_avatar: string | null;
}

export interface MediaItem {
  type: "video" | "image";
  url: string | null;
  poster: string | null;
  w?: number;
  h?: number;
}

/** Hanya terima media dari CDN Facebook (jangan sampai server mengambil URL sembarangan). */
const FB_MEDIA = /^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|fbsbx\.com)\//i;
const fbUrl = (v: unknown) => (typeof v === "string" && FB_MEDIA.test(v) ? v : null);

function mediaOf(raw: any): MediaItem[] {
  if (!Array.isArray(raw?.media)) return [];
  return raw.media
    .slice(0, 10)
    .map((m: any) => ({
      type: m?.type === "video" ? "video" : "image",
      url: fbUrl(m?.url),
      poster: fbUrl(m?.poster),
      w: Number(m?.w) || undefined,
      h: Number(m?.h) || undefined,
    }))
    .filter((m: MediaItem) => m.url || m.poster);
}

// --- Normalisasi data dari Ad Library (format mentah Meta maupun format ringkas) ---

const first = (v: unknown): string | null => {
  if (Array.isArray(v)) return v.map(String).find((s) => s.trim()) ?? null;
  return v == null || v === "" ? null : String(v);
};

function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Normalized = Omit<
  CompetitorAd,
  "first_seen" | "last_seen" | "angle" | "hook" | "promo" | "risky" | "confidence" | "scored_by" | "scored_at" | "query" | "country" | "media_saved"
>;

function normalize(raw: any): Normalized | null {
  const id = first(raw?.id ?? raw?.ad_archive_id);
  if (!id || !/^\d{5,25}$/.test(id)) return null;
  const stopped = toIso(raw.ad_delivery_stop_time ?? raw.stopped_at);
  return {
    id,
    page_id: first(raw.page_id),
    page_name: first(raw.page_name),
    title: clip(first(raw.title ?? raw.ad_creative_link_titles ?? raw.ad_creative_link_title) ?? "", 300) || null,
    // Teks iklan disimpan apa adanya (baris baru dipertahankan; baris pertama = hook).
    body: (first(raw.body ?? raw.ad_creative_bodies ?? raw.ad_creative_body) ?? "").trim().slice(0, 3000) || null,
    caption: clip(first(raw.caption ?? raw.ad_creative_link_captions ?? raw.ad_creative_link_caption) ?? "", 200) || null,
    snapshot_url: first(raw.snapshot_url ?? raw.ad_snapshot_url) ?? `https://www.facebook.com/ads/library/?id=${id}`,
    platforms: Array.isArray(raw.publisher_platforms) ? raw.publisher_platforms.join(", ") : first(raw.platforms ?? raw.publisher_platforms),
    currency: first(raw.currency),
    started_at: toIso(raw.ad_delivery_start_time ?? raw.started_at ?? raw.start_time ?? raw.ad_creation_time),
    stopped_at: stopped,
    active: raw.active === false || stopped ? 0 : 1,
    ...creative(raw),
  };
}

/** Detail kreatif dari halaman Ad Library (ekstraktor browser). Kosong untuk data dari API/MCP. */
function creative(raw: any) {
  const media = mediaOf(raw);
  const videos = media.filter((m) => m.type === "video").length;
  const images = media.length - videos;
  let link: string | null = null;
  try {
    const u = new URL(String(raw.link_url ?? ""));
    if (u.protocol === "https:" || u.protocol === "http:") link = u.toString().slice(0, 500);
  } catch {
    /* bukan URL */
  }
  const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  return {
    media: media.length ? JSON.stringify(media) : null,
    media_type: videos ? "video" : images > 1 ? "carousel" : images ? "image" : null,
    link_url: link,
    cta: raw.cta ? clip(String(raw.cta), 40) : null,
    duplicates: int(raw.duplicates),
    impression_rank: int(raw.impression_rank),
    video_duration: /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(raw.video_duration ?? "")) ? String(raw.video_duration) : null,
    page_avatar: fbUrl(raw.page_avatar),
  };
}

/** Simpan hasil pindaian. Iklan lama diperbarui (terakhir terlihat), iklan baru ditambahkan. */
export async function ingestAds(
  env: Env,
  scan: { source: string; query?: string; country?: string; ads: unknown[] },
): Promise<{ found: number; added: number; updated: number; skipped: number }> {
  const country = (scan.country ?? "ID").toUpperCase().slice(0, 2);
  const rows = scan.ads.slice(0, 200).map(normalize);
  const valid = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (!valid.length) return { found: scan.ads.length, added: 0, updated: 0, skipped: scan.ads.length };

  const existing = new Set(
    (
      await env.DB.prepare(`SELECT id FROM competitor_ads WHERE id IN (${valid.map(() => "?").join(",")})`)
        .bind(...valid.map((r) => r.id))
        .all<{ id: string }>()
    ).results.map((r) => r.id),
  );
  const now = new Date().toISOString();
  await env.DB.batch(
    valid.map((r) =>
      env.DB.prepare(
        `INSERT INTO competitor_ads (id, page_id, page_name, title, body, caption, snapshot_url, platforms, country, currency, query,
           started_at, stopped_at, active, first_seen, last_seen,
           media, media_type, link_url, cta, duplicates, impression_rank, video_duration, page_avatar)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
         ON CONFLICT(id) DO UPDATE SET
           page_id = coalesce(page_id, excluded.page_id),
           page_name = coalesce(excluded.page_name, page_name),
           title = coalesce(excluded.title, title),
           body = coalesce(excluded.body, body),
           caption = coalesce(excluded.caption, caption),
           platforms = coalesce(excluded.platforms, platforms),
           started_at = coalesce(excluded.started_at, started_at),
           stopped_at = excluded.stopped_at,
           active = excluded.active,
           last_seen = excluded.last_seen,
           query = coalesce(excluded.query, query),
           media = coalesce(excluded.media, media),
           media_type = coalesce(excluded.media_type, media_type),
           link_url = coalesce(excluded.link_url, link_url),
           cta = coalesce(excluded.cta, cta),
           duplicates = coalesce(excluded.duplicates, duplicates),
           impression_rank = coalesce(excluded.impression_rank, impression_rank),
           video_duration = coalesce(excluded.video_duration, video_duration),
           page_avatar = coalesce(excluded.page_avatar, page_avatar)`,
      ).bind(
        r.id,
        r.page_id,
        r.page_name,
        r.title,
        r.body,
        r.caption,
        r.snapshot_url,
        r.platforms,
        country,
        r.currency,
        scan.query ?? null,
        r.started_at,
        r.stopped_at,
        r.active,
        now,
        r.media,
        r.media_type,
        r.link_url,
        r.cta,
        r.duplicates,
        r.impression_rank,
        r.video_duration,
        r.page_avatar,
      ),
    ),
  );
  const added = valid.filter((r) => !existing.has(r.id)).length;
  await env.DB.prepare("INSERT INTO competitor_scans (source, query, country, found, new_count) VALUES (?, ?, ?, ?, ?)")
    .bind(scan.source, scan.query ?? null, country, valid.length, added)
    .run();
  await logActivity(
    env,
    "riset",
    "step",
    `Menyimpan ${valid.length} iklan kompetitor${scan.query ? ` "${clip(scan.query, 40)}"` : ""} (${added} baru)`,
    "mboard",
  );
  return { found: scan.ads.length, added, updated: valid.length - added, skipped: scan.ads.length - valid.length };
}

/** Kabari pemilik setelah pindaian (dipanggil sekali per sesi pindaian, bukan per kata kunci). */
export async function notifyScan(env: Env, totals: { found: number; added: number }): Promise<void> {
  if (!env.OWNER_CHAT_ID || !totals.added) return;
  const top = await env.DB.prepare(
    `SELECT page_name, count(*) AS n FROM competitor_ads WHERE first_seen >= ? GROUP BY page_name ORDER BY n DESC LIMIT 3`,
  )
    .bind(new Date(Date.now() - 3600_000).toISOString())
    .all<{ page_name: string; n: number }>();
  await new Telegram(env.TELEGRAM_BOT_TOKEN)
    .send(
      env.OWNER_CHAT_ID,
      `🔎 Scan iklan kompetitor: ${totals.found} iklan, ${totals.added} baru.\n${top.results
        .map((t) => `- ${t.page_name}: ${t.n} iklan baru`)
        .join("\n")}\n\nLihat di website → Riset Kompetitor.`,
    )
    .catch((err) => console.error("Gagal kirim notifikasi scan", err));
}

// --- Penilaian iklan ---

interface Score {
  angle: string;
  hook: number;
  promo: boolean;
  risky: boolean;
  confidence: number | null;
}

class JevUnavailable extends Error {}

const adText = (a: CompetitorAd) =>
  [a.title && `Judul: ${a.title}`, a.body && `Teks: ${a.body}`, a.caption && `Caption: ${a.caption}`].filter(Boolean).join("\n");

const JEV_QUESTIONS = {
  angle: {
    type: "choice",
    instructions: "Apa angle utama iklan ini?",
    criteria: {
      masalah_solusi: "Mengangkat masalah/keluhan lalu menawarkan produk sebagai solusi",
      testimoni: "Testimoni, review, atau bukti sosial dari pengguna",
      edukasi: "Edukasi, tips, atau fakta",
      promo: "Fokus pada harga, diskon, gratis ongkir, COD, atau bonus",
      gaya_hidup: "Gaya hidup, aspirasi, atau emosi",
      otoritas: "Ahli, dokter, sertifikasi, atau otoritas",
      lainnya: null,
    },
  },
  hook: {
    type: "score",
    instructions: "Seberapa kuat judul/kalimat pembuka iklan ini membuat orang berhenti scroll?",
    levels: HOOK_LEVELS,
  },
  promo: { type: "noul", instructions: "Apakah iklan menyebut penawaran jelas (diskon, gratis ongkir, COD, bonus, harga khusus)?" },
  risky: {
    type: "noul",
    instructions: "Apakah iklan membuat klaim kesehatan berlebihan atau menjanjikan hasil pasti (rawan ditolak kebijakan iklan Meta)?",
  },
};

const JEV_STATUS_KEY = "jev_status";
const JEV_RETRY_MS = 12 * 3600_000;

export async function jevStatus(env: Env): Promise<{ configured: boolean; state: "ok" | "habis" | "invalid" | "off"; at?: string; message?: string }> {
  if (!env.JEV_API_KEY) return { configured: false, state: "off" };
  const row = await profile.getSetting(env, JEV_STATUS_KEY);
  if (!row?.value) return { configured: true, state: "ok" };
  try {
    return { configured: true, ...(JSON.parse(row.value) as { state: "ok" | "habis" | "invalid"; at: string; message?: string }) };
  } catch {
    return { configured: true, state: "ok" };
  }
}

async function jevUsable(env: Env): Promise<boolean> {
  const s = await jevStatus(env);
  if (!s.configured) return false;
  return s.state === "ok" || !s.at || Date.now() - Date.parse(s.at) > JEV_RETRY_MS;
}

async function scoreWithJev(env: Env, ad: CompetitorAd): Promise<Score> {
  const res = await fetch("https://jev-ai.pro/api/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.JEV_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.JEV_MODEL || "jev-latest",
      state: { halaman: ad.page_name, iklan: adText(ad) },
      questions: JEV_QUESTIONS,
    }),
  });
  if (res.status === 402 || res.status === 401) {
    const state = res.status === 402 ? "habis" : "invalid";
    const message = res.status === 402 ? "Saldo/kredit Jev habis" : "API key Jev tidak valid";
    await profile.setSetting(env, JEV_STATUS_KEY, JSON.stringify({ state, at: new Date().toISOString(), message }));
    throw new JevUnavailable(message);
  }
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    answers: Record<string, { choice?: string; score?: number; noul?: number; confidence?: number }>;
  };
  const a = data.answers ?? {};
  const confs = Object.values(a)
    .map((x) => x.confidence)
    .filter((c): c is number => typeof c === "number");
  return {
    angle: a.angle?.choice && a.angle.choice in ANGLES ? a.angle.choice : "lainnya",
    hook: Math.max(0, Math.min(3, Math.round(a.hook?.score ?? 1))),
    promo: (a.promo?.noul ?? 0) >= 0.5,
    risky: (a.risky?.noul ?? 0) >= 0.5,
    confidence: confs.length ? confs.reduce((x, y) => x + y, 0) / confs.length : null,
  };
}

/** Penilaian cadangan oleh tim AI sendiri (Workers AI, gratis), beberapa iklan sekaligus. */
async function scoreWithAI(env: Env, ads: CompetitorAd[]): Promise<Map<string, Score>> {
  const list = ads.map((a, i) => `#${i + 1} [${a.page_name ?? "?"}]\n${adText(a)}`).join("\n\n");
  const res = (await env.AI.run(env.FALLBACK_MODEL as any, {
    messages: [
      {
        role: "system",
        content: `Kamu Analis Iklan. Nilai tiap iklan kompetitor di bawah. Balas HANYA JSON:
{"hasil":[{"no":1,"angle":"<${Object.keys(ANGLES).join("|")}>","hook":0-3,"promo":true/false,"risky":true/false}]}
- angle: masalah_solusi (masalah lalu solusi), testimoni (review/bukti sosial), edukasi (tips/fakta), promo (harga/diskon/ongkir/COD/bonus), gaya_hidup (aspirasi/emosi), otoritas (ahli/dokter/sertifikasi), lainnya.
- hook: kekuatan judul/kalimat pembuka bikin berhenti scroll: 0 lemah, 1 biasa, 2 kuat, 3 sangat kuat.
- promo: ada penawaran jelas. risky: klaim kesehatan berlebihan / janji hasil pasti.`,
      },
      { role: "user", content: list },
    ],
    max_tokens: 1500,
    temperature: 0.1,
    chat_template_kwargs: { enable_thinking: false },
  } as any)) as { choices?: { message?: { content?: string | null } }[]; response?: string };
  const raw = res.choices?.[0]?.message?.content ?? res.response ?? "";
  const out = new Map<string, Score>();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { hasil?: any[] };
    for (const h of parsed.hasil ?? []) {
      const ad = ads[Number(h?.no) - 1];
      if (!ad) continue;
      out.set(ad.id, {
        angle: String(h.angle) in ANGLES ? String(h.angle) : "lainnya",
        hook: Math.max(0, Math.min(3, Math.round(Number(h.hook) || 0))),
        promo: h.promo === true,
        risky: h.risky === true,
        confidence: null,
      });
    }
  } catch (err) {
    console.error("Penilaian AI tidak bisa dibaca", err, raw.slice(0, 300));
  }
  return out;
}

/** Nilai iklan yang belum dinilai. Jev dulu; kalau habis/gagal → AI tim. */
// Maks 40 per pemanggilan: Jev = 1 request per iklan, dan paket gratis Workers membatasi 50 subrequest.
export async function scorePending(env: Env, limit = 40): Promise<{ scored: number; jev: number; ai: number; remaining: number }> {
  const { results: ads } = await env.DB.prepare(
    "SELECT * FROM competitor_ads WHERE scored_at IS NULL ORDER BY first_seen DESC LIMIT ?",
  )
    .bind(limit)
    .all<CompetitorAd>();
  if (!ads.length) return { scored: 0, jev: 0, ai: 0, remaining: 0 };

  const now = new Date().toISOString();
  const save = (id: string, s: Score, by: string) =>
    env.DB.prepare(
      "UPDATE competitor_ads SET angle = ?, hook = ?, promo = ?, risky = ?, confidence = ?, scored_by = ?, scored_at = ? WHERE id = ?",
    ).bind(s.angle, s.hook, s.promo ? 1 : 0, s.risky ? 1 : 0, s.confidence, by, now, id);

  // Iklan tanpa teks tidak bisa dinilai.
  const empty = ads.filter((a) => !adText(a));
  const todo = ads.filter((a) => adText(a));
  const stmts = empty.map((a) =>
    env.DB.prepare("UPDATE competitor_ads SET scored_by = 'kosong', scored_at = ? WHERE id = ?").bind(now, a.id),
  );

  let jev = 0;
  const forAI: CompetitorAd[] = [];
  let useJev = await jevUsable(env);
  if (useJev) await logActivity(env, "analis", "start", `Menilai ${todo.length} iklan kompetitor dengan Jev AI`, "mboard");
  for (const ad of todo) {
    if (!useJev) {
      forAI.push(ad);
      continue;
    }
    try {
      stmts.push(save(ad.id, await scoreWithJev(env, ad), "jev"));
      jev++;
    } catch (err) {
      console.error("Jev gagal", err);
      if (err instanceof JevUnavailable) {
        useJev = false;
        await logActivity(env, "analis", "step", `${err.message} → pindah ke penilaian tim AI`);
      }
      forAI.push(ad);
    }
  }
  if (jev) await profile.setSetting(env, JEV_STATUS_KEY, JSON.stringify({ state: "ok", at: now }));

  let ai = 0;
  if (forAI.length) {
    await logActivity(env, "analis", "start", `Menilai ${forAI.length} iklan kompetitor (tim AI)`, "mboard");
    for (let i = 0; i < forAI.length; i += 10) {
      const batch = forAI.slice(i, i + 10);
      const scores = await scoreWithAI(env, batch).catch((err) => {
        console.error("Penilaian AI gagal", err);
        return new Map<string, Score>();
      });
      for (const [id, s] of scores) {
        stmts.push(save(id, s, "ai"));
        ai++;
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  await logActivity(env, "analis", "done", `Selesai menilai ${jev + ai} iklan kompetitor (Jev ${jev}, tim AI ${ai})`);
  const left = await env.DB.prepare("SELECT count(*) AS n FROM competitor_ads WHERE scored_at IS NULL").first<{ n: number }>();
  return { scored: jev + ai, jev, ai, remaining: left?.n ?? 0 };
}

// --- Daftar pantauan & data untuk website/MCP ---

export interface WatchItem {
  id: number;
  kind: "keyword" | "page";
  value: string;
  label: string | null;
  country: string;
  created_at: string;
}

export async function listWatch(env: Env): Promise<WatchItem[]> {
  const { results } = await env.DB.prepare("SELECT * FROM competitor_watch ORDER BY kind, id").all<WatchItem>();
  return results;
}

export async function addWatch(env: Env, w: { kind: string; value: string; label?: string | null; country?: string }): Promise<void> {
  const kind = w.kind === "page" ? "page" : "keyword";
  const value = w.value.trim();
  if (!value) throw new Error("Isi kata kunci atau page id");
  if (kind === "page" && !/^\d{5,25}$/.test(value)) throw new Error("Page id harus berupa angka");
  await env.DB.prepare(
    "INSERT INTO competitor_watch (kind, value, label, country) VALUES (?, ?, ?, ?) ON CONFLICT (kind, value, country) DO UPDATE SET label = coalesce(excluded.label, label)",
  )
    .bind(kind, kind === "keyword" ? value.toLowerCase() : value, w.label?.trim() || null, (w.country ?? "ID").toUpperCase().slice(0, 2))
    .run();
}

export async function deleteWatch(env: Env, id: number): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM competitor_watch WHERE id = ?").bind(id).run();
  return res.meta.changes > 0;
}

const DAYS_RUNNING = `CAST((julianday(coalesce(stopped_at, last_seen)) - julianday(coalesce(started_at, first_seen))) AS INTEGER)`;

export async function listAds(
  env: Env,
  f: { page?: string; angle?: string; active?: boolean; q?: string; sort?: string; limit?: number },
): Promise<(CompetitorAd & { days: number })[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (f.page) (where.push("page_id = ?"), vals.push(f.page));
  if (f.angle) (where.push("angle = ?"), vals.push(f.angle));
  if (f.active) where.push("active = 1");
  if (f.q) {
    where.push("lower(coalesce(page_name,'') || ' ' || coalesce(title,'') || ' ' || coalesce(body,'')) LIKE ?");
    vals.push(`%${f.q.toLowerCase()}%`);
  }
  const order =
    f.sort === "baru"
      ? "first_seen DESC"
      : f.sort === "hook"
        ? "hook DESC NULLS LAST, days DESC"
        : f.sort === "impresi"
          ? "impression_rank IS NULL, last_seen DESC, impression_rank, days DESC"
          : f.sort === "duplikat"
            ? "coalesce(duplicates, 1) DESC, days DESC"
            : "days DESC, first_seen DESC";
  const { results } = await env.DB.prepare(
    `SELECT *, ${DAYS_RUNNING} AS days,
       (SELECT id FROM competitor_remixes r WHERE r.ad_id = competitor_ads.id ORDER BY r.id DESC LIMIT 1) AS remix_id,
       (SELECT status FROM competitor_remixes r WHERE r.ad_id = competitor_ads.id ORDER BY r.id DESC LIMIT 1) AS remix_status
     FROM competitor_ads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ?`,
  )
    .bind(...vals, Math.min(f.limit ?? 100, 300))
    .all<CompetitorAd & { days: number }>();
  return results;
}

export async function summary(env: Env) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [totals, pages, angles, scans, watch, jev] = await Promise.all([
    env.DB.prepare(
      `SELECT count(*) AS ads, sum(active) AS active, count(DISTINCT page_id) AS pages,
              sum(first_seen >= ?1) AS newWeek, sum(scored_at IS NULL) AS unscored
       FROM competitor_ads`,
    )
      .bind(weekAgo)
      .first<{ ads: number; active: number; pages: number; newWeek: number; unscored: number }>(),
    env.DB.prepare(
      `SELECT page_id, max(page_name) AS page_name, count(*) AS ads, sum(active) AS active, max(${DAYS_RUNNING}) AS longest,
              max(last_seen) AS last_seen, round(avg(hook), 1) AS hook
       FROM competitor_ads GROUP BY page_id ORDER BY active DESC, ads DESC LIMIT 30`,
    ).all<{ page_id: string; page_name: string; ads: number; active: number; longest: number; last_seen: string; hook: number | null }>(),
    env.DB.prepare("SELECT angle, count(*) AS n FROM competitor_ads WHERE angle IS NOT NULL GROUP BY angle ORDER BY n DESC").all<{
      angle: string;
      n: number;
    }>(),
    env.DB.prepare("SELECT * FROM competitor_scans ORDER BY id DESC LIMIT 8").all(),
    listWatch(env),
    jevStatus(env),
  ]);
  return {
    totals: {
      ads: totals?.ads ?? 0,
      active: totals?.active ?? 0,
      pages: totals?.pages ?? 0,
      newWeek: totals?.newWeek ?? 0,
      unscored: totals?.unscored ?? 0,
    },
    pages: pages.results,
    angles: angles.results,
    scans: scans.results,
    watch,
    jev,
  };
}

/** Minta Riset menganalisis iklan kompetitor (semua, atau satu halaman). Hasilnya jadi catatan marketing. */
export async function analyze(env: Env, pageId?: string): Promise<{ text: string; noteId: number }> {
  const ads = await listAds(env, { page: pageId, sort: "lama", limit: 40 });
  if (!ads.length) throw new Error("Belum ada iklan kompetitor yang tersimpan");
  const lines = ads.map(
    (a) =>
      `- [${a.page_name}] tayang ${a.days} hari${a.active ? " (aktif)" : ""} · angle ${a.angle ? ANGLES[a.angle] : "?"} · hook ${
        a.hook != null ? HOOK_LEVELS[a.hook] : "?"
      }${a.promo ? " · ada promo" : ""}${a.risky ? " · klaim berisiko" : ""}\n  ${clip([a.title, a.body].filter(Boolean).join(" — "), 220)}`,
  );
  const res = await runMarketing(env, {
    specialist: "riset",
    request: `Analisis iklan kompetitor dari Meta Ad Library${pageId ? ` untuk halaman ${ads[0].page_name}` : ""}. Iklan yang tayang paling lama biasanya yang paling menguntungkan.
Jelaskan: (1) pola angle, hook, dan penawaran yang dipakai iklan yang bertahan lama, (2) celah yang belum dipakai kompetitor, (3) 5 ide iklan untuk kita yang meniru pola pemenang tapi tetap beda dan aman dari kebijakan Meta.

Data (${ads.length} iklan, urut dari yang paling lama tayang):
${lines.join("\n")}`,
  });
  return { text: res.text, noteId: res.noteId };
}

// --- Media: salin gambar/sampul (dan video iklan pemenang) dari CDN Facebook ke KV ---
// Link Facebook kedaluwarsa dalam beberapa hari; salinan di KV membuat galeri tetap utuh.
// Video lain diputar langsung dari link terbaru (diperbarui setiap scan selama iklannya tayang).

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const mediaKey = (adId: string, idx: number, kind: "image" | "poster" | "video") => `m:${adId}:${idx}:${kind}`;

const isWinner = (a: CompetitorAd & { days?: number }) =>
  (a.impression_rank ?? 99) <= 10 || (a.duplicates ?? 1) >= 3 || (a.days ?? 0) >= 60;

async function copyToKv(env: Env, key: string, url: string, maxBytes: number): Promise<boolean> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (asisten-ai media copier)" } });
  if (!res.ok) return false;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len && len > maxBytes) return false;
  const body = await res.arrayBuffer();
  if (body.byteLength > maxBytes || body.byteLength < 200) return false;
  await env.MEDIA.put(key, body, { metadata: { type: res.headers.get("content-type") ?? "application/octet-stream" } });
  return true;
}

/** Simpan media iklan yang belum tersimpan. `budget` = maks request ke Facebook (batas subrequest Workers). */
export async function saveMedia(env: Env, budget = 30): Promise<{ ads: number; files: number; remaining: number }> {
  const { results } = await env.DB.prepare(
    `SELECT *, ${DAYS_RUNNING} AS days FROM competitor_ads WHERE media_saved = 0 AND media IS NOT NULL
     ORDER BY impression_rank IS NULL, impression_rank, first_seen DESC LIMIT 25`,
  ).all<CompetitorAd & { days: number }>();
  let used = 0;
  let files = 0;
  let done = 0;
  for (const ad of results) {
    const items = JSON.parse(ad.media ?? "[]") as MediaItem[];
    const wantVideo = isWinner(ad);
    const jobs: [string, string, number][] = [];
    items.forEach((m, i) => {
      if (m.type === "image" && m.url) jobs.push([mediaKey(ad.id, i, "image"), m.url, 8 * 1024 * 1024]);
      if (m.type === "video" && m.poster) jobs.push([mediaKey(ad.id, i, "poster"), m.poster, 8 * 1024 * 1024]);
      if (m.type === "video" && m.url && wantVideo) jobs.push([mediaKey(ad.id, i, "video"), m.url, MAX_VIDEO_BYTES]);
    });
    if (used + jobs.length > budget) break;
    for (const [key, url, max] of jobs) {
      used++;
      try {
        if (await copyToKv(env, key, url, max)) files++;
      } catch (err) {
        console.error("Gagal menyalin media", key, err);
      }
    }
    await env.DB.prepare("UPDATE competitor_ads SET media_saved = 1 WHERE id = ?").bind(ad.id).run();
    done++;
  }
  const left = await env.DB.prepare("SELECT count(*) AS n FROM competitor_ads WHERE media_saved = 0 AND media IS NOT NULL").first<{ n: number }>();
  if (files) await logActivity(env, "riset", "step", `Mengarsipkan ${files} gambar/video iklan kompetitor`, "cabinet");
  return { ads: done, files, remaining: left?.n ?? 0 };
}

/** Sajikan media: dari KV kalau tersimpan, kalau tidak alihkan ke link Facebook terbaru. */
export async function serveMedia(env: Env, adId: string, idx: number, kind: "image" | "poster" | "video", req: Request): Promise<Response> {
  const stored = await env.MEDIA.getWithMetadata<{ type: string }>(mediaKey(adId, idx, kind), "arrayBuffer");
  if (stored.value) {
    const buf = stored.value;
    const type = stored.metadata?.type ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "content-type": type,
      "cache-control": "private, max-age=604800",
      "accept-ranges": "bytes",
    };
    // Video butuh Range supaya bisa digeser.
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
      return new Response(buf.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${buf.byteLength}`, "content-length": String(end - start + 1) },
      });
    }
    return new Response(buf, { headers: { ...headers, "content-length": String(buf.byteLength) } });
  }
  const ad = await env.DB.prepare("SELECT media FROM competitor_ads WHERE id = ?").bind(adId).first<{ media: string | null }>();
  const m = (JSON.parse(ad?.media ?? "[]") as MediaItem[])[idx];
  const url = kind === "poster" ? m?.poster : m?.url;
  if (!url) return new Response("Media tidak tersedia", { status: 404 });
  return Response.redirect(url, 302);
}

// --- Laporan "bedah iklan kompetitor" ---

export interface ReportData {
  subtitle?: string;
  stats?: { value: string; label: string }[];
  method?: string;
  summary: string[];
  topics?: { topic: string; count: number; hook: string }[];
  topics_note?: string;
  winners: { ad_id: string; title: string; badge?: string; hook?: string; why: string }[];
  others?: { page: string; hook: string; running: string; signal: string }[];
  patterns?: string[];
  warning?: string;
  plan?: { priority: string; title: string; steps: string[] }[];
  data_note?: string;
}

export interface Report {
  id: number;
  title: string;
  query: string | null;
  data: string;
  author: string;
  note_id: number | null;
  created_at: string;
}

function validReport(d: any): ReportData {
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => clip(String(x ?? ""), 1200)).filter(Boolean).slice(0, n) : []);
  const report: ReportData = {
    subtitle: d?.subtitle ? clip(String(d.subtitle), 300) : undefined,
    stats: Array.isArray(d?.stats)
      ? d.stats.slice(0, 4).map((s: any) => ({ value: clip(String(s?.value ?? ""), 20), label: clip(String(s?.label ?? ""), 40) }))
      : undefined,
    method: d?.method ? clip(String(d.method), 1500) : undefined,
    summary: strs(d?.summary, 7),
    topics: Array.isArray(d?.topics)
      ? d.topics.slice(0, 15).map((t: any) => ({ topic: clip(String(t?.topic ?? ""), 120), count: Number(t?.count) || 0, hook: clip(String(t?.hook ?? ""), 200) }))
      : undefined,
    topics_note: d?.topics_note ? clip(String(d.topics_note), 800) : undefined,
    winners: Array.isArray(d?.winners)
      ? d.winners.slice(0, 12).map((w: any) => ({
          ad_id: String(w?.ad_id ?? "").replace(/\D/g, ""),
          title: clip(String(w?.title ?? ""), 120),
          badge: w?.badge ? clip(String(w.badge), 30) : undefined,
          hook: w?.hook ? clip(String(w.hook), 300) : undefined,
          why: clip(String(w?.why ?? ""), 800),
        }))
      : [],
    others: Array.isArray(d?.others)
      ? d.others.slice(0, 15).map((o: any) => ({
          page: clip(String(o?.page ?? ""), 80),
          hook: clip(String(o?.hook ?? ""), 240),
          running: clip(String(o?.running ?? ""), 30),
          signal: clip(String(o?.signal ?? ""), 60),
        }))
      : undefined,
    patterns: strs(d?.patterns, 10),
    warning: d?.warning ? clip(String(d.warning), 1200) : undefined,
    plan: Array.isArray(d?.plan)
      ? d.plan.slice(0, 5).map((p: any) => ({ priority: clip(String(p?.priority ?? ""), 30), title: clip(String(p?.title ?? ""), 160), steps: strs(p?.steps, 6) }))
      : undefined,
    data_note: d?.data_note ? clip(String(d.data_note), 800) : undefined,
  };
  if (!report.summary.length && !report.winners.length) throw new Error("Laporan kosong");
  return report;
}

function reportText(title: string, r: ReportData): string {
  const out = [title, r.subtitle ?? "", "", "RINGKASAN:", ...r.summary.map((s, i) => `${i + 1}. ${s}`)];
  if (r.winners.length) out.push("", "IKLAN PEMENANG:", ...r.winners.map((w) => `- ${w.title} (${w.badge ?? ""}) — ${w.hook ?? ""} · ${w.why} · https://www.facebook.com/ads/library/?id=${w.ad_id}`));
  if (r.patterns?.length) out.push("", "POLA HOOK:", ...r.patterns.map((p) => `- ${p}`));
  if (r.warning) out.push("", `PERINGATAN: ${r.warning}`);
  for (const p of r.plan ?? []) out.push("", `${p.priority} — ${p.title}`, ...p.steps.map((s) => `- ${s}`));
  return out.join("\n");
}

export async function saveReport(env: Env, input: { title: string; query?: string | null; data: unknown; author: string }): Promise<number> {
  const data = validReport(input.data);
  const title = clip(input.title || "Bedah iklan kompetitor", 160);
  const noteId = await db.addNote(env.DB, { title, content: reportText(title, data), tags: "marketing, riset, kompetitor" });
  await memory.indexNote(env, noteId);
  const row = await env.DB.prepare(
    "INSERT INTO competitor_reports (title, query, data, author, note_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(title, input.query ?? null, JSON.stringify(data), input.author, noteId)
    .first<{ id: number }>();
  await logActivity(env, input.author === "claude" ? "claude" : "riset", "done", `Laporan "${clip(title, 80)}" siap`, "mboard");
  return row!.id;
}

export async function listReports(env: Env): Promise<Omit<Report, "data">[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, query, author, note_id, created_at FROM competitor_reports ORDER BY id DESC LIMIT 30",
  ).all<Omit<Report, "data">>();
  return results;
}

/** Laporan + data iklan pemenangnya (untuk ditampilkan dengan media). */
export async function getReport(env: Env, id: number) {
  const r = await env.DB.prepare("SELECT * FROM competitor_reports WHERE id = ?").bind(id).first<Report>();
  if (!r) return null;
  const data = JSON.parse(r.data) as ReportData;
  const ids = data.winners.map((w) => w.ad_id).filter(Boolean);
  const ads = ids.length
    ? (
        await env.DB.prepare(
          `SELECT *, ${DAYS_RUNNING} AS days,
             (SELECT id FROM competitor_remixes r WHERE r.ad_id = competitor_ads.id ORDER BY r.id DESC LIMIT 1) AS remix_id,
             (SELECT status FROM competitor_remixes r WHERE r.ad_id = competitor_ads.id ORDER BY r.id DESC LIMIT 1) AS remix_status
           FROM competitor_ads WHERE id IN (${ids.map(() => "?").join(",")})`,
        )
          .bind(...ids)
          .all<CompetitorAd & { days: number }>()
      ).results
    : [];
  return { ...r, data, ads };
}

const REPORT_PROMPT = `Kamu Periset Marketing senior. Buat laporan "Bedah Iklan Kompetitor" dari data Meta Ad Library di bawah, untuk pemilik bisnis (lihat profil). Ad Library tidak menampilkan spend/hasil, jadi tentukan "winning" dari 3 sinyal: urutan impresi (rank kecil = impresi terbanyak), lama tayang (iklan rugi biasanya dimatikan 1-2 minggu), dan jumlah duplikat/variasi (tanda sedang di-scale).

Balas HANYA JSON valid dengan bentuk:
{
 "subtitle": "cakupan data: kata kunci, negara, tanggal",
 "stats": [{"value":"±80","label":"IKLAN DIBEDAH"}, ... 4 item],
 "method": "cara menentukan winning (1 paragraf)",
 "summary": ["5 insight paling bisa diterapkan; tiap item: kalimat tebal pembuka lalu penjelasan + kaitannya dengan masalah pemilik"],
 "topics": [{"topic":"pain point/topik","count":angka,"hook":"contoh hook asli"}],
 "topics_note": "artinya: topik mana yang padat vs masih sepi",
 "winners": [{"ad_id":"id iklan dari data","title":"nama konsep singkat","badge":"EVERGREEN|SCALING|LAYAK DITIRU|IMPRESI #n|... hari","hook":"kutipan hook asli","why":"angle, visual/format, CTA, kenapa jalan"}],
 "others": [{"page":"nama halaman","hook":"hook/angle","running":"xx hari","signal":"duplikat/angle sepi/dll"}],
 "patterns": ["pola hook & struktur caption yang berulang di pemenang"],
 "warning": "klaim berisiko yang JANGAN ditiru (kebijakan Meta & BPOM) dan apa yang aman ditiru",
 "plan": [{"priority":"PRIORITAS 1","title":"...","steps":["langkah konkret, angka tes kalau relevan"]}],
 "data_note": "keterbatasan data"
}
Aturan: pakai ad_id yang ADA di data (6-8 pemenang terkuat). Kutip hook asli, jangan mengarang angka. Bahasa Indonesia, tajam dan praktis.`;

/** Laporan oleh agen Riset dari iklan tersimpan (opsional: hanya kata kunci tertentu). */
export async function generateReport(env: Env, query?: string): Promise<number> {
  const ads = await listAds(env, { q: undefined, sort: "lama", limit: 300 });
  const pool = (query ? ads.filter((a) => (a.query ?? "").toLowerCase() === query.toLowerCase()) : ads)
    .sort((a, b) => (a.impression_rank ?? 999) - (b.impression_rank ?? 999) || b.days - a.days)
    .slice(0, 60);
  if (!pool.length) throw new Error("Belum ada iklan kompetitor untuk dibedah");
  await logActivity(env, "riset", "start", `Membedah ${pool.length} iklan kompetitor${query ? ` "${query}"` : ""}`, "mboard");
  const lines = pool.map((a) =>
    [
      `ad_id ${a.id} · ${a.page_name} · rank ${a.impression_rank ?? "?"} · tayang ${a.days} hari${a.active ? "" : " (berhenti)"} · duplikat ${a.duplicates ?? 1}`,
      `  format ${a.media_type ?? "?"}${a.video_duration ? ` ${a.video_duration}` : ""} · CTA ${a.cta ?? "?"} · landing ${a.link_url ? new URL(a.link_url).hostname : "?"} · angle ${a.angle ?? "?"}${a.promo ? " · promo" : ""}${a.risky ? " · klaim berisiko" : ""}`,
      `  ${clip([a.title, a.body].filter(Boolean).join(" — "), 420)}`,
    ].join("\n"),
  );
  const owner = await profile.ownerContext(env);
  let data: unknown = null;
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    const { text } = await complete(env, {
      system: REPORT_PROMPT + owner,
      user: `Data (${pool.length} iklan aktif${query ? `, kata kunci "${query}"` : ""}, diambil ${new Date().toISOString().slice(0, 10)}):\n${lines.join("\n")}`,
      tier: "smart",
      actor: "riset",
      maxTokens: 7000,
      noThinking: true,
    });
    data = parseLooseJson(text);
    if (!data) console.error("Laporan bukan JSON valid, coba ulang", text.slice(0, 300));
  }
  if (!data) {
    await logActivity(env, "riset", "error", "Laporan tidak terbaca");
    throw new Error("Laporan tidak terbaca, coba lagi");
  }
  return saveReport(env, {
    title: `Bedah Iklan Kompetitor${query ? ` "${query}"` : ""} — ${memory.localDate(env, new Date().toISOString())}`,
    query: query ?? null,
    data,
    author: "riset",
  });
}

/** JSON dari model: ambil blok {...} dan bereskan kesalahan umum (koma berlebih, blok ```json). */
function parseLooseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const raw = text.slice(start, end + 1);
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* coba berikutnya */
    }
  }
  return null;
}

// --- "Bikin 5 konten mirip": tim marketing meniru pola iklan pemenang untuk brand pemilik ---

export interface RemixIdea {
  title: string;
  angle: string;
  format: string;
  hook: string;
  scenes?: { time?: string; visual: string; voiceover?: string; text?: string }[];
  caption: string;
  cta: string;
  production?: string;
}

export interface Remix {
  id: number;
  ad_id: string;
  status: "pending" | "done" | "error";
  specialist: string | null;
  data: string | null;
  note_id: number | null;
  error: string | null;
  created_at: string;
  done_at: string | null;
}

const REMIX_COUNT = 5;

/** Antrekan pembuatan konten (dikerjakan consumer antrean: boleh lama, tidak tergantung browser). */
export async function requestRemix(env: Env, adId: string): Promise<Remix> {
  const ad = await env.DB.prepare("SELECT id, page_name, media_type FROM competitor_ads WHERE id = ?")
    .bind(adId)
    .first<{ id: string; page_name: string | null; media_type: string | null }>();
  if (!ad) throw new Error("Iklan tidak ditemukan");
  const running = await env.DB.prepare(
    "SELECT * FROM competitor_remixes WHERE ad_id = ? AND status = 'pending' AND created_at > ?",
  )
    .bind(adId, new Date(Date.now() - 15 * 60_000).toISOString())
    .first<Remix>();
  if (running) return running;

  const specialist = ad.media_type === "video" ? "konten" : "copywriter";
  const row = await env.DB.prepare("INSERT INTO competitor_remixes (ad_id, specialist) VALUES (?, ?) RETURNING *")
    .bind(adId, specialist)
    .first<Remix>();
  await logActivity(
    env,
    "manajer_marketing",
    "step",
    `Menugaskan ${specialist === "konten" ? "Perencana Konten" : "Copywriter"}: ${REMIX_COUNT} konten mirip iklan ${ad.page_name ?? adId}`,
    `visit:${specialist}`,
  );
  await env.JOBS.send({ type: "remix", remixId: row!.id });
  return row!;
}

const REMIX_PROMPT = (specialist: string) => `Kamu ${specialist === "konten" ? "Perencana Konten (video)" : "Copywriter iklan"} di tim marketing pemilik, ditugaskan Manajer Marketing.
Tugas: pelajari iklan kompetitor yang terbukti jalan di bawah, lalu buat MINIMAL ${REMIX_COUNT} konten iklan BARU untuk bisnis/produk pemilik yang meniru POLA pemenangnya (struktur hook, angle, format, panjang, emosi, CTA) — bukan menyalin kata-katanya.
- Variasikan: tiap konten beda sudut (mis. hook usia, durasi masalah, reframe, testimoni, penjawab keberatan, harga), tapi tetap satu pola dengan iklan acuan.
- Untuk video: tulis naskah per adegan (detik, visual, voice over, teks di layar) dengan panjang mirip iklan acuan; talent realistis (CS/penjual/pelanggan) dan murah diproduksi.
- Untuk gambar/teks: tulis konsep visual + headline + teks gambar.
- Caption lengkap siap pakai: hook → agitasi singkat → solusi → manfaat checklist → bukti (BPOM/Halal/testimoni bila relevan) → CTA.
- WAJIB aman kebijakan Meta & BPOM: tanpa klaim menyembuhkan/menjamin hasil, tanpa klaim pelangsingan, tanpa konten seksual eksplisit, tanpa before-after; pakai "membantu menjaga…" dan testimoni.

Balas HANYA JSON:
{"summary":"1-2 kalimat: pola apa yang ditiru dari iklan acuan",
 "ideas":[{"title":"nama konsep","angle":"...","format":"video 45 detik talking head / gambar statis / carousel …","hook":"kalimat pembuka / headline",
   "scenes":[{"time":"0-3s","visual":"...","voiceover":"...","text":"teks di layar"}],
   "caption":"caption iklan lengkap","cta":"…","production":"talent, properti, catatan produksi"}]}
(scenes boleh kosong untuk gambar). Bahasa Indonesia.`;

/** Dikerjakan consumer antrean. */
export async function runRemix(env: Env, remixId: number): Promise<void> {
  const remix = await env.DB.prepare("SELECT * FROM competitor_remixes WHERE id = ?").bind(remixId).first<Remix>();
  if (!remix || remix.status !== "pending") return;
  const ad = await env.DB.prepare(`SELECT *, ${DAYS_RUNNING} AS days FROM competitor_ads WHERE id = ?`)
    .bind(remix.ad_id)
    .first<CompetitorAd & { days: number }>();
  const specialist = (remix.specialist ?? "copywriter") as "konten" | "copywriter";
  const name = specialist === "konten" ? "Perencana Konten" : "Copywriter";
  const fail = async (message: string) => {
    await env.DB.prepare("UPDATE competitor_remixes SET status = 'error', error = ?, done_at = ? WHERE id = ?")
      .bind(message.slice(0, 500), new Date().toISOString(), remixId)
      .run();
    await logActivity(env, specialist, "error", `Gagal membuat konten: ${message}`);
  };
  if (!ad) return fail("Iklan acuan sudah tidak ada");

  await logActivity(env, specialist, "start", `Membuat ${REMIX_COUNT} konten mirip iklan ${ad.page_name ?? ""}`, "mboard");
  const reference = [
    `Halaman: ${ad.page_name} · tayang ${ad.days} hari${ad.active ? " (masih aktif)" : ""} · urutan impresi ${ad.impression_rank ?? "?"} · ${ad.duplicates ?? 1} duplikat`,
    `Format: ${ad.media_type ?? "?"}${ad.video_duration ? ` ${ad.video_duration}` : ""} · CTA: ${ad.cta ?? "?"} · landing: ${ad.link_url ?? "?"}`,
    ad.angle ? `Angle (penilaian kami): ${ANGLES[ad.angle] ?? ad.angle}` : "",
    ad.title ? `Judul link: ${ad.title}` : "",
    `Teks iklan:\n${ad.body ?? "(tidak ada teks — iklan visual)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const [owner, context] = await Promise.all([profile.ownerContext(env), memory.autoContext(env, [ad.title, ad.body].filter(Boolean).join(" ").slice(0, 500))]);

  let data = null as { summary?: string; ideas?: RemixIdea[] } | null;
  try {
    for (let attempt = 0; attempt < 2 && !data?.ideas?.length; attempt++) {
      const { text } = await complete(env, {
        system: REMIX_PROMPT(specialist) + owner,
        user: `IKLAN ACUAN (kompetitor):\n${reference}${context ? `\n\n${context}` : ""}`,
        tier: "fast",
        actor: specialist,
        maxTokens: 7000,
        noThinking: true,
      });
      data = parseLooseJson(text) as typeof data;
    }
  } catch (err) {
    return fail(String(err));
  }
  const ideas = (data?.ideas ?? []).filter((i) => i && i.hook && i.caption).slice(0, 10);
  if (ideas.length < 3) return fail("Hasil AI tidak lengkap, coba lagi");

  const clean = {
    summary: clip(String(data?.summary ?? ""), 500),
    ideas: ideas.map((i) => ({
      title: clip(String(i.title ?? ""), 120),
      angle: clip(String(i.angle ?? ""), 160),
      format: clip(String(i.format ?? ""), 160),
      hook: String(i.hook ?? "").slice(0, 400),
      scenes: Array.isArray(i.scenes)
        ? i.scenes.slice(0, 12).map((s) => ({
            time: s?.time ? clip(String(s.time), 20) : undefined,
            visual: String(s?.visual ?? "").slice(0, 400),
            voiceover: s?.voiceover ? String(s.voiceover).slice(0, 500) : undefined,
            text: s?.text ? String(s.text).slice(0, 200) : undefined,
          }))
        : [],
      caption: String(i.caption ?? "").slice(0, 2500),
      cta: clip(String(i.cta ?? ""), 80),
      production: i.production ? String(i.production).slice(0, 600) : undefined,
    })),
  };
  const noteText = [
    `Acuan: ${ad.page_name} — https://www.facebook.com/ads/library/?id=${ad.id}`,
    clean.summary,
    ...clean.ideas.map(
      (i, n) =>
        `\n${n + 1}. ${i.title} (${i.format})\nAngle: ${i.angle}\nHook: ${i.hook}\n${(i.scenes ?? [])
          .map((s) => `- ${s.time ?? ""} ${s.visual}${s.voiceover ? ` | VO: ${s.voiceover}` : ""}${s.text ? ` | Teks: ${s.text}` : ""}`)
          .join("\n")}\nCaption:\n${i.caption}\nCTA: ${i.cta}${i.production ? `\nProduksi: ${i.production}` : ""}`,
    ),
  ].join("\n");
  const noteId = await db.addNote(env.DB, {
    title: `${clean.ideas.length} konten mirip iklan ${ad.page_name ?? ad.id}`,
    content: noteText,
    tags: `marketing, ${specialist}, kompetitor`,
  });
  await memory.indexNote(env, noteId);
  await env.DB.prepare("UPDATE competitor_remixes SET status = 'done', data = ?, note_id = ?, done_at = ? WHERE id = ?")
    .bind(JSON.stringify(clean), noteId, new Date().toISOString(), remixId)
    .run();
  await logActivity(env, specialist, "done", `${clean.ideas.length} konten mirip iklan ${ad.page_name ?? ""} siap (catatan #${noteId})`);
  await logActivity(env, "manajer_marketing", "done", `Menerima ${clean.ideas.length} konten dari ${name}`);
  if (env.OWNER_CHAT_ID) {
    await new Telegram(env.TELEGRAM_BOT_TOKEN)
      .send(
        env.OWNER_CHAT_ID,
        `✍️ ${name} selesai: ${clean.ideas.length} konten mirip iklan ${ad.page_name ?? ""}.\n${clean.ideas
          .map((i, n) => `${n + 1}. ${i.title} — "${clip(i.hook, 90)}"`)
          .join("\n")}\n\nNaskah & caption lengkap: website → Riset Kompetitor → Konten tim.`,
      )
      .catch((err) => console.error("Gagal kirim notifikasi remix", err));
  }
}

export async function getRemix(env: Env, id: number) {
  const r = await env.DB.prepare("SELECT * FROM competitor_remixes WHERE id = ?").bind(id).first<Remix>();
  if (!r) return null;
  const ad = await env.DB.prepare(`SELECT *, ${DAYS_RUNNING} AS days FROM competitor_ads WHERE id = ?`).bind(r.ad_id).first();
  return { ...r, data: r.data ? JSON.parse(r.data) : null, ad };
}

export async function listRemixes(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ad_id, r.status, r.specialist, r.note_id, r.error, r.created_at, r.done_at,
            json_array_length(json_extract(r.data, '$.ideas')) AS ideas, a.page_name, a.media_type
     FROM competitor_remixes r LEFT JOIN competitor_ads a ON a.id = r.ad_id ORDER BY r.id DESC LIMIT 50`,
  ).all();
  return results;
}
