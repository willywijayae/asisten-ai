import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, Upload } from "lucide-react";
import Papa from "papaparse";
import { Badge, Button, Card, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";

type Row = Record<string, string>;
const num = (v: string | undefined) => {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? NaN : n;
};
const NAME_KEYS = ["Ad name", "Ad Name", "Nama iklan", "Campaign name", "Nama kampanye", "Ad set name"];

export function MetaAds() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [rowAnalysis, setRowAnalysis] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [overall, setOverall] = useState("");
  const [err, setErr] = useState("");

  const headers = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const nameKey = headers.find((h) => NAME_KEYS.includes(h)) ?? headers[0];
  const numeric = useMemo(
    () => new Set(headers.filter((h) => rows.slice(0, 20).filter((r) => !Number.isNaN(num(r[h]))).length > 10)),
    [headers, rows],
  );
  const sorted = useMemo(() => {
    const idx = rows.map((r, i) => ({ r, i }));
    if (!sort) return idx;
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
        setRows(res.data);
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
      <PageHeader title="Meta Ads" subtitle="Upload CSV dari Ads Manager, breakdown per iklan, dan analisa Claude Opus" />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm hover:opacity-80">
          <Upload className="size-4" /> Pilih file CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {fileName && <Badge>{fileName} · {rows.length} baris</Badge>}
        {rows.length > 0 && (
          <Button variant="primary" onClick={() => analyze("all")} disabled={busy !== null}>
            {busy === "all" ? <Spinner /> : <Sparkles className="size-4" />} Analisa lengkap (Opus)
          </Button>
        )}
      </Card>
      {err && <p className="mb-3 text-sm text-red-500">{err}</p>}
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
                {headers.map((h) => (
                  <th key={h} className="cursor-pointer select-none p-2 font-medium" onClick={() => setSort((s) => (s?.key === h ? { key: h, dir: (s.dir * -1) as 1 | -1 } : { key: h, dir: -1 }))}>
                    {h}{sort?.key === h ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ r, i }) => (
                <Fragment key={i}>
                  <tr className="border-b border-line hover:bg-surface-2">
                    <td className="p-2">
                      <Button size="sm" variant="secondary" onClick={() => setOpen(open === i ? null : i)}>
                        {open === i ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} Breakdown
                      </Button>
                    </td>
                    {headers.map((h) => (
                      <td key={h} className={`max-w-[260px] truncate p-2 ${numeric.has(h) ? "text-right tabular-nums" : ""}`}>{r[h]}</td>
                    ))}
                  </tr>
                  {open === i && (
                    <tr className="border-b border-line bg-surface-2">
                      <td colSpan={headers.length + 1} className="p-4">
                        <div className="mb-3 font-medium">{r[nameKey]}</div>
                        <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
                          {headers.filter((h) => r[h] !== "" && r[h] != null).map((h) => (
                            <div key={h} className="flex justify-between gap-2 border-b border-line py-0.5">
                              <span className="text-muted">{h}</span><span>{r[h]}</span>
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
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
