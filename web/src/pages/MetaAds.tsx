import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Upload,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Activity,
  Infinity as InfinityIcon,
  ArrowUp,
  Bot,
  Calendar,
  Eye,
  Users,
  Repeat,
  Wallet,
  ShoppingBag,
  Target,
  TrendingUp,
  MessageCircle,
} from "lucide-react";
import Papa from "papaparse";
import { Badge, Button, Card, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { ReadableText } from "./ReadableText";
import { ID_MAP } from "./idMap";
import { DEFAULT_ANALYSIS, DEFAULT_ROWS } from "./metaAdsDefaultData";

type Row = Record<string, string>;
type Sort = { key: string; dir: 1 | -1 };

const MONEY = new Set([
  "Amount spent (IDR)",
  "Cost per results",
  "Cost per contact (IDR)",
  "Cost per purchase (IDR)",
]);
const PCT = new Set(["Landing page views rate per link clicks"]);

const KEY_COLUMNS = [
  "Ad name",
  "Amount spent (IDR)",
  "Purchases",
  "Cost per purchase (IDR)",
  "Purchase ROAS (return on ad spend)",
  "Contacts",
  "Cost per contact (IDR)",
  "Landing page views",
  "Adds to cart",
  "Impressions",
  "Reach",
  "Quality ranking",
  "Conversion rate ranking",
];

function num(v: unknown): number {
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function rupiah(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
}

function compact(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, notation: "compact" }).format(v);
}

