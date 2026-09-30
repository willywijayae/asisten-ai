import { useState, type ReactNode } from "react";
import { LogOut, Moon, RotateCcw, Sun } from "lucide-react";
import { api, type SystemInfo } from "../lib/api";
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
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

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
              <Row label="Otak utama">
                {data.puterConnected ? (
                  <span className="inline-flex items-center gap-2">
                    {data.model} <Badge tone="ok">via Puter</Badge>
                  </span>
                ) : (
                  <Badge tone="warn">Puter belum tersambung</Badge>
                )}
              </Row>
              <Row label="Otak cadangan (gratis)">
                <code className="text-xs">{data.fallbackModel}</code>
              </Row>
              <Row label="Zona waktu">UTC{data.timezone}</Row>
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
