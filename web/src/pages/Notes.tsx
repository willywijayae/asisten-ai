import { useEffect, useState } from "react";
import { Brain, Plus, Search, X } from "lucide-react";
import { api, type Note } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { NoteCard, NoteModal } from "../components/notes";

export function Notes() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Note | null | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const notes = useLoad(
    () => api<{ notes: Note[] }>(`/notes?${new URLSearchParams({ q: debouncedQ, ...(tag ? { tag } : {}) })}`),
    [debouncedQ, tag],
  );
  const tags = useLoad(() => api<{ tags: { tag: string; count: number }[] }>("/notes/tags"), []);

  const refresh = () => {
    notes.reload();
    tags.reload();
  };

  return (
    <>
      <PageHeader
        title="Second Brain"
        subtitle="Semua yang kamu minta asisten ingat: info, ide, hasil meeting, riset."
        action={
          <Button variant="primary" onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Catatan baru
          </Button>
        }
      />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Cari di Second Brain…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!!tags.data?.tags.length && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {tags.data.tags.map((t) => (
            <button
              key={t.tag}
              onClick={() => setTag(tag === t.tag ? null : t.tag)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                tag === t.tag ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"
              }`}
            >
              #{t.tag} <span className="opacity-60">{t.count}</span>
              {tag === t.tag && <X className="size-3" />}
            </button>
          ))}
        </div>
      )}

      {notes.error ? (
        <Empty title="Gagal memuat catatan" hint={notes.error} />
      ) : !notes.data ? (
        <Spinner />
      ) : notes.data.notes.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.data.notes.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={setEditing} onTag={setTag} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty
            icon={<Brain className="size-6" />}
            title={q || tag ? "Tidak ada catatan yang cocok" : "Belum ada catatan"}
            hint='Kirim "catat bahwa …" ke bot Telegram, atau tambah catatan di sini.'
          />
        </Card>
      )}

      {editing !== undefined && <NoteModal note={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />}
    </>
  );
}
