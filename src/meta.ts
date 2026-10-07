// Sinkronisasi iklan sendiri dari Meta Marketing API (Graph) ke tabel own_ads lewat intel.ingestOwnAds.
// Token & Ad Account ID diisi di Pengaturan (src/secrets.ts). Hanya membaca (ads_read).
import type { Env } from "./env";
import * as intel from "./intel";
import * as profile from "./profile";

const GRAPH = "https://graph.facebook.com/v21.0";
const STATUS_KEY = "meta_sync_status";

export const metaConfigured = (env: Env) => !!(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID);
const account = (env: Env) => `act_${String(env.META_AD_ACCOUNT_ID).replace(/^act_/i, "")}`;

async function graph(env: Env, url: string): Promise<any> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${env.META_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(25_000) });
  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok || j?.error) {
    const e = j?.error;
    // Pesan Graph tidak memuat token; tetap dipotong.
    throw new Error(`Meta ${res.status}${e?.code ? ` (kode ${e.code})` : ""}: ${String(e?.message ?? "gagal").slice(0, 250)}`);
  }
  return j;
}

export async function testMeta(env: Env): Promise<{ ok: boolean; name?: string; currency?: string; status?: string; message?: string }> {
  if (!metaConfigured(env)) return { ok: false, message: "Isi Access Token dan Ad Account ID dulu." };
  try {
    const j = await graph(env, `${GRAPH}/${account(env)}?fields=name,currency,account_status`);
    const statusMap: Record<number, string> = { 1: "aktif", 2: "dinonaktifkan", 3: "ada tunggakan", 7: "dalam review", 9: "masa tenggang", 101: "ditutup" };
    return { ok: true, name: j.name, currency: j.currency, status: statusMap[j.account_status] ?? String(j.account_status) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const actionValue = (list: any, types: string[]): number | null => {
  if (!Array.isArray(list)) return null;
  for (const t of types) {
    const hit = list.find((a) => a?.action_type === t);
    if (hit) return num(hit.value);
  }
  return null;
};
const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const LEAD = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

// Bentuk respons Graph → bentuk yang dimengerti ingestOwnAds. Diekspor agar bisa diuji tanpa jaringan.
export function mapAd(ad: any): Record<string, unknown> {
  const ins = ad?.insights?.data?.[0] ?? {};
  return {
    ad_id: ad.id,
    name: ad.name ?? null,
    campaign: ad.campaign?.name ?? null,
    status: ad.effective_status ? String(ad.effective_status).toLowerCase() : null,
    spend: num(ins.spend),
    impressions: num(ins.impressions),
    ctr: num(ins.ctr), // Meta sudah memberi dalam persen
    frequency: num(ins.frequency),
    cpa: actionValue(ins.cost_per_action_type, PURCHASE) ?? actionValue(ins.cost_per_action_type, LEAD),
    roas: actionValue(ins.purchase_roas, PURCHASE),
  };
}


const LPV = ["landing_page_view"];
const ATC = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];

function timeQuery(datePreset: string, since?: string, until?: string): string {
  if (since && until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Format tanggal harus YYYY-MM-DD.");
    if (since > until) throw new Error("Tanggal mulai tidak boleh setelah tanggal akhir.");
    return `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  }
  if (!/^[a-z_0-9]+$/.test(datePreset)) throw new Error("date_preset tidak valid.");
  return `date_preset=${datePreset}`;
}

async function insightsAll(env: Env, qs: string): Promise<any[]> {
  if (!metaConfigured(env)) throw new Error("Meta belum dikonfigurasi. Isi Access Token dan Ad Account ID di halaman Pengaturan.");
  let url: string | null = `${GRAPH}/${account(env)}/insights?${qs}&limit=200`;
  const rows: any[] = [];
  for (let page = 0; url && page < 5; page++) {
    const j: any = await graph(env, url);
    rows.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
    if (url && !url.startsWith("https://graph.facebook.com/")) url = null;
  }
  return rows;
}

const INS_FIELDS = "spend,impressions,reach,actions,cost_per_action_type,purchase_roas";
const LIGHT_FIELDS = "spend,impressions,actions"; // untuk breakdown wilayah/harian: tanpa field berat yang sering ditolak Meta
const LEVEL_NAME: Record<string, string> = { campaign: "campaign_name", adset: "adset_name", ad: "ad_name" };

// Baris insight → bentuk kolom yang dipakai dashboard (sama dengan CSV Meta).
function rowFromInsight(name: string, ins: any) {
  const spend = num(ins.spend) || 0;
  const purchases = actionValue(ins.actions, PURCHASE) || 0;
  const contacts = actionValue(ins.actions, LEAD) || 0;
  return {
    "Ad name": name || "Unknown",
    "Amount spent (IDR)": spend,
    "Purchases": purchases,
    "Cost per purchase (IDR)": actionValue(ins.cost_per_action_type, PURCHASE) || (purchases > 0 ? spend / purchases : 0),
    "Purchase ROAS (return on ad spend)": actionValue(ins.purchase_roas, PURCHASE) || 0,
    "Contacts": contacts,
    "Cost per contact (IDR)": actionValue(ins.cost_per_action_type, LEAD) || (contacts > 0 ? spend / contacts : 0),
    "Landing page views": actionValue(ins.actions, LPV) || 0,
    "Adds to cart": actionValue(ins.actions, ATC) || 0,
    "Impressions": num(ins.impressions) || 0,
    "Reach": num(ins.reach) || 0,
    "Quality ranking": ins.quality_ranking || "-",
    "Conversion rate ranking": ins.conversion_rate_ranking || "-",
  };
}

// Level campaign/adset memakai insights akun (tanpa ranking kualitas, yang hanya ada di level ad).
export async function getLevelData(env: Env, level: string, datePreset: string, since?: string, until?: string): Promise<any[]> {
  const nameField = LEVEL_NAME[level];
  if (!nameField) throw new Error("level harus campaign, adset, atau ad.");
  const rows = await insightsAll(env, `level=${level}&fields=${nameField},${INS_FIELDS}&${timeQuery(datePreset, since, until)}`);
  return rows.map((r) => rowFromInsight(r[nameField], r));
}

// Purchase & spend per hari untuk grafik.
export async function getDailyData(env: Env, datePreset: string, since?: string, until?: string): Promise<any[]> {
  const rows = await insightsAll(env, `time_increment=1&fields=date_start,${LIGHT_FIELDS}&${timeQuery(datePreset, since, until)}`);
  return rows.map((r) => ({ date: r.date_start, spend: num(r.spend) || 0, purchases: actionValue(r.actions, PURCHASE) || 0, impressions: num(r.impressions) || 0 }));
}

// Nama region Meta (Inggris) → kode provinsi (cocok dengan web/src/pages/idMap.ts).
const REGION_CODE: Record<string, number> = {
  "aceh": 11, "north sumatra": 12, "west sumatra": 13, "riau": 14, "jambi": 15, "south sumatra": 16, "bengkulu": 17, "lampung": 18,
  "bangka belitung islands": 19, "riau islands": 21, "jakarta": 31, "special capital region of jakarta": 31, "west java": 32, "central java": 33,
  "special region of yogyakarta": 34, "yogyakarta": 34, "east java": 35, "banten": 36, "bali": 51, "west nusa tenggara": 52, "east nusa tenggara": 53,
  "west kalimantan": 61, "central kalimantan": 62, "south kalimantan": 63, "east kalimantan": 64, "north kalimantan": 65,
  "north sulawesi": 71, "central sulawesi": 72, "south sulawesi": 73, "southeast sulawesi": 74, "gorontalo": 75, "west sulawesi": 76,
  "maluku": 81, "north maluku": 82, "papua": 91, "west papua": 92,
};

export async function getRegionData(env: Env, datePreset: string, since?: string, until?: string, campaign?: string): Promise<any[]> {
  const filt = campaign ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.name", operator: "EQUAL", value: campaign }]))}` : "";
  const rows = await insightsAll(env, `breakdowns=region&fields=region,${LIGHT_FIELDS}&${timeQuery(datePreset, since, until)}${filt}`);
  return rows.map((r) => ({
    region: r.region,
    code: REGION_CODE[String(r.region).toLowerCase()] ?? null,
    impressions: num(r.impressions) || 0,
    spend: num(r.spend) || 0,
    purchases: actionValue(r.actions, PURCHASE) || 0,
    contacts: actionValue(r.actions, LEAD) || 0,
  }));
}

export async function getLiveDashboardData(env: Env, datePreset: string = "maximum", since?: string, until?: string): Promise<any[]> {
  if (!metaConfigured(env)) throw new Error("Meta belum dikonfigurasi. Isi Access Token dan Ad Account ID di halaman Pengaturan.");
  let timeParam = "";
  if (since && until) {
    timeQuery(datePreset, since, until); // validasi
    timeParam = `time_range({"since":"${since}","until":"${until}"})`;
  } else {
    timeQuery(datePreset);
    timeParam = `date_preset(${datePreset})`;
  }

  const fields = "id,name,effective_status,insights." + timeParam + "{spend,impressions,reach,actions,cost_per_action_type,purchase_roas,quality_ranking,conversion_rate_ranking}";
  let url: string | null = `${GRAPH}/${account(env)}/ads?fields=${encodeURIComponent(fields)}&limit=100`;
  const ads: any[] = [];
  
  for (let page = 0; url && page < 5 && ads.length < 500; page++) {
    const j: any = await graph(env, url);
    ads.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
    if (url && !url.startsWith("https://graph.facebook.com/")) url = null;
  }
  
  return ads.map(ad => {
    const ins = ad.insights?.data?.[0] || {};
    const spend = num(ins.spend) || 0;
    const purchases = actionValue(ins.actions, PURCHASE) || 0;
    const contacts = actionValue(ins.actions, LEAD) || 0;
    
    return {
      "Ad name": ad.name || "Unknown Ad",
      "Amount spent (IDR)": spend,
      "Purchases": purchases,
      "Cost per purchase (IDR)": actionValue(ins.cost_per_action_type, PURCHASE) || (purchases > 0 ? spend / purchases : 0),
      "Purchase ROAS (return on ad spend)": actionValue(ins.purchase_roas, PURCHASE) || 0,
      "Contacts": contacts,
      "Cost per contact (IDR)": actionValue(ins.cost_per_action_type, LEAD) || (contacts > 0 ? spend / contacts : 0),
      "Landing page views": actionValue(ins.actions, LPV) || 0,
      "Adds to cart": actionValue(ins.actions, ATC) || 0,
      "Impressions": num(ins.impressions) || 0,
      "Reach": num(ins.reach) || 0,
      "Quality ranking": ins.quality_ranking || "-",
      "Conversion rate ranking": ins.conversion_rate_ranking || "-"
    };
  });
}

export async function syncMetaAds(env: Env): Promise<{ fetched: number; added: number; updated: number; skipped: number }> {
  if (!metaConfigured(env)) throw new Error("Meta belum dikonfigurasi (Pengaturan → Meta Ads).");
  const fields = "id,name,effective_status,campaign{name},insights.date_preset(this_month){spend,impressions,ctr,frequency,cost_per_action_type,purchase_roas}";
  let url: string | null = `${GRAPH}/${account(env)}/ads?fields=${encodeURIComponent(fields)}&limit=100`;
  const ads: any[] = [];
  for (let page = 0; url && page < 5 && ads.length < 500; page++) {
    const j: any = await graph(env, url);
    ads.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
    if (url && !url.startsWith("https://graph.facebook.com/")) url = null; // jangan ikuti URL tak terduga
  }
  const r = await intel.ingestOwnAds(env, ads.slice(0, 500).map(mapAd));
  await profile.setSetting(env, STATUS_KEY, JSON.stringify({ at: new Date().toISOString(), ok: true, fetched: ads.length, ...r }));
  return { fetched: ads.length, ...r };
}

export async function recordFailure(env: Env, message: string): Promise<void> {
  await profile.setSetting(env, STATUS_KEY, JSON.stringify({ at: new Date().toISOString(), ok: false, message: message.slice(0, 300) }));
}

export async function lastSync(env: Env): Promise<Record<string, unknown> | null> {
  const row = await profile.getSetting(env, STATUS_KEY);
  try { return row?.value ? JSON.parse(row.value) : null; } catch { return null; }
}

import { complete } from "./agent";

const SYS = "Kamu Analis Iklan senior (Performance Marketing) untuk e-commerce Indonesia. Jawab dalam Bahasa Indonesia, lugas, pakai angka aktual dari data, jangan mengarang metrik. Tulis seperti catatan rapi untuk pemilik bisnis awam: kalimat pendek, judul bagian, daftar singkat. Hindari simbol berlebihan, kode, dan tabel panjang.";

function adCsvSummary(data: any[]): string {
  const rows = data.map((r) => ({
    ad: r["Ad name"],
    delivery: r["Ad delivery"],
    ad_set: r["Ad set name"],
    spend_idr: r["Amount spent (IDR)"],
    impressions: r["Impressions"],
    reach: r["Reach"],
    landing_page_views: r["Landing page views"],
    adds_to_cart: r["Adds to cart"],
    contacts: r["Contacts"],
    cost_per_contact_idr: r["Cost per contact (IDR)"],
    purchases: r["Purchases"],
    cost_per_purchase_idr: r["Cost per purchase (IDR)"],
    purchase_roas: r["Purchase ROAS (return on ad spend)"],
    quality: r["Quality ranking"],
    engagement: r["Engagement rate ranking"],
    conversion: r["Conversion rate ranking"],
    lp_view_rate: r["Landing page views rate per link clicks"],
    result_indicator: r["Result indicator"],
  }));
  return JSON.stringify(rows.slice(0, 120), null, 2);
}

/** mode "all": analisa seluruh tabel. mode "row": breakdown satu baris iklan dibanding rata-rata tabel. */
export async function analyzeMetaAds(env: Env, data: any[], row?: any): Promise<string> {
  const table = adCsvSummary(data);
  const rowSummary = row ? adCsvSummary([row]) : "";
  const user = row
    ? `Konteks seluruh tabel Meta Ads:\n${table}\n\nIklan yang dibreakdown:\n${rowSummary}\n\nAnalisa 1 iklan ini. Bandingkan dengan iklan lain di tabel. Wajib bahas: spend, purchase, CPA, ROAS, LPV, add to cart, contact, ranking quality/engagement/conversion. Akhiri dengan keputusan jelas: SCALE / MATIKAN / PERBAIKI / PANTAU, plus langkah konkret kreatif, funnel, dan budget.`
    : `Data CSV Meta Ads 1-4 Oct 2026:\n${table}\n\nBuat analisa lengkap untuk dashboard: 1) Ringkasan total spend, purchase, CPA, ROAS dan funnel LPV→ATC→Contact→Purchase, 2) Ranking iklan terbaik sampai terburuk, 3) Diagnosa masalah utama (kreatif, landing page, offer, conversion rate), 4) Action plan besok pagi: iklan mana scale/matikan/perbaiki, budget rekomendasi, dan 3 ide testing berikutnya. Jangan mengarang data di luar tabel.`;
  const res = await complete(env, { system: SYS, user, tier: "smart", actor: "opus", maxTokens: 3500 });
  return res.text;
}

const CHAT_SYS = `Kamu Analis Iklan senior (performance marketing) untuk e-commerce Indonesia, menjadi pendamping pemilik di dashboard Meta Ads.
Kamu melihat tabel data iklan yang sedang dibuka pemilik (dalam JSON) dan wajib menjawab HANYA dari angka itu.
- Jawab Bahasa Indonesia, kalimat pendek, langsung ke inti. Jangan pakai tabel, heading, atau simbol markdown.
- Selalu sebut angka aktual dan hitung metrik turunan (CPA, ROAS, CTR funnel) kalau perlu. Tunjukkan hitungannya singkat.
- Jangan mengarang data. Kalau yang ditanya tidak ada di tabel, bilang data itu tidak ada dan sebut apa yang perlu ditarik.
- Kalau pemilik minta keputusan, jawab tegas: scale, pertahankan, perbaiki, atau matikan, plus alasan dan angka budget.
- Kalau pertanyaannya bukan soal data (mis. minta ide copy atau strategi), jawab sebagai praktisi marketing, tetap singkat.`;

/** Tanya-jawab lanjutan tentang tabel yang sedang dibuka di dashboard. */
export async function chatMetaAds(
  env: Env,
  data: any[],
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  meta?: { level?: string; period?: string; daily?: any[]; regions?: any[] },
): Promise<string> {
  const parts = [`Tabel iklan yang sedang dibuka (level ${meta?.level || "ad"}${meta?.period ? `, periode ${meta.period}` : ""}):\n${adCsvSummary(data)}`];
  if (meta?.daily?.length) parts.push(`Purchase & spend per hari:\n${JSON.stringify(meta.daily.slice(0, 60))}`);
  if (meta?.regions?.length) parts.push(`Impresi per wilayah:\n${JSON.stringify(meta.regions.slice(0, 40))}`);
  const convo = history.slice(-8).map((h) => `${h.role === "user" ? "Pemilik" : "Kamu"}: ${h.content}`).join("\n");
  if (convo) parts.push(`Obrolan sebelumnya:\n${convo}`);
  parts.push(`Pertanyaan pemilik: ${question}`);
  const res = await complete(env, { system: CHAT_SYS, user: parts.join("\n\n"), tier: "smart", actor: "opus", maxTokens: 1800 });
  return res.text;
}
