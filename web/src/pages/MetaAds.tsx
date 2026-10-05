import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Upload,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Activity
} from "lucide-react";
import Papa from "papaparse";
import { Badge, Button, Card, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
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

  const [err, setErr] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "analysis">("overview");

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

  const sorted = useMemo(() => {
    const idx = rows.map((r, i) => ({ r, i }));
    return [...idx].sort((a, b) => {
      const x = numeric.has(sort.key) ? num(a.r[sort.key]) : a.r[sort.key];
      const y = numeric.has(sort.key) ? num(b.r[sort.key]) : b.r[sort.key];
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, numeric]);

  
  async function fetchLive() {
    setBusy("live");
    setErr("");
    try {
      const res = await api<{ data: Row[] }>("/meta-ads/live?preset=maximum");
      if (!res.data || res.data.length === 0) {
        setErr("Tidak ada data iklan yang aktif/ditemukan dari Meta API.");
        return;
      }
      setRows(res.data);
      setFileName("Live Data (Meta API)");
      setOverall("");
      setRowAnalysis({});
      setOpen(null);
      
      try {
        localStorage.setItem("meta_ads_custom_rows", JSON.stringify(res.data));
        localStorage.setItem("meta_ads_custom_filename", "Live Data (Meta API)");
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

      {/* Control Bar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-surface transition">
            <Upload className="size-4 text-accent" /> Upload CSV Lain
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            />
          </label>
          <Badge tone="accent">
            📁 {fileName} ({rows.length} iklan)
          </Badge>
          {fileName !== "SVO-BISNISHACK---01-Ads-1-Oct-2026-4-Oct-2026.csv" && (
            <Button size="sm" variant="ghost" onClick={resetToDefault}>
              <RotateCcw className="size-3.5" /> Kembali ke Data SVO
            </Button>
          )}
        </div>

        
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={fetchLive}
            disabled={busy !== null}
            className="shadow-sm border-accent text-accent hover:bg-accent/10"
          >
            {busy === "live" ? <Spinner label="Menarik Data..." /> : <Activity className="size-4" />} Tarik Live (Meta API)
          </Button>

          <Button
            variant="primary"

            onClick={() => analyze("all")}
            disabled={busy !== null}
            className="shadow-sm"
          >
            {busy === "all" ? <Spinner label="Opus Sedang Menganalisa..." /> : <Sparkles className="size-4" />} Analisa Ulang (Claude Opus)
          </Button>
        </div>
      </Card>

      {err && (
        <Card className="border-danger/30 bg-danger-soft p-3 text-sm text-danger flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{err}</span>
        </Card>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5 border-l-4 border-l-accent">
          <p className="text-xs font-medium text-muted">Total Spend</p>
          <p className="mt-1 text-lg font-bold text-fg">{rupiah(summary.spend)}</p>
          <p className="text-[11px] text-muted">4 hari kampanye</p>
        </Card>

        <Card className="p-3.5 border-l-4 border-l-ok">
          <p className="text-xs font-medium text-muted">Purchases & CPA</p>
          <p className="mt-1 text-lg font-bold text-fg">
            {summary.purchases} <span className="text-xs font-normal text-muted">sales</span>
          </p>
          <p className="text-[11px] text-ok font-medium">CPA {rupiah(summary.cpa)}</p>
        </Card>

        <Card className="p-3.5 border-l-4 border-l-warn">
          <p className="text-xs font-medium text-muted">ROAS Tertimbang</p>
          <p className="mt-1 text-lg font-bold text-fg">{summary.roas.toFixed(2)}x</p>
          <p className="text-[11px] text-muted">Winner Ads06: 5.41x</p>
        </Card>

        <Card className="p-3.5 border-l-4 border-l-accent">
          <p className="text-xs font-medium text-muted">Contacts & Lead Cost</p>
          <p className="mt-1 text-lg font-bold text-fg">
            {summary.contacts} <span className="text-xs font-normal text-muted">kontak</span>
          </p>
          <p className="text-[11px] text-muted">{rupiah(summary.costPerContact)} / kontak</p>
        </Card>

        <Card className="p-3.5 border-l-4 border-l-danger">
          <p className="text-xs font-medium text-muted">Closing Rate</p>
          <p className="mt-1 text-lg font-bold text-danger">{summary.closingRate.toFixed(1)}%</p>
          <p className="text-[11px] text-danger font-medium">⚠️ Bottleneck kontak→beli</p>
        </Card>

        <Card className="p-3.5">
          <p className="text-xs font-medium text-muted">Reach & Impressions</p>
          <p className="mt-1 text-lg font-bold text-fg">
            {compact(summary.reach)} <span className="text-xs font-normal text-muted">reach</span>
          </p>
          <p className="text-[11px] text-muted">{compact(summary.impressions)} imps (Freq 1.26x)</p>
        </Card>
      </div>

      {/* Funnel Progress Overview Bar */}
      <Card className="p-4">
        <SectionTitle>
          <span>Funnel Konversi Keseluruhan (Agregat)</span>
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-surface-2 p-3">
            <span className="text-xs text-muted">1. Landing Page Views</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-semibold">{summary.lpv}</span>
              <span className="text-xs text-muted">Traffic masuk</span>
            </div>
          </div>

          <div className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>2. Adds to Cart</span>
              <span className="font-semibold text-accent">{summary.atcRate.toFixed(1)}% LPV</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-semibold">{summary.atc}</span>
              <span className="text-xs text-muted">Keranjang</span>
            </div>
          </div>

          <div className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>3. Contacts (WA/Lead)</span>
              <span className="font-semibold text-accent">{summary.contactRate.toFixed(1)}% ATC</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-semibold">{summary.contacts}</span>
              <span className="text-xs text-muted">Chat Masuk</span>
            </div>
          </div>

          <div className="rounded-lg bg-surface-2 p-3 border border-danger/30">
            <div className="flex items-center justify-between text-xs text-danger font-medium">
              <span>4. Purchases</span>
              <span>{summary.closingRate.toFixed(1)}% Close</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-semibold text-ok">{summary.purchases}</span>
              <span className="text-xs text-muted">Rp 524rb CPA</span>
            </div>
          </div>
        </div>
      </Card>

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
      </div>

      {/* Tab 1: Interactive Table with Row Breakdown */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">
              Daftar Iklan & Breakdown ({sorted.length} Iklan)
            </h3>
            <span className="text-xs text-muted">
              Klik nama kolom untuk urutkan · Klik tombol <strong>Breakdown</strong> untuk rincian
            </span>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-muted">
                <tr>
                  <th className="p-3 w-10">Breakdown</th>
                  <th className="p-3 font-semibold text-fg">Rekomendasi Tindakan</th>
                  {viewColumns.map((h) => (
                    <th
                      key={h}
                      className="cursor-pointer select-none p-3 font-medium hover:text-fg transition"
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
              <tbody className="divide-y divide-line">
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
                      <tr className={`hover:bg-surface-2/60 transition ${isExpanded ? "bg-surface-2/50" : ""}`}>
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
                              className={`max-w-[260px] truncate p-3 ${
                                numeric.has(h) ? "text-right tabular-nums" : ""
                              } ${isBold ? "font-semibold text-fg" : "text-fg/80"}`}
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
                                <div className="whitespace-pre-wrap text-fg text-xs sm:text-sm">
                                  {rowAnalysis[i]}
                                </div>
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
          <div className="text-fg leading-relaxed whitespace-pre-wrap rounded-lg bg-surface-2/60 p-4 sm:p-6 text-xs sm:text-sm border border-line font-sans">
            {overall}
          </div>
        </Card>
      )}
    </div>
  );
}
