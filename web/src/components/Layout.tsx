import type { ReactNode } from "react";
import { Box, Brain, CheckSquare, Clapperboard, Radar, LayoutDashboard, MessageCircle, Settings, UserRound, type LucideIcon } from "lucide-react";
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
      { path: "/kompetitor", label: "Riset Kompetitor", short: "Kompetitor", icon: Radar },
      { path: "/studio", label: "Studio Konten", short: "Studio", icon: Clapperboard },
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
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Brain className="size-4.5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Second Brain</p>
            <p className="text-[11px] text-muted">Asisten pribadi</p>
          </div>
        </div>
        <nav className="space-y-5">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted">{g.group}</p>
              {g.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition ${
                    active(item.path) ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
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

      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-10 md:pb-10 md:pt-8">
        <div className={`mx-auto ${path.startsWith("/kantor") ? "max-w-7xl" : "max-w-5xl"}`}>{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-line bg-surface/95 backdrop-blur md:hidden">
        {all.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`relative flex min-w-16 flex-1 shrink-0 flex-col items-center gap-0.5 py-2 text-[10px] ${active(item.path) ? "text-accent" : "text-muted"}`}
          >
            <item.icon className="size-5" />
            {item.short}
            {!!badges?.[item.path] && <span className="absolute right-1/4 top-1.5 size-2 rounded-full bg-warn" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