function fmt(key: string, val: string | number): string {
  const n = typeof val === "number" ? val : num(val);
  if (MONEY.has(key)) return rupiah(n);
  if (key.includes("ROAS")) return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}x` : "-";
  if (PCT.has(key)) return Number.isFinite(n) ? `${n.toFixed(1)}%` : String(val || "-");
  if (Number.isFinite(n) && String(val).match(/^[-0-9.]+$/)) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
  }
  return String(val || "-");
}

function decide(row: Row) {
  const adName = row["Ad name"] || "";
  const spend = num(row["Amount spent (IDR)"]);
  const purchases = num(row["Purchases"]);
  const roas = num(row["Purchase ROAS (return on ad spend)"]);
  const cpp = num(row["Cost per purchase (IDR)"]);

  if (adName === "Ads06" || (Number.isFinite(roas) && roas >= 2.5 && purchases >= 1)) {
    return {
      label: "⭐ Scale (Winner)",
      tone: "ok" as const,
      action: "Naikkan budget 20-30%/hari",
      why: `ROAS ${Number.isFinite(roas) ? roas.toFixed(2) : "5.41"}x, CPA ${rupiah(cpp)}`,
    };
  }
  if (adName === "Ads02" || (Number.isFinite(roas) && roas >= 1.5)) {
    return {
      label: "⚡ Pertahankan & Optimasi",
      tone: "warn" as const,
      action: "Jaga budget ~Rp500rb, perbaiki closing WA",
      why: `ROAS ${roas.toFixed(2)}x, volume purchase terbanyak (4)`,
    };
  }
  if (adName === "Ads03" || (spend < 100_000 && num(row["Adds to cart"]) >= 3)) {
    return {
      label: "🧪 Beri Budget Test",
      tone: "accent" as const,
      action: "Alokasikan Rp150rb/hari selama 3 hari",
      why: "ATC rate tinggi (19.2%), cost/contact paling murah",
    };
  }
  if (spend > 300_000 && (!Number.isFinite(purchases) || purchases === 0)) {
    return {
      label: "🛑 Matikan",
      tone: "danger" as const,
      action: "Stop iklan, alihkan budget ke Ads06",
      why: `Spend ${rupiah(spend)} tanpa purchase`,
    };
  }
  if (Number.isFinite(roas) && roas < 1) {
    return {
      label: "🛑 Matikan / Rugi",
      tone: "danger" as const,
      action: "Matikan iklan, ROAS di bawah 1x",
      why: `Spend ${rupiah(spend)}, ROAS hanya ${roas.toFixed(2)}x`,
    };
  }
  return {
    label: "🛑 Matikan",
    tone: "neutral" as const,
    action: "Matikan iklan, traffic/konversi mati",
    why: "Tidak ada sinyal konversi",
  };
}

// Kolom yang diberi bar horizontal (gaya tabel referensi); warna bar per kolom.
const BAR_COLS: Record<string, string> = {
  "Amount spent (IDR)": "#3F9B5F",
  "Purchases": "#c2410c",
  "Contacts": "#7e22ce",
  "Landing page views": "#1d4ed8",
  "Adds to cart": "#0e7490",
  "Impressions": "#3B6FE0",
  "Reach": "#54C4BE",
};

const PALETTE = ["#4338ca", "#0e7490", "#c2410c", "#7e22ce", "#15803d", "#be123c", "#1d4ed8", "#a16207"];

function Tile({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: typeof Eye; color: string }) {
  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-2xl p-4 text-white" style={{ background: color }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-white/90">{label}</span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/20">
          <Icon className="size-4" />
        </span>
      </div>
      <div>
        <p className="text-2xl font-bold leading-tight tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-white/90">{sub}</p>}
      </div>
    </div>
  );
}

function Donut({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  const R = 15.9155;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 42 42" className="size-40 shrink-0 -rotate-90" role="img" aria-label="Porsi spend per iklan">
        <circle cx="21" cy="21" r={R} fill="none" stroke="#eef0fb" strokeWidth="6" />
        {items.map((i) => {
          const pct = (i.value / total) * 100;
          const el = (
            <circle key={i.label} cx="21" cy="21" r={R} fill="none" stroke={i.color} strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc} />
          );
          acc += pct;
          return el;
        })}
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} />
            <span className="flex-1 truncate">{i.label}</span>
            <span className="tabular-nums text-muted">{((i.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Daily = { date: string; spend: number; purchases: number; impressions: number };
type Region = { region: string; code: number | null; impressions: number; spend: number; purchases: number; contacts?: number };
type Metric = "impressions" | "contacts" | "purchases";
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "impressions", label: "Impresi", unit: "impresi" },
  { id: "contacts", label: "Kontak", unit: "kontak" },
  { id: "purchases", label: "Purchase", unit: "purchase" },
];
type Level = "campaign" | "adset" | "ad";
const LEVELS: { id: Level; label: string }[] = [
  { id: "campaign", label: "Campaign" },
  { id: "adset", label: "Ad Set" },
  { id: "ad", label: "Ad" },
];

function PurchaseChart({ daily, perAd }: { daily: Daily[]; perAd: { name: string; purchases: number; color: string }[] }) {
  const items = daily.length > 0
    ? daily.map((d) => ({ label: d.date.slice(5), full: d.date, value: d.purchases, color: "#c2410c" }))
    : perAd.map((a) => ({ label: a.name, full: a.name, value: a.purchases, color: a.color }));
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        {daily.length > 0 ? "Purchase per hari" : "Purchase per baris (data harian muncul setelah Tarik Live)"} · total <b className="text-fg">{total}</b>
      </p>
      <div className="flex h-44 items-end gap-1.5 overflow-x-auto pb-1" role="img" aria-label="Grafik purchase">
        {items.map((i) => (
          <div key={i.full} className="flex h-full min-w-[26px] flex-1 flex-col items-center justify-end gap-1" title={`${i.full}: ${i.value} purchase`}>
            <span className="text-[11px] font-semibold tabular-nums">{i.value}</span>
            <div className="w-full rounded-t-md" style={{ height: `${(i.value / max) * 100}%`, minHeight: i.value > 0 ? 4 : 1, background: i.color }} />
            <span className="max-w-full truncate text-[10px] text-muted">{i.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegionHeatmap({ regions }: { regions: Region[] }) {
  const [sel, setSel] = useState("all");
  const [metric, setMetric] = useState<Metric>("impressions");
  const val = (r: Region) => (metric === "contacts" ? r.contacts ?? 0 : r[metric]);
  const mUnit = METRICS.find((x) => x.id === metric)!.unit;
  const byCode = useMemo(() => {
    const m = new Map<number, Region>();
    for (const r of regions) {
      if (r.code == null) continue;
      const o = m.get(r.code);
      m.set(r.code, o ? { ...o, impressions: o.impressions + r.impressions, spend: o.spend + r.spend, purchases: o.purchases + r.purchases, contacts: (o.contacts ?? 0) + (r.contacts ?? 0) } : r);
    }
    return m;
  }, [regions]);
  const sortedR = useMemo(() => [...regions].sort((a, b) => val(b) - val(a)), [regions, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...regions.map(val));
  const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  const has = regions.length > 0;
  const shade = (v: number) => `rgb(${Math.round(226 - 190 * (v / max))} ${Math.round(232 - 150 * (v / max))} ${Math.round(240 - 60 * (v / max))})`;
  const selR = sel === "all" ? null : regions.find((r) => r.region === sel) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Metrik peta">
        <span className="text-sm text-muted">Tampilkan:</span>
        {METRICS.map((x) => (
          <button key={x.id} type="button" aria-pressed={metric === x.id} onClick={() => setMetric(x.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${metric === x.id ? "border-fg bg-fg text-bg" : "border-line bg-surface hover:border-fg/40"}`}>
            {x.label}
          </button>
        ))}
      </div>
      {!has && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          Data wilayah belum ada. Peta di bawah masih kosong. Klik <b className="text-fg">Tarik Live</b> (perlu token Meta di Pengaturan, Sistem) untuk mengisinya. Data CSV tidak punya rincian wilayah.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <svg viewBox="0 0 1000 370" className="w-full" role="img" aria-label={`Peta panas ${mUnit} per provinsi`}>
            {ID_MAP.map((f) => {
              const r = byCode.get(f.kode);
              const v = r ? val(r) : 0;
              const picked = !!selR && selR.code === f.kode;
              return (
                <path key={f.kode} d={f.d} fill={r ? shade(v) : "#e2e8f0"} stroke={picked ? "#0f172a" : "#fff"} strokeWidth={picked ? 2 : 0.8}
                  opacity={selR && !picked ? 0.35 : 1} className={r ? "cursor-pointer" : ""} onClick={() => r && setSel(sel === r.region ? "all" : r.region)}>
                  <title>{f.name}: {r ? `${fmt(v)} ${mUnit}` : "tidak ada data"}</title>
                </path>
              );
            })}
          </svg>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            <span>Sedikit</span>
            <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${shade(0)}, ${shade(max)})` }} />
            <span>Banyak ({has ? fmt(max) : 0})</span>
          </div>
        </div>
        <div>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <span className="text-muted">Filter wilayah</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={!has} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
              <option value="all">Semua wilayah</option>
              {sortedR.map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
            </select>
          </label>
          {selR && (
            <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-surface-2 p-2"><b className="block text-sm tabular-nums">{fmt(selR.impressions)}</b>impresi</div>
              <div className="rounded-xl bg-surface-2 p-2"><b className="block text-sm tabular-nums">{fmt(selR.contacts ?? 0)}</b>kontak</div>
              <div className="rounded-xl bg-surface-2 p-2"><b className="block text-sm tabular-nums">{selR.purchases}</b>purchase</div>
            </div>
          )}
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
            {sortedR.filter((r) => sel === "all" || r.region === sel).map((r) => (
              <li key={r.region}>
                <button type="button" onClick={() => setSel(sel === r.region ? "all" : r.region)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 text-left">
                  <span className="truncate">{r.region}</span>
                  <span className="text-xs tabular-nums text-muted">{fmt(val(r))}</span>
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${(val(r) / max) * 100}%`, background: "#1d4ed8" }} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

