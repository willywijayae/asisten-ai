import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, type Note } from "../lib/api";
import { fmtDate } from "../lib/time";
import { Badge, Button, Field, Modal } from "./ui";
import { useToast } from "./app-context";

export function NoteCard({ note, onOpen, onTag }: { note: Note; onOpen: (n: Note) => void; onTag?: (t: string) => void }) {
  const tags = note.tags?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(note)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(note)}
      className="flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-4 text-left transition hover:border-accent/50 hover:shadow-sm"
    >
      {note.title && <p className="mb-1 text-sm font-semibold">{note.title}</p>}
      <p className="line-clamp-5 whitespace-pre-wrap text-sm text-fg/85">{note.content}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {tags.map((t) => (
          <button
            key={t}
            onClick={(e) => {
              e.stopPropagation();
              onTag?.(t);
            }}
          >
            <Badge tone="accent">#{t}</Badge>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted">{fmtDate(note.updated_at ?? note.created_at)}</span>
      </div>
    </div>
  );
}

export function NoteModal({
  note,
  initialContent = "",
  onClose,
  onSaved,
}: {
  note: Note | null;
  initialContent?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: note?.title ?? "",
    content: note?.content ?? initialContent,
    tags: note?.tags ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.content.trim()) return toast.error("Isi catatan wajib diisi");
    setSaving(true);
    try {
      if (note) await api(`/notes/${note.id}`, { method: "PATCH", body: form });
      else await api("/notes", { method: "POST", body: form });
      toast.ok(note ? "Catatan diperbarui" : "Catatan disimpan");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note || !confirm("Hapus catatan ini?")) return;
    try {
      await api(`/notes/${note.id}`, { method: "DELETE" });
      toast.ok("Catatan dihapus");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal
      title={note ? "Ubah catatan" : "Catatan baru"}
      onClose={onClose}
      footer={
        <>
          {note && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              <Trash2 className="size-4" /> Hapus
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Judul (opsional)">
          <input className="input" value={form.title} onChange={set("title")} placeholder="mis. Harga kompetitor Q4" />
        </Field>
        <Field label="Isi">
          <textarea className="input min-h-48" autoFocus={!note} value={form.content} onChange={set("content")} />
        </Field>
        <Field label="Tag" hint="Pisahkan dengan koma, mis. marketing, riset, klien">
          <input className="input" value={form.tags} onChange={set("tags")} />
        </Field>
      </div>
    </Modal>
  );
}
