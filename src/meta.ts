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

const SYS = "Kamu Analis Iklan senior (Performance Marketing). Jawab dalam Bahasa Indonesia, lugas, pakai angka aktual dari data, jangan mengarang metrik. Format markdown ringkas.";

/** mode "all": analisa seluruh tabel. mode "row": breakdown satu baris (iklan/kampanye) dibanding rata-rata tabel. */
export async function analyzeMetaAds(env: Env, data: any[], row?: any): Promise<string> {
  const table = JSON.stringify(data.slice(0, 120));
  const user = row
    ? `Data seluruh iklan (konteks pembanding):\n${table}\n\nBreakdown mendalam untuk baris ini:\n${JSON.stringify(row)}\n\nJelaskan: 1) performa vs rata-rata tabel, 2) masalah/peluang (CTR, CPM, CPC, frekuensi, CPA/ROAS jika ada), 3) keputusan: matikan / pertahankan / scale / tes kreatif baru, beserta angka budget atau langkah konkret.`
    : `Data ekspor Meta Ads:\n${table}\n\nBuat analisa lengkap: 1) Ringkasan (total spend, hasil, CPA/ROAS), 2) Top performer & yang boncos, 3) Diagnosa (kreatif, audiens, frekuensi, biaya), 4) Action plan prioritas (matikan, scale, tes berikutnya) dengan angka konkret.`;
  const res = await complete(env, { system: SYS, user, tier: "smart", actor: "opus", maxTokens: 3000 });
  return res.text;
}
