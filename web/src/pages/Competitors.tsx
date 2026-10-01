import { useEffect, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, Gauge, Megaphone, Plus, Search, Sparkles, Tag, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtWhen } from "../lib/time";
import { Badge, Button, Card, Empty, Modal, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useToast } from "../components/app-context";

const ANGLES: Record<string, string> = {
  masalah_solusi: "Masalah → solusi",
  testimoni: "Testimoni",
  edukasi: "Edukasi",
  promo: "Promo / harga",
  gaya_hidup: "Gaya hidup",
  otoritas: "Ahli / otoritas",
  lainnya: "Lainnya",
};
const HOOK = ["Lemah", "Biasa", "Kuat", "Sangat kuat"];

interface Ad {
  id: string;
  page_id: string | null;
  page_name: string | null;
  title: string | null;
  body: string | null;
  caption: string | null;
  snapshot_url: string | null;
  platforms: string | null;
  query: string | null;
  started_at: string | null;
  active: number;
  first_seen: string;
  last_seen: string;
  angle: string | null;
  hook: number | null;
  promo: number | null;
  risky: number | null;
  scored_by: string | null;
  days: number;
}

interface Summary {
  totals: { ads: number; active: number; pages: number; newWeek: number; unscored: number };
  pages: { page_id: string; page_name: string; ads: number; active: number; longest: number; last_seen: string; hook: number | null }[];
  angles: { angle: string; n: number }[];
  scans: { id: number; source: string; query: string | null; country: string; found: number; new_count: number; created_at: string }[];
  watch: { id: number; kind: "keyword" | "page"; value: string; label: string | null; country: string }[];
  jev: { configured: boolean; state: "ok" | "habis" | "invalid" | "off"; at?: string; message?: string };
}

const SCAN_PROMPT = "Scan iklan kompetitor dari daftar pantauan Second Brain di Meta Ad Library, simpan semua hasilnya, lalu ringkas temuannya.";

