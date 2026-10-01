import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  Film,
  ImagePlus,
  Loader2,
  Package,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtWhen } from "../lib/time";
import { Badge, Button, Card, Empty, Field, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useRouter, useToast } from "../components/app-context";

type Stage = "avatar" | "produk" | "storyboard";
type Provider = "chatgpt" | "grok";

interface Avatar {
  customer: { name: string; age: string; situation: string; pains: string[]; desires: string[]; objections: string[]; language: string[]; channels: string[] };
  character: { name: string; role: string; age: string; look: string; voice: string; consistency: string };
}
interface Product {
  input: Record<string, string>;
  product: { name: string; price: string; benefits: string[]; proof: string[]; offer: string; cta: string; look: string };
  angle: string;
  big_idea: string;
  hooks: string[];
  chosen_hook: number;
  objections: { objection: string; answer: string }[];
  compliance: string[];
}
interface Scene {
  no: number;
  seconds: number;
  shot: string;
  visual: string;
  action: string;
  dialogue: string;
  on_screen_text: string;
  audio: string;
}
interface Storyboard {
  title: string;
  duration: number;
  provider: Provider;
  scenes: Scene[];
  caption: string;
  hashtags: string[];
  cta: string;
}
interface Clip {
  id: number;
  scene_no: number;
  provider: Provider;
  seconds: number;
  prompt: string;
  status: "prompt" | "rendering" | "done" | "failed" | "uploaded";
  error: string | null;
  updated_at: string;
}
interface Project {
  id: number;
  title: string;
  brief: string | null;
  stage: Stage | "hasil";
  avatar: Avatar | null;
  product: Product | null;
  storyboard: Storyboard | null;
  approved: Partial<Record<Stage, string>>;
  provider: Provider | null;
  busy: Stage | null;
  error: string | null;
  clips: Clip[];
  has_character_image: boolean;
  api: Record<Provider, boolean>;
  updated_at: string;
}

const STEPS: { key: Stage | "hasil"; label: string; icon: typeof UserRound }[] = [
  { key: "avatar", label: "Avatar", icon: UserRound },
  { key: "produk", label: "Produk", icon: Package },
  { key: "storyboard", label: "Storyboard", icon: Clapperboard },
  { key: "hasil", label: "Hasil", icon: Film },
];
const PROVIDER_NAME: Record<Provider, string> = { chatgpt: "ChatGPT (Sora)", grok: "Grok Imagine" };
const PROVIDER_LINK: Record<Provider, string> = { chatgpt: "https://sora.chatgpt.com", grok: "https://grok.com/imagine" };
const BUSY_TEXT: Record<Stage, string> = {
  avatar: "Riset sedang menentukan avatar pelanggan & karakter video…",
  produk: "Copywriter sedang menyusun angle, hook, dan jawaban keberatan…",
  storyboard: "Perencana Konten sedang menulis storyboard per adegan…",
};

const lines = (v: string[] | undefined) => (v ?? []).join("\n");
const unlines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function Studio() {
  const { search, navigate } = useRouter();
  const id = Number(new URLSearchParams(search).get("p")) || null;
  return id ? <ProjectView key={id} id={id} onBack={() => navigate("/studio")} /> : <ProjectList />;
}

// --- Daftar proyek ---

function ProjectList() {
  const toast = useToast();
  const { navigate } = useRouter();
  const { data } = useLoad(
    () => api<{ projects: { id: number; title: string; stage: string; busy: string | null; provider: string | null; clips_ready: number; updated_at: string }[] }>("/studio"),
    [],
  );
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>("/studio", { body: { brief } });
      toast.ok("Proyek dibuat — Riset mulai menentukan avatar");
      navigate(`/studio?p=${r.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Studio Konten"
        subtitle="Dari avatar → produk → storyboard → video. Tiap tahap disusun tim AI (Opus), kamu cek & setujui, lalu lanjut."
      />
      <Card className="mb-6 p-4">
        <Field label="Brief konten baru">
          <textarea
            id="studio-brief"
            className="input min-h-24"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="mis. Video 30 detik untuk NOVIA, target ibu 40+ yang haidnya mulai tidak teratur, tujuannya chat WA konsultasi."
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" loading={busy} disabled={brief.trim().length < 5} onClick={create}>
            {!busy && <Sparkles className="size-4" />} Mulai proyek
          </Button>
        </div>
      </Card>

      <SectionTitle>Proyek</SectionTitle>
      {!data ? (
        <Spinner />
      ) : data.projects.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.projects.map((p) => {
            const done = STEPS.findIndex((s) => s.key === p.stage);
            return (
              <button key={p.id} onClick={() => navigate(`/studio?p=${p.id}`)} className="text-left">
                <Card className="h-full p-4 transition hover:border-accent">
                  <p className="font-semibold">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {fmtWhen(p.updated_at)}
                    {p.provider ? ` · ${PROVIDER_NAME[p.provider as Provider]}` : ""}
                    {p.clips_ready ? ` · ${p.clips_ready} klip jadi` : ""}
                  </p>
                  <div className="mt-3 flex gap-1">
                    {STEPS.map((s, i) => (
                      <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-ok" : i === done ? "bg-accent" : "bg-surface-2"}`} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs">
                    {p.busy ? (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <Loader2 className="size-3 animate-spin" /> Tim sedang bekerja
                      </span>
                    ) : (
                      <span className="text-muted">Tahap: {STEPS[Math.max(0, done)]?.label}</span>
                    )}
                  </p>
                </Card>
              </button>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty icon={<Clapperboard className="size-6" />} title="Belum ada proyek" hint="Tulis brief di atas, atau klik “Buat di Studio” pada iklan kompetitor." />
        </Card>
      )}
    </>
  );
}

