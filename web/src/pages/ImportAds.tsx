import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { Button, Card } from "../components/ui";

// Penerima hasil scan dari bookmarklet / Claude: data iklan dibawa di #fragment URL (tidak pernah
// terkirim ke server sebagai URL), lalu disimpan lewat API. #k=<kunci> dipakai kalau tidak login.

async function decode(d: string): Promise<{ query?: string; country?: string; ads: unknown[] }> {
  const [kind, b64] = [d.slice(0, 2), d.slice(3)];
  const bytes = Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const text =
    kind === "gz"
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

export function ImportAds() {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; message: string; detail?: string }>({
    status: "loading",
    message: "Membaca hasil scan…",
  });

  useEffect(() => {
    (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const d = hash.get("d");
      const key = hash.get("k");
      // Bersihkan URL supaya data & kunci tidak tertinggal di riwayat.
      window.history.replaceState(null, "", "/impor-iklan");
      if (!d) throw new Error("Tidak ada data scan. Jalankan dari halaman hasil pencarian Ad Library.");
      const scan = await decode(d);
      if (!Array.isArray(scan.ads) || !scan.ads.length) throw new Error("Tidak ada iklan yang terbaca di halaman itu.");
      setState({ status: "loading", message: `Menyimpan ${scan.ads.length} iklan${scan.query ? ` untuk "${scan.query}"` : ""}…` });
      const body = { source: key ? "claude" : "browser", ...scan };
      const res = key
        ? await fetch("/api/competitors/ingest", {
            method: "POST",
            headers: { "content-type": "application/json", "x-ingest-key": key },
            body: JSON.stringify(body),
          }).then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? `Gagal (${r.status})`);
            return j;
          })
        : await api<{ found: number; added: number; updated: number }>("/competitors/import", { body });
      setState({
        status: "ok",
        message: `Tersimpan: ${res.added} iklan baru, ${res.updated} diperbarui.`,
        detail: "Gambar/video disalin dan iklan dinilai otomatis dalam beberapa menit.",
      });
    })().catch((e) => setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 text-center">
        {state.status === "loading" && <Loader2 className="mx-auto size-8 animate-spin text-accent" />}
        {state.status === "ok" && <CheckCircle2 className="mx-auto size-8 text-ok" />}
        {state.status === "error" && <XCircle className="mx-auto size-8 text-danger" />}
        <p className="mt-3 font-medium">{state.message}</p>
        {state.detail && <p className="mt-1 text-sm text-muted">{state.detail}</p>}
        {state.status !== "loading" && (
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => window.history.back()}>Kembali ke Ad Library</Button>
            <Button variant="primary" onClick={() => (window.location.href = "/kompetitor")}>
              Buka Riset Kompetitor
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
