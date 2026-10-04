import { useCallback, useEffect, useState } from "react";
import { api, type Summary } from "./lib/api";
import { Layout } from "./components/Layout";
import { Spinner, Empty } from "./components/ui";
import { useRouter } from "./components/app-context";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Tasks } from "./pages/Tasks";
import { Notes } from "./pages/Notes";
import { Chat } from "./pages/Chat";
import { System } from "./pages/System";
import { Profile } from "./pages/Profile";
import { Office } from "./pages/Office";
import { Competitors } from "./pages/Competitors";
import { ImportAds } from "./pages/ImportAds";
import { Studio } from "./pages/Studio";
import { PaidAds } from "./pages/PaidAds";
import { MetaAds } from "./pages/MetaAds";
import { Intel } from "./pages/Intel";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);
  const { path, navigate } = useRouter();
  // Dicatat sekali di awal: halaman impor langsung menghapus #kunci dari URL.
  const [keyedImport] = useState(() => window.location.pathname.startsWith("/impor-iklan") && window.location.hash.includes("k="));

  useEffect(() => {
    api("/me")
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
    const onLogout = () => setAuthed(false);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  // Badge jumlah tugas yang menunggu approval di navigasi.
  const refreshBadges = useCallback(() => {
    api<Summary>("/summary")
      .then((s) => setPending(s.counts.pending))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (authed) refreshBadges();
  }, [authed, path, refreshBadges]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setAuthed(false);
    navigate("/");
  };

  // Impor dari Claude/tugas terjadwal membawa kuncinya sendiri, jadi tidak perlu login.
  if (keyedImport) return <ImportAds />;
  if (authed === null) return <Spinner />;
  if (!authed) return <Login onLoggedIn={() => setAuthed(true)} />;

  let page;
  if (path === "/") page = <Dashboard onChanged={refreshBadges} />;
  else if (path.startsWith("/kompetitor")) page = <Competitors />;
  else if (path.startsWith("/impor-iklan")) page = <ImportAds />;
  else if (path.startsWith("/studio")) page = <Studio />;
  else if (path.startsWith("/meta-ads")) page = <MetaAds />;
  else if (path.startsWith("/paid-ads")) page = <PaidAds />;
  else if (path.startsWith("/intel")) page = <Intel />;
  else if (path.startsWith("/kantor")) page = <Office onChanged={refreshBadges} />;
  else if (path.startsWith("/tugas")) page = <Tasks onChanged={refreshBadges} />;
  else if (path.startsWith("/catatan")) page = <Notes />;
  else if (path.startsWith("/chat")) page = <Chat onChanged={refreshBadges} />;
  else if (path.startsWith("/profil")) page = <Profile />;
  else if (path.startsWith("/sistem")) page = <System onLogout={logout} />;
  else page = <Empty title="Halaman tidak ditemukan" />;

  return (
    <Layout badges={{ "/tugas": pending }}>
      {/* key → state halaman direset saat pindah menu */}
      <div key={path}>{page}</div>
    </Layout>
  );
}
