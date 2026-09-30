import { useEffect, useState, type ReactNode } from "react";
import { Copy, FolderOpen, LogOut, Mail, Moon, Plug, RotateCcw, Sun, Unplug } from "lucide-react";
import { api, type GoogleStatus, type SystemInfo } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtWhen } from "../lib/time";
import { Badge, Button, Card, Empty, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useToast } from "../components/app-context";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function System({ onLogout }: { onLogout: () => void }) {
  const { data, error } = useLoad(() => api<SystemInfo>("/system"), []);
  const g = useLoad(() => api<GoogleStatus>("/google/status"), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  // Hasil kembali dari halaman izin Google (?google=ok|error).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("google") === "ok") toast.ok(`Google terhubung: ${p.get("email")}`);
    if (p.get("google") === "error") toast.error(`Gagal menghubungkan Google: ${p.get("message")}`);
    if (p.has("google")) window.history.replaceState(null, "", "/sistem");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.ok(ok);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Sistem" subtitle="Status bot, otak AI, dan tindakan cepat." />

      {error ? (
        <Empty title="Gagal memuat status" hint={error} />
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionTitle>Status</SectionTitle>
            <Card className="divide-y divide-line">
              <Row label="Bot Telegram">
                {data.bot ? (
                  <a className="text-accent hover:underline" href={`https://t.me/${data.bot.slice(1)}`} target="_blank" rel="noreferrer">
                    {data.bot}
                  </a>
                ) : (
                  <Badge tone="danger">Tidak terhubung</Badge>
                )}
              </Row>
              <Row label="Webhook">
                {data.webhook?.lastError ? (
                  <Badge tone="danger">
                    Error {data.webhook.lastErrorAt ? fmtWhen(data.webhook.lastErrorAt) : ""}: {data.webhook.lastError}
                  </Badge>
                ) : (
                  <Badge tone="ok">Normal · antrean {data.webhook?.pending ?? 0}</Badge>
                )}
              </Row>
              <Row label="Otak rutin (mencatat, tugas)">
                {data.puterConnected ? (
                  <span className="inline-flex items-center gap-2">
                    <code className="text-xs">{data.modelFast}</code> <Badge tone="ok">via Puter</Badge>
                  </span>
                ) : (
                  <Badge tone="warn">Puter belum tersambung</Badge>
                )}
              </Row>
              <Row label="Otak ahli (kalau rumit)">
                <code className="text-xs">{data.modelSmart}</code>
              </Row>
              <Row label="Otak cadangan (gratis)">
                <code className="text-xs">{data.fallbackModel}</code>
              </Row>
              <Row label="Zona waktu">UTC{data.timezone}</Row>
            </Card>
          </section>

          <section className="lg:col-span-2">
            <SectionTitle>Konektor Claude (MCP)</SectionTitle>
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Plug className="size-4" />
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">Hubungkan Second Brain ke Claude</p>
                  <p className="mt-0.5 text-muted">
                    Claude (desktop, web, HP) bisa membaca & menambah tugas, catatan, dan profil kamu. Di claude.ai → Settings → Connectors →
                    Add custom connector, tempel URL ini, lalu setujui di halaman izin.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">{`${window.location.origin}/mcp`}</code>
                    <Button
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/mcp`).then(() => toast.ok("URL disalin"))}
                    >
                      <Copy className="size-3.5" /> Salin
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <section className="lg:col-span-2">
            <SectionTitle>Google (Gmail & Drive)</SectionTitle>
            <Card className="p-4">
              {!g.data ? (
                <Spinner />
              ) : !g.data.configured ? (
                <div className="text-sm">
                  <p className="font-medium">Belum dikonfigurasi</p>
                  <p className="mt-1 text-muted">
                    Buat OAuth client di Google Cloud, lalu simpan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan ENCRYPTION_KEY sebagai secret
                    Worker. Panduannya ada di README bagian "Gmail & Google Drive".
                  </p>
                </div>
              ) : g.data.email ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-ok-soft text-ok">
                      <Mail className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{g.data.email}</p>
                      <p className="text-xs text-muted">
                        Terhubung {g.data.connectedAt ? fmtWhen(g.data.connectedAt) : ""} · baca email, buat draf, baca Drive, simpan ke folder
                        "Second Brain"
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === "gdis"}
                    onClick={() =>
                      confirm("Putuskan Gmail & Drive? Asisten tidak bisa lagi membaca email/file.") &&
                      run("gdis", () => api("/google/disconnect", { method: "POST" }).then(g.reload), "Google diputuskan")
                    }
                  >
                    <Unplug className="size-3.5" /> Putuskan
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">Belum terhubung</p>
                    <p className="mt-0.5 text-muted">
                      Asisten akan bisa membaca email & membuat draf balasan (tidak pernah mengirim), serta mencari & membaca file Drive.
                    </p>
                  </div>
                  <a
                    href="/api/google/connect"
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:opacity-90"
                  >
                    <FolderOpen className="size-4" /> Hubungkan Google
                  </a>
                </div>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Tindakan</SectionTitle>
            <Card className="divide-y divide-line">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm">Kirim briefing sekarang</p>
                  <p className="text-xs text-muted">Dikirim ke Telegram, sama seperti jadwal otomatis.</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={busy === "morning"}
                    onClick={() => run("morning", () => api("/briefing", { body: { kind: "morning" } }), "Briefing pagi terkirim")}
                  >
                    <Sun className="size-3.5" /> Pagi
                  </Button>
                  <Button
                    size="sm"
                    loading={busy === "evening"}
                    onClick={() => run("evening", () => api("/briefing", { body: { kind: "evening" } }), "Rekap malam terkirim")}
                  >
                    <Moon className="size-3.5" /> Malam
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm">Lupakan riwayat obrolan</p>
                  <p className="text-xs text-muted">Tugas & catatan tetap aman.</p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === "reset"}
                  onClick={() =>
                    confirm("Hapus seluruh riwayat obrolan?") &&
                    run("reset", () => api("/history/clear", { method: "POST" }), "Riwayat obrolan dihapus")
                  }
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm">Keluar dari website ini</p>
                <Button size="sm" onClick={onLogout}>
                  <LogOut className="size-3.5" /> Keluar
                </Button>
              </div>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
