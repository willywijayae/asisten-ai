import { useState, type ReactNode } from "react";
import { AlertTriangle, Bell, Check, Copy, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtDate, fmtWhen } from "../lib/time";
import { useToast } from "../components/app-context";
import { Badge, Button, Card, Empty, Field, PageHeader, SectionTitle, Spinner } from "../components/ui";

// ---- tipe (mengikuti src/intel.ts) ----
interface Product { id: number; name: string; keywords: string }
interface Overview {
  competitor_ads: number; competitor_active: number; tagged: number; untagged: number; winners: number;
  own_ads: number; voc: number; voc_pending: number; hooks: number; hooks_in_test: number; alerts_unseen: number;
}
interface Kpi {
  velocity_7d: number; hit_rate: number | null; hit_rate_sample: number; time_to_insight_hours: number | null;
  adoption: number | null; adoption_items: number; policy_rejected_meta: number; policy_flagged_30d: number;
  tokens_30d: number; insights_used: number; tokens_per_insight: number | null;
}
interface Taxonomy { angle: string[]; hook_type: string[]; format: string[]; offer: string[] }
interface BriefItem { due: string; owner: string }
interface Brief {
  id: number; week: string; product: string; sent: number; done: string[];
  data: {
    summary: string;
    test: (BriefItem & { angle: string; why: string; hooks: string[]; evidence: { competitor_ad_ids: string[]; voc: string[] } })[];
    kill: (BriefItem & { ad_id: string; name: string | null; reason: string })[];
    competitor_moves: (BriefItem & { brand: string; move: string; response: string })[];
    gaps: { angle: string; evidence: string; suggestion: string }[];
    data_note: string;
  };
}
interface Hook { id: number; text: string; angle: string | null; product: string | null; source: string; status: string; own_ad_id: string | null; result: string | null; created_at: string }
interface Voc { id: number; source: string; product: string | null; quote: string; category: string | null; angle: string | null; created_at: string }
interface OwnAd { ad_id: string; name: string | null; product: string | null; angle: string | null; status: string | null; spend: number | null; ctr: number | null; cpa: number | null; roas: number | null; frequency: number | null; verdict: string | null }
interface Alert { id: number; kind: string; title: string; detail: string | null; seen: number; created_at: string }
interface Policy { id: number; product: string | null; creative: string; decision: string; risk: string; reasons: string[]; suggestion: string | null; created_at: string }
interface WinAd { id: string; page_name: string; body: string; snapshot_url: string | null; link_url: string | null; active: number; days: number; angle: string | null; hook_type: string | null; format: string | null; offer: string | null; claim_risk: string | null; winner: number }

const TABS = [
  ["ringkasan", "Ringkasan"],
  ["brief", "Brief"],
  ["dashboard", "Dashboard"],
  ["hook", "Hook Bank"],
  ["voc", "Suara Pelanggan"],
  ["own", "Iklan Sendiri"],
  ["policy", "Policy Check"],
  ["alert", "Alert"],
] as const;
type Tab = (typeof TABS)[number][0];

const num = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toLocaleString("id-ID", { maximumFractionDigits: d }));
const q = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};
const tone = (s: string) => (s === "menang" || s === "lolos" || s === "rendah" ? "ok" : s === "kalah" || s === "tolak" || s === "tinggi" ? "danger" : s === "revisi" || s === "sedang" || s === "dipakai" ? "warn" : "neutral") as "ok" | "danger" | "warn" | "neutral";

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title="Salin"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg max-md:size-10"
      onClick={() => navigator.clipboard?.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1200)))}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

