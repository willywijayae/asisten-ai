import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, MessageCircle } from "lucide-react";
import { api, type ChatMessage, type Task } from "../lib/api";
import { fmtWhen } from "../lib/time";
import { Button, Card, Empty, Spinner } from "../components/ui";
import { TaskModal, TaskRow } from "../components/tasks";
import { useToast } from "../components/app-context";

type Item =
  | ChatMessage
  | { id: string; role: "proposals"; tasks: Task[] }
  | { id: string; role: "receipt"; text: string };

const SUGGESTIONS = [
  "Apa aja tugasku minggu ini?",
  "Ringkas catatan yang berhubungan dengan marketing",
  "Ingetin aku follow up klien besok jam 10",
  "Email apa aja yang belum kubalas hari ini?",
  "/profil",
];

export function Chat({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);

  const loadPage = async (before?: number) => {
    const { messages } = await api<{ messages: ChatMessage[] }>(`/history${before ? `?before=${before}` : ""}`);
    setHasMore(messages.length === 50);
    return messages.reverse();
  };

  useEffect(() => {
    // ?kirim=… → langsung kirim pesan itu (dipakai tombol "Mulai wawancara").
    const auto = new URLSearchParams(window.location.search).get("kirim");
    if (auto) window.history.replaceState(null, "", "/chat");
    loadPage()
      .then((m) => {
        setItems(m);
        if (auto) send(auto);
      })
      .catch((e) => {
        toast.error(e);
        setItems([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items?.length, sending]);

  const loadOlder = async () => {
    const first = items?.find((i): i is ChatMessage => typeof i.id === "number");
    if (!first) return;
    const older = await loadPage(first.id);
    setItems((cur) => [...older, ...(cur ?? [])]);
  };

  async function send(text = input) {
    const message = text.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    const now = new Date().toISOString();
    setItems((cur) => [...(cur ?? []), { id: -Date.now(), role: "user", content: message, created_at: now }]);
    try {
      const res = await api<{ reply: string; proposed: Task[]; receipt: string }>("/chat", { body: { message } });
      setItems((cur) => [
        ...(cur ?? []),
        { id: -Date.now() - 1, role: "assistant", content: res.reply, created_at: new Date().toISOString() },
        ...(res.receipt ? [{ id: `r${Date.now()}`, role: "receipt" as const, text: res.receipt }] : []),
        ...(res.proposed.length ? [{ id: `p${Date.now()}`, role: "proposals" as const, tasks: res.proposed }] : []),
      ]);
      onChanged();
    } catch (e) {
      toast.error(e);
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col md:h-[calc(100dvh-4.5rem)]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Chat AI</h1>
        <p className="mt-0.5 text-sm text-muted">Otak yang sama dengan bot Telegram. Riwayatnya juga sama.</p>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {items === null ? (
            <Spinner />
          ) : items.length === 0 ? (
            <Empty icon={<MessageCircle className="size-6" />} title="Belum ada obrolan" hint="Tanya apa saja, atau minta dicatatkan tugas." />
          ) : (
            <>
              {hasMore && (
                <div className="text-center">
                  <Button size="sm" variant="ghost" onClick={loadOlder}>
                    Muat pesan sebelumnya
                  </Button>
                </div>
              )}
              {items.map((m) =>
                m.role === "receipt" ? (
                  <p key={m.id} className="max-w-[85%] whitespace-pre-wrap rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
                    {m.text}
                  </p>
                ) : m.role === "proposals" ? (
                  <div key={m.id} className="max-w-[85%] overflow-hidden rounded-xl border border-line">
                    <p className="border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-muted">Usulan tugas</p>
                    <div className="divide-y divide-line">
                      {m.tasks.map((t) => (
                        <TaskRow key={t.id} task={t} onChanged={onChanged} onEdit={setEditing} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        m.role === "user" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-surface-2 text-fg"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`mt-1 text-[10px] ${m.role === "user" ? "opacity-70" : "text-muted"}`}>{fmtWhen(m.created_at)}</p>
                    </div>
                  </div>
                ),
              )}
            </>
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Asisten sedang berpikir…
            </div>
          )}
          <div ref={bottom} />
        </div>

        {items?.length === 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Tulis pesan…"
            className="input max-h-40 min-h-10 resize-none"
          />
          <Button type="submit" variant="primary" className="size-11 !px-0" disabled={!input.trim() || sending} aria-label="Kirim">
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </Card>

      {editing && <TaskModal task={editing} onClose={() => setEditing(undefined)} onSaved={onChanged} />}
    </div>
  );
}
