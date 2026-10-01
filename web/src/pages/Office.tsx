import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Box, Moon, MousePointerClick, Sun, SunMoon, X } from "lucide-react";
import { api } from "../lib/api";
import { Button, Card, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useToast } from "../components/app-context";
import {
  AGENT_BY_ID,
  DEPT_LABEL,
  MOOD_LABEL,
  ROSTER,
  statusOf,
  type AgentId,
  type Dept,
  type Mood,
  type OfficeData,
  type Status,
} from "../office/roster";

// three.js cukup besar → dimuat hanya saat halaman ini dibuka.
const OfficeScene = lazy(() => import("../office/Scene"));

const MOOD_DOT: Record<Mood, string> = {
  working: "bg-ok",
  visiting: "bg-ok",
  talking: "bg-warn",
  error: "bg-danger",
  idle: "bg-muted/50",
  standby: "bg-muted/30",
};

function ago(iso: string, skew: number): string {
  const s = Math.max(0, (Date.now() + skew - Date.parse(iso)) / 1000);
  if (s < 45) return "baru saja";
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function offsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 420;
}

export function Office({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<(OfficeData & { timezone: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [selected, setSelected] = useState<AgentId | null>(null);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [light, setLight] = useState<"auto" | "day" | "night">(() => {
    try {
      return (localStorage.getItem("kantor:light") as "day" | "night" | null) ?? "auto";
    } catch {
      return "auto";
    }
  });
  const cycleLight = () => {
    const next = light === "auto" ? "day" : light === "day" ? "night" : "auto";
    setLight(next);
    try {
      localStorage.setItem("kantor:light", next);
    } catch {
      /* abaikan */
    }
  };
  const [compact, setCompact] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sendingRef = useRef(false);
  sendingRef.current = sending;

  // Ambil keadaan kantor berkala: cepat saat sedang menunggu perintah, santai kalau tidak.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const load = async () => {
      // Tab tersembunyi: lewati pengambilan berkala (kecuali yang pertama) supaya hemat.
      if (first || !document.hidden) {
        first = false;
        try {
          const d = await api<OfficeData & { timezone: string }>("/office");
          if (stop) return;
          setData(d);
          setSkew(Date.parse(d.now) - Date.now());
          setError(null);
        } catch (e) {
          if (!stop) setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stop) timer = setTimeout(load, sendingRef.current ? 1200 : 4000);
    };
    load();
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  const statuses = useMemo(() => {
    const map = {} as Record<AgentId, Status>;
    for (const a of ROSTER) map[a.id] = statusOf(data?.agents.find((x) => x.id === a.id), skew, !!data?.puterConnected);
    return map;
    // tick (tiap detik) ikut menghitung ulang supaya gelembung kedaluwarsa tepat waktu
  }, [data, skew, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const tzMin = offsetMinutes(data?.timezone ?? "+07:00");
  const hour = new Date(Date.now() + skew + tzMin * 60_000).getUTCHours();
  const night = light === "auto" ? hour >= 18 || hour < 6 : light === "night";
  const LightIcon = light === "auto" ? SunMoon : light === "day" ? Sun : Moon;

  const send = async () => {
    const text = command.trim();
    if (!text || sending) return;
    setSending(true);
    setReply(null);
    try {
      const res = await api<{ reply: string; receipt?: string }>("/chat", { method: "POST", body: { message: text } });
      setReply(res.receipt ? `${res.reply}\n\n${res.receipt}` : res.reply);
      setCommand("");
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  };

  const working = ROSTER.filter((a) => ["working", "visiting"].includes(statuses[a.id].mood)).length;
  const feed = (data?.feed ?? []).filter((f) => !selected || f.agent === selected);
  const sel = selected ? AGENT_BY_ID[selected] : null;
  const selState = selected ? data?.agents.find((a) => a.id === selected) : undefined;
  const [reviewing, setReviewing] = useState(false);
  const askReview = async () => {
    setReviewing(true);
    try {
      const r = await api<{ focus: string[] }>("/review", { body: {} });
      toast.ok(r.focus.length ? "Review CEO terkirim ke Telegram" : "Review terkirim");
    } catch (e) {
      toast.error(e);
    } finally {
      setReviewing(false);
    }
  };
  const modelOf = (id: AgentId) =>
    id === "haiku" || id === "opus" || id === "gemma"
      ? data?.models[id]
      : id === "copywriter" || id === "konten" || id === "ceo"
        ? data?.models.opus
        : null;

  return (
    <div>
      <PageHeader
        title="Kantor AI"
        subtitle={
          data ? (working ? `${working} agen sedang bekerja — live dari server.` : "Semua agen sedang santai. Kirim perintah untuk melihat mereka bekerja.") : "Tim AI yang bekerja untukmu, live dalam 3D."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="relative h-[54vh] min-h-[380px] overflow-hidden sm:h-[62vh]">
          {error && !data ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-danger">{error}</div>
          ) : !data ? (
            <Spinner label="Menyiapkan kantor…" />
          ) : (
            <SceneBoundary>
              <Suspense fallback={<Spinner label="Memuat 3D…" />}>
                <OfficeScene
                  counts={data.counts}
                  focus={data.focus?.items ?? []}
                  statuses={statuses}
                  selected={selected}
                  onSelect={setSelected}
                  night={night}
                  tzOffsetMin={tzMin}
                  // Di HP cukup gelembung agen yang terakhir bergerak, supaya tidak menumpuk.
                  bubbles={compact && data.feed[0] ? [data.feed[0].agent] : undefined}
                />
              </Suspense>
            </SceneBoundary>
          )}

          <div className="pointer-events-none absolute left-3 top-3 hidden items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur sm:flex">
            <MousePointerClick className="size-3.5" /> Klik agen · seret untuk memutar · scroll untuk zoom
          </div>

          <button
            onClick={cycleLight}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur hover:bg-black/70"
            title="Suasana kantor"
          >
            <LightIcon className="size-3.5" />
            {light === "auto" ? "Otomatis (WIB)" : light === "day" ? "Siang" : "Malam"}
          </button>

          {/* Perintah langsung ke tim (sama seperti Chat AI) */}
          <div className="absolute inset-x-3 bottom-3 space-y-2">
            {reply && (
              <div className="relative max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface/95 p-3 pr-8 text-sm shadow-lg backdrop-blur">
                {reply}
                <button className="absolute right-2 top-2 text-muted hover:text-fg" onClick={() => setReply(null)} aria-label="Tutup balasan">
                  <X className="size-4" />
                </button>
              </div>
            )}
            <form
              className="flex items-center gap-2 rounded-xl border border-line bg-surface/95 p-1.5 pl-3 shadow-lg backdrop-blur"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                placeholder={sending ? "Tim sedang mengerjakan…" : "Suruh tim, mis. “ingetin aku meeting besok jam 10”"}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !command.trim()}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition disabled:opacity-40"
                aria-label="Kirim perintah"
              >
                <ArrowUp className={`size-4 ${sending ? "animate-bounce" : ""}`} />
              </button>
            </form>
          </div>
        </Card>

        <div className="space-y-4">
          {sel ? (
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 size-9 shrink-0 rounded-lg" style={{ background: sel.color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{sel.name}</p>
                  <p className="text-xs text-muted">{sel.role}</p>
                </div>
                <button className="text-muted hover:text-fg" onClick={() => setSelected(null)} aria-label="Tutup">
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-muted">{sel.about}</p>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Status</dt>
                  <dd className="flex items-center gap-1.5 font-medium">
                    <span className={`size-2 rounded-full ${MOOD_DOT[statuses[sel.id].mood]}`} />
                    {MOOD_LABEL[statuses[sel.id].mood]}
                  </dd>
                </div>
                {modelOf(sel.id) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Model</dt>
                    <dd className="truncate font-mono">{modelOf(sel.id)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Pekerjaan hari ini</dt>
                  <dd className="font-medium">{selState?.today ?? 0}</dd>
                </div>
                {selState?.lastAt && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Terakhir aktif</dt>
                    <dd className="font-medium">{ago(selState.lastAt, skew)}</dd>
                  </div>
                )}
                {sel.reportsTo && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Atasan</dt>
                    <dd>
                      <button className="font-medium text-accent hover:underline" onClick={() => setSelected(sel.reportsTo!)}>
                        {AGENT_BY_ID[sel.reportsTo].name}
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              {ROSTER.some((a) => a.reportsTo === sel.id) && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Membawahi</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ROSTER.filter((a) => a.reportsTo === sel.id).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                        className="flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-[11px] hover:bg-surface-2"
                      >
                        <span className="size-2 rounded-full" style={{ background: a.color }} />
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sel.id === "ceo" && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Fokus minggu ini</p>
                  {data?.focus?.items.length ? (
                    <ol className="list-decimal space-y-1 pl-4 text-sm">
                      {data.focus.items.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-muted">Belum ditetapkan. Review otomatis tiap Minggu 20:00 WIB.</p>
                  )}
                  <Button size="sm" className="mt-3 w-full" loading={reviewing} onClick={askReview}>
                    Minta review sekarang
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-2">
              {(["pimpinan", "ops", "marketing"] as Dept[]).map((dept) => (
                <div key={dept}>
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{DEPT_LABEL[dept]}</p>
              {ROSTER.filter((a) => a.dept === dept).map((a) => {
                const manager = !a.reportsTo || a.reportsTo === "ceo";
                const st = statuses[a.id];
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left transition hover:bg-surface-2 ${manager ? "pl-2" : "pl-6"}`}
                  >
                    <span className={`shrink-0 rounded-md ${manager ? "size-6" : "size-5"}`} style={{ background: a.color }} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${manager ? "font-semibold" : "font-medium"}`}>{a.name}</span>
                      <span className="block truncate text-[11px] text-muted">{a.role}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span className={`size-2 rounded-full ${MOOD_DOT[st.mood]} ${st.mood === "working" || st.mood === "visiting" ? "animate-pulse" : ""}`} />
                      {MOOD_LABEL[st.mood]}
                    </span>
                  </button>
                );
              })}
                </div>
              ))}
            </Card>
          )}

          <Card className="p-4">
            <SectionTitle>{sel ? `Aktivitas ${sel.name}` : "Aktivitas terbaru"}</SectionTitle>
            {feed.length ? (
              <ol className="max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                {feed.slice(0, 25).map((f) => {
                  const a = AGENT_BY_ID[f.agent];
                  return (
                    <li key={f.id} className="flex gap-2.5 text-xs">
                      <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: f.kind === "error" ? "var(--danger)" : a?.color }} />
                      <div className="min-w-0">
                        <p className={f.kind === "error" ? "text-danger" : "text-fg"}>
                          <span className="font-semibold">{a?.name ?? f.agent}</span> · {f.summary}
                        </p>
                        <p className="text-muted">{ago(f.created_at, skew)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-xs text-muted">
                Belum ada aktivitas{sel ? ` dari ${sel.name}` : ""}. Kirim pesan ke bot Telegram atau lewat kotak perintah, lalu lihat timnya bergerak.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Kalau browser tidak mendukung WebGL, halaman tetap jalan tanpa 3D. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <Box className="size-6" />
          Browser ini tidak bisa menampilkan 3D. Status tim tetap terlihat di panel samping.
        </div>
      );
    return this.props.children;
  }
}
