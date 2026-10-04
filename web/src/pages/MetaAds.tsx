import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, Upload } from "lucide-react";
import Papa from "papaparse";
import { Badge, Button, Card, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";

type Row = Record<string, string>;
type Sort = { key: string; dir: 1 | -1 };

const MONEY = new Set(["Amount spent (IDR)", "Cost per results", "Cost per contact (IDR)", "Cost per purchase (IDR)"]);
const PCT = new Set(["Landing page views rate per link clicks"]);
const KEY_COLUMNS = [
  "Ad name",
  "Ad delivery",
  "Amount spent (IDR)",
  "Impressions",
  "Reach",
  "Landing page views",
  "Adds to cart",
  "Contacts",
  "Cost per contact (IDR)",
  "Purchases",
  "Cost per purchase (IDR)",
  "Purchase ROAS (return on ad spend)",
  "Quality ranking",
  "Engagement rate ranking",
  "Conversion rate ranking",
  "Ad set name",
];

function num(v: unknown) {
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
function rupiah(v: number) {
  if (!Number.isFinite(v)) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
}
function compact(v: number) {
  if (!Number.isFinite(v)) return "-";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, notation: "compact" }).format(v);
}
function fmt(key: string, val: string | number) {
  const n = typeof val === "number" ? val : num(val);
  if (MONEY.has(key)) return rupiah(n);
  if (key.includes("ROAS")) return Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";
  if (PCT.has(key)) return Number.isFinite(n) ? `${n.toFixed(1)}%` : String(val || "-");
  if (Number.isFinite(n) && String(val).match(/^[-0-9.]+$/)) return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
  return String(val || "-");
}
function sum(rows: Row[], key: string) {
  return rows.reduce((a, r) => a + (Number.isFinite(num(r[key])) ? num(r[key]) : 0), 0);
}
function decide(row: Row) {
  const spend = num(row["Amount spent (IDR)"]);
  const purchases = num(row["Purchases"]);
  const roas = num(row["Purchase ROAS (return on ad spend)"]);
  const cpp = num(row["Cost per purchase (IDR)"]);
  if (Number.isFinite(roas) && roas >= 1.8 && purchases >= 1) return { label: "Scale", tone: "ok" as const, why: `ROAS ${roas.toFixed(2)}x, CPA ${rupiah(cpp)}` };
  if (spend > 300_000 && (!Number.isFinite(purchases) || purchases === 0)) return { label: "Matikan/Test Ulang", tone: "danger" as const, why: `Spend ${rupiah(spend)} tanpa purchase` };
  if (Number.isFinite(roas) && roas < 1) return { label: "Perbaiki", tone: "warn" as const, why: `ROAS ${roas.toFixed(2)}x belum balik modal` };
  return { label: "Pantau", tone: "neutral" as const, why: "Data belum cukup untuk keputusan keras" };
}

