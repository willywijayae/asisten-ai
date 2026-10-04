// Intelijen Kreatif — iklan kompetitor + iklan sendiri + suara pelanggan → brief mingguan.
// Mengikuti PDF "Second Brain & Competitor Intelligence". Data iklan kompetitor tetap dari modul competitors.ts
// (scrape Meta Ads Library oleh Hermes); modul ini menambah tagging, sinyal pemenang, VOC, brief, policy, feedback loop.
import type { Env } from "./env";
import { complete } from "./agent";
import { logActivity } from "./activity";
import { Telegram } from "./telegram";
import { parseLooseJson } from "./competitors";
import { offsetMinutes } from "./time";
import * as profile from "./profile";

type Row = Record<string, any>;

// --- Taksonomi (PDF hal. 4–5). Satu-satunya sumber; frontend mengambilnya lewat GET /intel/taxonomy. ---
export const TAXONOMY = {
  angle: [
    "performa/stamina",
    "kepercayaan diri",
    "hubungan pasangan",
    "energi kerja",
    "natural/herbal",
    "bukti sosial",
    "perbandingan",
    "harga/promo",
    "kecantikan/anti-aging",
  ],
  hook_type: ["pertanyaan", "pain point", "testimoni", "statistik", "kontroversi", "before-after", "POV", "demo produk"],
  format: ["single image", "carousel", "video pendek (<15 dtk)", "video panjang", "UGC", "talking head", "motion graphic"],
  offer: ["diskon", "bundling", "gratis ongkir", "garansi", "COD", "bonus"],
  emotion: ["rasa malu", "ingin percaya diri", "takut", "harapan", "penasaran", "bangga"],
  claim_risk: ["rendah", "sedang", "tinggi"],
  voc_category: ["keberatan", "alasan_beli", "bahasa_pelanggan"],
} as const;

// Ambang aturan sinyal (PDF hal. 5: "titik awal; kalibrasi dengan data sendiri setelah 4 minggu").
export const RULES = {
  winnerDays: 30,
  scaleVariants: 3,
  shortLivedDays: 7,
  burstAds: 5,
  burstHours: 48,
  fatigueFreqUp: 0.1,
  fatigueCtrDown: 0.1,
  fatigueFreqAbs: 3,
  killCpaFactor: 1.3,
  killRoasFactor: 0.7,
  feedbackMinDays: 3,
  feedbackMaxDays: 7,
};

const OWNERS = ["Kreatif", "Media Buyer", "Copywriter"];

const pick = (v: unknown, list: readonly string[]): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return list.find((x) => x.toLowerCase() === t) ?? null;
};
const clip = (s: string | null | undefined, n: number) => {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
};
const median = (xs: number[]): number | null => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const localDate = (env: Env, d = new Date()) =>
  new Date(d.getTime() + offsetMinutes(env.TIMEZONE_OFFSET) * 60_000).toISOString().slice(0, 10);

const addDays = (isoDate: string, n: number) => new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

// --- LLM + log biaya (estimasi token = karakter/4; bukan angka tagihan resmi) ---

async function llm(
  env: Env,
  module: string,
  o: { system: string; user: string; tier: "fast" | "smart"; maxTokens?: number },
): Promise<string> {
  const { text, model } = await complete(env, { ...o, actor: "riset", noThinking: true });
  const tokens = Math.ceil((o.system.length + o.user.length + text.length) / 4);
  await env.DB.prepare("INSERT INTO intel_costs (module, model, tokens) VALUES (?, ?, ?)").bind(module, model, tokens).run().catch(() => {});
  return text;
}

async function llmJson(env: Env, module: string, o: Parameters<typeof llm>[2], tries = 2): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    const data = parseLooseJson(await llm(env, module, o));
    if (data) return data;
  }
  return null;
}

// --- Produk ---

export async function listProducts(env: Env): Promise<Row[]> {
  return (await env.DB.prepare("SELECT * FROM intel_products ORDER BY name").all<Row>()).results;
}

export async function saveProduct(env: Env, name: string, keywords: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("Nama produk kosong");
  const k = keywords.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).join(",") || n.toLowerCase();
  await env.DB.prepare(
    "INSERT INTO intel_products (name, keywords) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET keywords = excluded.keywords",
  )
    .bind(n, k)
    .run();
}

export async function deleteProduct(env: Env, id: number): Promise<boolean> {
  return ((await env.DB.prepare("DELETE FROM intel_products WHERE id = ?").bind(id).run()).meta.changes ?? 0) > 0;
}

function detectProduct(products: Row[], text: string): string | null {
  const t = text.toLowerCase();
  for (const p of products) if (String(p.keywords).split(",").some((k) => k && t.includes(k))) return p.name;
  return null;
}

// --- 1. Dedup + tagging (hemat token: hash copy+landing, cache per ad_id, batch) ---

async function adHash(a: Row): Promise<string | null> {
  const text = [a.title, a.body].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim();
  if (!text) return null;
  let host = "";
  try {
    host = a.link_url ? new URL(a.link_url).hostname : "";
  } catch {
    /* tautan rusak → abaikan */
  }
  return sha1(`${text}|${host}`);
}

const TAG_PROMPT = `Kamu menandai (tagging) iklan Meta untuk produk kesehatan/kecantikan di Indonesia. Pakai HANYA nilai dari daftar. Kalau tidak yakin, isi null.
Daftar:
- angle: ${TAXONOMY.angle.join(" | ")}
- hook_type: ${TAXONOMY.hook_type.join(" | ")}
- offer: ${TAXONOMY.offer.join(" | ")} (null kalau tidak ada penawaran)
- emotion: ${TAXONOMY.emotion.join(" | ")}
- claim_risk: rendah | sedang | tinggi (tinggi = klaim kesehatan/seksual eksplisit, janji hasil pasti, klaim penyakit)
- product: salah satu nama produk milik pemilik bila iklan ini jelas bersaing langsung dengannya, selain itu null.
Balas HANYA JSON: {"tags":[{"ad_id":"...","product":null,"angle":"...","hook_type":"...","offer":null,"emotion":"...","claim_risk":"..."}]}`;

export async function tagPending(env: Env, limit = 30): Promise<{ tagged: number; copied: number; empty: number; pending: number }> {
  const products = await listProducts(env);
  const { results: pending } = await env.DB.prepare(
    `SELECT a.* FROM competitor_ads a LEFT JOIN ad_tags t ON t.ad_id = a.id WHERE t.ad_id IS NULL ORDER BY a.active DESC, a.first_seen DESC LIMIT ?`,
  )
    .bind(Math.min(limit, 60))
    .all<Row>();
  const out = { tagged: 0, copied: 0, empty: 0, pending: 0 };
  if (!pending.length) return out;

  const toAi: { ad: Row; hash: string }[] = [];
  const seen = new Map<string, Row>(); // hash → iklan perwakilan di batch ini
  const dupes: { ad: Row; hash: string }[] = [];
  for (const ad of pending) {
    const hash = await adHash(ad);
    if (!hash) {
      await env.DB.prepare("INSERT OR IGNORE INTO ad_tags (ad_id, tagged_by) VALUES (?, 'kosong')").bind(ad.id).run();
      out.empty++;
      continue;
    }
    const cached = await env.DB.prepare("SELECT * FROM ad_tags WHERE content_hash = ? AND tagged_by = 'ai' LIMIT 1").bind(hash).first<Row>();
    if (cached) {
      await insertTag(env, ad.id, cached, hash, "salin");
      out.copied++;
    } else if (seen.has(hash)) dupes.push({ ad, hash });
    else {
      seen.set(hash, ad);
      toAi.push({ ad, hash });
    }
  }

  if (toAi.length) {
    const lines = toAi.map(({ ad }) =>
      [
        `ad_id ${ad.id} · ${ad.page_name ?? "?"} · ${ad.media_type ?? "?"}${ad.video_duration ? ` ${ad.video_duration}` : ""} · CTA ${ad.cta ?? "?"}`,
        `  ${clip([ad.title, ad.body].filter(Boolean).join(" — "), 380)}`,
      ].join("\n"),
    );
    const data = await llmJson(env, "tagging", {
      system: `${TAG_PROMPT}\nNama produk milik pemilik: ${products.map((p) => p.name).join(", ") || "(belum ada)"}.`,
      user: lines.join("\n"),
      tier: "fast",
      maxTokens: 4000,
    });
    const tags: Row[] = Array.isArray(data?.tags) ? data.tags : [];
    const byId = new Map(tags.map((t) => [String(t.ad_id), t]));
    for (const { ad, hash } of toAi) {
      const t = byId.get(String(ad.id));
      if (!t) continue; // model melewatkan → biarkan tanpa tag, dicoba lagi lain kali
      const prod = products.find((p) => p.name.toLowerCase() === String(t.product ?? "").toLowerCase())?.name ?? null;
      await insertTag(
        env,
        ad.id,
        {
          product: prod,
          angle: pick(t.angle, TAXONOMY.angle),
          hook_type: pick(t.hook_type, TAXONOMY.hook_type),
          format: formatOf(ad),
          offer: pick(t.offer, TAXONOMY.offer),
          emotion: pick(t.emotion, TAXONOMY.emotion),
          claim_risk: pick(t.claim_risk, TAXONOMY.claim_risk) ?? (ad.risky ? "tinggi" : null),
        },
        hash,
        "ai",
      );
      out.tagged++;
    }
    for (const { ad, hash } of dupes) {
      const c = await env.DB.prepare("SELECT * FROM ad_tags WHERE content_hash = ? AND tagged_by = 'ai' LIMIT 1").bind(hash).first<Row>();
      if (c) (await insertTag(env, ad.id, c, hash, "salin"), out.copied++);
    }
  }
  out.pending = (await env.DB.prepare("SELECT count(*) AS n FROM competitor_ads a LEFT JOIN ad_tags t ON t.ad_id = a.id WHERE t.ad_id IS NULL").first<Row>())?.n ?? 0;
  return out;
}

