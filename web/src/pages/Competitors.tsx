import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Clapperboard,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  PenLine,
  Play,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtDate, fmtWhen } from "../lib/time";
import { Badge, Button, Card, Empty, Modal, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useRouter, useToast } from "../components/app-context";

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

interface MediaItem {
  type: "video" | "image";
  url: string | null;
  poster: string | null;
}

interface Ad {
  id: string;
  page_id: string | null;
  page_name: string | null;
  page_avatar: string | null;
  title: string | null;
  body: string | null;
  snapshot_url: string | null;
  query: string | null;
  started_at: string | null;
  active: number;
  first_seen: string;
  angle: string | null;
  hook: number | null;
  promo: number | null;
  risky: number | null;
  scored_by: string | null;
  media: string | null;
  media_type: string | null;
  link_url: string | null;
  cta: string | null;
  duplicates: number | null;
  impression_rank: number | null;
  video_duration: string | null;
  days: number;
  remix_id?: number | null;
  remix_status?: "pending" | "done" | "error" | null;
}

interface RemixIdea {
  title: string;
  angle: string;
  format: string;
  hook: string;
  scenes?: { time?: string; visual: string; voiceover?: string; text?: string }[];
  caption: string;
  cta: string;
  production?: string;
}

interface RemixFull {
  id: number;
  ad_id: string;
  status: "pending" | "done" | "error";
  specialist: string | null;
  error: string | null;
  note_id: number | null;
  created_at: string;
  data: { model?: string; summary?: string; ideas: RemixIdea[] } | null;
  ad: Ad | null;
}

const SPECIALIST_NAME: Record<string, string> = { konten: "Perencana Konten", copywriter: "Copywriter" };

interface Summary {
  totals: { ads: number; active: number; pages: number; newWeek: number; unscored: number };
  pages: { page_id: string; page_name: string; ads: number; active: number; longest: number; hook: number | null }[];
  angles: { angle: string; n: number }[];
  scans: { created_at: string; found: number; new_count: number }[];
  watch: { id: number; kind: "keyword" | "page"; value: string; label: string | null; country: string }[];
  jev: { configured: boolean; state: "ok" | "habis" | "invalid" | "off"; message?: string };
}

interface ReportData {
  subtitle?: string;
  stats?: { value: string; label: string }[];
  method?: string;
  summary: string[];
  topics?: { topic: string; count: number; hook: string }[];
  topics_note?: string;
  winners: { ad_id: string; title: string; badge?: string; hook?: string; why: string }[];
  others?: { page: string; hook: string; running: string; signal: string }[];
  patterns?: string[];
  warning?: string;
  plan?: { priority: string; title: string; steps: string[] }[];
  data_note?: string;
}

interface ReportMeta {
  id: number;
  title: string;
  query: string | null;
  author: string;
  created_at: string;
}

const SCAN_PROMPT =
  "Scan iklan kompetitor dari daftar pantauan Second Brain di Meta Ad Library (pakai browser, urut impresi, ambil gambar & video), simpan semua hasilnya, lalu buat laporan bedah iklannya.";

/** Label sinyal "winning" dari data Ad Library. */
function signals(a: Ad): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  if (a.days >= 90) out.push({ label: `EVERGREEN ${a.days} HARI`, cls: "bg-[#2E7D32]" });
  if ((a.duplicates ?? 1) >= 3 || (a.impression_rank ?? 99) <= 5) out.push({ label: "SCALING", cls: "bg-[#1565C0]" });
  if (a.days < 30 && (a.hook ?? 0) >= 2) out.push({ label: "LAYAK DITIRU", cls: "bg-[#B8860B]" });
  return out;
}

const mediaUrl = (adId: string, idx: number, kind: "image" | "poster" | "video") => `/api/competitors/media/${adId}/${idx}/${kind}`;