export function MetaAds() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "Amount spent (IDR)", dir: -1 });
  const [open, setOpen] = useState<number | null>(null);
  const [rowAnalysis, setRowAnalysis] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [overall, setOverall] = useState("");
  const [err, setErr] = useState("");

  const headers = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const viewColumns = useMemo(() => KEY_COLUMNS.filter((h) => headers.includes(h)), [headers]);
  const extraColumns = useMemo(() => headers.filter((h) => !viewColumns.includes(h)), [headers, viewColumns]);
  const numeric = useMemo(() => {
    const minHits = Math.max(1, Math.ceil(Math.min(rows.length, 20) * 0.5));
    return new Set(headers.filter((h) => rows.slice(0, 20).filter((r) => Number.isFinite(num(r[h]))).length >= minHits));
  }, [headers, rows]);
  const summary = useMemo(() => {
    const spend = sum(rows, "Amount spent (IDR)");
    const purchases = sum(rows, "Purchases");
    const contacts = sum(rows, "Contacts");
    const lpv = sum(rows, "Landing page views");
    const atc = sum(rows, "Adds to cart");
    const impressions = sum(rows, "Impressions");
    const reach = sum(rows, "Reach");
    const weightedRoas = rows.reduce((a, r) => a + (Number.isFinite(num(r["Purchase ROAS (return on ad spend)"])) ? num(r["Purchase ROAS (return on ad spend)"]) * num(r["Amount spent (IDR)"]) : 0), 0) / Math.max(spend, 1);
    return { spend, purchases, contacts, lpv, atc, impressions, reach, cpa: spend / Math.max(purchases, 1), cpc: spend / Math.max(contacts, 1), roas: weightedRoas };
  }, [rows]);
  const sorted = useMemo(() => {
    const idx = rows.map((r, i) => ({ r, i }));
    return [...idx].sort((a, b) => {
      const x = numeric.has(sort.key) ? num(a.r[sort.key]) : a.r[sort.key];
      const y = numeric.has(sort.key) ? num(b.r[sort.key]) : b.r[sort.key];
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, numeric]);

  function load(file: File) {
    setErr("");
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const clean = res.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
        setRows(clean);
        setFileName(file.name);
        setOverall("");
        setRowAnalysis({});
        setOpen(null);
      },
      error: (e) => setErr(e.message),
    });
  }

  async function analyze(target: "all" | number) {
    setBusy(target);
    setErr("");
    try {
      const r = await api<{ analysis: string }>("/meta-ads/analyze", {
        method: "POST",
        body: { data: rows, row: target === "all" ? undefined : rows[target] },
      });
      if (target === "all") setOverall(r.analysis);
      else setRowAnalysis((p) => ({ ...p, [target]: r.analysis }));
    } catch (e: any) {
      setErr(e.message ?? "Gagal menganalisa");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Meta Ads" subtitle="Dashboard CSV Ads Manager: breakdown per iklan + analisa Claude Opus" />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm hover:opacity-80">
          <Upload className="size-4" /> Pilih file CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {fileName && <Badge>{fileName} · {rows.length} iklan</Badge>}
        {rows.length > 0 && (
          <Button variant="primary" onClick={() => analyze("all")} disabled={busy !== null}>
            {busy === "all" ? <Spinner /> : <Sparkles className="size-4" />} Analisa lengkap (Opus)
          </Button>
        )}
      </Card>

      {err && <p className="mb-3 text-sm text-red-500">{err}</p>}

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Card className="p-3"><p className="text-xs text-muted">Spend</p><p className="font-semibold">{rupiah(summary.spend)}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">Purchase</p><p className="font-semibold">{summary.purchases}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">CPA</p><p className="font-semibold">{rupiah(summary.cpa)}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">ROAS tertimbang</p><p className="font-semibold">{summary.roas.toFixed(2)}x</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">Contacts</p><p className="font-semibold">{summary.contacts}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted">Reach / Imp.</p><p className="font-semibold">{compact(summary.reach)} / {compact(summary.impressions)}</p></Card>
        </div>
      )}

      {overall && (
        <Card className="mb-4 p-4">
          <SectionTitle>Analisa & rencana tindakan</SectionTitle>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{overall}</div>
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-muted">
              <tr>
                <th className="p-2" />
                <th className="p-2 font-medium">Action</th>
                {viewColumns.map((h) => (
                  <th key={h} className="cursor-pointer select-none p-2 font-medium" onClick={() => setSort((s) => (s.key === h ? { key: h, dir: (s.dir * -1) as 1 | -1 } : { key: h, dir: -1 }))}>
                    {h}{sort.key === h ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ r, i }) => {
                const verdict = decide(r);
                return (
                  <Fragment key={i}>
                    <tr className="border-b border-line hover:bg-surface-2">
                      <td className="p-2">
                        <Button size="sm" variant="secondary" onClick={() => setOpen(open === i ? null : i)}>
                          {open === i ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} Breakdown
                        </Button>
                      </td>
                      <td className="p-2"><Badge tone={verdict.tone}>{verdict.label}</Badge></td>
                      {viewColumns.map((h) => (
                        <td key={h} className={`max-w-[260px] truncate p-2 ${numeric.has(h) ? "text-right tabular-nums" : ""}`}>{fmt(h, r[h])}</td>
                      ))}
                    </tr>
                    {open === i && (
                      <tr className="border-b border-line bg-surface-2">
                        <td colSpan={viewColumns.length + 2} className="p-4">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="font-medium">{r["Ad name"]}</span>
                            <Badge tone={verdict.tone}>{verdict.label}</Badge>
                            <span className="text-sm text-muted">{verdict.why}</span>
                          </div>
                          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
                            {[...viewColumns, ...extraColumns].filter((h) => r[h] !== "" && r[h] != null).map((h) => (
                              <div key={h} className="flex justify-between gap-2 border-b border-line py-0.5">
                                <span className="text-muted">{h}</span><span className={numeric.has(h) ? "tabular-nums" : ""}>{fmt(h, r[h])}</span>
                              </div>
                            ))}
                          </div>
                          <Button variant="primary" size="sm" onClick={() => analyze(i)} disabled={busy !== null}>
                            {busy === i ? <Spinner /> : <Sparkles className="size-3.5" />} Analisa iklan ini
                          </Button>
                          {rowAnalysis[i] && <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{rowAnalysis[i]}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
