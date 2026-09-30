import { useEffect, useState } from "react";
import { CheckSquare, Plus, Search } from "lucide-react";
import { api, type Task } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { TaskModal, TaskRow } from "../components/tasks";

const TABS = [
  { key: "open", label: "Aktif" },
  { key: "pending", label: "Perlu approval" },
  { key: "done", label: "Selesai" },
  { key: "cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
] as const;

const RANGES = [
  { key: "any", label: "Semua waktu" },
  { key: "today", label: "Hari ini" },
  { key: "tomorrow", label: "Besok" },
  { key: "week", label: "7 hari ke depan" },
  { key: "overdue", label: "Terlewat" },
] as const;

export function Tasks({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<(typeof TABS)[number]["key"]>("open");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("any");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, loading, reload } = useLoad(
    () =>
      api<{ tasks: Task[] }>(
        `/tasks?${new URLSearchParams({ status, range, ...(debouncedQ ? { q: debouncedQ } : {}) })}`,
      ),
    [status, range, debouncedQ],
  );

  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <>
      <PageHeader
        title="Tugas"
        subtitle="Semua komitmen yang dicatat asisten, dari Telegram maupun website."
        action={
          <Button variant="primary" onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Tugas baru
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                status === t.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={range} onChange={(e) => setRange(e.target.value as typeof range)} aria-label="Rentang waktu">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Cari tugas, orang, catatan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card className="divide-y divide-line overflow-hidden">
        {error ? (
          <Empty title="Gagal memuat tugas" hint={error} />
        ) : !data && loading ? (
          <Spinner />
        ) : data?.tasks.length ? (
          data.tasks.map((t) => <TaskRow key={t.id} task={t} onChanged={refresh} onEdit={setEditing} />)
        ) : (
          <Empty icon={<CheckSquare className="size-6" />} title="Tidak ada tugas di sini" hint="Coba ubah filter, atau tambah tugas baru." />
        )}
      </Card>
      {data && data.tasks.length > 0 && <p className="mt-2 text-xs text-muted">{data.tasks.length} tugas</p>}

      {editing !== undefined && <TaskModal task={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />}
    </>
  );
}