// --- Detail proyek ---

function ProjectView({ id, onBack }: { id: number; onBack: () => void }) {
  const toast = useToast();
  const { data: p, error, reload } = useLoad(() => api<Project>(`/studio/${id}`), [id]);
  const [step, setStep] = useState<Stage | "hasil" | null>(null);
  const current = step ?? p?.stage ?? "avatar";

  // Pantau selama tim AI bekerja atau video sedang dibuat.
  const working = !!p && (!!p.busy || p.clips.some((c) => c.status === "rendering"));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [working, reload]);
  // Ikuti tahap baru setelah disetujui.
  const lastStage = useRef(p?.stage);
  useEffect(() => {
    if (p && p.stage !== lastStage.current) {
      lastStage.current = p.stage;
      setStep(null);
    }
  }, [p]);

  if (error) return <Empty title="Gagal memuat proyek" hint={error} />;
  if (!p) return <Spinner />;

  const generate = async (stage: Stage, options: Record<string, unknown> = {}) => {
    try {
      await api(`/studio/${id}/generate`, { body: { stage, options } });
      toast.ok("Ditugaskan ke tim");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const save = async (stage: Stage, data: unknown, approve: boolean) => {
    try {
      const r = await api<{ ok: boolean; errors: string[] }>(`/studio/${id}/save`, { body: { stage, data, approve } });
      if (r.errors.length) toast.error(r.errors.join(" "));
      else toast.ok(approve ? "Disetujui — lanjut ke tahap berikutnya" : "Tersimpan");
      reload();
      return r.errors;
    } catch (e) {
      toast.error(e);
      return ["gagal"];
    }
  };
  const remove = async () => {
    if (!window.confirm(`Hapus proyek "${p.title}" beserta videonya?`)) return;
    await api(`/studio/${id}`, { method: "DELETE" });
    onBack();
  };

  const stepIndex = STEPS.findIndex((s) => s.key === p.stage);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Studio
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{p.title}</h1>
        <Button size="sm" variant="ghost" onClick={remove} aria-label="Hapus proyek">
          <Trash2 className="size-4" />
        </Button>
      </div>
      {p.brief && <p className="mb-4 text-sm text-muted">{p.brief}</p>}

      {/* Stepper */}
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => {
          const approved = s.key !== "hasil" && !!p.approved[s.key as Stage];
          const reachable = i <= stepIndex;
          return (
            <button
              key={s.key}
              disabled={!reachable}
              onClick={() => setStep(s.key)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs transition sm:flex-row sm:justify-center sm:gap-2 sm:text-sm ${
                current === s.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted"
              } ${reachable ? "hover:border-accent" : "opacity-50"}`}
            >
              {approved ? <Check className="size-4 text-ok" /> : p.busy === s.key ? <Loader2 className="size-4 animate-spin" /> : <s.icon className="size-4" />}
              <span className="font-medium">
                {i + 1}. {s.label}
              </span>
            </button>
          );
        })}
      </div>

      <FlowMap p={p} onSelect={setStep} />

      {p.error && !p.busy && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">{p.error}</div>
      )}

      {p.busy && p.busy === current ? (
        <Card className="flex items-center gap-3 p-6 text-sm">
          <Loader2 className="size-5 animate-spin text-accent" /> {BUSY_TEXT[p.busy]} (biasanya 30–90 detik)
        </Card>
      ) : current === "avatar" ? (
        <AvatarStep p={p} onGenerate={(o) => generate("avatar", o)} onSave={(d, a) => save("avatar", d, a)} />
      ) : current === "produk" ? (
        <ProductStep p={p} onGenerate={(o) => generate("produk", o)} onSave={(d, a) => save("produk", d, a)} />
      ) : current === "storyboard" ? (
        <StoryboardStep p={p} onGenerate={(o) => generate("storyboard", o)} onSave={(d, a) => save("storyboard", d, a)} />
      ) : (
        <ResultStep p={p} reload={reload} />
      )}
    </>
  );
}

/** Peta alur bergaya Archify: lajur per tahap, jalur utama, klik simpul untuk menelusuri hulu–hilirnya. */
function FlowMap({ p, onSelect }: { p: Project; onSelect: (s: Stage | "hasil") => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const scenes = p.storyboard?.scenes ?? [];
  const clip = (no: number) => p.clips.find((c) => c.scene_no === no && c.provider === (p.provider ?? "chatgpt"));
  type Node = { id: string; lane: number; col: number; label: string; sub: string; stage: Stage | "hasil"; state: "done" | "draft" | "empty" | "busy" };
  const nodes: Node[] = useMemo(() => {
    const st = (stage: Stage, has: boolean): Node["state"] => (p.busy === stage ? "busy" : p.approved[stage] ? "done" : has ? "draft" : "empty");
    const list: Node[] = [
      { id: "customer", lane: 0, col: 0, label: p.avatar?.customer.name || "Pelanggan", sub: p.avatar?.customer.age || "avatar", stage: "avatar", state: st("avatar", !!p.avatar) },
      { id: "character", lane: 0, col: 1, label: p.avatar?.character.name || "Karakter", sub: p.avatar?.character.role || "talent AI", stage: "avatar", state: st("avatar", !!p.avatar) },
      { id: "product", lane: 1, col: 2, label: p.product?.product.name || "Produk", sub: p.product?.angle || "angle", stage: "produk", state: st("produk", !!p.product) },
      { id: "hook", lane: 1, col: 3, label: "Hook", sub: p.product?.hooks[p.product.chosen_hook] || "—", stage: "produk", state: st("produk", !!p.product) },
    ];
    scenes.forEach((s, i) => {
      list.push({ id: `s${s.no}`, lane: 2, col: 4 + i, label: `Adegan ${s.no}`, sub: `${s.seconds} dtk`, stage: "storyboard", state: st("storyboard", true) });
      const c = clip(s.no);
      list.push({
        id: `c${s.no}`,
        lane: 3,
        col: 4 + i,
        label: `Klip ${s.no}`,
        sub: c ? { prompt: "prompt siap", rendering: "dibuat…", done: "jadi", uploaded: "diunggah", failed: "gagal" }[c.status] : "belum",
        stage: "hasil",
        state: c?.status === "rendering" ? "busy" : c && ["done", "uploaded"].includes(c.status) ? "done" : c ? "draft" : "empty",
      });
    });
    return list;
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jalur utama (seperti mainPath Archify) + cabang adegan → klip.
  const main = ["customer", "character", "product", "hook", ...scenes.map((s) => `s${s.no}`)];
  const edges: [string, string][] = [...main.slice(1).map((to, i) => [main[i], to] as [string, string]), ...scenes.map((s) => [`s${s.no}`, `c${s.no}`] as [string, string])];
  const lineage = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    // hulu
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of edges) if (set.has(b) && !set.has(a)) (set.add(a), (changed = true));
    }
    // hilir
    const down = [focus];
    while (down.length) {
      const n = down.pop()!;
      for (const [a, b] of edges) if (a === n && !set.has(b)) (set.add(b), down.push(b));
    }
    return set;
  }, [focus, edges.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = 132;
  const H = 52;
  const GX = 24;
  const GY = 26;
  const LANES = ["Avatar", "Produk", "Storyboard", "Hasil"];
  const cols = Math.max(5, 4 + scenes.length);
  const LABEL = 78;
  const width = LABEL + cols * (W + GX);
  const height = LANES.length * (H + GY) + GY;
  const pos = (n: Node) => ({ x: LABEL + n.col * (W + GX), y: GY / 2 + n.lane * (H + GY) });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const COLOR: Record<Node["state"], string> = { done: "var(--ok)", draft: "var(--accent)", busy: "var(--warn)", empty: "var(--line)" };

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <p className="flex-1 text-sm font-semibold">Peta alur</p>
        <span className="hidden text-[11px] text-muted sm:inline">klik simpul untuk menelusuri jalurnya</span>
        <a href={`/api/studio/${p.id}/archify`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" title="Unduh IR workflow Archify (schema v2)">
          <Download className="size-3.5" /> Archify
        </a>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Tutup" : "Buka"}
        </Button>
      </div>
      {open && (
        <div className="overflow-x-auto">
          <svg width={width} height={height} className="block" role="img" aria-label="Peta alur proyek konten">
            {LANES.map((l, i) => (
              <g key={l}>
                <rect x={0} y={GY / 2 + i * (H + GY) - GY / 2 + 2} width={width} height={H + GY - 4} fill={i % 2 ? "transparent" : "var(--surface-2)"} opacity={0.5} />
                <text x={10} y={GY / 2 + i * (H + GY) + H / 2 + 4} fontSize={11} fontWeight={600} fill="var(--muted)">
                  {l}
                </text>
              </g>
            ))}
            {edges.map(([a, b]) => {
              const na = byId.get(a);
              const nb = byId.get(b);
              if (!na || !nb) return null;
              const pa = pos(na);
              const pb = pos(nb);
              const vertical = na.col === nb.col;
              const x1 = vertical ? pa.x + W / 2 : pa.x + W;
              const y1 = vertical ? pa.y + H : pa.y + H / 2;
              const x2 = vertical ? pb.x + W / 2 : pb.x;
              const y2 = vertical ? pb.y : pb.y + H / 2;
              const mx = (x1 + x2) / 2;
              const d = vertical ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
              const lit = !lineage || (lineage.has(a) && lineage.has(b));
              return <path key={a + b} d={d} fill="none" stroke={lit ? "var(--accent)" : "var(--line)"} strokeWidth={lit && lineage ? 2.2 : 1.4} opacity={lit ? 0.9 : 0.4} />;
            })}
            {nodes.map((n) => {
              const { x, y } = pos(n);
              const dim = lineage && !lineage.has(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${x},${y})`}
                  opacity={dim ? 0.35 : 1}
                  className="cursor-pointer"
                  onClick={() => {
                    setFocus(focus === n.id ? null : n.id);
                    onSelect(n.stage);
                  }}
                >
                  <rect width={W} height={H} rx={10} fill="var(--surface)" stroke={COLOR[n.state]} strokeWidth={focus === n.id ? 2.5 : 1.5} />
                  <circle cx={12} cy={14} r={4} fill={COLOR[n.state]} />
                  <text x={22} y={18} fontSize={12} fontWeight={600} fill="var(--fg)">
                    {n.label.length > 15 ? n.label.slice(0, 14) + "…" : n.label}
                  </text>
                  <text x={12} y={38} fontSize={10.5} fill="var(--muted)">
                    {n.sub.length > 21 ? n.sub.slice(0, 20) + "…" : n.sub}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Card>
  );
}

function StepCard({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/** Tombol bawah setiap tahap: simpan, setujui, atau minta tim membuat ulang dengan catatan. */
function StageActions({
  approved,
  onSave,
  onApprove,
  onRegenerate,
}: {
  approved: boolean;
  onSave: () => void;
  onApprove: () => void;
  onRegenerate: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Field label="Revisi oleh tim (opsional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. buat karakternya lebih muda, pakai hijab" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onRegenerate(note)}>
          <RefreshCw className="size-4" /> Buat ulang
        </Button>
        <Button onClick={onSave}>Simpan</Button>
        <Button variant="primary" onClick={onApprove}>
          <Check className="size-4" /> {approved ? "Setujui ulang" : "Setujui & lanjut"}
        </Button>
      </div>
    </div>
  );
}

function AvatarStep({ p, onGenerate, onSave }: { p: Project; onGenerate: (o: Record<string, unknown>) => void; onSave: (d: Avatar, approve: boolean) => void }) {
  const [a, setA] = useState<Avatar | null>(p.avatar);
  useEffect(() => setA(p.avatar), [p.avatar]);
  if (!a)
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-muted">Avatar belum ada.</p>
        <Button className="mt-3" variant="primary" onClick={() => onGenerate({})}>
          <Wand2 className="size-4" /> Tentukan avatar
        </Button>
      </Card>
    );
  const c = a.customer;
  const ch = a.character;
  const setC = (k: keyof Avatar["customer"], v: string | string[]) => setA({ ...a, customer: { ...c, [k]: v } });
  const setCh = (k: keyof Avatar["character"], v: string) => setA({ ...a, character: { ...ch, [k]: v } });
  return (
    <StepCard title="1. Avatar" actions={p.approved.avatar ? <Badge tone="ok">Disetujui</Badge> : <Badge tone="warn">Perlu dicek</Badge>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserRound className="size-4 text-accent" /> Avatar pelanggan
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama">
              <input id="av-c-name" className="input" value={c.name} onChange={(e) => setC("name", e.target.value)} />
            </Field>
            <Field label="Usia">
              <input id="av-c-age" className="input" value={c.age} onChange={(e) => setC("age", e.target.value)} />
            </Field>
          </div>
          <Field label="Situasi">
            <textarea id="av-c-sit" className="input min-h-16" value={c.situation} onChange={(e) => setC("situation", e.target.value)} />
          </Field>
          {(["pains", "desires", "objections", "language", "channels"] as const).map((k) => (
            <Field key={k} label={{ pains: "Keluhan", desires: "Keinginan", objections: "Keberatan sebelum beli", language: "Kata-kata yang mereka pakai", channels: "Tempat online" }[k] + " (satu per baris)"}>
              <textarea id={`av-c-${k}`} className="input min-h-16" value={lines(c[k])} onChange={(e) => setC(k, unlines(e.target.value))} />
            </Field>
          ))}
        </Card>
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Film className="size-4 text-accent" /> Karakter video AI
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama">
              <input id="av-ch-name" className="input" value={ch.name} onChange={(e) => setCh("name", e.target.value)} />
            </Field>
            <Field label="Usia">
              <input id="av-ch-age" className="input" value={ch.age} onChange={(e) => setCh("age", e.target.value)} />
            </Field>
          </div>
          <Field label="Peran">
            <input id="av-ch-role" className="input" value={ch.role} onChange={(e) => setCh("role", e.target.value)} />
          </Field>
          <Field label="Tampilan">
            <textarea id="av-ch-look" className="input min-h-20" value={ch.look} onChange={(e) => setCh("look", e.target.value)} />
          </Field>
          <Field label="Gaya bicara">
            <input id="av-ch-voice" className="input" value={ch.voice} onChange={(e) => setCh("voice", e.target.value)} />
          </Field>
          <Field label="Deskripsi konsistensi (bahasa Inggris, dipakai di setiap prompt video)">
            <textarea id="av-ch-cons" className="input min-h-28 font-mono text-xs" value={ch.consistency} onChange={(e) => setCh("consistency", e.target.value)} />
          </Field>
        </Card>
      </div>
      <StageActions approved={!!p.approved.avatar} onSave={() => onSave(a, false)} onApprove={() => onSave(a, true)} onRegenerate={(note) => onGenerate({ note })} />
    </StepCard>
  );
}

function ProductStep({ p, onGenerate, onSave }: { p: Project; onGenerate: (o: Record<string, unknown>) => void; onSave: (d: Product, approve: boolean) => void }) {
  const [input, setInput] = useState<Record<string, string>>(p.product?.input ?? { name: "", price: "", benefits: "", proof: "", offer: "", cta: "", link: "" });
  const [d, setD] = useState<Product | null>(p.product);
  useEffect(() => setD(p.product), [p.product]);
  const fields: [string, string, string][] = [
    ["name", "Nama produk", "mis. NOVIA"],
    ["price", "Harga & paket", "mis. 1 botol Rp990rb, 2 botol Rp1,8jt"],
    ["benefits", "Manfaat", "mis. bantu menjaga keseimbangan hormon, mood stabil"],
    ["proof", "Bukti", "mis. BPOM, Halal, 3.000+ testimoni"],
    ["offer", "Penawaran", "mis. gratis ongkir & COD"],
    ["cta", "CTA", "mis. konsultasi gratis via WhatsApp"],
    ["link", "Link / WA", "opsional"],
  ];
  return (
    <StepCard title="2. Produk" actions={p.approved.produk ? <Badge tone="ok">Disetujui</Badge> : d ? <Badge tone="warn">Perlu dicek</Badge> : null}>
      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Data produk</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              <input id={`pr-${k}`} className="input" value={input[k] ?? ""} onChange={(e) => setInput({ ...input, [k]: e.target.value })} placeholder={ph} />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant={d ? "secondary" : "primary"} disabled={!input.name?.trim()} onClick={() => onGenerate({ input })}>
            <Wand2 className="size-4" /> {d ? "Susun ulang strategi" : "Susun strategi produk"}
          </Button>
        </div>
      </Card>
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Angle">
              <textarea id="pr-angle" className="input min-h-16" value={d.angle} onChange={(e) => setD({ ...d, angle: e.target.value })} />
            </Field>
            <Field label="Ide besar">
              <textarea id="pr-idea" className="input min-h-16" value={d.big_idea} onChange={(e) => setD({ ...d, big_idea: e.target.value })} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Pilih hook pembuka</p>
            <div className="space-y-2">
              {d.hooks.map((h, i) => (
                <label key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${d.chosen_hook === i ? "border-accent bg-accent-soft" : "border-line"}`}>
                  <input type="radio" name="hook" checked={d.chosen_hook === i} onChange={() => setD({ ...d, chosen_hook: i })} className="mt-1" />
                  <input
                    id={`pr-hook-${i}`}
                    className="flex-1 bg-transparent outline-none"
                    value={h}
                    onChange={(e) => setD({ ...d, hooks: d.hooks.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Manfaat (satu per baris)">
              <textarea id="pr-ben" className="input min-h-20" value={lines(d.product.benefits)} onChange={(e) => setD({ ...d, product: { ...d.product, benefits: unlines(e.target.value) } })} />
            </Field>
            <Field label="Bukti (satu per baris)">
              <textarea id="pr-proof" className="input min-h-20" value={lines(d.product.proof)} onChange={(e) => setD({ ...d, product: { ...d.product, proof: unlines(e.target.value) } })} />
            </Field>
            <Field label="Penawaran">
              <input id="pr-offer2" className="input" value={d.product.offer} onChange={(e) => setD({ ...d, product: { ...d.product, offer: e.target.value } })} />
            </Field>
            <Field label="CTA">
              <input id="pr-cta2" className="input" value={d.product.cta} onChange={(e) => setD({ ...d, product: { ...d.product, cta: e.target.value } })} />
            </Field>
          </div>
          <Field label="Tampilan kemasan (bahasa Inggris, untuk prompt video)">
            <input id="pr-look" className="input" value={d.product.look} onChange={(e) => setD({ ...d, product: { ...d.product, look: e.target.value } })} />
          </Field>
          {!!d.objections.length && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Jawaban keberatan</p>
              <div className="space-y-1.5 text-sm">
                {d.objections.map((o, i) => (
                  <p key={i}>
                    <b>{o.objection}</b> — {o.answer}
                  </p>
                ))}
              </div>
            </div>
          )}
          {!!d.compliance.length && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              <b>Hindari:</b> {d.compliance.join(" · ")}
            </div>
          )}
          <StageActions approved={!!p.approved.produk} onSave={() => onSave(d, false)} onApprove={() => onSave(d, true)} onRegenerate={(note) => onGenerate({ input, note })} />
        </>
      )}
    </StepCard>
  );
}

function StoryboardStep({ p, onGenerate, onSave }: { p: Project; onGenerate: (o: Record<string, unknown>) => void; onSave: (d: Storyboard, approve: boolean) => void }) {
  const [sb, setSb] = useState<Storyboard | null>(p.storyboard);
  const [provider, setProvider] = useState<Provider>(p.provider ?? "chatgpt");
  const [duration, setDuration] = useState(p.storyboard?.duration ?? 30);
  useEffect(() => setSb(p.storyboard), [p.storyboard]);
  const limit = provider === "grok" ? 15 : 12;
  const total = sb?.scenes.reduce((n, s) => n + (Number(s.seconds) || 0), 0) ?? 0;
  const setScene = (i: number, k: keyof Scene, v: string | number) => sb && setSb({ ...sb, scenes: sb.scenes.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  const options = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Video dibuat dengan">
        <select id="sb-provider" className="input w-auto" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          <option value="chatgpt">ChatGPT (Sora) — klip 4/8/12 dtk</option>
          <option value="grok">Grok Imagine — klip s.d. 15 dtk</option>
        </select>
      </Field>
      <Field label="Durasi total">
        <select id="sb-duration" className="input w-auto" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {[15, 30, 45, 60].map((n) => (
            <option key={n} value={n}>
              {n} detik
            </option>
          ))}
        </select>
      </Field>
      <Button variant={sb ? "secondary" : "primary"} onClick={() => onGenerate({ provider, duration })}>
        <Wand2 className="size-4" /> {sb ? "Tulis ulang storyboard" : "Tulis storyboard"}
      </Button>
    </div>
  );

  return (
    <StepCard title="3. Storyboard" actions={p.approved.storyboard ? <Badge tone="ok">Disetujui</Badge> : sb ? <Badge tone="warn">Perlu dicek</Badge> : null}>
      {options}
      {sb && (
        <>
          <p className="text-xs text-muted">
            {sb.scenes.length} adegan · total {total} detik · maksimal {limit} detik per adegan untuk {PROVIDER_NAME[provider]}. Visual, aksi, dan kamera ditulis dalam bahasa Inggris karena dibaca generator video; dialog dalam bahasa Indonesia.
          </p>
          <div className="space-y-3">
            {sb.scenes.map((s, i) => (
              <Card key={i} className={`p-3 ${Number(s.seconds) > limit ? "border-danger" : ""}`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">{i + 1}</span>
                  <input
                    id={`sb-sec-${i}`}
                    type="number"
                    min={2}
                    max={limit}
                    className="input w-20"
                    value={s.seconds}
                    onChange={(e) => setScene(i, "seconds", Number(e.target.value))}
                    aria-label="Detik"
                  />
                  <span className="text-xs text-muted">detik</span>
                  <input id={`sb-shot-${i}`} className="input flex-1" value={s.shot} onChange={(e) => setScene(i, "shot", e.target.value)} placeholder="shot / kamera" />
                  <button
                    className="text-muted hover:text-danger"
                    aria-label="Hapus adegan"
                    onClick={() => setSb({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Visual (EN)">
                    <textarea id={`sb-vis-${i}`} className="input min-h-16 text-[13px]" value={s.visual} onChange={(e) => setScene(i, "visual", e.target.value)} />
                  </Field>
                  <Field label="Aksi (EN)">
                    <textarea id={`sb-act-${i}`} className="input min-h-16 text-[13px]" value={s.action} onChange={(e) => setScene(i, "action", e.target.value)} />
                  </Field>
                  <Field label="Dialog karakter">
                    <textarea id={`sb-dia-${i}`} className="input min-h-16 text-[13px]" value={s.dialogue} onChange={(e) => setScene(i, "dialogue", e.target.value)} />
                  </Field>
                  <div className="space-y-2">
                    <Field label="Teks layar">
                      <input id={`sb-txt-${i}`} className="input" value={s.on_screen_text} onChange={(e) => setScene(i, "on_screen_text", e.target.value)} />
                    </Field>
                    <Field label="Audio">
                      <input id={`sb-aud-${i}`} className="input" value={s.audio} onChange={(e) => setScene(i, "audio", e.target.value)} />
                    </Field>
                  </div>
                </div>
              </Card>
            ))}
            <Button
              size="sm"
              onClick={() =>
                setSb({
                  ...sb,
                  scenes: [...sb.scenes, { no: sb.scenes.length + 1, seconds: 4, shot: "", visual: "", action: "", dialogue: "", on_screen_text: "", audio: "" }],
                })
              }
            >
              <Plus className="size-4" /> Tambah adegan
            </Button>
          </div>
          <Field label="Caption iklan">
            <textarea id="sb-caption" className="input min-h-28" value={sb.caption} onChange={(e) => setSb({ ...sb, caption: e.target.value })} />
          </Field>
          <StageActions
            approved={!!p.approved.storyboard}
            onSave={() => onSave({ ...sb, provider }, false)}
            onApprove={() => onSave({ ...sb, provider }, true)}
            onRegenerate={(note) => onGenerate({ provider, duration, note })}
          />
        </>
      )}
    </StepCard>
  );
}

function CopyButton({ text, label = "Salin" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(text).then(() => toast.ok("Disalin"), () => toast.error("Gagal menyalin"))}>
      <Copy className="size-3.5" /> {label}
    </Button>
  );
}

async function uploadFile(path: string, file: File) {
  const res = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": file.type, "x-upload": "1" }, body: file });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Gagal (${res.status})`);
}

function ResultStep({ p, reload }: { p: Project; reload: () => void }) {
  const toast = useToast();
  const provider = p.provider ?? "chatgpt";
  const clips = p.clips.filter((c) => c.provider === provider);
  const ready = clips.filter((c) => ["done", "uploaded"].includes(c.status));
  const [playing, setPlaying] = useState<number | null>(null);
  const [charVersion, setCharVersion] = useState(0);

  const switchProvider = async (to: Provider) => {
    try {
      await api(`/studio/${p.id}/clips`, { body: { provider: to } });
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const render = async (c: Clip) => {
    try {
      await api(`/studio/clips/${c.id}/render`, { body: {} });
      toast.ok(`Adegan ${c.scene_no} sedang dibuat ${PROVIDER_NAME[provider]}`);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const upload = async (c: Clip, file: File | undefined) => {
    if (!file) return;
    try {
      await uploadFile(`/studio/clips/${c.id}/upload`, file);
      toast.ok(`Video adegan ${c.scene_no} tersimpan`);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const uploadCharacter = async (file: File | undefined) => {
    if (!file) return;
    try {
      await uploadFile(`/studio/${p.id}/character`, file);
      toast.ok("Foto karakter tersimpan");
      setCharVersion((v) => v + 1);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  if (!p.storyboard) return <Empty title="Setujui storyboard dulu" />;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {(["chatgpt", "grok"] as Provider[]).map((pv) => (
            <button
              key={pv}
              onClick={() => switchProvider(pv)}
              className={`rounded-md px-3 py-1.5 text-sm ${provider === pv ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2"}`}
            >
              {PROVIDER_NAME[pv]}
            </button>
          ))}
        </div>
        <p className="flex-1 text-xs text-muted">
          {p.api[provider]
            ? `API ${provider === "grok" ? "xAI" : "OpenAI"} aktif: klik “Buat otomatis” per adegan (berbayar per detik video).`
            : `Mode prompt (gratis): salin prompt → tempel di ${PROVIDER_NAME[provider]} pakai akunmu → unggah videonya ke sini.`}
        </p>
        <a href={PROVIDER_LINK[provider]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Buka {PROVIDER_NAME[provider]} <ExternalLink className="size-3.5" />
        </a>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Foto karakter</p>
            {p.has_character_image ? (
              <img src={`/api/studio/${p.id}/character?v=${charVersion}`} alt="Karakter video" className="mb-2 aspect-[3/4] w-full rounded-lg object-cover" />
            ) : (
              <p className="mb-2 text-xs text-muted">
                Opsional untuk Sora, wajib untuk Grok API. Buat dulu fotonya di ChatGPT/Grok pakai deskripsi konsistensi, lalu unggah supaya wajah karakter sama di semua klip.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <CopyButton text={p.avatar?.character.consistency ?? ""} label="Salin deskripsi" />
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-surface-2">
                <ImagePlus className="size-3.5" /> Unggah foto
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadCharacter(e.target.files?.[0])} />
              </label>
            </div>
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Caption</p>
              <CopyButton text={[p.storyboard.caption, p.storyboard.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n")} />
            </div>
            <p className="max-h-64 overflow-y-auto whitespace-pre-line text-xs text-muted">{p.storyboard.caption}</p>
          </Card>
        </div>

        <div className="space-y-3">
          {ready.length > 0 && (
            <Card className="flex items-center gap-3 p-3">
              <Play className="size-4 text-accent" />
              <p className="flex-1 text-sm">
                {ready.length}/{clips.length} klip jadi. Putar berurutan untuk melihat alurnya; gabungkan di CapCut untuk hasil akhir.
              </p>
              <Button size="sm" variant="primary" onClick={() => setPlaying(ready[0].id)}>
                <Play className="size-3.5" /> Putar semua
              </Button>
            </Card>
          )}
          {clips.map((c) => {
            const scene = p.storyboard!.scenes.find((s) => s.no === c.scene_no);
            const hasVideo = ["done", "uploaded"].includes(c.status);
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-3 sm:flex-row">
                <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:w-32">
                  {hasVideo ? (
                    <video
                      key={`${c.id}-${c.updated_at}`}
                      src={`/api/studio/clips/${c.id}/video?v=${encodeURIComponent(c.updated_at)}`}
                      controls
                      playsInline
                      autoPlay={playing === c.id}
                      onEnded={() => {
                        const i = ready.findIndex((r) => r.id === c.id);
                        setPlaying(ready[i + 1]?.id ?? null);
                      }}
                      className="size-full bg-black object-contain"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted">
                      {c.status === "rendering" ? <Loader2 className="size-5 animate-spin text-accent" /> : <Film className="size-5" />}
                      {c.status === "rendering" ? "Sedang dibuat…" : c.status === "failed" ? "Gagal" : "Belum ada video"}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">Adegan {c.scene_no}</p>
                    <Badge>{c.seconds} dtk</Badge>
                    {c.status === "uploaded" && <Badge tone="ok">Diunggah</Badge>}
                    {c.status === "done" && <Badge tone="ok">Dibuat otomatis</Badge>}
                    {c.status === "failed" && <Badge tone="danger">Gagal</Badge>}
                  </div>
                  {scene?.dialogue && <p className="mt-1 text-sm italic">“{scene.dialogue}”</p>}
                  {c.error && <p className="mt-1 text-xs text-danger">{c.error}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted">Prompt {PROVIDER_NAME[provider]}</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[11px]">{c.prompt}</pre>
                  </details>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <CopyButton text={c.prompt} label="Salin prompt" />
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-surface-2">
                      <Upload className="size-3.5" /> Unggah video
                      <input type="file" accept="video/*" hidden onChange={(e) => upload(c, e.target.files?.[0])} />
                    </label>
                    {p.api[provider] && (
                      <Button size="sm" variant="primary" disabled={c.status === "rendering"} onClick={() => render(c)}>
                        <Wand2 className="size-3.5" /> {hasVideo ? "Buat ulang otomatis" : "Buat otomatis"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
