import { useState } from "react";
import { Check, Copy, ExternalLink, Megaphone, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, PageHeader, SectionTitle } from "../components/ui";

// Konektor MCP hosted (Ryze AI): https://github.com/irinabuht12-oss/google-ads-meta-ads-mcp
// Login OAuth dilakukan di sisi klien MCP (Claude), jadi halaman ini berupa panduan + peluncur, bukan dashboard data.
const ENDPOINT = "https://connector.get-ryze.ai/mcp";
const CLI = `claude mcp add ryze --transport http ${ENDPOINT}`;
const REPO = "https://github.com/irinabuht12-oss/google-ads-meta-ads-mcp";

interface Platform {
  id: "google" | "meta";
  name: string;
  login: string;
  guide: string;
  tools: [string, string][];
  prompts: string[];
}

const PLATFORMS: Platform[] = [
  {
    id: "google",
    name: "Google Ads",
    login: "Masuk dengan akun Google pemilik iklan, lalu pilih Connect Google Ads. Akun MCC ikut terdeteksi.",
    guide: `${REPO}/blob/main/google-ads-mcp/README.md`,
    tools: [
      ["google_ads__listAccessibleCustomers", "Daftar akun Google Ads yang bisa diakses"],
      ["google_ads__getAccountSummary", "Spend, konversi, CPA, ROAS per periode"],
      ["google_ads__runRawGaql", "Query GAQL: kampanye, keyword, search terms"],
      ["google_ads__generateKeywordIdeas", "Ide keyword + volume, kompetisi, CPC"],
      ["google_ads__listRecommendations", "Rekomendasi dari Google"],
      ["google_ads__runRawMutate", "Ubah budget/bid/jeda iklan (butuh persetujuan)"],
    ],
    prompts: [
      "Search terms mana yang spend di atas Rp500 ribu tanpa konversi dalam 30 hari terakhir? Buat daftar negative keyword.",
      "Kenapa CPA naik minggu ini? Pecah per kampanye dan ad group.",
      "Tampilkan kampanye yang terbatas budget dan impression share yang hilang.",
    ],
  },
  {
    id: "meta",
    name: "Meta Ads",
    login: "Masuk dengan akun Facebook yang punya akses di Business Manager, lalu pilih Connect Meta Ads (izin ads_read, ads_management).",
    guide: `${REPO}/blob/main/meta-ads-mcp/README.md`,
    tools: [
      ["meta_ads__listAdAccounts", "Daftar ad account yang bisa diakses"],
      ["meta_ads__getAccountSummary", "Spend, hasil, CPA, ROAS, frekuensi"],
      ["meta_ads__runRawInsights", "Query Insights: level, breakdown, atribusi"],
      ["meta_ads__listCreatives", "Kreatif beserta copy dan media"],
      ["meta_ads__searchAdLibrary", "Riset kompetitor di Meta Ad Library"],
      ["meta_ads__runGraphWrite", "Jeda iklan, ubah budget (butuh persetujuan)"],
    ],
    prompts: [
      "Iklan mana yang frekuensinya di atas 3 dan CTR turun lebih dari 20% dari puncaknya minggu ini?",
      "Ambil spend, pembelian, dan ROAS per kampanye, atribusi 7 hari klik, 30 hari terakhir.",
      "Cari semua iklan aktif kompetitor di Ad Library dan kelompokkan hook-nya.",
    ],
  },
];

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label ?? (done ? "Tersalin" : "Salin")}
    </Button>
  );
}

export function PaidAds() {
  const [tab, setTab] = useState<Platform["id"]>("google");
  const p = PLATFORMS.find((x) => x.id === tab)!;

  return (
    <div>
      <PageHeader title="Paid Ads" subtitle="Google Ads & Meta Ads lewat konektor MCP (Claude)" />

      <div className="mb-5 flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
        {PLATFORMS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`h-9 rounded-md px-4 text-sm font-medium transition max-md:h-10 ${
              tab === x.id ? "border border-accent/30 text-accent" : "text-muted hover:text-fg"
            }`}
          >
            {x.name}
          </button>
        ))}
      </div>

      <Card className="mb-5 p-4">
        <SectionTitle action={<Badge tone="accent"><Megaphone className="size-3" /> {p.name}</Badge>}>Hubungkan</SectionTitle>
        <ol className="space-y-3 text-sm">
          <li>
            <p className="mb-1.5 text-muted">1. Claude Code — jalankan di terminal:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{CLI}</code>
              <CopyBtn text={CLI} />
            </div>
          </li>
          <li>
            <p className="mb-1.5 text-muted">
              2. claude.ai / Claude Desktop — Settings › Connectors › Add custom connector, nama <b>Ryze</b>, URL:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{ENDPOINT}</code>
              <CopyBtn text={ENDPOINT} />
            </div>
          </li>
          <li className="text-muted">3. {p.login}</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={p.guide} target="_blank" rel="noreferrer">
            <Button size="sm"><ExternalLink className="size-3.5" /> Panduan {p.name}</Button>
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost"><ExternalLink className="size-3.5" /> Repo</Button>
          </a>
        </div>
      </Card>

      <Card className="mb-5 p-4">
        <SectionTitle>Tool {p.name}</SectionTitle>
        <ul className="divide-y divide-line">
          {p.tools.map(([name, desc]) => (
            <li key={name} className="flex flex-col gap-0.5 py-2 md:flex-row md:items-center md:gap-3">
              <code className="shrink-0 text-xs text-accent">{name}</code>
              <span className="text-sm text-muted">{desc}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-5 p-4">
        <SectionTitle>Contoh prompt</SectionTitle>
        <ul className="space-y-2">
          {p.prompts.map((t) => (
            <li key={t} className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-sm">
              <span className="flex-1">{t}</span>
              <CopyBtn text={t} label="" />
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          Konektor ini dijalankan pihak ketiga (Ryze AI): login dan akses akun iklan lewat server mereka, bukan Worker ini.
          Pembacaan data langsung jalan; perubahan (budget, jeda, kampanye baru) menunggu persetujuan di chat.
        </p>
      </div>
    </div>
  );
}
