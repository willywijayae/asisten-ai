import type { ReactNode } from "react";
import { Box, Brain, BarChart3, CheckSquare, Clapperboard, Lightbulb, Megaphone, Radar, LayoutDashboard, MessageCircle, Settings, UserRound, type LucideIcon } from "lucide-react";
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
  const active = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  const all = NAV.flatMap((g) => g.items);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 bg-white shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-2 px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-md">
            <Brain className="size-4.5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Second Brain</p>
            <p className="text-[11px] text-muted">Asisten pribadi</p>
          </div>
        </div>
        <nav className="space-y-5" aria-label="Navigasi utama">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted/80">{g.group}</p>
              {g.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active(item.path) ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
                    active(item.path)
                      ? "bg-accent-soft font-semibold text-accent before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-accent"
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
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-10 md:pb-10 md:pt-8">
        <div className={`mx-auto ${path.startsWith("/kantor") ? "max-w-7xl" : "max-w-5xl"}`}>{children}</div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto overscroll-x-contain border-t border-line bg-surface/95 backdrop-blur md:hidden [scrollbar-width:none]">
        {all.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`relative flex min-w-16 flex-1 shrink-0 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${active(item.path) ? "font-semibold text-accent" : "text-muted"}`}
          >
            <span className={`flex h-6 w-11 items-center justify-center rounded-full transition-colors ${active(item.path) ? "bg-accent-soft" : ""}`}>
              <item.icon className="size-5" />
            </span>
            {item.short}
            {!!badges?.[item.path] && <span className="absolute right-1/4 top-1.5 size-2 rounded-full bg-warn" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