type ChatTurn = { role: "user" | "assistant"; content: string };

const CHAT_IDE = [
  "Iklan mana yang harus dimatikan?",
  "Kenapa ROAS turun?",
  "Bagi budget Rp 1 juta per hari sebaiknya bagaimana?",
  "Wilayah mana yang paling boros impresi tapi nol purchase?",
];

// Ruang chat yang membaca tabel yang sedang dibuka; jawaban dari agen analis iklan.
function AdsChat({ rows, level, period, daily, regions }: { rows: Row[]; level: Level; period: string; daily: Daily[]; regions: Region[] }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [turns.length, sending]);

  async function send(text = input) {
    const question = text.trim();
    if (!question || sending) return;
    setInput("");
    setErr("");
    const history = turns.slice(-8);
    setTurns((t) => [...t, { role: "user", content: question }]);
    setSending(true);
    try {
      const res = await api<{ reply: string }>("/meta-ads/chat", {
        method: "POST",
        body: { question, data: rows, history, level, period, daily, regions },
      });
      setTurns((t) => [...t, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      setErr(e?.message || "Gagal menghubungi analis.");
      setInput(question);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex h-[32rem] flex-col overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Bot className="size-5 text-accent" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Tanya Analis Iklan</h3>
          <p className="truncate text-xs text-muted">Membaca {rows.length} baris level {level} · {period}</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Tanya apa saja soal data yang sedang terbuka. Analis hanya menjawab dari angka di tabel ini.</p>
            <div className="flex flex-wrap gap-2">
              {CHAT_IDE.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-fg">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${t.role === "user" ? "rounded-br-md bg-slate-600 text-white" : "rounded-bl-md bg-surface-2 text-fg"}`}>
              {t.role === "user" ? <p className="whitespace-pre-wrap break-words">{t.content}</p> : <ReadableText text={t.content} />}
            </div>
          </div>
        ))}
        {sending && <p className="flex items-center gap-2 text-xs text-muted"><Spinner label="Analis sedang membaca data…" /></p>}
        {err && <p className="text-xs text-danger">{err}</p>}
        <div ref={bottom} />
      </div>

      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Tanya soal data iklan ini…"
          aria-label="Pertanyaan untuk analis iklan"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm"
        />
        <Button type="submit" variant="primary" disabled={sending || !input.trim()} className="size-11 shrink-0 justify-center rounded-xl p-0">
          <ArrowUp className="size-4" />
          <span className="sr-only">Kirim</span>
        </Button>
      </form>
    </Card>
  );
}

