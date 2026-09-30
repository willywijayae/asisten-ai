import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

// --- Router mini (tanpa dependensi) ---

const RouterCtx = createContext<{ path: string; navigate: (to: string) => void }>({ path: "/", navigate: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

// --- Toast ---

type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm shadow-lg"
          >
            {t.kind === "ok" ? (
              <CheckCircle2 className="size-4 shrink-0 text-ok" />
            ) : (
              <AlertCircle className="size-4 shrink-0 text-danger" />
            )}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    ok: (text: string) => push("ok", text),
    error: (err: unknown) => push("error", err instanceof Error ? err.message : String(err)),
  };
}