/** Format dari metadata Ad Library (bukan tebakan AI) bila tersedia. */
function formatOf(ad: Row): string | null {
  const mt = String(ad.media_type ?? "").toLowerCase();
  if (mt.includes("carousel")) return "carousel";
  if (mt.includes("image") || mt.includes("gambar") || mt === "photo") return "single image";
  if (mt.includes("video")) {
    const m = /(\d+)/.exec(String(ad.video_duration ?? ""));
    if (m) return Number(m[1]) < 15 ? "video pendek (<15 dtk)" : "video panjang";
    return "video panjang";
  }
  return null;
}

async function insertTag(env: Env, adId: string, t: Row, hash: string, by: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ad_tags (ad_id, product, angle, hook_type, format, offer, emotion, claim_risk, content_hash, tagged_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(adId, t.product ?? null, t.angle ?? null, t.hook_type ?? null, t.format ?? null, t.offer ?? null, t.emotion ?? null, t.claim_risk ?? null, hash, by)
    .run();
}

// --- 2. Sinyal pemenang + alert ---

const DAYS = `CAST((julianday(coalesce(a.stopped_at, a.last_seen)) - julianday(coalesce(a.started_at, a.first_seen))) AS INTEGER)`;

async function addAlert(env: Env, key: string, kind: string, title: string, detail: string): Promise<boolean> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO intel_alerts (alert_key, kind, title, detail) VALUES (?, ?, ?, ?)").bind(key, kind, clip(title, 160), clip(detail, 400)).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function detectSignals(env: Env): Promise<{ winners: number; alerts: number }> {
  const now = new Date().toISOString();
  let alerts = 0;
  const wk = localDate(env);

  // Kandidat pemenang: aktif & tayang ≥ N hari.
  const { results: cand } = await env.DB.prepare(
    `SELECT a.id, a.page_name, ${DAYS} AS days, t.angle FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.active = 1 AND t.winner = 0 AND ${DAYS} >= ?`,
  ).bind(RULES.winnerDays).all<Row>();
  for (const c of cand) {
    await env.DB.prepare("UPDATE ad_tags SET winner = 1, winner_at = ? WHERE ad_id = ?").bind(now, c.id).run();
    if (await addAlert(env, `winner:${c.id}`, "winner", `Pemenang baru: ${c.page_name ?? "?"} (${c.days} hari)`, `Iklan ${c.id}${c.angle ? ` · angle ${c.angle}` : ""} masih aktif ≥ ${RULES.winnerDays} hari.`)) alerts++;
  }
  // Pemenang yang sudah berhenti tidak lagi dianggap pemenang.
  await env.DB.prepare("UPDATE ad_tags SET winner = 0 WHERE winner = 1 AND ad_id IN (SELECT id FROM competitor_ads WHERE active = 0)").run();

  // Angle sedang di-scale: satu brand ≥ N variasi aktif dari angle yang sama.
  const { results: scale } = await env.DB.prepare(
    `SELECT a.page_name, t.angle, count(*) AS n FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.active = 1 AND t.angle IS NOT NULL GROUP BY a.page_id, t.angle HAVING n >= ?`,
  ).bind(RULES.scaleVariants).all<Row>();
  for (const s of scale) {
    if (await addAlert(env, `scale:${s.page_name}:${s.angle}:${wk.slice(0, 7)}`, "scale", `${s.page_name} men-scale angle "${s.angle}"`, `${s.n} variasi aktif dari angle yang sama.`)) alerts++;
  }

  // Burst: ≥ 5 iklan baru dalam 48 jam dari satu brand yang sudah dikenal (punya iklan lebih tua dari 7 hari).
  const since = new Date(Date.now() - RULES.burstHours * 3600_000).toISOString();
  const { results: burst } = await env.DB.prepare(
    `SELECT a.page_id, a.page_name, count(*) AS n FROM competitor_ads a
     WHERE a.first_seen >= ? AND EXISTS (SELECT 1 FROM competitor_ads o WHERE o.page_id = a.page_id AND o.first_seen < datetime('now','-7 days'))
     GROUP BY a.page_id HAVING n >= ?`,
  ).bind(since, RULES.burstAds).all<Row>();
  for (const b of burst) {
    if (await addAlert(env, `burst:${b.page_id}:${wk}`, "burst", `${b.page_name} meluncurkan ${b.n} iklan baru`, `${b.n} iklan baru dalam ${RULES.burstHours} jam terakhir.`)) alerts++;
  }

  // Offer baru: iklan baru dengan offer yang belum pernah dipakai brand itu sebelumnya.
  const { results: offers } = await env.DB.prepare(
    `SELECT a.page_id, a.page_name, t.offer, min(a.id) AS ad_id FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.first_seen >= ? AND t.offer IS NOT NULL
       AND EXISTS (SELECT 1 FROM competitor_ads o WHERE o.page_id = a.page_id AND o.first_seen < datetime('now','-7 days'))
       AND NOT EXISTS (SELECT 1 FROM competitor_ads o JOIN ad_tags ot ON ot.ad_id = o.id WHERE o.page_id = a.page_id AND o.first_seen < ? AND ot.offer = t.offer)
     GROUP BY a.page_id, t.offer`,
  ).bind(since, since).all<Row>();
  for (const o of offers) {
    if (await addAlert(env, `offer:${o.page_id}:${o.offer}`, "offer", `${o.page_name}: offer baru "${o.offer}"`, `Pertama kali terlihat di iklan ${o.ad_id}.`)) alerts++;
  }

  // Kreatif sendiri: fatigue (frequency naik, CTR turun) dan iklan ditolak.
  for (const f of await fatigued(env)) {
    if (await addAlert(env, `fatigue:${f.ad_id}:${wk}`, "fatigue", `Fatigue: ${f.name ?? f.ad_id}`, f.reason)) alerts++;
  }
  const { results: rejected } = await env.DB.prepare("SELECT ad_id, name FROM own_ads WHERE lower(coalesce(status,'')) LIKE '%reject%' OR lower(coalesce(status,'')) LIKE '%disapprov%'").all<Row>();
  for (const r of rejected) {
    if (await addAlert(env, `policy:${r.ad_id}`, "policy", `Iklan ditolak Meta: ${r.name ?? r.ad_id}`, "Status iklan = ditolak. Cek kebijakan sebelum upload ulang.")) alerts++;
  }

  if (alerts && env.OWNER_CHAT_ID) {
    const { results: fresh } = await env.DB.prepare("SELECT kind, title, detail FROM intel_alerts WHERE seen = 0 AND created_at >= ? ORDER BY id DESC LIMIT 8").bind(now.slice(0, 13) + ":00:00.000Z").all<Row>();
    if (fresh.length)
      await new Telegram(env.TELEGRAM_BOT_TOKEN)
        .send(env.OWNER_CHAT_ID, `🚨 Alert Intelijen Kreatif (${alerts})\n${fresh.map((a) => `- ${a.title}`).join("\n")}\n\nDetail: website → Intelijen Kreatif → Alert.`)
        .catch((e) => console.error("Gagal kirim alert intel", e));
  }
  const winners = (await env.DB.prepare("SELECT count(*) AS n FROM ad_tags WHERE winner = 1").first<Row>())?.n ?? 0;
  return { winners, alerts };
}