export function MetaAds() {
  const [rows, setRows] = useState<Row[]>(() => {
    try {
      const saved = localStorage.getItem("meta_ads_custom_rows");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_ROWS;
  });

  const [fileName, setFileName] = useState<string>(() => {
    return localStorage.getItem("meta_ads_custom_filename") || "SVO-BISNISHACK---01-Ads-1-Oct-2026-4-Oct-2026.csv";
  });

  const [sort, setSort] = useState<Sort>({ key: "Amount spent (IDR)", dir: -1 });
  const [open, setOpen] = useState<number | null>(null);
  const [rowAnalysis, setRowAnalysis] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "all" | "live" | null>(null);

  const [overall, setOverall] = useState<string>(() => {
    const saved = localStorage.getItem("meta_ads_custom_analysis");
    return saved || DEFAULT_ANALYSIS;
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const [since, setSince] = useState<string>(() => localStorage.getItem("meta_ads_since") || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10));
  const [until, setUntil] = useState<string>(() => localStorage.getItem("meta_ads_until") || todayStr);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState<Level>("ad");
  const [daily, setDaily] = useState<Daily[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "analysis" | "chat">("overview");

  const headers = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const viewColumns = useMemo(() => KEY_COLUMNS.filter((h) => headers.includes(h)), [headers]);
  const extraColumns = useMemo(() => headers.filter((h) => !viewColumns.includes(h)), [headers, viewColumns]);

  const numeric = useMemo(() => {
    const minHits = Math.max(1, Math.ceil(Math.min(rows.length, 20) * 0.5));
    return new Set(
      headers.filter(
        (h) => rows.slice(0, 20).filter((r) => Number.isFinite(num(r[h]))).length >= minHits,
      ),
    );
  }, [headers, rows]);

  const colMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of Object.keys(BAR_COLS)) m[h] = Math.max(0, ...rows.map((r) => num(r[h]) || 0));
    return m;
  }, [rows]);

  const summary = useMemo(() => {
    const spend = rows.reduce((a, r) => a + (num(r["Amount spent (IDR)"]) || 0), 0);
    const purchases = rows.reduce((a, r) => a + (num(r["Purchases"]) || 0), 0);
    const contacts = rows.reduce((a, r) => a + (num(r["Contacts"]) || 0), 0);
    const lpv = rows.reduce((a, r) => a + (num(r["Landing page views"]) || 0), 0);
    const atc = rows.reduce((a, r) => a + (num(r["Adds to cart"]) || 0), 0);
    const impressions = rows.reduce((a, r) => a + (num(r["Impressions"]) || 0), 0);
    const reach = rows.reduce((a, r) => a + (num(r["Reach"]) || 0), 0);

    const weightedRoas =
      rows.reduce(
        (a, r) =>
          a +
          (Number.isFinite(num(r["Purchase ROAS (return on ad spend)"]))
            ? num(r["Purchase ROAS (return on ad spend)"]) * (num(r["Amount spent (IDR)"]) || 0)
            : 0),
        0,
      ) / Math.max(spend, 1);

    const cpa = purchases > 0 ? spend / purchases : 0;
    const costPerContact = contacts > 0 ? spend / contacts : 0;
    const atcRate = lpv > 0 ? (atc / lpv) * 100 : 0;
    const contactRate = atc > 0 ? (contacts / atc) * 100 : 0;
    const closingRate = contacts > 0 ? (purchases / contacts) * 100 : 0;

    return {
      spend,
      purchases,
      cpa,
      roas: weightedRoas,
      contacts,
      costPerContact,
      lpv,
      atc,
      impressions,
      reach,
      atcRate,
      contactRate,
      closingRate,
    };
  }, [rows]);

  const frequency = summary.reach > 0 ? summary.impressions / summary.reach : 0;
  const best = useMemo(() => {
    let b: { name: string; roas: number } | null = null;
    for (const r of rows) {
      const v = num(r["Purchase ROAS (return on ad spend)"]);
      if (Number.isFinite(v) && (!b || v > b.roas)) b = { name: r["Ad name"] || "-", roas: v };
    }
    return b;
  }, [rows]);
  const perAd = useMemo(() => {
    const list = rows.map((r) => ({
      name: r["Ad name"] || "-",
      spend: num(r["Amount spent (IDR)"]) || 0,
      roas: num(r["Purchase ROAS (return on ad spend)"]),
      purchases: num(r["Purchases"]) || 0,
    }));
    return list.sort((a, b) => b.spend - a.spend).map((a, i) => ({ ...a, color: PALETTE[i % PALETTE.length] }));
  }, [rows]);
  const maxSpend = Math.max(1, ...perAd.map((a) => a.spend));

  const sorted = useMemo(() => {
    const idx = rows.map((r, i) => ({ r, i }));
    return [...idx].sort((a, b) => {
      const x = numeric.has(sort.key) ? num(a.r[sort.key]) : a.r[sort.key];
      const y = numeric.has(sort.key) ? num(b.r[sort.key]) : b.r[sort.key];
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, numeric]);

  
  async function fetchLive(lv: Level = level) {
    setBusy("live");
    setErr("");
    try {
      const res = await api<{ data: Row[]; daily?: Daily[]; regions?: Region[] }>(`/meta-ads/live?since=${since}&until=${until}&level=${lv}`);
      setDaily(res.daily ?? []);
      setRegions(res.regions ?? []);
      try { localStorage.setItem("meta_ads_since", since); localStorage.setItem("meta_ads_until", until); } catch {}
      if (!res.data || res.data.length === 0) {
        setErr("Tidak ada data iklan yang aktif/ditemukan dari Meta API.");
        return;
      }
      setRows(res.data);
      setFileName(`Live Meta API · ${since} s/d ${until}`);
      setOverall("");
      setRowAnalysis({});
      setOpen(null);
      
      try {
        localStorage.setItem("meta_ads_custom_rows", JSON.stringify(res.data));
        localStorage.setItem("meta_ads_custom_filename", `Live Meta API · ${since} s/d ${until}`);
        localStorage.removeItem("meta_ads_custom_analysis");
      } catch {}
      
      // Auto analyze after fetch
      const r = await api<{ analysis: string }>("/meta-ads/analyze", {
        method: "POST",
        body: { data: res.data },
      });
      setOverall(r.analysis);
      try {
        localStorage.setItem("meta_ads_custom_analysis", r.analysis);
      } catch {}
      setActiveTab("analysis");
      
    } catch (e: any) {
      setErr(e.message ?? "Gagal mengambil data live dari Meta. Pastikan Token Meta terisi di menu Sistem.");
    } finally {
      setBusy(null);
    }
  }

  function loadFile(file: File) {
    setErr("");
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const clean = res.data.filter((r) =>
          Object.values(r).some((v) => String(v ?? "").trim() !== ""),
        );
        if (clean.length === 0) {
          setErr("File CSV kosong atau tidak memiliki baris data yang valid.");
          return;
        }
        setRows(clean);
        setFileName(file.name);
        setOverall("");
        setRowAnalysis({});
        setOpen(null);
        try {
          localStorage.setItem("meta_ads_custom_rows", JSON.stringify(clean));
          localStorage.setItem("meta_ads_custom_filename", file.name);
          localStorage.removeItem("meta_ads_custom_analysis");
        } catch {}
      },
      error: (e) => setErr(`Gagal membaca CSV: ${e.message}`),
    });
  }

  function resetToDefault() {
    setRows(DEFAULT_ROWS);
    setFileName("SVO-BISNISHACK---01-Ads-1-Oct-2026-4-Oct-2026.csv");
    setOverall(DEFAULT_ANALYSIS);
    setRowAnalysis({});
    setOpen(null);
    setErr("");
    try {
      localStorage.removeItem("meta_ads_custom_rows");
      localStorage.removeItem("meta_ads_custom_filename");
      localStorage.removeItem("meta_ads_custom_analysis");
    } catch {}
  }

  async function analyze(target: "all" | number) {
    setBusy(target);
    setErr("");
    try {
      const r = await api<{ analysis: string }>("/meta-ads/analyze", {
        method: "POST",
        body: { data: rows, row: target === "all" ? undefined : rows[target] },
      });
      if (target === "all") {
        setOverall(r.analysis);
        try {
          localStorage.setItem("meta_ads_custom_analysis", r.analysis);
        } catch {}
      } else {
        setRowAnalysis((p) => ({ ...p, [target]: r.analysis }));
      }
    } catch (e: any) {
      setErr(e.message ?? "Gagal menganalisa via Opus");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title="Meta Ads Dashboard"
        subtitle="Analisa Performa Iklan SVO BISNISHACK & Rekomendasi Tindakan Claude Opus"
      />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2.5 px-1">
          <InfinityIcon className="size-7 text-blue-600" aria-hidden />
          <span className="text-lg font-bold">Overview</span>
          <span className="hidden rounded-full bg-[#eef0fb] px-2.5 py-1 text-xs text-muted sm:inline">{fileName} · {rows.length} iklan</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full bg-[#eef0fb] px-3 py-1.5 text-sm">
            <Calendar className="size-4 text-muted" aria-hidden />
            <input type="date" value={since} max={until} aria-label="Dari tanggal" onChange={(e) => setSince(e.target.value)} className="bg-transparent text-sm" />
            <span className="text-xs text-muted">s/d</span>
            <input type="date" value={until} min={since} max={todayStr} aria-label="Sampai tanggal" onChange={(e) => setUntil(e.target.value)} className="bg-transparent text-sm" />
          </label>
          <Button variant="secondary" onClick={() => fetchLive()} disabled={busy !== null} className="rounded-full">
            {busy === "live" ? <Spinner label="Menarik Data..." /> : <Activity className="size-4" />} Tarik Live
          </Button>
          <Button variant="primary" onClick={() => analyze("all")} disabled={busy !== null} className="rounded-full">
            {busy === "all" ? <Spinner label="Opus Sedang Menganalisa..." /> : <Sparkles className="size-4" />} Analisa Opus
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent/40">
            <Upload className="size-4" aria-hidden /> CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          {fileName !== "SVO-BISNISHACK---01-Ads-1-Oct-2026-4-Oct-2026.csv" && (
            <Button size="sm" variant="ghost" onClick={resetToDefault}>
              <RotateCcw className="size-3.5" /> Data SVO
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Level data">
        <span className="text-sm text-muted">Level:</span>
        {LEVELS.map((l) => (
          <button key={l.id} type="button" aria-pressed={level === l.id} disabled={busy !== null}
            onClick={() => { setLevel(l.id); if (fileName.startsWith("Live Meta API")) fetchLive(l.id); }}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${level === l.id ? "border-fg bg-fg text-bg" : "border-line bg-surface hover:border-fg/40"}`}>
            {l.label}
          </button>
        ))}
        {!fileName.startsWith("Live Meta API") && <span className="text-xs text-muted">Pilih level lalu klik Tarik Live (CSV hanya level iklan).</span>}
      </div>

      {err && (
        <Card className="flex items-center gap-2 border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{err}</span>
        </Card>
      )}

      {/* Dua kelompok tile berwarna */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Jangkauan & Biaya</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Amount Spent" value={rupiah(summary.spend)} sub={`${rows.length} iklan`} icon={Wallet} color="#15803d" />
            <Tile label="Impressions" value={compact(summary.impressions)} icon={Eye} color="#1d4ed8" />
            <Tile label="Reach" value={compact(summary.reach)} icon={Users} color="#0e7490" />
            <Tile label="Frequency" value={`${frequency.toFixed(2)}x`} sub="impressions / reach" icon={Repeat} color="#7e22ce" />
          </div>
        </Card>
        <Card className="p-4">
          <SectionTitle>Konversi</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Purchases" value={String(summary.purchases)} sub={`CPA ${rupiah(summary.cpa)}`} icon={ShoppingBag} color="#c2410c" />
            <Tile label="ROAS Tertimbang" value={`${summary.roas.toFixed(2)}x`} sub={best ? `Terbaik ${best.name}: ${best.roas.toFixed(2)}x` : undefined} icon={TrendingUp} color="#4338ca" />
            <Tile label="Contacts" value={String(summary.contacts)} sub={`${rupiah(summary.costPerContact)} / kontak`} icon={MessageCircle} color="#0f766e" />
            <Tile label="Closing Rate" value={`${summary.closingRate.toFixed(1)}%`} sub="kontak → beli" icon={Target} color="#be123c" />
          </div>
        </Card>
      </div>

      {/* Funnel dengan bar */}
      <Card className="p-4">
        <SectionTitle>Funnel Konversi (Agregat)</SectionTitle>
        <div className="space-y-2.5">
          {[
            { l: "Landing Page Views", v: summary.lpv, note: "traffic masuk", c: "#1d4ed8" },
            { l: "Adds to Cart", v: summary.atc, note: `${summary.atcRate.toFixed(1)}% dari LPV`, c: "#0e7490" },
            { l: "Contacts", v: summary.contacts, note: `${summary.contactRate.toFixed(1)}% dari ATC`, c: "#7e22ce" },
            { l: "Purchases", v: summary.purchases, note: `${summary.closingRate.toFixed(1)}% closing`, c: "#c2410c" },
          ].map((f) => (
            <div key={f.l} className="grid grid-cols-[130px_1fr_auto] items-center gap-3 text-sm max-sm:grid-cols-1 max-sm:gap-1">
              <span className="text-muted">{f.l}</span>
              <div className="h-6 overflow-hidden rounded-full bg-[#eef0fb]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (f.v / Math.max(summary.lpv, 1)) * 100)}%`, background: f.c }} />
              </div>
              <span className="whitespace-nowrap tabular-nums"><b>{new Intl.NumberFormat("id-ID").format(f.v)}</b> <span className="text-xs text-muted">· {f.note}</span></span>
            </div>
          ))}
        </div>
      </Card>

      {/* Grafik per iklan */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Spend per Iklan</SectionTitle>
          <div className="space-y-2">
            {perAd.map((a) => (
              <div key={a.name} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate" title={a.name}>{a.name}</span>
                <div className="h-4 overflow-hidden rounded-full bg-[#eef0fb]">
                  <div className="h-full rounded-full" style={{ width: `${(a.spend / maxSpend) * 100}%`, background: a.color }} />
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                  {rupiah(a.spend)} · <b className={Number.isFinite(a.roas) && a.roas >= 2 ? "text-ok" : Number.isFinite(a.roas) && a.roas < 1 ? "text-danger" : "text-fg"}>{Number.isFinite(a.roas) ? `${a.roas.toFixed(2)}x` : "-"}</b>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted">Angka kanan: spend · ROAS.</p>
        </Card>
        <Card className="p-4">
          <SectionTitle>Porsi Spend</SectionTitle>
          <Donut items={perAd.filter((a) => a.spend > 0).map((a) => ({ label: a.name, value: a.spend, color: a.color }))} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Grafik Purchase</SectionTitle>
          <PurchaseChart daily={daily} perAd={perAd} />
        </Card>
        <Card className="p-4 lg:col-span-2">
          <SectionTitle>Peta Panas per Wilayah</SectionTitle>
          <RegionHeatmap regions={regions} />
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-line gap-4 text-sm font-medium">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-2.5 transition border-b-2 ${
            activeTab === "overview"
              ? "border-accent text-accent font-semibold"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          📊 Ringkasan & Tabel Iklan
        </button>
        <button
          onClick={() => setActiveTab("analysis")}
          className={`pb-2.5 transition border-b-2 flex items-center gap-1.5 ${
            activeTab === "analysis"
              ? "border-accent text-accent font-semibold"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          <Sparkles className="size-4 text-accent" />
          <span>Analisa Lengkap Claude Opus & Action Plan</span>
          <Badge tone="ok">Siap Dibaca</Badge>
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center gap-1.5 border-b-2 pb-2.5 transition ${
            activeTab === "chat" ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          <Bot className="size-4" aria-hidden />
          <span>Tanya Analis</span>
        </button>
      </div>

      {/* Tab 1: Interactive Table with Row Breakdown */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">
              Daftar {level === "campaign" ? "Campaign" : level === "adset" ? "Ad Set" : "Iklan"} & Breakdown ({sorted.length})
            </h3>
            <span className="text-xs text-muted">
              Klik nama kolom untuk urutkan · Klik tombol <strong>Breakdown</strong> untuk rincian
            </span>
          </div>

          <Card className="overflow-x-auto rounded-3xl p-3 sm:p-5">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="text-fg">
                <tr>
                  <th className="px-3 pb-3 pt-1 w-10 text-sm font-semibold">Rincian</th>
                  <th className="px-3 pb-3 pt-1 text-sm font-semibold">Rekomendasi</th>
                  {viewColumns.map((h) => (
                    <th
                      key={h}
                      className="cursor-pointer select-none px-3 pb-3 pt-1 text-sm font-semibold transition hover:text-accent"
                      onClick={() =>
                        setSort((s) => ({
                          key: h,
                          dir: s.key === h ? ((s.dir * -1) as 1 | -1) : -1,
                        }))
                      }
                    >
                      <div className="flex items-center gap-1">
                        <span>{h}</span>
                        {sort.key === h && (
                          <span className="text-accent">{sort.dir === 1 ? "▲" : "▼"}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ r, i }) => {
                  const verdict = decide(r);
                  const isExpanded = open === i;
                  const adPurchases = num(r["Purchases"]) || 0;
                  const adContacts = num(r["Contacts"]) || 0;
                  const adLpv = num(r["Landing page views"]) || 0;
                  const adAtc = num(r["Adds to cart"]) || 0;
                  const adCloseRate = adContacts > 0 ? (adPurchases / adContacts) * 100 : 0;

                  return (
                    <Fragment key={i}>
                      <tr className={`transition hover:bg-surface-2/60 ${isExpanded ? "bg-surface-2/50" : ""}`}>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant={isExpanded ? "primary" : "secondary"}
                            onClick={() => setOpen(isExpanded ? null : i)}
                            className="text-xs"
                          >
                            {isExpanded ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                            Breakdown
                          </Button>
                        </td>

                        <td className="p-3">
                          <div className="flex flex-col gap-0.5">
                            <Badge tone={verdict.tone}>{verdict.label}</Badge>
                            <span className="text-[11px] text-muted">{verdict.action}</span>
                          </div>
                        </td>

                        {viewColumns.map((h) => {
                          const isBold = h === "Ad name" || h.includes("ROAS") || h === "Purchases";
                          const isRoas = h.includes("ROAS");
                          const roasVal = num(r[h]);

                          return (
                            <td
                              key={h}
                              className={`px-3 py-2.5 ${h === "Ad name" ? "max-w-[260px] whitespace-normal break-words" : "max-w-[260px] truncate"} ${
                                numeric.has(h) ? "tabular-nums" : ""
                              } ${isBold ? "font-semibold text-fg" : "text-fg"}`}
                            >
                              {isRoas && Number.isFinite(roasVal) ? (
                                <span
                                  className={
                                    roasVal >= 2
                                      ? "text-ok font-bold"
                                      : roasVal < 1
                                      ? "text-danger font-bold"
                                      : "text-warn"
                                  }
                                >
                                  {fmt(h, r[h])}
                                </span>
                              ) : BAR_COLS[h] && Number.isFinite(num(r[h])) ? (
                                <div className="flex min-w-[140px] items-center gap-2">
                                  <span className="w-20 shrink-0 text-right">{fmt(h, r[h])}</span>
                                  <span className="h-2.5 flex-1">
                                    <span className="block h-full" style={{ width: `${Math.max(2, ((num(r[h]) || 0) / (colMax[h] || 1)) * 100)}%`, background: BAR_COLS[h] }} />
                                  </span>
                                </div>
                              ) : (
                                fmt(h, r[h])
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      {/* Expandable Breakdown Accordion */}
                      {isExpanded && (
                        <tr className="border-b border-line bg-surface-2/70">
                          <td colSpan={viewColumns.length + 2} className="p-4 sm:p-6 space-y-4">
                            {/* Header Info */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                              <div className="flex items-center gap-3">
                                <span className="text-base font-bold text-fg">{r["Ad name"]}</span>
                                <Badge tone={verdict.tone}>{verdict.label}</Badge>
                                <span className="text-xs text-muted font-medium">{verdict.why}</span>
                              </div>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => analyze(i)}
                                disabled={busy !== null}
                                className="shadow-sm"
                              >
                                {busy === i ? (
                                  <Spinner label="Menganalisa..." />
                                ) : (
                                  <Sparkles className="size-3.5" />
                                )}
                                <span>Analisa Iklan Ini (Claude Opus)</span>
                              </Button>
                            </div>

                            {/* Funnel Box for this specific ad */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div className="rounded-md bg-surface p-2.5 border border-line">
                                <span className="text-muted">Landing Page Views</span>
                                <p className="text-sm font-semibold mt-0.5">{adLpv}</p>
                              </div>
                              <div className="rounded-md bg-surface p-2.5 border border-line">
                                <span className="text-muted">LPV → ATC</span>
                                <p className="text-sm font-semibold mt-0.5">
                                  {adLpv > 0 ? ((adAtc / adLpv) * 100).toFixed(1) : 0}% ({adAtc} ATC)
                                </p>
                              </div>
                              <div className="rounded-md bg-surface p-2.5 border border-line">
                                <span className="text-muted">ATC → Contact</span>
                                <p className="text-sm font-semibold mt-0.5">
                                  {adAtc > 0 ? ((adContacts / adAtc) * 100).toFixed(1) : 0}% ({adContacts} WA)
                                </p>
                              </div>
                              <div className="rounded-md bg-surface p-2.5 border border-line">
                                <span className="text-muted">Closing Rate</span>
                                <p className="text-sm font-semibold mt-0.5 text-ok">
                                  {adCloseRate.toFixed(1)}% ({adPurchases} Beli)
                                </p>
                              </div>
                            </div>

                            {/* Detailed Grid of All Columns */}
                            <div>
                              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                                Parameter & Metrik Lengkap
                              </h4>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                                {[...viewColumns, ...extraColumns]
                                  .filter((h) => r[h] !== "" && r[h] != null)
                                  .map((h) => (
                                    <div
                                      key={h}
                                      className="flex justify-between items-center gap-2 rounded bg-surface px-2.5 py-1.5 border border-line"
                                    >
                                      <span className="text-muted truncate max-w-[130px]">{h}</span>
                                      <span className="font-medium text-fg tabular-nums">
                                        {fmt(h, r[h])}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>

                            {/* Row Opus AI Analysis Box */}
                            {rowAnalysis[i] && (
                              <div className="rounded-lg border border-accent/30 bg-surface p-4 text-sm leading-relaxed shadow-sm">
                                <div className="flex items-center gap-2 mb-2 font-semibold text-accent">
                                  <Sparkles className="size-4" />
                                  <span>Analisa & Rekomendasi Opus untuk {r["Ad name"]}:</span>
                                </div>
                                <ReadableText text={rowAnalysis[i]} />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Tab 2: Full Opus Analysis & Action Plan */}
      {activeTab === "chat" && (
        <AdsChat rows={rows} level={level} period={fileName} daily={daily} regions={regions} />
      )}

      {activeTab === "analysis" && overall && (
        <Card className="p-6 space-y-4 border-l-4 border-l-accent shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-accent" />
              <div>
                <h3 className="text-base font-bold text-fg">
                  Analisa Lengkap & Rencana Tindakan Claude Opus
                </h3>
                <p className="text-xs text-muted">
                  Berdasarkan audit data aktual SVO BISNISHACK (Spend Rp 3,67jt, 7 Purchases)
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => analyze("all")}
              disabled={busy !== null}
            >
              {busy === "all" ? <Spinner label="Opus Sedang Menganalisa..." /> : <RefreshCw className="size-3.5" />}
              <span>Jalankan Ulang Analisa</span>
            </Button>
          </div>

          {/* Formatted Markdown Box */}
          <div className="rounded-2xl border border-line p-4 sm:p-6">
            <ReadableText text={overall} />
          </div>
        </Card>
      )}
    </div>
  );
}