/** Media iklan: video bisa diputar, gambar/carousel bisa digeser. Fallback ke tombol Ad Library. */
function AdMedia({ ad, className = "" }: { ad: Ad; className?: string }) {
  const items: MediaItem[] = ad.media ? JSON.parse(ad.media) : [];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const m = items[idx];
  const box = `relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 ${className}`;

  if (!m || broken)
    return (
      <a href={ad.snapshot_url ?? "#"} target="_blank" rel="noreferrer" className={`${box} flex-col gap-1 text-[11px] text-muted`}>
        <ImageIcon className="size-5" />
        {m ? "Media kedaluwarsa" : "Tanpa media"}
        <span className="text-accent">Buka Ad Library</span>
      </a>
    );

  return (
    <div className={box}>
      {m.type === "video" ? (
        playing ? (
          <video src={mediaUrl(ad.id, idx, "video")} controls autoPlay playsInline className="size-full bg-black object-contain" />
        ) : (
          <button className="group size-full" onClick={() => setPlaying(true)} aria-label="Putar video">
            {m.poster ? (
              <img src={mediaUrl(ad.id, idx, "poster")} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
            ) : (
              <span className="block size-full bg-black/80" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-black/25">
              <span className="flex size-11 items-center justify-center rounded-full bg-white/90 shadow-lg">
                <Play className="ml-0.5 size-5 fill-black text-black" />
              </span>
            </span>
            {ad.video_duration && (
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{ad.video_duration}</span>
            )}
          </button>
        )
      ) : (
        <img src={mediaUrl(ad.id, idx, "image")} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
      )}
      {items.length > 1 && (
        <>
          <button
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white disabled:opacity-0"
            disabled={idx === 0}
            onClick={() => (setIdx(idx - 1), setPlaying(false))}
            aria-label="Sebelumnya"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white disabled:opacity-0"
            disabled={idx === items.length - 1}
            onClick={() => (setIdx(idx + 1), setPlaying(false))}
            aria-label="Berikutnya"
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white">
            {idx + 1}/{items.length}
          </span>
        </>
      )}
    </div>
  );
}

function Signals({ ad }: { ad: Ad }) {
  return (
    <>
      {signals(ad).map((s) => (
        <span key={s.label} className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${s.cls}`}>
          {s.label}
        </span>
      ))}
      {ad.impression_rank != null && ad.impression_rank <= 20 && (
        <span className="rounded-full bg-[#7C518E] px-2 py-0.5 text-[10px] font-bold text-white">IMPRESI #{ad.impression_rank}</span>
      )}
    </>
  );
}

const hookLine = (ad: Ad) => (ad.body ?? ad.title ?? "").split("\n").find((l) => l.trim().length > 3)?.trim() ?? "";

function AdCard({ ad }: { ad: Ad }) {
  const [more, setMore] = useState(false);
  const meta = [
    ad.media_type === "video" ? `video${ad.video_duration ? ` ${ad.video_duration}` : ""}` : ad.media_type === "carousel" ? "carousel" : ad.media_type === "image" ? "gambar" : null,
    (ad.duplicates ?? 1) > 1 ? `${ad.duplicates} duplikat` : null,
    ad.started_at ? `sejak ${fmtDate(ad.started_at)}` : null,
    `${ad.days} hari tayang`,
  ].filter(Boolean);
  let domain: string | null = null;
  try {
    domain = ad.link_url ? new URL(ad.link_url).hostname.replace(/^www\./, "") : null;
  } catch {
    domain = null;
  }
  return (
    <Card className="flex overflow-hidden">
      <AdMedia ad={ad} className="aspect-[9/16] w-28 sm:w-36" />
      <div className="min-w-0 flex-1 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold">{ad.page_name ?? "Halaman tidak diketahui"}</span>
          <span className={`size-2 shrink-0 rounded-full ${ad.active ? "bg-ok" : "bg-muted/40"}`} title={ad.active ? "Masih tayang" : "Sudah berhenti"} />
          <Signals ad={ad} />
        </div>
        <p className="mt-0.5 text-[11px] text-muted">{meta.join(" · ")}</p>
        {hookLine(ad) && <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-[13px] italic">“{hookLine(ad)}”</p>}
        {ad.body && (
          <p className={`mt-1.5 whitespace-pre-line text-xs text-muted ${more ? "" : "line-clamp-3"}`} onClick={() => setMore(!more)}>
            {ad.body}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
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
          {ad.cta && <Badge>{ad.cta}</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {domain && (
            <a href={ad.link_url!} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
              {domain}
            </a>
          )}
          {ad.query && <span>“{ad.query}”</span>}
          {ad.snapshot_url && (
            <a href={ad.snapshot_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Ad Library <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <RemixButton ad={ad} className="mt-3" />
      </div>
    </Card>
  );
}

/** Tombol "Bikin 5 konten mirip" → Manajer Marketing menugaskan spesialis; status dipantau sampai selesai. */
function RemixButton({ ad, className = "" }: { ad: Ad; className?: string }) {
  const toast = useToast();
  const [state, setState] = useState<{ id: number | null; status: Ad["remix_status"] }>({ id: ad.remix_id ?? null, status: ad.remix_status ?? null });
  const [open, setOpen] = useState(false);

  // Pantau pekerjaan yang sedang berjalan.
  useEffect(() => {
    if (state.status !== "pending" || !state.id) return;
    const t = setInterval(async () => {
      try {
        const r = await api<RemixFull>(`/competitors/remixes/${state.id}`);
        if (r.status !== "pending") {
          setState({ id: r.id, status: r.status });
          if (r.status === "done") toast.ok(`${r.data?.ideas.length ?? 5} konten mirip iklan ${ad.page_name ?? ""} siap`);
          else toast.error(r.error ?? "Gagal membuat konten");
        }
      } catch {
        /* coba lagi di putaran berikutnya */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [state, ad.page_name, toast]);

  const start = async () => {
    try {
      const r = await api<RemixFull>(`/competitors/ads/${ad.id}/remix`, { body: {} });
      setState({ id: r.id, status: r.status });
      toast.ok(`Manajer Marketing menugaskan ${SPECIALIST_NAME[r.specialist ?? ""] ?? "tim"} — sekitar 1 menit`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {state.status === "done" && state.id ? (
        <>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            <PenLine className="size-3.5" /> Lihat konten tim
          </Button>
          <Button size="sm" variant="ghost" onClick={start}>
            <Sparkles className="size-3.5" /> Bikin lagi
          </Button>
        </>
      ) : state.status === "pending" ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">
          <Loader2 className="size-3.5 animate-spin" /> Tim marketing sedang membuat 5 konten…
        </span>
      ) : (
        <Button size="sm" variant={state.status === "error" ? "danger" : "secondary"} onClick={start}>
          <Sparkles className="size-3.5" /> {state.status === "error" ? "Gagal — coba lagi" : "Bikin 5 konten mirip"}
        </Button>
      )}
      <StudioButton ad={ad} />
      {open && state.id && <RemixModal id={state.id} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Jadikan iklan ini acuan proyek baru di Studio Konten (avatar → produk → storyboard → video). */
function StudioButton({ ad }: { ad: Ad }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const hook = hookLine(ad);
      const r = await api<{ id: number }>("/studio", {
        body: {
          title: `Konten ala ${ad.page_name ?? "kompetitor"}`,
          brief: `Buat video iklan untuk produk kita yang meniru pola iklan kompetitor ${ad.page_name ?? ""}${hook ? ` (hook: "${hook.slice(0, 160)}")` : ""}. Sesuaikan dengan produk, target, dan preferensi pemilik.`,
          source_ad_id: ad.id,
        },
      });
      navigate(`/studio?p=${r.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={start}>
      {!busy && <Clapperboard className="size-3.5" />} Buat di Studio
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button
      className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.ok("Disalin"))}
    >
      <Copy className="size-3" /> Salin
    </button>
  );
}

/** Hasil konten tim: naskah per adegan + caption siap salin. */
function RemixModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: r, error } = useLoad(() => api<RemixFull>(`/competitors/remixes/${id}`), [id]);
  return (
    <Modal
      wide
      title={r?.ad ? `Konten mirip iklan ${r.ad.page_name ?? ""}` : "Konten tim marketing"}
      onClose={onClose}
      footer={r?.note_id ? <span className="mr-auto text-xs text-muted">Tersimpan di Second Brain sebagai catatan #{r.note_id}</span> : undefined}
    >
      {error ? (
        <Empty title="Gagal memuat" hint={error} />
      ) : !r ? (
        <Spinner />
      ) : !r.data ? (
        <Empty title={r.status === "pending" ? "Masih dikerjakan…" : "Belum ada hasil"} hint={r.error ?? undefined} />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            {r.ad && <AdMedia ad={r.ad} className="aspect-[9/16] w-20 rounded-lg" />}
            <div className="min-w-0 text-sm">
              <p className="text-xs text-muted">
                Dibuat {SPECIALIST_NAME[r.specialist ?? ""] ?? "tim marketing"}
                {r.data.model ? ` · ditulis ${r.data.model}` : ""} · {fmtWhen(r.created_at)}
              </p>
              {r.data.summary && <p className="mt-1">{r.data.summary}</p>}
            </div>
          </div>
          {r.data.ideas.map((idea, i) => {
            const full = `${idea.hook}\n\n${idea.caption}\n\n${idea.cta}`;
            return (
              <Card key={i} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {i + 1}. {idea.title}
                    </p>
                    <p className="text-[11px] text-muted">
                      {idea.format} · {idea.angle}
                    </p>
                  </div>
                  <CopyButton text={full} />
                </div>
                <p className="mt-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-sm font-medium text-accent">“{idea.hook}”</p>
                {!!idea.scenes?.length && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-line text-left text-muted">
                          <th className="py-1 pr-2 font-medium">Detik</th>
                          <th className="py-1 pr-2 font-medium">Visual</th>
                          <th className="py-1 pr-2 font-medium">Voice over</th>
                          <th className="py-1 font-medium">Teks layar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {idea.scenes.map((s, j) => (
                          <tr key={j} className="border-b border-line/60 align-top">
                            <td className="whitespace-nowrap py-1.5 pr-2 text-muted">{s.time}</td>
                            <td className="py-1.5 pr-2">{s.visual}</td>
                            <td className="py-1.5 pr-2">{s.voiceover}</td>
                            <td className="py-1.5">{s.text}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted">Caption</span>
                    <CopyButton text={idea.caption} />
                  </div>
                  <p className="whitespace-pre-line rounded-md bg-surface-2 p-2.5 text-[13px]">{idea.caption}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    <b>CTA:</b> {idea.cta}
                  </span>
                  {idea.production && (
                    <span className="text-muted">
                      <b className="text-fg">Produksi:</b> {idea.production}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export function Competitors() {
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<"iklan" | "laporan" | "konten">(
    params.get("laporan") ? "laporan" : params.get("konten") ? "konten" : "iklan",
  );
  const { data: sum, error, reload: reloadSum } = useLoad(() => api<Summary>("/competitors"), []);

  if (error) return <Empty title="Gagal memuat riset kompetitor" hint={error} />;
  if (!sum) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Riset Kompetitor"
        subtitle="Iklan kompetitor dari Meta Ad Library: lengkap dengan gambar & video, lama tayang, duplikat, dan urutan impresi."
      />
      <div className="mb-5 flex gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit">
        {(
          [
            ["iklan", "Galeri iklan", Megaphone],
            ["laporan", "Laporan bedah iklan", FileText],
            ["konten", "Konten tim", PenLine],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm transition sm:flex-none ${
              tab === key ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2"
            }`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "iklan" ? <Gallery sum={sum} reloadSum={reloadSum} /> : tab === "laporan" ? <Reports sum={sum} /> : <TeamContent />}
    </>
  );
}

function Gallery({ sum, reloadSum }: { sum: Summary; reloadSum: () => void }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: "", page: "", angle: "", active: false, sort: "impresi" });
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
    limit: "150",
  }).toString();
  const { data: list, loading, reload: reloadAds } = useLoad(() => api<{ ads: Ad[] }>(`/competitors/ads?${qs}`), [qs]);
  const [scoring, setScoring] = useState(false);

  const score = async () => {
    setScoring(true);
    try {
      const r = await api<{ scored: number; jev: number; ai: number; remaining: number }>("/competitors/score", { body: {} });
      toast.ok(`Dinilai ${r.scored} iklan (Jev ${r.jev}, tim AI ${r.ai})${r.remaining ? `, sisa ${r.remaining}` : ""}`);
      reloadSum();
      reloadAds();
    } catch (e) {
      toast.error(e);
    } finally {
      setScoring(false);
    }
  };

  const jevLabel = !sum.jev.configured
    ? { tone: "neutral" as const, text: "Penilai: tim AI" }
    : sum.jev.state === "ok"
      ? { tone: "ok" as const, text: "Penilai: Jev AI" }
      : { tone: "warn" as const, text: `${sum.jev.message ?? "Jev tidak tersedia"} → tim AI` };

  return (
    <>
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
          <SectionTitle
            action={
              <div className="flex items-center gap-2">
                {sum.totals.unscored > 0 && (
                  <Button size="sm" loading={scoring} onClick={score}>
                    {!scoring && <Gauge className="size-3.5" />} Nilai {sum.totals.unscored}
                  </Button>
                )}
                <Badge tone={jevLabel.tone}>{jevLabel.text}</Badge>
              </div>
            }
          >
            Iklan
          </SectionTitle>
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
              <option value="impresi">Impresi terbanyak</option>
              <option value="lama">Paling lama tayang</option>
              <option value="duplikat">Duplikat terbanyak</option>
              <option value="baru">Terbaru ditemukan</option>
              <option value="hook">Hook terkuat</option>
            </select>
            <label className="flex items-center gap-2 px-1 text-sm text-muted">
              <input type="checkbox" checked={filters.active} onChange={(e) => setFilters((f) => ({ ...f, active: e.target.checked }))} />
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
                hint={sum.totals.ads ? undefined : 'Isi daftar pantauan, lalu minta Claude memindai (lihat "Cara scan").'}
              />
            </Card>
          )}
        </section>

        <aside className="space-y-6">
          <WatchList items={sum.watch} onChanged={reloadSum} />
          <ScanHelp lastScan={sum.scans[0]} />
          {sum.pages.length > 0 && (
            <section>
              <SectionTitle>Kompetitor</SectionTitle>
              <Card className="divide-y divide-line">
                {sum.pages.slice(0, 15).map((p) => (
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
                  </button>
                ))}
              </Card>
            </section>
          )}
          {sum.angles.length > 0 && (
            <section>
              <SectionTitle>Angle yang dipakai</SectionTitle>
              <Card className="space-y-2 p-4">
                {sum.angles.map((a) => (
                  <div key={a.angle} className="text-xs">
                    <div className="mb-1 flex justify-between">
                      <span>{ANGLES[a.angle] ?? a.angle}</span>
                      <span className="tabular-nums text-muted">{a.n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(a.n / sum.angles[0].n) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

/** Bookmarklet: ekstraktor + kirim ke halaman impor situs ini (Facebook memblokir fetch ke situs lain). */
function useBookmarklet(): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    fetch("/adlibrary-extract.js")
      .then((r) => r.text())
      .then((src) => {
        const code = `(async()=>{${src}
const r=await adLibraryExtract({scrolls:3});
if(!r.ads.length){alert("Tidak ada iklan terbaca. Buka halaman hasil pencarian Ad Library dulu.");return}
const t=JSON.stringify(r);let d;
try{const s=new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"));const b=new Uint8Array(await new Response(s).arrayBuffer());let x="";for(const c of b)x+=String.fromCharCode(c);d="gz."+btoa(x)}
catch(e){d="js."+btoa(unescape(encodeURIComponent(t)))}
location.href=${JSON.stringify(window.location.origin)}+"/impor-iklan#d="+encodeURIComponent(d)})()`;
        setHref("javascript:" + encodeURIComponent(code));
      })
      .catch(() => setHref(null));
  }, []);
  return href;
}

function ScanHelp({ lastScan }: { lastScan?: Summary["scans"][number] }) {
  const toast = useToast();
  const bookmarklet = useBookmarklet();
  return (
    <section>
      <SectionTitle>Cara scan</SectionTitle>
      <Card className="space-y-3 p-4 text-sm">
        <div>
          <p className="font-medium">1. Sendiri, lewat Chrome di laptop</p>
          <p className="mt-1 text-muted">
            Seret tombol ini ke bookmark bar. Buka Ad Library, cari kata kunci, urutkan <i>Impressions: high to low</i>, lalu klik bookmark-nya.
            Semua iklan beserta gambar & videonya masuk ke sini.
          </p>
          {bookmarklet && (
            <a
              ref={(el) => void el?.setAttribute("href", bookmarklet)}
              onClick={(e) => {
                e.preventDefault();
                toast.ok("Seret tombol ini ke bookmark bar, jangan diklik di sini");
              }}
              className="mt-2 inline-flex cursor-grab items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              <Megaphone className="size-3.5" /> Kirim ke Second Brain
            </a>
          )}
        </div>
        <p className="font-medium">2. Lewat Claude (bisa sekaligus dibuatkan laporan)</p>
        <p className="-mt-2 text-muted">Di Claude desktop / Claude in Chrome, kirim:</p>
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
        {lastScan && (
          <p className="text-xs text-muted">
            Scan terakhir {fmtWhen(lastScan.created_at)} · {lastScan.found} iklan, {lastScan.new_count} baru
          </p>
        )}
      </Card>
    </section>
  );
}

function Reports({ sum }: { sum: Summary }) {
  const toast = useToast();
  const { data, reload } = useLoad(() => api<{ reports: ReportMeta[] }>("/competitors/reports"), []);
  const [openId, setOpenId] = useState<number | null>(null);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    if (data?.reports[0] && openId == null) setOpenId(data.reports[0].id);
  }, [data, openId]);

  const make = async () => {
    setMaking(true);
    try {
      const r = await api<{ id: number }>("/competitors/reports", { body: {} });
      toast.ok("Laporan baru siap");
      await reload();
      setOpenId(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setMaking(false);
    }
  };

  if (!data) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Button variant="primary" className="w-full" loading={making} disabled={!sum.totals.ads} onClick={make}>
          {!making && <Sparkles className="size-4" />} Bedah iklan sekarang
        </Button>
        <p className="text-[11px] text-muted">Dibuat agen Riset dari iklan tersimpan. Laporan dari Claude (lewat konektor) juga muncul di sini.</p>
        <Card className="divide-y divide-line">
          {data.reports.length ? (
            data.reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-surface-2 ${openId === r.id ? "bg-accent-soft" : ""}`}
              >
                <span className="line-clamp-2 font-medium">{r.title}</span>
                <span className="text-[11px] text-muted">
                  {fmtWhen(r.created_at)} · {r.author === "claude" ? "Claude" : "agen Riset"}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-xs text-muted">Belum ada laporan.</p>
          )}
        </Card>
      </aside>
      {openId ? <ReportView id={openId} /> : <Empty icon={<FileText className="size-6" />} title="Pilih atau buat laporan" />}
    </div>
  );
}

/** Tampilan laporan bergaya "Bedah Iklan Kompetitor" (selalu terang, siap dicetak). */
function ReportView({ id }: { id: number }) {
  const { data: r, error } = useLoad(() => api<ReportMeta & { data: ReportData; ads: Ad[] }>(`/competitors/reports/${id}`), [id]);
  if (error) return <Empty title="Gagal memuat laporan" hint={error} />;
  if (!r) return <Spinner />;
  const d = r.data;
  const adById = new Map(r.ads.map((a) => [a.id, a]));
  const maxTopic = Math.max(1, ...(d.topics ?? []).map((t) => t.count));
  const H2 = ({ children }: { children: ReactNode }) => (
    <h2 className="mb-2.5 mt-7 border-l-[5px] border-[#7C518E] pl-2.5 text-base font-bold text-[#7C518E]">{children}</h2>
  );
  const bold = (s: string) => {
    // **tebal** dari model → <b>; kalau tidak ada, kalimat pertama yang ditebalkan.
    if (s.includes("**"))
      return s.split(/\*\*(.+?)\*\*/g).map((part, i) =>
        i % 2 ? (
          <b key={i} className="text-[#2E7D32]">
            {part}
          </b>
        ) : (
          part
        ),
      );
    const m = /^(.{8,160}?[.!?:])\s+([\s\S]+)$/.exec(s);
    return m ? (
      <>
        <b className="text-[#2E7D32]">{m[1]}</b> {m[2]}
      </>
    ) : (
      s
    );
  };

  return (
    <article className="rounded-2xl bg-[#f6f2f8] p-4 text-[13.5px] leading-relaxed text-[#2f2933] sm:p-6 [color-scheme:light]">
      <h1 className="text-xl font-bold text-[#4F2E3A] sm:text-2xl">{r.title}</h1>
      {d.subtitle && <p className="mt-1 text-xs text-[#888]">{d.subtitle}</p>}
      <div className="my-3 h-1 rounded bg-gradient-to-r from-[#7C518E] to-[#9380AC]" />

      {!!d.stats?.length && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {d.stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-[#e2d5ea] bg-white px-2 py-2.5 text-center">
              <div className="text-lg font-bold text-[#7C518E]">{s.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[#888]">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {d.method && (
        <div className="mb-3 rounded-lg border border-[#c9d8f0] border-l-[5px] border-l-[#1565C0] bg-[#eef3fb] px-4 py-3">
          <b className="text-[#1565C0]">Cara menentukan "winning": </b>
          {d.method}
        </div>
      )}

      <H2>1. Ringkasan: hal yang paling bisa diterapkan</H2>
      <div className="space-y-3 rounded-lg border border-[#c3e6c8] border-l-[5px] border-l-[#2E7D32] bg-[#e8f5e9] px-4 py-3">
        {d.summary.map((s, i) => (
          <p key={i}>
            <b className="text-[#2E7D32]">{i + 1}. </b>
            {bold(s)}
          </p>
        ))}
      </div>

      {!!d.topics?.length && (
        <>
          <H2>2. Peta topik — apa yang sedang ramai diiklankan</H2>
          <div className="overflow-x-auto rounded-xl border border-[#e2d5ea] bg-white p-3">
            <table className="w-full text-[12.6px]">
              <thead>
                <tr className="bg-[#7C518E] text-left text-white">
                  <th className="px-2 py-1.5">Topik / pain point</th>
                  <th className="px-2 py-1.5 text-right">± iklan</th>
                  <th className="w-[25%] px-2 py-1.5" />
                  <th className="px-2 py-1.5">Contoh hook</th>
                </tr>
              </thead>
              <tbody>
                {d.topics.map((t) => (
                  <tr key={t.topic} className="border-b border-[#eee4f2] align-top">
                    <td className="px-2 py-1.5 font-semibold">{t.topic}</td>
                    <td className="px-2 py-1.5 text-right">{t.count}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-block h-3.5 rounded bg-gradient-to-r from-[#7C518E] to-[#9380AC]" style={{ width: `${(t.count / maxTopic) * 100}%` }} />
                    </td>
                    <td className="px-2 py-1.5">“{t.hook}”</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.topics_note && (
            <div className="mt-3 rounded-lg border border-[#c9d8f0] border-l-[5px] border-l-[#1565C0] bg-[#eef3fb] px-4 py-3">
              <b className="text-[#1565C0]">Artinya: </b>
              {d.topics_note}
            </div>
          )}
        </>
      )}

      <H2>3. Iklan kompetitor paling winning</H2>
      <div className="grid gap-3 md:grid-cols-2">
        {d.winners.map((w) => {
          const ad = adById.get(w.ad_id);
          return (
            <div key={w.ad_id + w.title} className="flex overflow-hidden rounded-xl border border-[#e2d5ea] bg-white">
              {ad ? (
                <AdMedia ad={ad} className="aspect-[9/16] w-28 !bg-[#e9e0ef]" />
              ) : (
                <div className="flex w-28 shrink-0 items-center justify-center bg-[#e9e0ef] text-[11px] text-[#888]">tanpa media</div>
              )}
              <div className="min-w-0 flex-1 px-3 py-2.5">
                <div className="font-bold text-[#4F2E3A]">
                  {w.title}{" "}
                  {w.badge && (
                    <span className="ml-1 inline-block max-w-full truncate rounded-full bg-[#2E7D32] px-2 py-0.5 align-middle text-[10px] font-bold text-white">
                      {w.badge}
                    </span>
                  )}
                </div>
                {ad && (
                  <div className="mb-1 text-[11px] text-[#888]">
                    {[ad.page_name, ad.media_type === "video" && ad.video_duration ? `video ${ad.video_duration}` : ad.media_type, (ad.duplicates ?? 1) > 1 ? `${ad.duplicates} iklan` : null, ad.started_at ? `sejak ${fmtDate(ad.started_at)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {w.hook && <div className="my-1.5 rounded-md bg-[#faf6fb] px-2 py-1 text-xs italic text-[#555]">“{w.hook}”</div>}
                <div className="text-xs text-[#444]">{w.why}</div>
                <a
                  href={`https://www.facebook.com/ads/library/?id=${w.ad_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[11.5px] font-bold text-[#7C518E]"
                >
                  Lihat di Ad Library →
                </a>
                {ad && <RemixButton ad={ad} className="mt-2" />}
              </div>
            </div>
          );
        })}
      </div>

      {!!d.others?.length && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[#e2d5ea] bg-white p-3">
          <b className="text-[#4F2E3A]">Pemenang lain yang layak dicatat</b>
          <table className="mt-2 w-full text-[12.6px]">
            <thead>
              <tr className="bg-[#7C518E] text-left text-white">
                <th className="px-2 py-1.5">Halaman</th>
                <th className="px-2 py-1.5">Hook / angle</th>
                <th className="px-2 py-1.5 text-right">Tayang</th>
                <th className="px-2 py-1.5">Sinyal</th>
              </tr>
            </thead>
            <tbody>
              {d.others.map((o, i) => (
                <tr key={i} className="border-b border-[#eee4f2] align-top">
                  <td className="px-2 py-1.5">{o.page}</td>
                  <td className="px-2 py-1.5">{o.hook}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{o.running}</td>
                  <td className="px-2 py-1.5">{o.signal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!d.patterns?.length && (
        <>
          <H2>4. Pola hook &amp; struktur yang berulang di iklan pemenang</H2>
          <ol className="list-decimal space-y-1.5 rounded-xl border border-[#e2d5ea] bg-white py-3 pl-8 pr-4">
            {d.patterns.map((p, i) => (
              <li key={i}>{bold(p)}</li>
            ))}
          </ol>
        </>
      )}

      {d.warning && (
        <div className="mt-3 rounded-lg border border-[#f5c6c0] border-l-[5px] border-l-[#B3261E] bg-[#fdecea] px-4 py-3">
          <b className="text-[#B3261E]">Hati-hati meniru klaimnya. </b>
          {d.warning}
        </div>
      )}

      {!!d.plan?.length && (
        <>
          <H2>5. Yang bisa langsung diterapkan ke iklan kita</H2>
          <div className="rounded-xl border border-[#e2d5ea] bg-white px-4 pb-3">
            {d.plan.map((p, i) => (
              <div key={i}>
                <h3 className="mb-1.5 mt-3 font-bold text-[#4F2E3A]">
                  <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] text-white ${["bg-[#C1621B]", "bg-[#7C518E]", "bg-[#2E7D32]"][i % 3]}`}>
                    {p.priority}
                  </span>
                  {p.title}
                </h3>
                <ol className="list-decimal space-y-1.5 pl-5">
                  {p.steps.map((s, j) => (
                    <li key={j}>{bold(s)}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}

      {d.data_note && (
        <div className="mt-3 rounded-lg border border-[#c9d8f0] border-l-[5px] border-l-[#1565C0] bg-[#eef3fb] px-4 py-3">
          <b className="text-[#1565C0]">Catatan data: </b>
          {d.data_note}
        </div>
      )}
      <p className="mt-4 text-center text-[11px] text-[#999]">
        Sumber: Meta Ad Library · {fmtWhen(r.created_at)} · {r.author === "claude" ? "disusun Claude" : "disusun agen Riset"}
      </p>
    </article>
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
                <button onClick={() => remove(w.id)} className="text-muted opacity-60 transition hover:text-danger group-hover:opacity-100" aria-label="Hapus dari pantauan">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-muted">Belum ada. Tambahkan kata kunci produk (mis. "novia hormon") atau page id halaman kompetitor.</p>
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
              placeholder={kind === "page" ? "Page id, mis. 491041664102579" : "mis. novia hormon"}
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

/** Semua konten yang dibuat tim marketing dari iklan kompetitor. */
function TeamContent() {
  const { data, reload } = useLoad(
    () =>
      api<{
        remixes: {
          id: number;
          ad_id: string;
          status: string;
          specialist: string | null;
          ideas: number | null;
          page_name: string | null;
          media_type: string | null;
          created_at: string;
          error: string | null;
        }[];
      }>("/competitors/remixes"),
    [],
  );
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (!data?.remixes.some((r) => r.status === "pending")) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [data, reload]);

  if (!data) return <Spinner />;
  if (!data.remixes.length)
    return (
      <Card>
        <Empty
          icon={<PenLine className="size-6" />}
          title="Belum ada konten"
          hint='Klik "Bikin 5 konten mirip" di iklan kompetitor mana pun — Manajer Marketing akan menugaskan Copywriter atau Perencana Konten.'
        />
      </Card>
    );
  return (
    <>
      <Card className="divide-y divide-line">
        {data.remixes.map((r) => (
          <button
            key={r.id}
            disabled={r.status !== "done"}
            onClick={() => setOpen(r.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <PenLine className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {r.status === "done" ? `${r.ideas ?? 5} konten` : "Konten"} mirip iklan {r.page_name ?? r.ad_id}
              </span>
              <span className="text-[11px] text-muted">
                {SPECIALIST_NAME[r.specialist ?? ""] ?? "Tim marketing"} · {r.media_type ?? "iklan"} · {fmtWhen(r.created_at)}
              </span>
            </span>
            {r.status === "pending" ? (
              <Badge tone="accent">
                <Loader2 className="size-3 animate-spin" /> Dikerjakan
              </Badge>
            ) : r.status === "error" ? (
              <Badge tone="danger">Gagal</Badge>
            ) : (
              <Badge tone="ok">Siap</Badge>
            )}
          </button>
        ))}
      </Card>
      {open && <RemixModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