function Sel({ value, onChange, options, all }: { value: string; onChange: (v: string) => void; options: string[]; all: string }) {
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export function Intel() {
  const [tab, setTab] = useState<Tab>("ringkasan");
  const [product, setProduct] = useState("");
  const ov = useLoad(() => api<{ overview: Overview; products: Product[]; kpi: Kpi }>(`/intel/overview${q({ product })}`), [product]);
  const tx = useLoad(() => api<{ taxonomy: Taxonomy }>("/intel/taxonomy"), []);

  if (ov.loading && !ov.data) return <Spinner />;
  if (!ov.data || !tx.data) return <Empty title="Gagal memuat" hint={ov.error ?? tx.error ?? ""} />;
  const { overview, products, kpi } = ov.data;
  const taxonomy = tx.data.taxonomy;
  const ctx = { product, products, taxonomy, reload: ov.reload };

  return (
    <div>
      <PageHeader
        title="Intelijen Kreatif"
        subtitle="Iklan kompetitor + iklan sendiri + suara pelanggan → keputusan kreatif mingguan"
        action={
          <select className="input w-auto" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">Semua produk</option>
            {products.map((p) => (
              <option key={p.id}>{p.name}</option>
            ))}
          </select>
        }
      />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative h-9 shrink-0 rounded-md px-3.5 text-sm font-medium transition max-md:h-10 ${tab === id ? "border border-accent/30 text-accent" : "text-muted hover:text-fg"}`}
          >
            {label}
            {id === "alert" && overview.alerts_unseen > 0 && (
              <span className="ml-1.5 rounded-full bg-danger px-1.5 text-[10px] text-white">{overview.alerts_unseen}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "ringkasan" && <Summary overview={overview} kpi={kpi} {...ctx} />}
      {tab === "brief" && <Briefs {...ctx} />}
      {tab === "dashboard" && <Dashboard {...ctx} />}
      {tab === "hook" && <Hooks {...ctx} />}
      {tab === "voc" && <VocTab {...ctx} />}
      {tab === "own" && <OwnAds {...ctx} />}
      {tab === "policy" && <PolicyTab {...ctx} />}
      {tab === "alert" && <Alerts {...ctx} />}
    </div>
  );
}

interface Ctx { product: string; products: Product[]; taxonomy: Taxonomy; reload: () => void }

// ---------- Ringkasan: KPI, status pipeline, produk ----------
function Summary({ overview: o, kpi, products, reload }: { overview: Overview; kpi: Kpi } & Ctx) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [kw, setKw] = useState("");
  const run = async (key: string, path: string, label: (r: any) => string) => {
    setBusy(key);
    try {
      toast.ok(label(await api<any>(path, { method: "POST", body: {} })));
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy("");
    }
  };
  const kpis: [string, string, string][] = [
    ["Creative velocity", `${num(kpi.velocity_7d)} / 7 hari`, "Hook yang ditandai masuk tes"],
    ["Hit rate", kpi.hit_rate == null ? "—" : `${kpi.hit_rate}%`, kpi.hit_rate == null ? "Belum ada tes selesai" : `dari ${kpi.hit_rate_sample} tes selesai`],
    ["Time-to-insight", kpi.time_to_insight_hours == null ? "—" : `${num(kpi.time_to_insight_hours)} jam`, "Iklan kompetitor muncul → masuk brief"],
    ["Adopsi tim", kpi.adoption == null ? "—" : `${kpi.adoption}%`, kpi.adoption_items ? `${kpi.adoption_items} item brief 30 hari` : "Belum ada brief"],
    ["Ditolak Meta", num(kpi.policy_rejected_meta), `${kpi.policy_flagged_30d} kreatif ditandai policy check`],
    ["Token / insight", kpi.tokens_per_insight == null ? "—" : num(kpi.tokens_per_insight), `${num(kpi.tokens_30d)} token (estimasi) 30 hari`],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {kpis.map(([t, v, h]) => (
          <Card key={t} className="p-4">
            <p className="text-xs text-muted">{t}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
            <p className="mt-0.5 text-[11px] text-muted">{h}</p>
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted">KPI dihitung dari data di sistem ini. Baseline awal kosong; target & ambang dikalibrasi setelah 4 minggu data.</p>

      <Card className="p-4">
        <SectionTitle>Status pipeline</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {[
            ["Iklan kompetitor", `${num(o.competitor_ads)} (${num(o.competitor_active)} aktif)`],
            ["Sudah di-tag", `${num(o.tagged)} · belum ${num(o.untagged)}`],
            ["Kandidat pemenang", num(o.winners)],
            ["Iklan sendiri", num(o.own_ads)],
            ["Kutipan VOC", `${num(o.voc)} · antre ${num(o.voc_pending)}`],
            ["Hook bank", `${num(o.hooks)} · tes ${num(o.hooks_in_test)}`],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-muted">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "tag"} onClick={() => run("tag", "/intel/tag", (r) => `Tag: ${r.tagged} baru, ${r.copied} disalin, sisa ${r.pending}`)}>
            <Sparkles className="size-3.5" /> Tag iklan baru
          </Button>
          <Button size="sm" loading={busy === "sig"} onClick={() => run("sig", "/intel/signals", (r) => `${r.winners} pemenang, ${r.alerts} alert baru`)}>
            <RefreshCw className="size-3.5" /> Deteksi sinyal
          </Button>
          <Button size="sm" loading={busy === "voc"} onClick={() => run("voc", "/intel/voc/classify", (r) => `VOC: ${r.classified} diklasifikasi, sisa ${r.pending}`)}>
            Klasifikasi VOC
          </Button>
          <Button size="sm" loading={busy === "daily"} onClick={() => run("daily", "/intel/run-daily", () => "Siklus harian selesai")}>
            Jalankan siklus harian
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted">Otomatis: siklus harian 07:00 WIB (tag → sinyal → feedback loop → VOC); Senin 07:00 WIB brief tiap produk dikirim ke Telegram.</p>
      </Card>

      <Card className="p-4">
        <SectionTitle>Produk & kata kunci</SectionTitle>
        <p className="mb-3 text-xs text-muted">Kata kunci dipakai memetakan nama iklan sendiri dan kutipan VOC ke produk.</p>
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-muted">{p.keywords}</span>
              </div>
              <button
                title="Hapus"
                className="text-muted hover:text-danger"
                onClick={async () => {
                  if (!confirm(`Hapus produk ${p.name}?`)) return;
                  try { await api(`/intel/products/${p.id}`, { method: "DELETE" }); reload(); } catch (e) { toast.error(e); }
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try { await api("/intel/products", { body: { name, keywords: kw } }); setName(""); setKw(""); reload(); } catch (err) { toast.error(err); }
          }}
        >
          <input className="input w-40" placeholder="Nama produk" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input min-w-[12rem] flex-1" placeholder="kata kunci, pisah koma" value={kw} onChange={(e) => setKw(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}><Plus className="size-4" /> Tambah</Button>
        </form>
      </Card>

      <Card className="p-4 text-xs text-muted">
        <p className="mb-1 font-medium text-fg">Cara mengisi data</p>
        <p>Iklan kompetitor: dari modul Riset Kompetitor (scrape Hermes). Iklan sendiri: tab "Iklan Sendiri" atau <code>POST /api/intel/ingest/own-ads</code>. Suara pelanggan: tab VOC atau <code>POST /api/intel/ingest/voc</code>. Dua endpoint ingest memakai header <code>x-ingest-key</code> yang sama dengan impor kompetitor.</p>
      </Card>
    </div>
  );
}

// ---------- Brief mingguan ----------
function Briefs({ product, products, reload }: Ctx) {
  const toast = useToast();
  const { data, loading, reload: rl } = useLoad(() => api<{ briefs: Brief[] }>(`/intel/briefs${q({ product })}`), [product]);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(product || products[0]?.name || "");
  const make = async () => {
    setBusy(true);
    try { await api("/intel/briefs", { body: { product: target } }); toast.ok("Brief dibuat"); rl(); reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const mark = async (b: Brief, key: string, done: boolean) => {
    try { await api(`/intel/briefs/${b.id}/item`, { body: { key, done } }); rl(); } catch (e) { toast.error(e); }
  };
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <select className="input w-auto" value={target} onChange={(e) => setTarget(e.target.value)}>
          {products.map((p) => <option key={p.id}>{p.name}</option>)}
        </select>
        <Button variant="primary" loading={busy} disabled={!target} onClick={make}><Sparkles className="size-4" /> Buat brief sekarang</Button>
        <span className="text-xs text-muted">Memakai model kuat; dibuat dari ringkasan data, bukan data mentah.</span>
      </Card>
      {loading && !data ? <Spinner /> : !data?.briefs.length ? <Empty title="Belum ada brief" hint="Brief otomatis dibuat Senin pagi, atau buat manual di atas setelah ada iklan bertag / VOC / iklan sendiri." /> : data.briefs.map((b) => {
        const d = b.data;
        const Row = ({ k, children, who }: { k: string; children: ReactNode; who: BriefItem }) => (
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" className="mt-1 size-4" checked={b.done.includes(k)} onChange={(e) => mark(b, k, e.target.checked)} />
            <div className={`min-w-0 flex-1 text-sm ${b.done.includes(k) ? "opacity-60" : ""}`}>
              {children}
              <p className="mt-1 text-[11px] text-muted">👤 {who.owner} · ⏰ {fmtDate(who.due)}</p>
            </div>
          </label>
        );
        return (
          <Card key={b.id} className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">{b.product} · {fmtDate(b.week)}</h3>
                <p className="text-xs text-muted">{d.summary}</p>
              </div>
              <div className="flex items-center gap-2">
                {b.sent ? <Badge tone="ok">Terkirim</Badge> : null}
                <Button size="sm" onClick={async () => { try { await api(`/intel/briefs/${b.id}/send`, { body: {} }); toast.ok("Dikirim ke Telegram"); rl(); } catch (e) { toast.error(e); } }}>
                  <Send className="size-3.5" /> Kirim
                </Button>
              </div>
            </div>
            {d.test.length > 0 && <SectionTitle>🧪 Test minggu ini</SectionTitle>}
            <div className="space-y-2">
              {d.test.map((t, i) => (
                <Row key={i} k={`test:${i}`} who={t}>
                  <p className="font-medium">{t.angle}</p>
                  <p className="text-xs text-muted">{t.why}</p>
                  <ul className="mt-2 space-y-1">
                    {t.hooks.map((h, j) => (
                      <li key={j} className="flex items-start justify-between gap-2 rounded bg-surface-2 px-2 py-1 text-[13px]"><span>{h}</span><CopyBtn text={h} /></li>
                    ))}
                  </ul>
                  {(t.evidence.competitor_ad_ids.length > 0 || t.evidence.voc.length > 0) && (
                    <p className="mt-2 text-[11px] text-muted">
                      Bukti: {t.evidence.competitor_ad_ids.length ? `iklan kompetitor ${t.evidence.competitor_ad_ids.join(", ")}` : ""}
                      {t.evidence.voc.map((v, j) => <span key={j} className="block italic">“{v}”</span>)}
                    </p>
                  )}
                </Row>
              ))}
            </div>
            {d.kill.length > 0 && <div className="mt-4"><SectionTitle>🛑 Kill</SectionTitle><div className="space-y-2">{d.kill.map((k, i) => <Row key={i} k={`kill:${i}`} who={k}><p className="font-medium">{k.name ?? k.ad_id}</p><p className="text-xs text-muted">{k.reason}</p></Row>)}</div></div>}
            {d.competitor_moves.length > 0 && <div className="mt-4"><SectionTitle>🕵️ Gerakan kompetitor</SectionTitle><div className="space-y-2">{d.competitor_moves.map((m, i) => <Row key={i} k={`move:${i}`} who={m}><p className="font-medium">{m.brand}: {m.move}</p><p className="text-xs text-muted">→ {m.response}</p></Row>)}</div></div>}
            {d.gaps.length > 0 && <div className="mt-4"><SectionTitle>🔎 Celah</SectionTitle><ul className="space-y-1 text-sm">{d.gaps.map((g, i) => <li key={i}><b>{g.angle}</b> — {g.suggestion} <span className="text-xs text-muted">({g.evidence})</span></li>)}</ul></div>}
            {d.data_note && <p className="mt-3 flex items-start gap-1.5 text-xs text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{d.data_note}</p>}
          </Card>
        );
      })}
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ product, taxonomy }: Ctx) {
  const [fmt, setFmt] = useState("");
  const map = useLoad(() => api<{ angles: string[]; pages: { id: string; name: string }[]; cells: { page_id: string; angle: string; n: number }[] }>(`/intel/map${q({ product })}`), [product]);
  const win = useLoad(() => api<{ ads: WinAd[] }>(`/intel/winners${q({ product, format: fmt })}`), [product, fmt]);
  const tl = useLoad(() => api<{ weeks: string[]; rows: { page_id: string; page_name: string; started: Record<string, number>; stopped: Record<string, number> }[] }>(`/intel/timeline${q({ product })}`), [product]);
  const perf = useLoad(() => api<{ angles: { angle: string; ads: number; spend: number; cpa: number | null; roas: number | null; ctr: number | null }[]; status: { product: string; angle: string; status: string; evidence: string | null }[] }>(`/intel/perf${q({ product })}`), [product]);
  const max = Math.max(1, ...(map.data?.cells.map((c) => c.n) ?? [1]));
  const cell = (p: string, a: string) => map.data?.cells.find((c) => c.page_id === p && c.angle === a)?.n ?? 0;
  const cols = map.data?.angles.filter((a) => map.data!.cells.some((c) => c.angle === a)) ?? [];
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionTitle>Peta angle · brand × angle (ukuran titik = iklan aktif)</SectionTitle>
        {map.loading && !map.data ? <Spinner /> : !map.data?.pages.length ? <Empty title="Belum ada iklan bertag" hint="Scrape iklan di Riset Kompetitor lalu klik “Tag iklan baru” di Ringkasan." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr><th className="p-2 text-left font-medium text-muted">Brand</th>{cols.map((a) => <th key={a} className="p-2 text-center font-medium text-muted">{a}</th>)}</tr></thead>
              <tbody>
                {map.data.pages.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="p-2 font-medium">{p.name}</td>
                    {cols.map((a) => {
                      const n = cell(p.id, a);
                      const s = n ? 10 + Math.round((22 * n) / max) : 0;
                      return <td key={a} className="p-2 text-center">{n ? <span title={`${n} iklan aktif`} className="inline-flex items-center justify-center rounded-full bg-slate-700 text-[10px] text-white" style={{ width: s, height: s }}>{n}</span> : <span className="text-muted">·</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div>
        <SectionTitle action={<Sel value={fmt} onChange={setFmt} options={taxonomy.format} all="Semua format" />}>Winner board</SectionTitle>
        {win.loading && !win.data ? <Spinner /> : !win.data?.ads.length ? <Empty title="Belum ada iklan" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {win.data.ads.map((a) => (
              <Card key={a.id} className="p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{a.page_name}</span>
                  {a.winner ? <Badge tone="ok">PEMENANG</Badge> : null}
                  <Badge>{a.days} hari{a.active ? "" : " · berhenti"}</Badge>
                  {a.claim_risk === "tinggi" && <Badge tone="danger">klaim berisiko</Badge>}
                </div>
                <p className="mb-2 text-xs text-muted">{a.body}</p>
                <div className="flex flex-wrap gap-1">
                  {[a.angle, a.hook_type, a.format, a.offer].filter(Boolean).map((t) => <Badge key={t!} tone="accent">{t}</Badge>)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="p-4">
        <SectionTitle>Timeline kompetitor · iklan baru (+) / berhenti (−) per minggu</SectionTitle>
        {tl.loading && !tl.data ? <Spinner /> : !tl.data?.rows.length ? <Empty title="Belum ada data" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr><th className="p-2 text-left font-medium text-muted">Brand</th>{tl.data.weeks.map((w) => <th key={w} className="p-2 text-center font-medium text-muted">{fmtDate(w)}</th>)}</tr></thead>
              <tbody>
                {tl.data.rows.map((r) => (
                  <tr key={r.page_id} className="border-t border-line">
                    <td className="p-2 font-medium">{r.page_name}</td>
                    {tl.data!.weeks.map((w) => (
                      <td key={w} className="p-2 text-center">
                        {r.started[w] ? <span className="text-ok">+{r.started[w]}</span> : null}{" "}
                        {r.stopped[w] ? <span className="text-danger">−{r.stopped[w]}</span> : null}
                        {!r.started[w] && !r.stopped[w] ? <span className="text-muted">·</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle>Performa sendiri per angle (median CPA/ROAS)</SectionTitle>
        {!perf.data?.angles.length ? <Empty title="Belum ada iklan sendiri berangle" hint="Isi di tab Iklan Sendiri (kolom angle)." /> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="p-2 font-medium">Angle</th><th className="p-2 font-medium">Iklan</th><th className="p-2 font-medium">Spend</th><th className="p-2 font-medium">CPA</th><th className="p-2 font-medium">ROAS</th><th className="p-2 font-medium">CTR</th><th className="p-2 font-medium">Status</th></tr></thead>
            <tbody>
              {perf.data.angles.map((r) => {
                const st = perf.data!.status.find((s) => s.angle === r.angle);
                return (
                  <tr key={r.angle} className="border-t border-line">
                    <td className="p-2 font-medium">{r.angle}</td><td className="p-2">{r.ads}</td><td className="p-2">{num(r.spend)}</td><td className="p-2">{num(r.cpa)}</td><td className="p-2">{num(r.roas, 2)}</td><td className="p-2">{r.ctr == null ? "—" : `${num(r.ctr, 2)}%`}</td>
                    <td className="p-2">{st ? <Badge tone={st.status === "teruji" ? "ok" : "danger"}>{st.status}</Badge> : <Badge>belum</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ---------- Hook bank ----------
function Hooks({ product, products, taxonomy }: Ctx) {
  const toast = useToast();
  const [angle, setAngle] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState({ product: product || products[0]?.name || "", angle: taxonomy.angle[0] });
  const [text, setText] = useState("");
  const { data, loading, reload } = useLoad(() => api<{ hooks: Hook[] }>(`/intel/hooks${q({ product, angle, source, status })}`), [product, angle, source, status]);
  const patch = async (id: number, body: object) => {
    try { await api(`/intel/hooks/${id}`, { method: "PATCH", body }); reload(); } catch (e) { toast.error(e); }
  };
  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={gen.product} onChange={(e) => setGen({ ...gen, product: e.target.value })}>{products.map((p) => <option key={p.id}>{p.name}</option>)}</select>
          <select className="input w-auto" value={gen.angle} onChange={(e) => setGen({ ...gen, angle: e.target.value })}>{taxonomy.angle.map((a) => <option key={a}>{a}</option>)}</select>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { const r = await api<{ added: number; total: number }>("/intel/hooks/generate", { body: { ...gen, n: 20 } }); toast.ok(`${r.added} hook baru dari ${r.total}`); reload(); } catch (e) { toast.error(e); } finally { setBusy(false); } }}>
            <Sparkles className="size-4" /> Generate 20 hook
          </Button>
        </div>
        <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api("/intel/hooks", { body: { text, product: product || gen.product, angle: gen.angle } }); setText(""); reload(); } catch (err) { toast.error(err); } }}>
          <input className="input flex-1" placeholder="Tambah hook manual…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" disabled={text.trim().length < 5}><Plus className="size-4" /></Button>
        </form>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Sel value={angle} onChange={setAngle} options={taxonomy.angle} all="Semua angle" />
        <Sel value={source} onChange={setSource} options={["kompetitor", "voc", "ai", "manual"]} all="Semua sumber" />
        <Sel value={status} onChange={setStatus} options={["baru", "dipakai", "menang", "kalah"]} all="Semua status" />
      </div>
      {loading && !data ? <Spinner /> : !data?.hooks.length ? <Empty title="Hook bank kosong" /> : (
        <div className="space-y-2">
          {data.hooks.map((h) => {
            const res = h.result ? JSON.parse(h.result) : null;
            return (
              <Card key={h.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">{h.text}</p>
                  <div className="flex shrink-0 items-center"><CopyBtn text={h.text} /><button title="Hapus" className="inline-flex size-8 items-center justify-center text-muted hover:text-danger max-md:size-10" onClick={async () => { try { await api(`/intel/hooks/${h.id}`, { method: "DELETE" }); reload(); } catch (e) { toast.error(e); } }}><Trash2 className="size-4" /></button></div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={tone(h.status)}>{h.status}</Badge>
                  {h.angle && <Badge tone="accent">{h.angle}</Badge>}
                  {h.product && <Badge>{h.product}</Badge>}
                  <Badge>{h.source}</Badge>
                  <select className="input ml-auto h-8 w-auto py-0 text-xs" value={h.status} onChange={(e) => patch(h.id, { status: e.target.value })}>
                    {["baru", "dipakai", "menang", "kalah"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <input className="input h-8 w-36 py-0 text-xs" placeholder="ID iklan sendiri" defaultValue={h.own_ad_id ?? ""} onBlur={(e) => e.target.value !== (h.own_ad_id ?? "") && patch(h.id, { own_ad_id: e.target.value })} />
                </div>
                {res && <p className="mt-1.5 text-[11px] text-muted">Hasil: CPA {num(res.cpa)} vs kontrol {num(res.control_cpa)} · ROAS {num(res.roas, 2)} · spend {num(res.spend)}</p>}
                {h.status === "dipakai" && !h.own_ad_id && <p className="mt-1.5 text-[11px] text-warn">Isi ID iklan sendiri agar hasil tes terisi otomatis (setelah 3–7 hari).</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Suara pelanggan ----------
function VocTab({ product, products, taxonomy }: Ctx) {
  const toast = useToast();
  const [cat, setCat] = useState("");
  const [angle, setAngle] = useState("");
  const [paste, setPaste] = useState("");
  const [src, setSrc] = useState("chat");
  const [prod, setProd] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, loading, reload } = useLoad(() => api<{ items: Voc[] }>(`/intel/voc${q({ product, category: cat, angle })}`), [product, cat, angle]);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Tempel kutipan (satu per baris)" hint="Nomor telepon, email, tautan, dan @akun otomatis disamarkan sebelum disimpan; nama orang disamarkan saat klasifikasi AI. Jangan tempel data yang tak perlu.">
          <textarea className="input min-h-28 w-full" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Takut efek sampingnya…\nPas dicoba ternyata badan lebih bertenaga"} />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={src} onChange={(e) => setSrc(e.target.value)}>{["chat", "crm", "review"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input w-auto" value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Produk: deteksi otomatis</option>{products.map((p) => <option key={p.id}>{p.name}</option>)}</select>
          <Button variant="primary" loading={busy} disabled={!paste.trim()} onClick={async () => {
            setBusy(true);
            try {
              const items = paste.split("\n").map((l) => l.trim()).filter(Boolean).map((quote) => ({ quote, source: src, product: prod || undefined }));
              const r = await api<{ added: number; skipped: number }>("/intel/voc", { body: { items } });
              toast.ok(`${r.added} ditambah, ${r.skipped} dilewati (duplikat/terlalu pendek)`);
              setPaste(""); reload();
            } catch (e) { toast.error(e); } finally { setBusy(false); }
          }}>Simpan & klasifikasi</Button>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Sel value={cat} onChange={setCat} options={["keberatan", "alasan_beli", "bahasa_pelanggan"]} all="Semua kategori" />
        <Sel value={angle} onChange={setAngle} options={taxonomy.angle} all="Semua angle" />
      </div>
      {loading && !data ? <Spinner /> : !data?.items.length ? <Empty title="Belum ada kutipan" /> : (
        <div className="space-y-2">
          {data.items.map((v) => (
            <Card key={v.id} className="p-3">
              <p className="text-sm italic">“{v.quote}”</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge>{v.source}</Badge>
                {v.product && <Badge>{v.product}</Badge>}
                {v.category ? <Badge tone={v.category === "keberatan" ? "warn" : "ok"}>{v.category.replace("_", " ")}</Badge> : <Badge>belum diklasifikasi</Badge>}
                {v.angle && <Badge tone="accent">{v.angle}</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Iklan sendiri ----------
function OwnAds({ product, taxonomy }: Ctx) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, loading, reload } = useLoad(() => api<{ ads: OwnAd[] }>(`/intel/own-ads${q({ product })}`), [product]);
  const COLS = ["ad_id", "name", "angle", "status", "spend", "impressions", "ctr", "cpa", "roas", "frequency"];
  const parse = () => {
    const lines = csv.trim().split("\n").filter(Boolean);
    if (lines.length < 2) throw new Error("Butuh baris header + minimal 1 baris data");
    const sep = lines[0].includes("\t") ? "\t" : ",";
    const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    if (!head.includes("ad_id")) throw new Error("Header harus memuat kolom ad_id");
    return lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim()])));
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Impor performa (CSV/TSV dari Meta Ads Manager / Motion)" hint={`Header: ${COLS.join(", ")} (opsional: prev_ctr, prev_frequency, product, hook_id). ctr dalam persen. Angle harus salah satu: ${taxonomy.angle.join(", ")}. Sinkron otomatis via POST /api/intel/ingest/own-ads.`}>
          <textarea className="input min-h-28 w-full font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`${COLS.join(",")}\n1200345,Erojan UGC 1,energi kerja,active,900000,52000,1.4,45000,2.1,2.3`} />
        </Field>
        <Button className="mt-2" variant="primary" loading={busy} disabled={!csv.trim()} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ added: number; updated: number; skipped: number }>("/intel/own-ads", { body: { ads: parse() } }); toast.ok(`${r.added} baru, ${r.updated} diperbarui, ${r.skipped} dilewati`); setCsv(""); reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
        }}>Impor</Button>
      </Card>
      {loading && !data ? <Spinner /> : !data?.ads.length ? <Empty title="Belum ada iklan sendiri" /> : (
        <Card className="overflow-x-auto p-2">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted">{["Iklan", "Produk", "Angle", "Status", "Spend", "CTR", "CPA", "ROAS", "Freq", "Hasil"].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {data.ads.map((a) => (
                <tr key={a.ad_id} className="border-t border-line">
                  <td className="p-2 font-medium">{a.name ?? a.ad_id}</td><td className="p-2">{a.product ?? "—"}</td><td className="p-2">{a.angle ?? "—"}</td><td className="p-2">{a.status ?? "—"}</td>
                  <td className="p-2">{num(a.spend)}</td><td className="p-2">{a.ctr == null ? "—" : `${num(a.ctr, 2)}%`}</td><td className="p-2">{num(a.cpa)}</td><td className="p-2">{num(a.roas, 2)}</td><td className="p-2">{num(a.frequency, 2)}</td>
                  <td className="p-2">{a.verdict ? <Badge tone={tone(a.verdict)}>{a.verdict}</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------- Policy check ----------
function PolicyTab({ product, products }: Ctx) {
  const toast = useToast();
  const [creative, setCreative] = useState("");
  const [prod, setProd] = useState(product);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useLoad(() => api<{ checks: Policy[] }>("/intel/policy"), []);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Copy / script kreatif" hint="Wajib dicek sebelum upload. Pola kata berisiko dicek otomatis, lalu AI menilai konteksnya. Ini alat bantu, bukan jaminan lolos review Meta.">
          <textarea className="input min-h-32 w-full" value={creative} onChange={(e) => setCreative(e.target.value)} placeholder="Tempel headline + primary text + script video…" />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="input w-auto" value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Produk (opsional)</option>{products.map((p) => <option key={p.id}>{p.name}</option>)}</select>
          <Button variant="primary" loading={busy} disabled={creative.trim().length < 10} onClick={async () => {
            setBusy(true);
            try { const r = await api<Policy>("/intel/policy", { body: { creative, product: prod || undefined } }); toast.ok(`Hasil: ${r.decision} (risiko ${r.risk})`); reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
          }}><ShieldCheck className="size-4" /> Periksa</Button>
        </div>
      </Card>
      {data?.checks.map((c) => (
        <Card key={c.id} className="p-3">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={tone(c.decision)}>{c.decision.toUpperCase()}</Badge><Badge tone={tone(c.risk)}>risiko {c.risk}</Badge>{c.product && <Badge>{c.product}</Badge>}
            <span className="ml-auto text-[11px] text-muted">{fmtWhen(c.created_at)}</span>
          </div>
          <p className="mb-2 line-clamp-2 text-xs text-muted">{c.creative}</p>
          {c.reasons.length > 0 && <ul className="mb-2 list-disc pl-5 text-sm">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {c.suggestion && <div className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 p-2 text-sm"><span><b className="text-xs text-muted">Saran revisi: </b>{c.suggestion}</span><CopyBtn text={c.suggestion} /></div>}
        </Card>
      ))}
    </div>
  );
}

// ---------- Alert ----------
function Alerts({ reload }: Ctx) {
  const toast = useToast();
  const { data, loading, reload: rl } = useLoad(() => api<{ alerts: Alert[] }>("/intel/alerts"), []);
  const ICON: Record<string, string> = { winner: "🏆", scale: "📈", burst: "💥", offer: "🏷️", fatigue: "😴", policy: "🚫" };
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={async () => { try { await api("/intel/alerts/seen", { body: {} }); rl(); reload(); } catch (e) { toast.error(e); } }}><Bell className="size-3.5" /> Tandai semua terbaca</Button>
      </div>
      {loading && !data ? <Spinner /> : !data?.alerts.length ? <Empty title="Belum ada alert" hint="Alert muncul dari: pemenang baru, angle di-scale, ≥5 iklan baru/48 jam, offer baru, fatigue, iklan ditolak." /> : data.alerts.map((a) => (
        <Card key={a.id} className={`p-3 ${a.seen ? "opacity-70" : ""}`}>
          <p className="text-sm font-medium">{ICON[a.kind] ?? "•"} {a.title}</p>
          {a.detail && <p className="text-xs text-muted">{a.detail}</p>}
          <p className="mt-1 text-[11px] text-muted">{fmtWhen(a.created_at)}</p>
        </Card>
      ))}
    </div>
  );
}