async function fatigued(env: Env): Promise<{ ad_id: string; name: string | null; reason: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM own_ads WHERE lower(coalesce(status,'')) = 'active' AND frequency IS NOT NULL AND ctr IS NOT NULL",
  ).all<Row>();
  const out: { ad_id: string; name: string | null; reason: string }[] = [];
  for (const a of results) {
    const hasPrev = a.prev_ctr !== null && a.prev_frequency !== null && a.prev_ctr > 0 && a.prev_frequency > 0;
    if (!hasPrev) continue;
    const fUp = a.frequency / a.prev_frequency - 1;
    const cDown = 1 - a.ctr / a.prev_ctr;
    if ((fUp >= RULES.fatigueFreqUp || a.frequency >= RULES.fatigueFreqAbs) && cDown >= RULES.fatigueCtrDown)
      out.push({ ad_id: a.ad_id, name: a.name, reason: `Frequency ${a.prev_frequency.toFixed(2)} → ${a.frequency.toFixed(2)}, CTR ${a.prev_ctr.toFixed(2)}% → ${a.ctr.toFixed(2)}%.` });
  }
  return out;
}

// --- 3. Iklan sendiri (Meta Ads API / Motion → ingest) ---

export async function ingestOwnAds(env: Env, ads: any[]): Promise<{ added: number; updated: number; skipped: number }> {
  const products = await listProducts(env);
  const out = { added: 0, updated: 0, skipped: 0 };
  const now = new Date().toISOString();
  for (const a of ads.slice(0, 500)) {
    const id = a?.ad_id ?? a?.id;
    if (!id) {
      out.skipped++;
      continue;
    }
    const name = a.name ? String(a.name) : null;
    const product = a.product ? String(a.product) : detectProduct(products, `${name ?? ""} ${a.campaign ?? ""}`);
    const angle = pick(a.angle, TAXONOMY.angle);
    const cur = {
      spend: num(a.spend),
      impressions: num(a.impressions),
      ctr: num(a.ctr),
      cpa: num(a.cpa),
      roas: num(a.roas),
      frequency: num(a.frequency),
    };
    const old = await env.DB.prepare("SELECT * FROM own_ads WHERE ad_id = ?").bind(String(id)).first<Row>();
    if (!old) {
      await env.DB.prepare(
        `INSERT INTO own_ads (ad_id, name, product, angle, hook_id, status, spend, impressions, ctr, cpa, roas, frequency, prev_ctr, prev_frequency, prev_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(String(id), name, product, angle, num(a.hook_id), a.status ? String(a.status) : null, cur.spend, cur.impressions, cur.ctr, cur.cpa, cur.roas, cur.frequency, num(a.prev_ctr), num(a.prev_frequency), a.prev_ctr != null ? now : null)
        .run();
      out.added++;
      continue;
    }
    // Rotasi snapshot pembanding (prev_*) tiap ≥ 6 hari agar fatigue bisa dihitung dari tren.
    const rotate = !old.prev_at || Date.now() - Date.parse(old.prev_at) >= 6 * 86400_000;
    const prevCtr = a.prev_ctr != null ? num(a.prev_ctr) : rotate ? old.ctr : old.prev_ctr;
    const prevFreq = a.prev_frequency != null ? num(a.prev_frequency) : rotate ? old.frequency : old.prev_frequency;
    await env.DB.prepare(
      `UPDATE own_ads SET name = coalesce(?, name), product = coalesce(?, product), angle = coalesce(?, angle), hook_id = coalesce(?, hook_id),
         status = coalesce(?, status), spend = coalesce(?, spend), impressions = coalesce(?, impressions), ctr = coalesce(?, ctr),
         cpa = coalesce(?, cpa), roas = coalesce(?, roas), frequency = coalesce(?, frequency),
         prev_ctr = ?, prev_frequency = ?, prev_at = ?, synced_at = ? WHERE ad_id = ?`,
    )
      .bind(name, product, angle, num(a.hook_id), a.status ? String(a.status) : null, cur.spend, cur.impressions, cur.ctr, cur.cpa, cur.roas, cur.frequency, prevCtr, prevFreq, rotate ? now : old.prev_at, now, String(id))
      .run();
    out.updated++;
  }
  return out;
}

export async function listOwnAds(env: Env, product?: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM own_ads ${product ? "WHERE product = ?" : ""} ORDER BY coalesce(spend, 0) DESC LIMIT 200`,
  ).bind(...(product ? [product] : [])).all<Row>();
  return results;
}

// --- 4. Suara pelanggan (VOC): anonimkan → simpan → klasifikasi ---

/** Anonimkan pola yang pasti: nomor telepon, email, @handle, URL. Nama orang dimasking lagi oleh AI saat klasifikasi. */
export function anonymize(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[tautan]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+?62|0)[\s\-.]?8\d[\d\s\-.]{6,12}\d/g, "[nomor]")
    .replace(/\+?\d[\d\s\-().]{8,}\d/g, "[nomor]")
    .replace(/@\w{3,}/g, "[akun]")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestVoc(
  env: Env,
  items: { source?: string; product?: string; quote?: string; text?: string; date?: string }[],
): Promise<{ added: number; skipped: number }> {
  const products = await listProducts(env);
  const out = { added: 0, skipped: 0 };
  for (const it of items.slice(0, 500)) {
    const quote = anonymize(String(it.quote ?? it.text ?? "")).slice(0, 600);
    if (quote.length < 8) {
      out.skipped++;
      continue;
    }
    const source = ["chat", "crm", "review"].includes(String(it.source)) ? String(it.source) : "chat";
    const product = it.product ? String(it.product) : detectProduct(products, quote);
    const hash = await sha1(quote.toLowerCase());
    const r = await env.DB.prepare("INSERT OR IGNORE INTO voc_snippets (source, product, quote, quote_hash, occurred_on) VALUES (?, ?, ?, ?, ?)")
      .bind(source, product, quote, hash, it.date ? String(it.date).slice(0, 10) : null)
      .run();
    (r.meta.changes ?? 0) > 0 ? out.added++ : out.skipped++;
  }
  return out;
}

export async function classifyVoc(env: Env, limit = 40): Promise<{ classified: number; pending: number }> {
  const { results } = await env.DB.prepare("SELECT id, quote FROM voc_snippets WHERE classified_at IS NULL ORDER BY id LIMIT ?").bind(limit).all<Row>();
  if (!results.length) return { classified: 0, pending: 0 };
  const data = await llmJson(env, "voc", {
    system: `Kamu mengklasifikasi kutipan percakapan pelanggan (Indonesia) untuk riset iklan.
Untuk tiap kutipan beri:
- category: keberatan (alasan ragu/menolak membeli) | alasan_beli (alasan membeli/puas) | bahasa_pelanggan (cara pelanggan menyebut masalah/manfaat dengan kata sendiri)
- angle: salah satu dari ${TAXONOMY.angle.join(" | ")}, atau null
- quote: kutipan yang sama, tetapi nama orang diganti [nama]; jangan ubah isi lain.
Balas HANYA JSON: {"items":[{"id":1,"category":"...","angle":null,"quote":"..."}]}`,
    user: results.map((r) => `id ${r.id}: ${r.quote}`).join("\n"),
    tier: "fast",
    maxTokens: 4000,
  });
  const items: Row[] = Array.isArray(data?.items) ? data.items : [];
  let classified = 0;
  const known = new Set(results.map((r) => r.id));
  for (const it of items) {
    const id = Number(it.id);
    if (!known.has(id)) continue;
    const cat = pick(String(it.category ?? "").replace(/\s+/g, "_"), TAXONOMY.voc_category);
    if (!cat) continue;
    const q = typeof it.quote === "string" && it.quote.length >= 4 ? it.quote.slice(0, 600) : null;
    // Hash sudah dihitung dari teks asli; menimpa quote tidak mengubah dedup.
    await env.DB.prepare("UPDATE voc_snippets SET category = ?, angle = ?, quote = coalesce(?, quote), classified_at = ? WHERE id = ?")
      .bind(cat, pick(it.angle, TAXONOMY.angle), q, new Date().toISOString(), id)
      .run();
    classified++;
  }
  const pending = (await env.DB.prepare("SELECT count(*) AS n FROM voc_snippets WHERE classified_at IS NULL").first<Row>())?.n ?? 0;
  return { classified, pending };
}

export async function listVoc(env: Env, f: { product?: string; category?: string; angle?: string }): Promise<Row[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (f.product) (where.push("product = ?"), vals.push(f.product));
  if (f.category) (where.push("category = ?"), vals.push(f.category));
  if (f.angle) (where.push("angle = ?"), vals.push(f.angle));
  const { results } = await env.DB.prepare(`SELECT * FROM voc_snippets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 200`).bind(...vals).all<Row>();
  return results;
}

// --- 5. Dashboard: peta angle, winner board, timeline, performa vs angle ---

const prodClause = (product?: string, col = "t.product") => (product ? { sql: ` AND ${col} = ?`, vals: [product] } : { sql: "", vals: [] as unknown[] });

export async function angleMap(env: Env, product?: string) {
  const p = prodClause(product);
  const { results } = await env.DB.prepare(
    `SELECT a.page_id, a.page_name, t.angle, count(*) AS n FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.active = 1 AND t.angle IS NOT NULL${p.sql} GROUP BY a.page_id, t.angle`,
  ).bind(...p.vals).all<Row>();
  const pages = new Map<string, string>();
  for (const r of results) pages.set(r.page_id, r.page_name ?? r.page_id);
  return { angles: TAXONOMY.angle, pages: [...pages].map(([id, name]) => ({ id, name })), cells: results.map((r) => ({ page_id: r.page_id, angle: r.angle, n: r.n })) };
}

export async function winnerBoard(env: Env, f: { product?: string; format?: string; limit?: number }): Promise<Row[]> {
  const p = prodClause(f.product);
  const fmt = f.format ? " AND t.format = ?" : "";
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.page_name, a.title, a.body, a.snapshot_url, a.link_url, a.active, ${DAYS} AS days,
            t.angle, t.hook_type, t.format, t.offer, t.claim_risk, t.winner, t.product
     FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE (t.winner = 1 OR a.active = 1)${p.sql}${fmt} ORDER BY t.winner DESC, days DESC LIMIT ?`,
  ).bind(...p.vals, ...(f.format ? [f.format] : []), Math.min(f.limit ?? 40, 100)).all<Row>();
  return results.map((r) => ({ ...r, body: clip(r.body, 240) }));
}

export async function timeline(env: Env, product?: string, weeks = 8): Promise<{ weeks: string[]; rows: Row[] }> {
  const p = prodClause(product);
  const since = new Date(Date.now() - weeks * 7 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT a.page_id, a.page_name, a.started_at, a.first_seen, a.stopped_at FROM competitor_ads a
     LEFT JOIN ad_tags t ON t.ad_id = a.id WHERE (coalesce(a.started_at, a.first_seen) >= ? OR a.stopped_at >= ?)${p.sql}`,
  ).bind(since, since, ...p.vals).all<Row>();
  const weekKey = (iso: string) => {
    const d = new Date(Date.parse(iso));
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000);
    return monday.toISOString().slice(0, 10);
  };
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) keys.push(weekKey(new Date(Date.now() - i * 7 * 86400_000).toISOString()));
  const rows = new Map<string, Row>();
  const row = (id: string, name: string) => {
    if (!rows.has(id)) rows.set(id, { page_id: id, page_name: name, started: Object.fromEntries(keys.map((k) => [k, 0])), stopped: Object.fromEntries(keys.map((k) => [k, 0])) });
    return rows.get(id)!;
  };
  for (const r of results) {
    const st = weekKey(r.started_at ?? r.first_seen);
    if (keys.includes(st)) row(r.page_id, r.page_name ?? r.page_id).started[st]++;
    if (r.stopped_at) {
      const sp = weekKey(r.stopped_at);
      if (keys.includes(sp)) row(r.page_id, r.page_name ?? r.page_id).stopped[sp]++;
    }
  }
  return { weeks: keys, rows: [...rows.values()] };
}

