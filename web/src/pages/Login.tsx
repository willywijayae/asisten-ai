import { useState } from "react";
import { Brain, Send } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [step, setStep] = useState<"request" | "verify">("request");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/auth/request", { method: "POST" });
      setStep("verify");
    } catch (e) {
      // Kode sebelumnya masih berlaku → tetap bisa lanjut memasukkan kode.
      if (e instanceof ApiError && e.status === 429) setStep("verify");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify", { method: "POST", body: { code } });
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg">
            <Brain className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Second Brain</h1>
          <p className="mt-1 text-sm text-muted">Masuk dengan kode yang dikirim ke Telegram kamu.</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          {step === "request" ? (
            <Button variant="primary" className="w-full" loading={busy} onClick={request}>
              <Send className="size-4" /> Kirim kode ke Telegram
            </Button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify();
              }}
              className="space-y-3"
            >
              <label className="block text-xs font-medium text-muted" htmlFor="code">
                Kode 6 digit dari bot Telegram
              </label>
              <input
                id="code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="input text-center font-mono text-2xl tracking-[0.5em]"
                placeholder="••••••"
              />
              <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6}>
                Masuk
              </Button>
              <button type="button" onClick={request} disabled={busy} className="w-full text-xs text-muted hover:text-fg">
                Kirim ulang kode
              </button>
            </form>
          )}
          {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
