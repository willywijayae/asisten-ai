import { useState } from "react";
import { Check, Copy, KeyRound, Plug, RefreshCw, Trash2, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { fmtWhen } from "../lib/time";
import { Badge, Button, Card, SectionTitle, Spinner } from "./ui";
import { useToast } from "./app-context";

interface Field { key: string; label: string; group: string; secret: boolean; hint: string; placeholder?: string; set: boolean; source: "web" | "worker" | null; preview: string | null }
interface Mcp { id: string; name: string; url: string; has_token: boolean; token_preview: string | null; added_at: string }
interface Cfg { canStore: boolean; fields: Field[]; meta: { configured: boolean; last_sync: Record<string, any> | null }; mcp: Mcp[] }

const GROUPS: { id: string; title: string; desc: string }[] = [
  { id: "meta", title: "Meta Ads", desc: "Sinkronisasi iklan sendiri (spend, CTR, frekuensi, CPA, ROAS) ke Intelijen Kreatif. Hanya baca." },
  { id: "ai", title: "API AI", desc: "Kunci layanan AI opsional. Kosong = fitur terkait memakai mode prompt/tim AI sendiri." },
  { id: "akses", title: "Akses skrip luar", desc: "Kunci untuk mengirim data ke asisten dari skrip/jadwal di luar (header x-ingest-key)." },
];

export function ConfigPanel() {
  const { data, reload } = useLoad(() => api<Cfg>("/settings/config"), []);
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [mcpForm, setMcpForm] = useState({ name: "", url: "", token: "" });
  const [mcpTest, setMcpTest] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [metaMsg, setMetaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  if (!data) return <section className="lg:col-span-2"><SectionTitle>Kunci & Token</SectionTitle><Spinner /></section>;

  const dirty = (keys: string[]) => keys.filter((k) => (draft[k] ?? "").trim());
  const save = (group: string) => act(`save-${group}`, async () => {
    const keys = dirty(data.fields.filter((f) => f.group === group).map((f) => f.key));
    if (!keys.length) return toast.ok("Tidak ada perubahan");
    await api("/settings/config", { body: { values: Object.fromEntries(keys.map((k) => [k, draft[k]])) } });
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
    toast.ok("Tersimpan (terenkripsi)");
    reload();
  });
  const clear = (key: string) => act(`clear-${key}`, async () => {
    if (!window.confirm("Hapus nilai tersimpan dari web? Kalau ada secret Worker dengan nama sama, itu yang dipakai lagi.")) return;
    await api("/settings/config", { body: { values: { [key]: null } } });
    toast.ok("Dihapus");
    reload();
  });

  return (
    <>
      <section className="lg:col-span-2">
        <SectionTitle>Kunci, Token & API</SectionTitle>
        {!data.canStore && (
          <Card className="mb-3 border-warn p-4 text-sm">
            <p className="font-medium">Penyimpanan terenkripsi belum aktif</p>
            <p className="mt-1 text-muted">Set secret Worker <code>ENCRYPTION_KEY</code> sekali saja (nilai acak panjang), lalu form di bawah bisa dipakai. Tanpa itu, kunci tidak disimpan.</p>
          </Card>
        )}
        <p className="mb-3 text-xs text-muted">
          Nilai dienkripsi (AES-GCM) di database dan <b>tidak pernah dikirim balik ke browser</b>, hanya status dan 4 karakter terakhir. Kolom kosong = tidak diubah. Token bot Telegram & kunci Hermes sengaja tidak bisa diubah dari sini.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map((g) => {
            const fields = data.fields.filter((f) => f.group === g.id);
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 text-accent"><KeyRound className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{g.title}</p>
                    <p className="text-xs text-muted">{g.desc}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  {fields.map((f) => (
                    <div key={f.key}>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <label className="text-xs font-medium" htmlFor={f.key}>{f.label}</label>
                        {f.set ? <Badge tone="ok"><Check className="size-3" /> {f.source === "web" ? "tersimpan" : "dari secret Worker"} {f.preview}</Badge> : <Badge tone="neutral">belum diisi</Badge>}
                        {f.source === "web" && <button className="text-[11px] text-danger hover:underline" onClick={() => clear(f.key)}>hapus</button>}
                      </div>
                      <input
                        id={f.key}
                        className="input"
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={f.set ? "Isi untuk mengganti" : f.placeholder ?? "Tempel di sini"}
                        value={draft[f.key] ?? ""}
                        disabled={!data.canStore}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      />
                      <p className="mt-0.5 text-[11px] text-muted">{f.hint}</p>
                      {f.key === "INGEST_KEY" && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Button size="sm" disabled={!data.canStore} loading={busy === "gen"} onClick={() => act("gen", async () => {
                            if (data.fields.find((x) => x.key === "INGEST_KEY")?.set && !window.confirm("Ganti ingest key? Skrip lama yang memakai kunci lama akan berhenti jalan.")) return;
                            const r = await api<{ key: string }>("/settings/generate-ingest-key", { body: {} });
                            setNewKey(r.key);
                            reload();
                          })}><RefreshCw className="size-3.5" /> Buat kunci acak</Button>
                        </div>
                      )}
                      {f.key === "INGEST_KEY" && newKey && (
                        <div className="mt-2 rounded-md border border-line bg-surface-2 p-2 text-xs">
                          <p className="mb-1 text-muted">Salin sekarang. Setelah ditutup tidak bisa dilihat lagi.</p>
                          <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 break-all">{newKey}</code>
                            <Button size="sm" onClick={() => navigator.clipboard.writeText(newKey).then(() => toast.ok("Disalin"))}><Copy className="size-3.5" /></Button>
                            <Button size="sm" onClick={() => setNewKey(null)}>Tutup</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" disabled={!data.canStore || !dirty(fields.map((f) => f.key)).length} loading={busy === `save-${g.id}`} onClick={() => save(g.id)}>Simpan</Button>
                  {g.id === "meta" && (
                    <>
                      <Button size="sm" loading={busy === "meta-test"} onClick={() => act("meta-test", async () => {
                        const r = await api<{ ok: boolean; name?: string; currency?: string; status?: string; message?: string }>("/settings/meta/test", { body: {} });
                        setMetaMsg({ ok: r.ok, text: r.ok ? `Terhubung: ${r.name} · ${r.currency} · akun ${r.status}` : r.message ?? "Gagal" });
                      })}><Zap className="size-3.5" /> Tes koneksi</Button>
                      <Button size="sm" loading={busy === "meta-sync"} disabled={!data.meta.configured} onClick={() => act("meta-sync", async () => {
                        const r = await api<{ fetched: number; added: number; updated: number }>("/settings/meta/sync", { body: {} });
                        toast.ok(`Sinkron: ${r.fetched} iklan (${r.added} baru, ${r.updated} diperbarui)`);
                        reload();
                      })}><RefreshCw className="size-3.5" /> Sinkron sekarang</Button>
                    </>
                  )}
                </div>
                {g.id === "meta" && metaMsg && <p className={`mt-2 text-xs ${metaMsg.ok ? "text-ok" : "text-danger"}`}>{metaMsg.text}</p>}
                {g.id === "meta" && data.meta.last_sync && (
                  <p className="mt-2 text-xs text-muted">
                    Sinkron terakhir {fmtWhen(String(data.meta.last_sync.at))}:{" "}
                    {data.meta.last_sync.ok ? `${data.meta.last_sync.fetched} iklan` : <span className="text-danger">gagal — {String(data.meta.last_sync.message)}</span>}
                    {data.meta.configured && " · otomatis tiap pagi"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="lg:col-span-2">
        <SectionTitle>Konektor MCP (Meta Ads, dll.)</SectionTitle>
        <Card className="p-4">
          <p className="text-xs text-muted">
            Simpan alamat server MCP dan token-nya di sini (terenkripsi), tidak perlu ditempel di chat. Tombol <b>Tes</b> mengirim <code>initialize</code> ke server. Catatan: daftar ini belum dipakai agen otomatis; ia menjadi tempat satu-satunya menyimpan dan menguji kredensial.
          </p>
          {data.mcp.length > 0 && (
            <div className="mt-3 divide-y divide-line rounded-lg border border-line">
              {data.mcp.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Plug className="size-4 text-accent" />
                  <span className="font-medium">{c.name}</span>
                  <code className="min-w-0 flex-1 truncate text-xs text-muted">{c.url}</code>
                  {c.has_token ? <Badge tone="ok">token {c.token_preview}</Badge> : <Badge tone="neutral">tanpa token</Badge>}
                  {mcpTest[c.id] && <Badge tone={mcpTest[c.id].ok ? "ok" : "warn"}>{mcpTest[c.id].detail}</Badge>}
                  <Button size="sm" loading={busy === `t-${c.id}`} onClick={() => act(`t-${c.id}`, async () => {
                    const r = await api<{ ok: boolean; detail: string }>(`/settings/mcp/${c.id}/test`, { body: {} });
                    setMcpTest((m) => ({ ...m, [c.id]: r }));
                  })}>Tes</Button>
                  <Button size="sm" onClick={() => act(`d-${c.id}`, async () => {
                    if (!window.confirm(`Hapus konektor ${c.name}?`)) return;
                    await api(`/settings/mcp/${c.id}`, { method: "DELETE" });
                    reload();
                  })}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              act("mcp-add", async () => {
                await api("/settings/mcp", { body: mcpForm });
                setMcpForm({ name: "", url: "", token: "" });
                toast.ok("Konektor disimpan");
                reload();
              });
            }}
          >
            <input className="input" placeholder="Nama (mis. Meta Ads)" value={mcpForm.name} disabled={!data.canStore} onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })} />
            <input className="input" placeholder="https://…/mcp" value={mcpForm.url} disabled={!data.canStore} onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })} />
            <input className="input" type="password" autoComplete="off" placeholder="Token (opsional)" value={mcpForm.token} disabled={!data.canStore} onChange={(e) => setMcpForm({ ...mcpForm, token: e.target.value })} />
            <Button variant="primary" type="submit" disabled={!data.canStore || !mcpForm.name || !mcpForm.url} loading={busy === "mcp-add"}>Tambah</Button>
          </form>
        </Card>
      </section>
    </>
  );
}