export async function ownPerfByAngle(env: Env, product?: string): Promise<Row[]> {
  const ads = await listOwnAds(env, product);
  const g = new Map<string, Row[]>();
  for (const a of ads) {
    if (!a.angle || (a.spend ?? 0) <= 0) continue;
    g.set(a.angle, [...(g.get(a.angle) ?? []), a]);
  }
  return [...g].map(([angle, xs]) => ({
    angle,
    ads: xs.length,
    spend: xs.reduce((s, a) => s + (a.spend ?? 0), 0),
    cpa: median(xs.map((a) => a.cpa).filter((v) => v != null && v > 0)),
    roas: median(xs.map((a) => a.roas).filter((v) => v != null && v > 0)),
    ctr: median(xs.map((a) => a.ctr).filter((v) => v != null)),
  })).sort((a, b) => b.spend - a.spend);
}

export async function listAngles(env: Env, product?: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM intel_angles ${product ? "WHERE product = ?" : ""} ORDER BY product, angle`).bind(...(product ? [product] : [])).all<Row>();
  return results;
}

// --- 6. Gap analysis (kode, bukan LLM: deterministik & murah) ---

export interface Gaps {
  winners: Row[];
  scaling: Row[];
  shortLived: Row[];
  vocByAngle: Row[];
  gaps: Row[];
  moves: Row[];
  ownAngles: Row[];
  kill: Row[];
}

export async function gapAnalysis(env: Env, product: string): Promise<Gaps> {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  // Iklan yang belum jelas produknya (null) ikut dihitung: kompetitor biasanya tak ber-tag produk kita.
  const pc = " AND (t.product = ? OR t.product IS NULL)";
  const winners = (await env.DB.prepare(
    `SELECT a.id, a.page_name, ${DAYS} AS days, t.angle, t.hook_type, t.format, t.offer, a.title, a.body FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE t.winner = 1${pc} ORDER BY days DESC LIMIT 8`,
  ).bind(product).all<Row>()).results.map((r) => ({ ...r, copy: clip([r.title, r.body].filter(Boolean).join(" — "), 220), title: undefined, body: undefined }));

  const scaling = (await env.DB.prepare(
    `SELECT a.page_name, t.angle, count(*) AS n FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.active = 1 AND t.angle IS NOT NULL${pc} GROUP BY a.page_id, t.angle HAVING n >= ? ORDER BY n DESC LIMIT 8`,
  ).bind(product, RULES.scaleVariants).all<Row>()).results;

  const shortLived = (await env.DB.prepare(
    `SELECT t.angle, count(*) AS n FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id
     WHERE a.active = 0 AND a.stopped_at IS NOT NULL AND ${DAYS} < ? AND t.angle IS NOT NULL${pc} GROUP BY t.angle ORDER BY n DESC`,
  ).bind(RULES.shortLivedDays, product).all<Row>()).results;

  const vocRows = (await env.DB.prepare(
    `SELECT angle, category, quote FROM voc_snippets WHERE classified_at IS NOT NULL AND angle IS NOT NULL AND (product = ? OR product IS NULL) ORDER BY id DESC LIMIT 400`,
  ).bind(product).all<Row>()).results;
  const vocMap = new Map<string, { n: number; quotes: string[] }>();
  for (const v of vocRows) {
    const e = vocMap.get(v.angle) ?? { n: 0, quotes: [] };
    e.n++;
    if (e.quotes.length < 3) e.quotes.push(clip(v.quote, 160));
    vocMap.set(v.angle, e);
  }
  const vocByAngle = [...vocMap].map(([angle, e]) => ({ angle, n: e.n, quotes: e.quotes })).sort((a, b) => b.n - a.n);

  const activeByAngle = new Map<string, number>(
    (await env.DB.prepare(`SELECT t.angle, count(*) AS n FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id WHERE a.active = 1 AND t.angle IS NOT NULL${pc} GROUP BY t.angle`).bind(product).all<Row>()).results.map((r) => [r.angle, r.n]),
  );
  const ownAngles = (await env.DB.prepare("SELECT angle, status, evidence FROM intel_angles WHERE product = ?").bind(product).all<Row>()).results;
  const ownTried = new Set([
    ...ownAngles.map((a) => a.angle),
    ...(await env.DB.prepare("SELECT DISTINCT angle FROM own_ads WHERE product = ? AND angle IS NOT NULL").bind(product).all<Row>()).results.map((r) => r.angle),
  ]);
  // Celah = sering muncul di VOC, belum dipakai kompetitor aktif (≤1 iklan) dan belum pernah dites sendiri.
  const gaps = vocByAngle.filter((v) => (activeByAngle.get(v.angle) ?? 0) <= 1 && !ownTried.has(v.angle)).slice(0, 5);

  const moves = (await env.DB.prepare(
    `SELECT a.page_name,
       sum(CASE WHEN a.first_seen >= ? THEN 1 ELSE 0 END) AS new_ads,
       sum(CASE WHEN a.stopped_at >= ? THEN 1 ELSE 0 END) AS stopped_ads,
       sum(a.active) AS active_ads
     FROM competitor_ads a LEFT JOIN ad_tags t ON t.ad_id = a.id WHERE 1 = 1${pc}
     GROUP BY a.page_id HAVING new_ads > 0 OR stopped_ads > 0 ORDER BY new_ads DESC LIMIT 8`,
  ).bind(weekAgo, weekAgo, product).all<Row>()).results;
  const newOffers = (await env.DB.prepare("SELECT title, detail FROM intel_alerts WHERE kind IN ('offer','burst','scale') AND created_at >= ? ORDER BY id DESC LIMIT 8").bind(weekAgo).all<Row>()).results;

  return { winners, scaling, shortLived, vocByAngle, gaps, moves: [...moves, ...newOffers.map((o) => ({ alert: o.title, detail: o.detail }))], ownAngles, kill: await killCandidates(env, product) };
}

export async function killCandidates(env: Env, product: string): Promise<Row[]> {
  const ads = (await listOwnAds(env, product)).filter((a) => String(a.status ?? "").toLowerCase() === "active");
  const medCpa = median(ads.map((a) => a.cpa).filter((v) => v != null && v > 0));
  const medRoas = median(ads.map((a) => a.roas).filter((v) => v != null && v > 0));
  const fat = new Map((await fatigued(env)).map((f) => [f.ad_id, f.reason]));
  const out: Row[] = [];
  for (const a of ads) {
    const reasons: string[] = [];
    if (fat.has(a.ad_id)) reasons.push(`fatigue (${fat.get(a.ad_id)})`);
    if (medCpa && a.cpa > 0 && (a.spend ?? 0) >= 2 * medCpa && a.cpa > RULES.killCpaFactor * medCpa) reasons.push(`CPA ${Math.round(a.cpa)} vs median produk ${Math.round(medCpa)}`);
    if (medRoas && a.roas > 0 && (a.spend ?? 0) >= 2 * (medCpa ?? 0) && a.roas < RULES.killRoasFactor * medRoas) reasons.push(`ROAS ${a.roas.toFixed(2)} vs median ${medRoas.toFixed(2)}`);
    if (reasons.length) out.push({ ad_id: a.ad_id, name: a.name, angle: a.angle, spend: a.spend, reasons });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || (b.spend ?? 0) - (a.spend ?? 0)).slice(0, 5);
}

// --- 7. Brief mingguan ---

const BRIEF_PROMPT = `Kamu analis kreatif iklan untuk satu produk. Susun BRIEF MINGGUAN 1 halaman dari data ringkasan (bukan data mentah).
Aturan:
- test: tepat 3 angle yang harus dites minggu ini, dipilih HANYA dari daftar angle resmi. Tiap angle: 3 hook siap pakai (bahasa Indonesia santai, jangan menjiplak teks kompetitor, hindari klaim penyakit/seksual eksplisit), alasan singkat, bukti. Bukti hanya boleh dari data (id iklan kompetitor pemenang, kutipan VOC persis dari data). Jangan mengarang bukti.
- Utamakan angle: sering muncul di VOC & belum dipakai (celah), atau di-scale kompetitor & belum dites sendiri. Hindari angle yang banyak iklan kompetitornya mati <7 hari.
- kill: pakai HANYA kandidat kill dari data (maks 3), tulis alasan singkat.
- competitor_moves: 1–4 gerakan kompetitor dari data beserta saran respons satu kalimat.
- gaps: celah dari data, satu saran per celah. Kalau data kosong, tulis array kosong.
- owner: salah satu ${OWNERS.join(" | ")}. due_in_days: bilangan bulat 1–6.
- Kalau data terlalu tipis untuk satu bagian, kosongkan bagian itu & jelaskan di "data_note". Jangan menebak.
Balas HANYA JSON:
{"summary":"2 kalimat","test":[{"angle":"","why":"","hooks":["","",""],"evidence":{"competitor_ad_ids":[""],"voc":[""]},"owner":"","due_in_days":3}],
"kill":[{"ad_id":"","reason":"","owner":"","due_in_days":2}],
"competitor_moves":[{"brand":"","move":"","response":"","owner":"","due_in_days":3}],
"gaps":[{"angle":"","evidence":"","suggestion":""}],"data_note":""}`;

export async function generateBrief(env: Env, product: string): Promise<{ id: number; data: Row }> {
  await logActivity(env, "riset", "start", `Menyusun brief mingguan ${product}`, "mboard");
  const g = await gapAnalysis(env, product);
  const empty = !g.winners.length && !g.vocByAngle.length && !g.moves.length && !g.kill.length;
  if (empty) {
    await logActivity(env, "riset", "error", `Brief ${product}: data belum cukup`);
    throw new Error(`Data untuk ${product} belum cukup (belum ada iklan bertag, VOC, atau iklan sendiri).`);
  }
  const hookBest = (await env.DB.prepare("SELECT text, angle FROM hook_bank WHERE status = 'menang' AND (product = ? OR product IS NULL) ORDER BY id DESC LIMIT 6").bind(product).all<Row>()).results;
  const owner = await profile.ownerContext(env);
  const data = await llmJson(env, "brief", {
    system: BRIEF_PROMPT + owner,
    user: `Produk: ${product}\nAngle resmi: ${TAXONOMY.angle.join(" | ")}\nData: ${JSON.stringify({ ...g, hook_menang_sebelumnya: hookBest })}`,
    tier: "smart",
    maxTokens: 5000,
  });
  if (!data || !Array.isArray(data.test)) {
    await logActivity(env, "riset", "error", `Brief ${product}: keluaran model tidak terbaca`);
    throw new Error("Brief tidak terbaca dari model, coba lagi");
  }

  // Validasi: model tak boleh membawa angle/id di luar data.
  const today = localDate(env);
  const adIds = new Set(g.winners.map((w) => String(w.id)));
  const killIds = new Set(g.kill.map((k) => String(k.ad_id)));
  const due = (n: unknown) => addDays(today, Math.min(6, Math.max(1, Number(n) || 3)));
  const own = (o: unknown) => (OWNERS.includes(String(o)) ? String(o) : OWNERS[0]);
  const clean = {
    summary: clip(data.summary, 400),
    test: data.test
      .map((t: Row) => ({
        angle: pick(t.angle, TAXONOMY.angle),
        why: clip(t.why, 300),
        hooks: (Array.isArray(t.hooks) ? t.hooks : []).map((h: unknown) => clip(String(h), 200)).filter(Boolean).slice(0, 5),
        evidence: {
          competitor_ad_ids: (Array.isArray(t.evidence?.competitor_ad_ids) ? t.evidence.competitor_ad_ids : []).map(String).filter((x: string) => adIds.has(x)),
          voc: (Array.isArray(t.evidence?.voc) ? t.evidence.voc : []).map((q: unknown) => clip(String(q), 200)).slice(0, 3),
        },
        owner: own(t.owner),
        due: due(t.due_in_days),
      }))
      .filter((t: Row) => t.angle)
      .slice(0, 3),
    kill: (Array.isArray(data.kill) ? data.kill : [])
      .filter((k: Row) => killIds.has(String(k.ad_id)))
      .map((k: Row) => ({ ad_id: String(k.ad_id), name: g.kill.find((x) => x.ad_id === String(k.ad_id))?.name ?? null, reason: clip(k.reason, 240), owner: own(k.owner), due: due(k.due_in_days) }))
      .slice(0, 3),
    competitor_moves: (Array.isArray(data.competitor_moves) ? data.competitor_moves : []).slice(0, 4).map((m: Row) => ({ brand: clip(m.brand, 60), move: clip(m.move, 240), response: clip(m.response, 240), owner: own(m.owner), due: due(m.due_in_days) })),
    gaps: (Array.isArray(data.gaps) ? data.gaps : []).slice(0, 5).map((x: Row) => ({ angle: pick(x.angle, TAXONOMY.angle) ?? clip(x.angle, 60), evidence: clip(x.evidence, 240), suggestion: clip(x.suggestion, 240) })),
    data_note: clip(data.data_note, 300),
    stats: { winners: g.winners.length, voc_angles: g.vocByAngle.length, kill_candidates: g.kill.length },
  };
  const res = await env.DB.prepare("INSERT INTO intel_briefs (week, product, data) VALUES (?, ?, ?)").bind(today, product, JSON.stringify(clean)).run();
  const id = Number(res.meta.last_row_id);
  // Hook dari brief masuk hook bank (dedup per teks).
  for (const t of clean.test) for (const h of t.hooks) await addHook(env, { text: h, angle: t.angle, product, source: "ai", brief_id: id });
  await logActivity(env, "riset", "done", `Brief ${product} siap (#${id})`);
  return { id, data: clean };
}

export function briefText(product: string, week: string, d: Row): string {
  const L: string[] = [`📋 Brief Mingguan — ${product} (${week})`, d.summary || ""];
  if (d.test?.length) {
    L.push("\n🧪 TEST MINGGU INI");
    d.test.forEach((t: Row, i: number) => L.push(`${i + 1}. ${t.angle} — ${t.why}\n   Hook: ${t.hooks.slice(0, 2).join(" / ")}\n   👤 ${t.owner} · ⏰ ${t.due}`));
  }
  if (d.kill?.length) {
    L.push("\n🛑 KILL");
    d.kill.forEach((k: Row) => L.push(`- ${k.name ?? k.ad_id}: ${k.reason} (👤 ${k.owner} · ⏰ ${k.due})`));
  }
  if (d.competitor_moves?.length) {
    L.push("\n🕵️ GERAKAN KOMPETITOR");
    d.competitor_moves.forEach((m: Row) => L.push(`- ${m.brand}: ${m.move} → ${m.response}`));
  }
  if (d.gaps?.length) {
    L.push("\n🔎 CELAH");
    d.gaps.forEach((x: Row) => L.push(`- ${x.angle}: ${x.suggestion}`));
  }
  if (d.data_note) L.push(`\nCatatan data: ${d.data_note}`);
  L.push("\nBukti & hook lengkap: website → Intelijen Kreatif → Brief.");
  return L.join("\n");
}

export async function sendBrief(env: Env, id: number): Promise<boolean> {
  const b = await env.DB.prepare("SELECT * FROM intel_briefs WHERE id = ?").bind(id).first<Row>();
  if (!b || !env.OWNER_CHAT_ID) return false;
  await new Telegram(env.TELEGRAM_BOT_TOKEN).send(env.OWNER_CHAT_ID, briefText(b.product, b.week, JSON.parse(b.data)));
  await env.DB.prepare("UPDATE intel_briefs SET sent = 1 WHERE id = ?").bind(id).run();
  return true;
}

export async function listBriefs(env: Env, product?: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM intel_briefs ${product ? "WHERE product = ?" : ""} ORDER BY id DESC LIMIT 30`).bind(...(product ? [product] : [])).all<Row>();
  return results.map((b) => ({ ...b, data: JSON.parse(b.data), done: JSON.parse(b.done) }));
}

export async function setBriefItem(env: Env, id: number, key: string, done: boolean): Promise<string[]> {
  const b = await env.DB.prepare("SELECT done FROM intel_briefs WHERE id = ?").bind(id).first<Row>();
  if (!b) throw new Error("Brief tidak ditemukan");
  const set = new Set<string>(JSON.parse(b.done));
  done ? set.add(key) : set.delete(key);
  const arr = [...set];
  await env.DB.prepare("UPDATE intel_briefs SET done = ? WHERE id = ?").bind(JSON.stringify(arr), id).run();
  return arr;
}

// --- 8. Hook bank + generator ---

export async function addHook(env: Env, h: { text: string; angle?: string | null; product?: string | null; source: string; brief_id?: number }): Promise<number | null> {
  const text = h.text.trim();
  if (text.length < 5) return null;
  const dup = await env.DB.prepare("SELECT id FROM hook_bank WHERE lower(text) = lower(?) AND coalesce(product,'') = coalesce(?, '')").bind(text, h.product ?? null).first<Row>();
  if (dup) return null;
  const r = await env.DB.prepare("INSERT INTO hook_bank (text, angle, product, source, brief_id) VALUES (?, ?, ?, ?, ?)").bind(text, h.angle ?? null, h.product ?? null, h.source, h.brief_id ?? null).run();
  return Number(r.meta.last_row_id);
}

export async function listHooks(env: Env, f: { product?: string; angle?: string; source?: string; status?: string }): Promise<Row[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  for (const k of ["product", "angle", "source", "status"] as const) if (f[k]) (where.push(`${k} = ?`), vals.push(f[k]));
  return (await env.DB.prepare(`SELECT * FROM hook_bank ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 300`).bind(...vals).all<Row>()).results;
}

export async function updateHook(env: Env, id: number, b: { status?: string; own_ad_id?: string | null }): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.status !== undefined) {
    if (!["baru", "dipakai", "menang", "kalah"].includes(b.status)) throw new Error("Status tidak valid");
    sets.push("status = ?");
    vals.push(b.status);
    if (b.status === "dipakai") sets.push("used_at = coalesce(used_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  }
  if (b.own_ad_id !== undefined) (sets.push("own_ad_id = ?"), vals.push(b.own_ad_id || null));
  if (!sets.length) return;
  const r = await env.DB.prepare(`UPDATE hook_bank SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  if (!(r.meta.changes ?? 0)) throw new Error("Hook tidak ditemukan");
}

export async function deleteHook(env: Env, id: number): Promise<boolean> {
  return ((await env.DB.prepare("DELETE FROM hook_bank WHERE id = ?").bind(id).run()).meta.changes ?? 0) > 0;
}

export async function generateHooks(env: Env, product: string, angle: string, n = 20): Promise<{ added: number; total: number }> {
  if (!pick(angle, TAXONOMY.angle)) throw new Error("Angle tidak dikenal");
  n = Math.min(Math.max(n, 5), 30);
  const [voc, win, won] = await Promise.all([
    env.DB.prepare("SELECT quote, category FROM voc_snippets WHERE angle = ? AND (product = ? OR product IS NULL) AND classified_at IS NOT NULL ORDER BY id DESC LIMIT 12").bind(angle, product).all<Row>(),
    env.DB.prepare(`SELECT a.title, a.body, t.hook_type FROM competitor_ads a JOIN ad_tags t ON t.ad_id = a.id WHERE t.angle = ? AND t.winner = 1 LIMIT 6`).bind(angle).all<Row>(),
    env.DB.prepare("SELECT text FROM hook_bank WHERE status = 'menang' AND angle = ? AND (product = ? OR product IS NULL) LIMIT 6").bind(angle, product).all<Row>(),
  ]);
  const owner = await profile.ownerContext(env);
  const data = await llmJson(env, "hooks", {
    system: `Kamu copywriter iklan Meta Indonesia. Buat ${n} hook (kalimat pembuka iklan, maks 140 karakter) untuk produk "${product}" dengan angle "${angle}".
Aturan: bahasa santai pelanggan Indonesia; variasikan tipe hook (${TAXONOMY.hook_type.join(", ")}); terinspirasi dari bahasa pelanggan & pola pemenang, JANGAN menjiplak kalimat kompetitor; tanpa klaim penyakit, tanpa janji hasil pasti, tanpa kata seksual eksplisit, tanpa before-after tubuh.
Balas HANYA JSON: {"hooks":["..."]}${owner}`,
    user: `Bahasa pelanggan (VOC):\n${voc.results.map((v) => `- [${v.category}] ${v.quote}`).join("\n") || "(belum ada)"}\n\nIklan pemenang kompetitor di angle ini:\n${win.results.map((w) => `- (${w.hook_type ?? "?"}) ${clip([w.title, w.body].filter(Boolean).join(" — "), 200)}`).join("\n") || "(belum ada)"}\n\nHook sendiri yang pernah menang:\n${won.results.map((w) => `- ${w.text}`).join("\n") || "(belum ada)"}`,
    tier: "smart",
    maxTokens: 3000,
  });
  const hooks: string[] = Array.isArray(data?.hooks) ? data.hooks.map((h: unknown) => clip(String(h), 160)) : [];
  if (!hooks.length) throw new Error("Hook tidak terbaca dari model, coba lagi");
  let added = 0;
  for (const text of hooks) if (await addHook(env, { text, angle, product, source: "ai" })) added++;
  return { added, total: hooks.length };
}

// --- 9. Policy check ---

// Pola pasti (murah, tanpa AI). Hasil akhir = yang lebih berisiko antara pola dan AI.
const RISK_PATTERNS: [RegExp, string, "sedang" | "tinggi"][] = [
  [/\b(sembuh|menyembuhkan|obat\s+(?:kuat|impoten|diabetes|kanker|darah tinggi))\b/i, "Klaim menyembuhkan/obat penyakit", "tinggi"],
  [/\b(impoten|disfungsi\s+ereksi|ejakulasi\s+dini|mati\s+rasa)\b/i, "Menyebut kondisi medis/seksual sensitif", "tinggi"],
  [/\b(ukuran|diameter|panjang)\s+(?:miss\s*v|kemaluan|alat\s+vital|p\w+s)\b/i, "Menyebut bagian tubuh intim", "tinggi"],
  [/\b(?:tahan|kuat)\s+(?:sampai\s+)?\d+\s*(?:jam|menit)\b/i, "Janji durasi/hasil terukur", "tinggi"],
  [/\b(dijamin|100\s*%\s*(?:ampuh|berhasil|aman)|pasti\s+(?:berhasil|ampuh|sembuh)|permanen)\b/i, "Janji hasil pasti", "sedang"],
  [/\b(sebelum|before)\b.*\b(sesudah|after)\b/i, "Pola before-after", "sedang"],
  [/\b(kamu|anda)\s+(?:terlalu\s+)?(?:gemuk|kurus|jelek|bau|gagal|lemah|loyo)\b/i, "Menyerang atribut personal pengguna", "sedang"],
  [/\bkolagen\b.*\b(awet\s+muda\s+selamanya|hilang\s+keriput\s+total)\b/i, "Klaim anti-aging berlebihan", "sedang"],
];

export async function policyCheck(env: Env, product: string | null, creative: string): Promise<Row> {
  const text = creative.trim().slice(0, 4000);
  if (text.length < 10) throw new Error("Teks kreatif terlalu pendek");
  const hits = RISK_PATTERNS.filter(([re]) => re.test(text));
  const data = await llmJson(env, "policy", {
    system: `Kamu pemeriksa kebijakan iklan Meta (Personal Health, Adult Content, klaim menyesatkan, atribut personal) untuk pasar Indonesia.
Nilai kreatif iklan. Balas HANYA JSON:
{"decision":"lolos|revisi|tolak","risk":"rendah|sedang|tinggi","reasons":["alasan spesifik mengutip frasa bermasalah"],"suggestion":"versi revisi teks yang lebih aman, tetap menarik"}
Pegangan: lolos = aman diupload; revisi = ada frasa yang perlu diganti; tolak = inti pesannya melanggar. Jangan lolos-kan klaim penyakit, janji hasil pasti, atau konten seksual eksplisit.`,
    user: `Produk: ${product ?? "-"}\nKreatif:\n${text}`,
    tier: "smart",
    maxTokens: 1500,
  });
  const rank = { rendah: 0, sedang: 1, tinggi: 2 } as const;
  let risk: keyof typeof rank = pick(data?.risk, TAXONOMY.claim_risk) as keyof typeof rank ?? "sedang";
  for (const [, , r] of hits) if (rank[r] > rank[risk]) risk = r;
  let decision = pick(data?.decision, ["lolos", "revisi", "tolak"]) ?? "revisi";
  if (risk === "tinggi" && decision === "lolos") decision = "revisi";
  if (risk === "sedang" && decision === "lolos" && hits.length) decision = "revisi";
  const reasons = [...hits.map(([, why]) => `Pola: ${why}`), ...(Array.isArray(data?.reasons) ? data.reasons.map((r: unknown) => clip(String(r), 240)) : [])];
  if (!data) reasons.push("Pemeriksa AI tidak merespons; hasil hanya dari pola kata, anggap tidak lengkap.");
  const suggestion = clip(data?.suggestion, 1200);
  const r = await env.DB.prepare("INSERT INTO policy_checks (product, creative, decision, risk, reasons, suggestion) VALUES (?, ?, ?, ?, ?, ?)").bind(product, text, decision, risk, JSON.stringify(reasons), suggestion).run();
  if (risk === "tinggi") await addAlert(env, `policy-check:${r.meta.last_row_id}`, "policy", `Kreatif berisiko tinggi (${product ?? "-"})`, clip(reasons[0] ?? "", 200));
  return { id: Number(r.meta.last_row_id), decision, risk, reasons, suggestion, ai: !!data };
}

export async function listPolicy(env: Env): Promise<Row[]> {
  return (await env.DB.prepare("SELECT * FROM policy_checks ORDER BY id DESC LIMIT 50").all<Row>()).results.map((p) => ({ ...p, reasons: JSON.parse(p.reasons ?? "[]") }));
}

// --- 10. Feedback loop: hasil tes iklan sendiri → status hook & angle ---

export async function feedbackLoop(env: Env): Promise<{ checked: number; updated: number }> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM hook_bank WHERE status = 'dipakai' AND own_ad_id IS NOT NULL AND used_at IS NOT NULL",
  ).all<Row>();
  let updated = 0;
  for (const h of results) {
    const days = (Date.now() - Date.parse(h.used_at)) / 86400_000;
    if (days < RULES.feedbackMinDays) continue;
    const ad = await env.DB.prepare("SELECT * FROM own_ads WHERE ad_id = ?").bind(h.own_ad_id).first<Row>();
    if (!ad) continue;
    const peers = (await env.DB.prepare("SELECT cpa, roas FROM own_ads WHERE product = ? AND ad_id != ? AND coalesce(spend,0) > 0").bind(ad.product ?? h.product, ad.ad_id).all<Row>()).results;
    const ctrlCpa = median(peers.map((p) => p.cpa).filter((v) => v != null && v > 0));
    const ctrlRoas = median(peers.map((p) => p.roas).filter((v) => v != null && v > 0));
    const enough = ctrlCpa ? (ad.spend ?? 0) >= ctrlCpa : (ad.spend ?? 0) > 0;
    let verdict: "menang" | "kalah" | "netral" | null = null;
    if (ctrlCpa && ad.cpa > 0 && enough) verdict = ad.cpa <= 0.9 * ctrlCpa ? "menang" : ad.cpa >= 1.2 * ctrlCpa ? "kalah" : null;
    else if (ctrlRoas && ad.roas > 0 && enough) verdict = ad.roas >= 1.1 * ctrlRoas ? "menang" : ad.roas <= 0.8 * ctrlRoas ? "kalah" : null;
    if (!verdict && days >= RULES.feedbackMaxDays && enough) verdict = "netral"; // data cukup tapi tak jelas → selesai tanpa pemenang
    if (!verdict) continue;
    const result = { cpa: ad.cpa, roas: ad.roas, ctr: ad.ctr, spend: ad.spend, control_cpa: ctrlCpa, control_roas: ctrlRoas, at: new Date().toISOString() };
    await env.DB.prepare("UPDATE hook_bank SET status = ?, result = ? WHERE id = ?").bind(verdict === "netral" ? "kalah" : verdict, JSON.stringify({ ...result, verdict }), h.id).run();
    await env.DB.prepare("UPDATE own_ads SET verdict = ? WHERE ad_id = ?").bind(verdict, ad.ad_id).run();
    const angle = h.angle ?? ad.angle;
    const product = ad.product ?? h.product;
    if (angle && product && verdict !== "netral") {
      const ev = `Hook #${h.id} ${verdict} (CPA ${ad.cpa ?? "-"} vs kontrol ${ctrlCpa ? Math.round(ctrlCpa) : "-"})`;
      await env.DB.prepare(
        `INSERT INTO intel_angles (product, angle, status, evidence) VALUES (?, ?, ?, ?)
         ON CONFLICT(product, angle) DO UPDATE SET status = CASE WHEN intel_angles.status = 'teruji' AND excluded.status = 'gagal' THEN 'teruji' ELSE excluded.status END,
           evidence = excluded.evidence, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).bind(product, angle, verdict === "menang" ? "teruji" : "gagal", ev).run();
    }
    updated++;
  }
  return { checked: results.length, updated };
}

// --- 11. Alert, KPI, biaya ---

export async function listAlerts(env: Env): Promise<Row[]> {
  return (await env.DB.prepare("SELECT * FROM intel_alerts ORDER BY id DESC LIMIT 100").all<Row>()).results;
}

export async function markAlertsSeen(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE intel_alerts SET seen = 1 WHERE seen = 0").run();
}

export async function kpi(env: Env, product?: string) {
  const d7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const pc = product ? " AND product = ?" : "";
  const pv = product ? [product] : [];
  const one = async (sql: string, ...vals: unknown[]) => ((await env.DB.prepare(sql).bind(...vals).first<Row>()) ?? {}) as Row;

  // Creative velocity: hook yang masuk tes (ditandai dipakai) dalam 7 hari terakhir.
  const velocity = (await one(`SELECT count(*) AS n FROM hook_bank WHERE used_at >= ?${pc}`, d7, ...pv)).n ?? 0;
  const w = (await one(`SELECT sum(status = 'menang') AS win, sum(status IN ('menang','kalah')) AS done FROM hook_bank WHERE used_at IS NOT NULL${pc}`, ...pv));
  const hitRate = w.done ? Math.round((100 * (w.win ?? 0)) / w.done) : null;
  // Time-to-insight (PDF): jam dari iklan kompetitor pertama kali terlihat sampai dikutip sebagai bukti di brief.
  const briefs = (await env.DB.prepare(`SELECT created_at, data, done FROM intel_briefs WHERE created_at >= ?${pc}`).bind(d30, ...pv).all<Row>()).results;
  const hours: number[] = [];
  for (const b of briefs) {
    const ids = [...new Set<string>(JSON.parse(b.data).test?.flatMap((t: Row) => t.evidence?.competitor_ad_ids ?? []) ?? [])];
    for (const adId of ids) {
      const a = await env.DB.prepare("SELECT first_seen FROM competitor_ads WHERE id = ?").bind(adId).first<Row>();
      if (a) hours.push((Date.parse(b.created_at) - Date.parse(a.first_seen)) / 3600_000);
    }
  }
  const tti = median(hours);
  // Adopsi: item brief (test+kill+gerakan) yang ditandai dieksekusi.
  let items = 0;
  let done = 0;
  for (const b of briefs) {
    const d = JSON.parse(b.data);
    items += (d.test?.length ?? 0) + (d.kill?.length ?? 0) + (d.competitor_moves?.length ?? 0);
    done += JSON.parse(b.done).length;
  }
  const adoption = items ? Math.round((100 * done) / items) : null;
  const rejected = (await one(`SELECT count(*) AS n FROM own_ads WHERE (lower(coalesce(status,'')) LIKE '%reject%' OR lower(coalesce(status,'')) LIKE '%disapprov%')${pc}`, ...pv)).n ?? 0;
  const blocked = (await one(`SELECT count(*) AS n FROM policy_checks WHERE decision != 'lolos' AND created_at >= ?${pc}`, d30, ...pv)).n ?? 0;
  const tokens = (await one("SELECT sum(tokens) AS t FROM intel_costs WHERE created_at >= ?", d30)).t ?? 0;
  const usedHooks = (await one(`SELECT count(*) AS n FROM hook_bank WHERE status != 'baru'${pc}`, ...pv)).n ?? 0;
  const insights = done + usedHooks;
  return {
    velocity_7d: velocity,
    hit_rate: hitRate,
    hit_rate_sample: w.done ?? 0,
    time_to_insight_hours: tti != null ? Math.max(0, Math.round(tti)) : null,
    adoption,
    adoption_items: items,
    policy_rejected_meta: rejected,
    policy_flagged_30d: blocked,
    tokens_30d: tokens,
    insights_used: insights,
    tokens_per_insight: insights ? Math.round(tokens / insights) : null,
  };
}

export async function costs(env: Env): Promise<Row[]> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  return (await env.DB.prepare("SELECT module, count(*) AS calls, sum(tokens) AS tokens FROM intel_costs WHERE created_at >= ? GROUP BY module ORDER BY tokens DESC").bind(since).all<Row>()).results;
}

export async function overview(env: Env) {
  const one = async (sql: string) => ((await env.DB.prepare(sql).first<Row>()) ?? {}) as Row;
  const [ads, tagged, win, own, voc, vocPending, hooks, unseen] = await Promise.all([
    one("SELECT count(*) AS n, sum(active) AS a FROM competitor_ads"),
    one("SELECT count(*) AS n FROM ad_tags WHERE tagged_by != 'kosong'"),
    one("SELECT count(*) AS n FROM ad_tags WHERE winner = 1"),
    one("SELECT count(*) AS n FROM own_ads"),
    one("SELECT count(*) AS n FROM voc_snippets"),
    one("SELECT count(*) AS n FROM voc_snippets WHERE classified_at IS NULL"),
    one("SELECT count(*) AS n, sum(status = 'dipakai') AS used FROM hook_bank"),
    one("SELECT count(*) AS n FROM intel_alerts WHERE seen = 0"),
  ]);
  return {
    competitor_ads: ads.n ?? 0,
    competitor_active: ads.a ?? 0,
    tagged: tagged.n ?? 0,
    untagged: (ads.n ?? 0) - (tagged.n ?? 0),
    winners: win.n ?? 0,
    own_ads: own.n ?? 0,
    voc: voc.n ?? 0,
    voc_pending: vocPending.n ?? 0,
    hooks: hooks.n ?? 0,
    hooks_in_test: hooks.used ?? 0,
    alerts_unseen: unseen.n ?? 0,
  };
}

// --- 12. Siklus harian & mingguan (dipanggil dari cron) ---

export async function runDaily(env: Env): Promise<Row> {
  const out: Row = {};
  out.tag = await tagPending(env, 40).catch((e) => ({ error: String(e) }));
  out.signals = await detectSignals(env).catch((e) => ({ error: String(e) }));
  out.feedback = await feedbackLoop(env).catch((e) => ({ error: String(e) }));
  out.voc = await classifyVoc(env, 40).catch((e) => ({ error: String(e) }));
  return out;
}

export function isMondayLocal(env: Env, now = new Date()): boolean {
  return new Date(now.getTime() + offsetMinutes(env.TIMEZONE_OFFSET) * 60_000).getUTCDay() === 1;
}

export async function weeklyBriefs(env: Env): Promise<void> {
  for (const p of await listProducts(env)) {
    try {
      const { id } = await generateBrief(env, p.name);
      await sendBrief(env, id);
    } catch (e) {
      console.error(`Brief ${p.name} dilewati`, e instanceof Error ? e.message : e);
    }
  }
}
