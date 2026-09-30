import { useState } from "react";
import { Check, Clock, User, Flag, Trash2, X, Bell } from "lucide-react";
import { api, type Task, type TaskInput } from "../lib/api";
import { fmtWhen, isOverdue, toInputValue } from "../lib/time";
import { Badge, Button, Field, Modal } from "./ui";
import { useToast } from "./app-context";

const SOURCE_LABEL: Record<string, string> = {
  chat: "Telegram",
  forward: "Pesan diteruskan",
  voice: "Voice note",
  photo: "Foto",
  web: "Website",
};

export function TaskRow({ task, onChanged, onEdit }: { task: Task; onChanged: () => void; onEdit: (t: Task) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const done = task.status === "done";
  const overdue = task.status === "open" && isOverdue(task.due_at);

  const patch = async (body: TaskInput, msg: string) => {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body });
      toast.ok(msg);
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/60">
      {task.status === "pending" ? (
        <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-dashed border-warn" aria-hidden />
      ) : (
        <button
          disabled={busy}
          onClick={() => patch({ status: done ? "open" : "done" }, done ? "Dibuka lagi" : "Selesai 🎉")}
          aria-label={done ? "Tandai belum selesai" : "Tandai selesai"}
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
            done ? "border-ok bg-ok text-bg" : "border-line hover:border-ok"
          }`}
        >
          {done && <Check className="size-3" strokeWidth={3} />}
        </button>
      )}

      <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(task)}>
        <p className={`text-sm ${done || task.status === "cancelled" ? "text-muted line-through" : "text-fg"}`}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {task.due_at && (
            <span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-danger" : ""}`}>
              <Clock className="size-3" /> {fmtWhen(task.due_at)}
            </span>
          )}
          {task.remind_at && (
            <span className="inline-flex items-center gap-1">
              <Bell className="size-3" /> {fmtWhen(task.remind_at)}
            </span>
          )}
          {task.person && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {task.person}
            </span>
          )}
          {task.priority === "high" && (
            <Badge tone="danger">
              <Flag className="size-3" /> Penting
            </Badge>
          )}
          {task.status === "pending" && <Badge tone="warn">Menunggu approval · {SOURCE_LABEL[task.source] ?? task.source}</Badge>}
        </div>
        {task.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{task.notes}</p>}
      </button>

      {task.status === "pending" && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => patch({ status: "open" }, "Tugas disimpan")}>
            <Check className="size-3.5" /> Simpan
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "cancelled" }, "Usulan dibuang")} aria-label="Buang">
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function TaskModal({ task, onClose, onSaved }: { task: Task | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Required<Omit<TaskInput, "status">>>({
    title: task?.title ?? "",
    notes: task?.notes ?? "",
    person: task?.person ?? "",
    priority: task?.priority ?? "normal",
    due: toInputValue(task?.due_at ?? null),
    remind: toInputValue(task?.remind_at ?? null),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) return toast.error("Judul wajib diisi");
    setSaving(true);
    try {
      if (task) await api(`/tasks/${task.id}`, { method: "PATCH", body: form });
      else await api("/tasks", { method: "POST", body: form });
      toast.ok(task ? "Tugas diperbarui" : "Tugas ditambahkan");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task || !confirm(`Hapus tugas "${task.title}"?`)) return;
    try {
      await api(`/tasks/${task.id}`, { method: "DELETE" });
      toast.ok("Tugas dihapus");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal
      title={task ? "Ubah tugas" : "Tugas baru"}
      onClose={onClose}
      footer={
        <>
          {task && (
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
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Judul">
          <input className="input" autoFocus value={form.title} onChange={set("title")} placeholder="mis. Kirim penawaran ke Budi" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline (WIB)">
            <input type="datetime-local" className="input" value={form.due} onChange={set("due")} />
          </Field>
          <Field label="Ingatkan (WIB)" hint="Kosong = 60 menit sebelum deadline">
            <input type="datetime-local" className="input" value={form.remind} onChange={set("remind")} />
          </Field>
          <Field label="Orang terkait">
            <input className="input" value={form.person} onChange={set("person")} placeholder="Klien, bos, dsb" />
          </Field>
          <Field label="Prioritas">
            <select className="input" value={form.priority} onChange={set("priority")}>
              <option value="low">Rendah</option>
              <option value="normal">Normal</option>
              <option value="high">Penting</option>
            </select>
          </Field>
        </div>
        <Field label="Catatan">
          <textarea className="input min-h-20" value={form.notes} onChange={set("notes")} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
