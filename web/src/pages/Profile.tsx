import { useEffect, useState } from "react";
import { Database, MessageCircle, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtWhen } from "../lib/time";
import { Badge, Button, Card, Empty, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { useRouter, useToast } from "../components/app-context";

interface ProfileData {
  profile: string;
  updatedAt: string | null;
  interviewing: boolean;
  preferences: { id: number; content: string; created_at: string }[];
}

export function Profile() {
  const { data, error, reload } = useLoad(() => api<ProfileData>("/profile"), []);
  const { navigate } = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [pref, setPref] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.profile);
  }, [data?.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api("/profile", { method: "PATCH", body: { profile: draft } });
      toast.ok("Profil disimpan");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const addPref = async () => {
    if (!pref.trim()) return;
    setAdding(true);
    try {
      await api("/preferences", { body: { content: pref } });
      setPref("");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setAdding(false);
    }
  };

  const removePref = async (id: number) => {
    try {
      await api(`/preferences/${id}`, { method: "DELETE" });
      toast.ok("Preferensi dihapus");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  if (error) return <Empty title="Gagal memuat profil" hint={error} />;
  if (!data) return <Spinner />;

  const dirty = draft !== data.profile;

  return (
    <>
      <PageHeader
        title="Profil & Memori"
        subtitle="Yang asisten tahu tentang kamu. Ikut dibaca di setiap percakapan, jadi jawabannya makin sesuai."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle
            action={
              <Button size="sm" onClick={() => navigate("/chat?kirim=%2Fprofil")}>
                <Sparkles className="size-3.5" /> {data.profile ? "Wawancara ulang" : "Mulai wawancara"}
              </Button>
            }
          >
            Profil
          </SectionTitle>
          <Card className="p-4">
            {data.interviewing && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                <span>Wawancara sedang berjalan. Jawab pertanyaannya di Telegram atau Chat AI.</span>
                <Button size="sm" variant="ghost" onClick={() => navigate("/chat")}>
                  <MessageCircle className="size-3.5" /> Buka chat
                </Button>
              </div>
            )}
            {!data.profile && !data.interviewing && (
              <p className="mb-3 text-sm text-muted">
                Belum ada profil. Klik <b>Mulai wawancara</b> (atau ketik <code>/profil</code> ke bot) dan asisten akan menanyakan 5–7 hal
                tentang kamu, atau tulis sendiri di bawah.
              </p>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"Tentang saya: …\nBisnis & peran: …\nTarget & prioritas: …"}
              className="input min-h-80 font-mono text-[13px] leading-relaxed"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{data.updatedAt ? `Diperbarui ${fmtWhen(data.updatedAt)}` : ""}</span>
              <div className="flex gap-2">
                {dirty && (
                  <Button variant="ghost" onClick={() => setDraft(data.profile)}>
                    Batal
                  </Button>
                )}
                <Button variant="primary" loading={saving} disabled={!dirty} onClick={saveProfile}>
                  Simpan profil
                </Button>
              </div>
            </div>
          </Card>
        </section>

        <section className="lg:col-span-2">
          <SectionTitle>Preferensi</SectionTitle>
          <Card className="overflow-hidden">
            <p className="border-b border-line px-4 py-3 text-xs text-muted">
              Aturan permanen yang selalu diikuti asisten. Otomatis bertambah saat kamu mengoreksinya, misalnya "jangan panggil aku bro".
            </p>
            {data.preferences.length ? (
              <ul className="divide-y divide-line">
                {data.preferences.map((p) => (
                  <li key={p.id} className="group flex items-start gap-3 px-4 py-3">
                    <Badge tone="accent">{p.id}</Badge>
                    <span className="flex-1 text-sm">{p.content}</span>
                    <button
                      onClick={() => removePref(p.id)}
                      className="text-muted opacity-60 transition hover:text-danger group-hover:opacity-100"
                      aria-label="Hapus preferensi"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Belum ada preferensi" hint="Koreksi asisten saat chat, atau tambahkan di bawah." />
            )}
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                addPref();
              }}
            >
              <input className="input" value={pref} onChange={(e) => setPref(e.target.value)} placeholder="mis. Jawab pakai bahasa santai" />
              <Button type="submit" variant="primary" loading={adding} disabled={!pref.trim()} aria-label="Tambah">
                <Plus className="size-4" />
              </Button>
            </form>
          </Card>
        </section>
      </div>

      <MemorySection />
    </>
  );
}

interface Memory {
  id: number;
  content: string;
  entities: string | null;
  source: string;
  created_at: string;
}

const SOURCE: Record<string, string> = {
  chat: "Telegram",
  voice: "Voice note",
  photo: "Foto",
  forward: "Pesan terusan",
  web: "Website",
  claude: "Claude",
  manual: "Manual",
};

/** Fakta yang diingat otomatis dari obrolan (ala mem0): bisa dicari, ditambah, dan dihapus. */
function MemorySection() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useLoad(
    () => api<{ memories: Memory[]; total: number }>(`/memories${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    [query],
  );
  const [fact, setFact] = useState("");
  const [adding, setAdding] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const add = async () => {
    if (!fact.trim()) return;
    setAdding(true);
    try {
      await api("/memories", { body: { content: fact } });
      setFact("");
      toast.ok("Diingat");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (m: Memory) => {
    try {
      await api(`/memories/${m.id}`, { method: "DELETE" });
      toast.ok("Dilupakan");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const r = await api<{ notes: number; memories: number }>("/memories/reindex", { body: {} });
      toast.ok(`Indeks diperbarui: ${r.notes} catatan, ${r.memories} memori`);
    } catch (e) {
      toast.error(e);
    } finally {
      setReindexing(false);
    }
  };

  return (
    <section className="mt-8">
      <SectionTitle
        action={
          <Button size="sm" variant="ghost" loading={reindexing} onClick={reindex} title="Bangun ulang indeks pencarian makna">
            {!reindexing && <RefreshCw className="size-3.5" />} Indeks ulang
          </Button>
        }
      >
        Memori jangka panjang {data ? <span className="font-normal text-muted">· {data.total} fakta</span> : null}
      </SectionTitle>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-xs text-muted">
            Setelah tiap obrolan, asisten otomatis mengingat fakta penting (tim, klien, rencana, angka). Fakta yang relevan ikut dibaca saat
            menjawab. Hapus yang salah atau tidak perlu.
          </p>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari berdasarkan makna…" />
          </div>
        </div>

        {error ? (
          <Empty title="Gagal memuat memori" hint={error} />
        ) : !data ? (
          <Spinner />
        ) : data.memories.length ? (
          <ul className={`divide-y divide-line ${loading ? "opacity-60" : ""}`}>
            {data.memories.map((m) => (
              <li key={m.id} className="group flex items-start gap-3 px-4 py-3">
                <Database className="mt-0.5 size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{m.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span>{fmtWhen(m.created_at)}</span>
                    <span>·</span>
                    <span>{SOURCE[m.source] ?? m.source}</span>
                    {m.entities?.split(", ").map((e) => (
                      <Badge key={e}>{e}</Badge>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => remove(m)}
                  className="text-muted opacity-60 transition hover:text-danger group-hover:opacity-100"
                  aria-label="Lupakan fakta ini"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title={query ? "Tidak ada memori yang cocok" : "Belum ada memori"}
            hint={query ? undefined : "Ngobrol saja seperti biasa di Telegram atau Chat AI, fakta penting akan terkumpul di sini."}
          />
        )}

        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="input"
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            placeholder="Tambah fakta, mis. Justin cuti sampai 10 Oktober 2026"
          />
          <Button type="submit" variant="primary" loading={adding} disabled={!fact.trim()} aria-label="Tambah fakta">
            <Plus className="size-4" />
          </Button>
        </form>
      </Card>
    </section>
  );
}