export function Competitors() {
  const toast = useToast();
  const { data: sum, error, reload: reloadSum } = useLoad(() => api<Summary>("/competitors"), []);
  const [filters, setFilters] = useState({ q: "", page: "", angle: "", active: false, sort: "lama" });
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: q.trim() })), 350);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({
    ...(filters.q && { q: filters.q }),
    ...(filters.page && { page: filters.page }),
    ...(filters.angle && { angle: filters.angle }),
    ...(filters.active && { active: "1" }),
    sort: filters.sort,
  }).toString();
  const { data: list, loading, reload: reloadAds } = useLoad(() => api<{ ads: Ad[] }>(`/competitors/ads?${qs}`), [qs]);
  const [scoring, setScoring] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ text: string; noteId: number } | null>(null);

  const reload = () => {
    reloadSum();
    reloadAds();
  };

  const score = async () => {
    setScoring(true);
    try {
      const r = await api<{ scored: number; jev: number; ai: number; remaining: number }>("/competitors/score", { body: {} });
      toast.ok(`Dinilai ${r.scored} iklan (Jev ${r.jev}, tim AI ${r.ai})${r.remaining ? `, sisa ${r.remaining}` : ""}`);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setScoring(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      setAnalysis(await api<{ text: string; noteId: number }>("/competitors/analyze", { body: { page: filters.page || undefined } }));
    } catch (e) {
      toast.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  if (error) return <Empty title="Gagal memuat riset kompetitor" hint={error} />;
  if (!sum) return <Spinner />;

  const jevLabel = !sum.jev.configured
    ? { tone: "neutral" as const, text: "Penilai: tim AI (Jev belum diatur)" }
    : sum.jev.state === "ok"
      ? { tone: "ok" as const, text: "Penilai: Jev AI" }
      : { tone: "warn" as const, text: `${sum.jev.message ?? "Jev tidak tersedia"} → tim AI` };

  return (
    <>
      <PageHeader
        title="Riset Kompetitor"
        subtitle="Iklan kompetitor dari Meta Ad Library, dinilai otomatis. Iklan yang tayang paling lama biasanya iklan pemenang."
        action={
          <div className="flex gap-2">
            {sum.totals.unscored > 0 && (
              <Button loading={scoring} onClick={score}>
                {!scoring && <Gauge className="size-4" />} Nilai {sum.totals.unscored} iklan
              </Button>
            )}
            <Button variant="primary" loading={analyzing} disabled={!sum.totals.ads} onClick={analyze}>
              {!analyzing && <Sparkles className="size-4" />} Analisis tim marketing
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Iklan tersimpan", sum.totals.ads],
          ["Masih tayang", sum.totals.active],
          ["Halaman kompetitor", sum.totals.pages],
          ["Baru 7 hari", sum.totals.newWeek],
        ].map(([label, n]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{n}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
          <SectionTitle action={<Badge tone={jevLabel.tone}>{jevLabel.text}</Badge>}>Iklan</SectionTitle>
          <Card className="mb-3 flex flex-wrap gap-2 p-3">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari teks iklan / halaman…" />
            </div>
            <select className="input w-auto" value={filters.page} onChange={(e) => setFilters((f) => ({ ...f, page: e.target.value }))}>
              <option value="">Semua kompetitor</option>
              {sum.pages.map((p) => (
                <option key={p.page_id} value={p.page_id}>
                  {p.page_name} ({p.ads})
                </option>
              ))}
            </select>
            <select className="input w-auto" value={filters.angle} onChange={(e) => setFilters((f) => ({ ...f, angle: e.target.value }))}>
              <option value="">Semua angle</option>
              {Object.entries(ANGLES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select className="input w-auto" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
              <option value="lama">Paling lama tayang</option>
              <option value="baru">Terbaru ditemukan</option>
              <option value="hook">Hook terkuat</option>
            </select>
            <label className="flex items-center gap-2 px-1 text-sm text-muted">
              <input
                type="checkbox"
                checked={filters.active}
                onChange={(e) => setFilters((f) => ({ ...f, active: e.target.checked }))}
                className="accent-[var(--accent)]"
              />
              Masih tayang
            </label>
          </Card>

          {!list ? (
            <Spinner />
          ) : list.ads.length ? (
            <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
              {list.ads.map((a) => (
                <AdCard key={a.id} ad={a} />
              ))}
            </div>
          ) : (
            <Card>
              <Empty
                icon={<Megaphone className="size-6" />}
                title={sum.totals.ads ? "Tidak ada iklan yang cocok" : "Belum ada iklan kompetitor"}
                hint={sum.totals.ads ? undefined : "Isi daftar pantauan di samping, lalu minta Claude memindai (lihat \"Cara scan\")."}
              />
            </Card>
          )}
        </section>

        <aside className="space-y-6">
          <WatchList items={sum.watch} onChanged={reload} />

          <section>
            <SectionTitle>Cara scan</SectionTitle>
            <Card className="space-y-2 p-4 text-sm">
              <p className="text-muted">
                Pemindaian lewat konektor Meta di Claude (server ini tidak bisa membuka Ad Library untuk iklan Indonesia). Di Claude (claude.ai,
                app, atau Claude Code) yang terhubung ke Meta Ads & Second Brain, kirim:
              </p>
              <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-[13px]">
                <span className="flex-1">{SCAN_PROMPT}</span>
                <button
                  className="text-muted hover:text-fg"
                  aria-label="Salin perintah"
                  onClick={() => navigator.clipboard.writeText(SCAN_PROMPT).then(() => toast.ok("Perintah disalin"))}
                >
                  <Copy className="size-4" />
                </button>
              </div>
              {sum.scans[0] && (
                <p className="text-xs text-muted">
                  Scan terakhir {fmtWhen(sum.scans[0].created_at)} · {sum.scans[0].found} iklan, {sum.scans[0].new_count} baru
                </p>
              )}
            </Card>
          </section>

          {sum.pages.length > 0 && (
            <section>
              <SectionTitle>Kompetitor</SectionTitle>
              <Card className="divide-y divide-line">
                {sum.pages.slice(0, 12).map((p) => (
                  <button
                    key={p.page_id}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page === p.page_id ? "" : p.page_id }))}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-2 ${
                      filters.page === p.page_id ? "bg-accent-soft" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.page_name}</span>
                      <span className="text-[11px] text-muted">
                        {p.active}/{p.ads} tayang · terlama {p.longest} hari
                      </span>
                    </span>
                    {p.hook != null && <Badge>hook {p.hook}</Badge>}
                  </button>
                ))}
              </Card>
            </section>
          )}

          {sum.angles.length > 0 && (
            <section>
              <SectionTitle>Angle yang dipakai</SectionTitle>
              <Card className="space-y-2 p-4">
                {sum.angles.map((a) => {
                  const max = sum.angles[0].n;
                  return (
                    <div key={a.angle} className="text-xs">
                      <div className="mb-1 flex justify-between">
                        <span>{ANGLES[a.angle] ?? a.angle}</span>
                        <span className="text-muted tabular-nums">{a.n}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(a.n / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          )}
        </aside>
      </div>

      {analysis && (
        <Modal
          title="Analisis tim marketing"
          onClose={() => setAnalysis(null)}
          footer={<span className="mr-auto text-xs text-muted">Tersimpan sebagai catatan #{analysis.noteId}</span>}
        >
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{analysis.text}</div>
        </Modal>
      )}
    </>
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const text = [ad.title, ad.body].filter(Boolean);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{ad.page_name ?? "Halaman tidak diketahui"}</span>
        <span className={`size-2 rounded-full ${ad.active ? "bg-ok" : "bg-muted/40"}`} title={ad.active ? "Masih tayang" : "Sudah berhenti"} />
        <Badge tone={ad.days >= 30 ? "ok" : ad.days >= 7 ? "accent" : "neutral"}>{ad.days} hari tayang</Badge>
        {ad.angle && <Badge tone="accent">{ANGLES[ad.angle] ?? ad.angle}</Badge>}
        {ad.hook != null && <Badge tone={ad.hook >= 2 ? "ok" : "neutral"}>Hook {HOOK[ad.hook]}</Badge>}
        {!!ad.promo && (
          <Badge tone="warn">
            <Tag className="size-3" /> Promo
          </Badge>
        )}
        {!!ad.risky && (
          <Badge tone="danger">
            <AlertTriangle className="size-3" /> Klaim berisiko
          </Badge>
        )}
      </div>
      {text.length ? (
        <div className="mt-2 space-y-1 text-sm">
          {ad.title && <p className="font-medium">{ad.title}</p>}
          {ad.body && <p className="line-clamp-4 whitespace-pre-line text-muted">{ad.body}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Teks iklan tidak tersedia (biasanya iklan video/gambar saja) — buka di Ad Library.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {ad.started_at && <span>Mulai {fmtWhen(ad.started_at)}</span>}
        {ad.platforms && <span>{ad.platforms}</span>}
        {ad.query && <span>dari "{ad.query}"</span>}
        {ad.scored_by && ad.scored_by !== "kosong" && <span>dinilai {ad.scored_by === "jev" ? "Jev AI" : "tim AI"}</span>}
        {ad.snapshot_url && (
          <a href={ad.snapshot_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
            Lihat di Ad Library <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </Card>
  );
}

function WatchList({ items, onChanged }: { items: Summary["watch"]; onChanged: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<"keyword" | "page">("keyword");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api("/competitors/watch", { body: { kind, value, label: kind === "page" ? label : undefined, country: "ID" } });
      setValue("");
      setLabel("");
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/competitors/watch/${id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <section>
      <SectionTitle>Daftar pantauan</SectionTitle>
      <Card className="overflow-hidden">
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((w) => (
              <li key={w.id} className="group flex items-center gap-2 px-4 py-2.5 text-sm">
                <Badge tone={w.kind === "page" ? "accent" : "neutral"}>{w.kind === "page" ? "Halaman" : "Kata kunci"}</Badge>
                <span className="min-w-0 flex-1 truncate">{w.kind === "page" ? (w.label ?? w.value) : w.value}</span>
                <span className="text-[11px] text-muted">{w.country}</span>
                <button
                  onClick={() => remove(w.id)}
                  className="text-muted opacity-60 transition hover:text-danger group-hover:opacity-100"
                  aria-label="Hapus dari pantauan"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-muted">Belum ada. Tambahkan kata kunci produk (mis. "suplemen herbal") atau page id halaman kompetitor.</p>
        )}
        <form
          className="space-y-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex gap-2">
            <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as "keyword" | "page")}>
              <option value="keyword">Kata kunci</option>
              <option value="page">Halaman</option>
            </select>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "page" ? "Page id, mis. 491041664102579" : "mis. suplemen herbal"}
              inputMode={kind === "page" ? "numeric" : undefined}
            />
          </div>
          {kind === "page" && <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nama halaman (opsional)" />}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!value.trim()}>
            <Plus className="size-4" /> Pantau
          </Button>
        </form>
      </Card>
    </section>
  );
}
