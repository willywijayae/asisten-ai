import { useEffect, useState, type ReactNode } from "react";
import { Box, Brain, BarChart3, CheckSquare, Clapperboard, Lightbulb, Megaphone, Radar, LayoutDashboard, Menu, MessageCircle, Settings, UserRound, X, type LucideIcon } from "lucide-react";
import { useRouter } from "./app-context";

export interface NavItem {
  path: string;
  label: string;
  /** Label pendek untuk navigasi bawah di HP. */
  short: string;
  icon: LucideIcon;
}

// Tambah modul baru (mis. Marketing, Riset) cukup di sini + di App.tsx.
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Asisten",
    items: [
      { path: "/", label: "Dashboard", short: "Beranda", icon: LayoutDashboard },
      { path: "/kantor", label: "Kantor 3D", short: "Kantor", icon: Box },
      { path: "/tugas", label: "Tugas", short: "Tugas", icon: CheckSquare },
      { path: "/catatan", label: "Second Brain", short: "Brain", icon: Brain },
      { path: "/chat", label: "Chat AI", short: "Chat", icon: MessageCircle },
      { path: "/profil", label: "Profil & Memori", short: "Profil", icon: UserRound },
    ],
  },
  {
    group: "Marketing",
    items: [
      { path: "/intel", label: "Intelijen Kreatif", short: "Intel", icon: Lightbulb },
      { path: "/kompetitor", label: "Riset Kompetitor", short: "Kompetitor", icon: Radar },
      { path: "/studio", label: "Studio Konten", short: "Studio", icon: Clapperboard },
      { path: "/paid-ads", label: "Paid Ads", short: "Ads", icon: Megaphone },
      { path: "/meta-ads", label: "Meta Ads", short: "Meta", icon: BarChart3 },
    ],
  },
  {
    group: "Lainnya",
    items: [{ path: "/sistem", label: "Sistem", short: "Sistem", icon: Settings }],
  },
];

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Layout({ children, badges }: { children: ReactNode; badges?: Record<string, number> }) {
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  const active = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  const current = NAV.flatMap((g) => g.items).find((i) => active(i.path))?.label ?? "Second Brain";
  const totalBadge = Object.values(badges ?? {}).reduce((a, b) => a + b, 0);

  // Tutup drawer saat pindah halaman, kunci scroll saat terbuka, Esc menutup.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const brand = (
    <div className="flex items-center gap-2 px-2">
      <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-md">
        <Brain className="size-4.5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold">Second Brain</p>
        <p className="text-[11px] text-muted">Asisten pribadi</p>
      </div>
    </div>
  );

  const nav = (
    <nav className="space-y-5" aria-label="Navigasi utama">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted/80">{g.group}</p>
          {g.items.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active(item.path) ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150 max-md:py-3 ${
                active(item.path) ? "font-semibold text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <item.icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              {!!badges?.[item.path] && (
                <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-medium text-warn">{badges[item.path]}</span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop: sidebar tetap */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-5 md:flex">
        <div className="mb-6">{brand}</div>
        {nav}
      </aside>

      {/* HP: bar atas + sidebar geser */}
      <header className="safe-top sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-line bg-white/95 px-3 backdrop-blur md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          aria-expanded={open}
          className="relative flex size-10 items-center justify-center rounded-lg text-fg hover:bg-surface-2"
        >
          <Menu className="size-5" />
          {totalBadge > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-warn" />}
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{current}</p>
      </header>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Menu navigasi"
        className={`safe-top safe-bottom fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-white px-3 py-4 shadow-xl transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          {brand}
          <button onClick={() => setOpen(false)} aria-label="Tutup menu" className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <X className="size-5" />
          </button>
        </div>
        {nav}
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-8 pt-4 md:px-10 md:pb-10 md:pt-8">
        <div className={`mx-auto ${path.startsWith("/kantor") ? "max-w-7xl" : "max-w-5xl"}`}>{children}</div>
      </main>
    </div>
  );
}
