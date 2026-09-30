import { useState } from "react";
import { AlertTriangle, Brain, CalendarCheck, CheckCircle2, Hourglass, Plus, Sparkles } from "lucide-react";
import { api, type Summary, type Task } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { greeting, todayLabel } from "../lib/time";
import { Button, Card, Empty, SectionTitle, Spinner } from "../components/ui";
import { TaskModal, TaskRow } from "../components/tasks";
import { NoteCard, NoteModal } from "../components/notes";
import { Link } from "../components/Layout";
import { useToast } from "../components/app-context";

export function Dashboard({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api<Summary>("/summary"), []);
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);
  const [noteOpen, setNoteOpen] = useState<null | { id?: number; content?: string }>(null);
  const [capture, setCapture] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const toast = useToast();

  const refresh = () => {
    reload();
    onChanged();
  };

  const captureAsTask = async () => {
    if (!capture.trim()) return;
    setCaptureBusy(true);
    try {
      await api("/tasks", { method: "POST", body: { title: capture.trim() } });
      toast.ok("Tugas ditambahkan");
      setCapture("");
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setCaptureBusy(false);
    }
  };

  const captureAsNote = async () => {
    if (!capture.trim()) return;
    setCaptureBusy(true);
    try {
      await api("/notes", { method: "POST", body: { content: capture.trim() } });
      toast.ok("Tersimpan di Second Brain");
      setCapture("");
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setCaptureBusy(false);
    }
  };

  if (error) return <Empty title="Gagal memuat dashboard" hint={error} />;
  if (!data) return <Spinner />;

  const stats = [
    { label: "Hari ini", value: data.counts.today, icon: CalendarCheck, tone: "text-accent" },
    { label: "Terlewat", value: data.counts.overdue, icon: AlertTriangle, tone: data.counts.overdue ? "text-danger" : "text-muted" },
    { label: "Perlu approval", value: data.counts.pending, icon: Hourglass, tone: data.counts.pending ? "text-warn" : "text-muted" },
    { label: "Selesai 7 hari", value: data.counts.doneWeek, icon: CheckCircle2, tone: "text-ok" },
    { label: "Catatan", value: data.counts.notes, icon: Brain, tone: "text-accent" },
  ];

  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-muted">{todayLabel()}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}, Willy 👋</h1>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">{s.label}</p>
              <s.icon className={`size-4 ${s.tone}`} />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-6 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" /> Tangkap cepat
        </div>
        <textarea
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          placeholder="Ide, info penting, atau hal yang harus dikerjakan…"
          className="input min-h-16 resize-y"
        />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={captureAsNote} disabled={!capture.trim() || captureBusy}>
            <Brain className="size-3.5" /> Simpan sebagai catatan
          </Button>
          <Button size="sm" variant="primary" onClick={captureAsTask} disabled={!capture.trim() || captureBusy}>
            <Plus className="size-3.5" /> Jadikan tugas
          </Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {data.pending.length > 0 && (
            <section>
              <SectionTitle>Menunggu approval</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {data.pending.map((t) => (
                  <TaskRow key={t.id} task={t} onChanged={refresh} onEdit={setEditing} />
                ))}
              </Card>
            </section>
          )}

          {data.overdue.length > 0 && (
            <section>
              <SectionTitle>Terlewat</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {data.overdue.map((t) => (
                  <TaskRow key={t.id} task={t} onChanged={refresh} onEdit={setEditing} />
                ))}
              </Card>
            </section>
          )}

          <section>
            <SectionTitle
              action={
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  <Plus className="size-3.5" /> Tambah
                </Button>
              }
            >
              Agenda hari ini
            </SectionTitle>
            <Card className="divide-y divide-line overflow-hidden">
              {data.today.length ? (
                data.today.map((t) => <TaskRow key={t.id} task={t} onChanged={refresh} onEdit={setEditing} />)
              ) : (
                <Empty title="Tidak ada agenda lagi hari ini" hint="Tambah tugas di sini atau lewat chat Telegram." />
              )}
            </Card>
          </section>
        </div>

        <section>
          <SectionTitle
            action={
              <Link to="/catatan" className="text-xs text-muted hover:text-fg">
                Lihat semua →
              </Link>
            }
          >
            Catatan terbaru
          </SectionTitle>
          {data.recentNotes.length ? (
            <div className="grid gap-3">
              {data.recentNotes.map((n) => (
                <NoteCard key={n.id} note={n} onOpen={() => setNoteOpen({ id: n.id })} />
              ))}
            </div>
          ) : (
            <Card>
              <Empty icon={<Brain className="size-6" />} title="Second Brain masih kosong" hint='Kirim "catat bahwa …" ke bot, atau pakai Tangkap cepat di atas.' />
            </Card>
          )}
        </section>
      </div>

      {editing !== undefined && <TaskModal task={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />}
      {noteOpen && (
        <NoteModal
          note={data.recentNotes.find((n) => n.id === noteOpen.id) ?? null}
          onClose={() => setNoteOpen(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
