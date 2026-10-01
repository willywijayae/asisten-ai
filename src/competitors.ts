import type { Env } from "./env";
import * as profile from "./profile";
import { clip, logActivity } from "./activity";
import { runMarketing } from "./marketing";
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

function normalize(raw: any): Omit<CompetitorAd, "first_seen" | "last_seen" | "angle" | "hook" | "promo" | "risky" | "confidence" | "scored_by" | "scored_at" | "query" | "country"> | null {
  const id = first(raw?.id ?? raw?.ad_archive_id);
  if (!id || !/^\d{5,25}$/.test(id)) return null;
  const stopped = toIso(raw.ad_delivery_stop_time ?? raw.stopped_at);
  return {
    id,
    page_id: first(raw.page_id),
    page_name: first(raw.page_name),
    title: clip(first(raw.title ?? raw.ad_creative_link_titles ?? raw.ad_creative_link_title) ?? "", 300) || null,
    body: clip(first(raw.body ?? raw.ad_creative_bodies ?? raw.ad_creative_body) ?? "", 2000) || null,
    caption: clip(first(raw.caption ?? raw.ad_creative_link_captions ?? raw.ad_creative_link_caption) ?? "", 200) || null,
    snapshot_url: first(raw.snapshot_url ?? raw.ad_snapshot_url) ?? `https://www.facebook.com/ads/library/?id=${id}`,
    platforms: Array.isArray(raw.publisher_platforms) ? raw.publisher_platforms.join(", ") : first(raw.platforms ?? raw.publisher_platforms),
    currency: first(raw.currency),
    started_at: toIso(raw.ad_delivery_start_time ?? raw.started_at ?? raw.start_time ?? raw.ad_creation_time),
    stopped_at: stopped,
    active: raw.active === false || stopped ? 0 : 1,
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
           started_at, stopped_at, active, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
         ON CONFLICT(id) DO UPDATE SET
           page_name = coalesce(excluded.page_name, page_name),
           title = coalesce(excluded.title, title),
           body = coalesce(excluded.body, body),
           caption = coalesce(excluded.caption, caption),
           platforms = coalesce(excluded.platforms, platforms),
           started_at = coalesce(started_at, excluded.started_at),
           stopped_at = excluded.stopped_at,
           active = excluded.active,
           last_seen = excluded.last_seen`,
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
    f.sort === "baru" ? "first_seen DESC" : f.sort === "hook" ? "hook DESC NULLS LAST, days DESC" : "days DESC, first_seen DESC";
  const { results } = await env.DB.prepare(
    `SELECT *, ${DAYS_RUNNING} AS days FROM competitor_ads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ?`,
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
