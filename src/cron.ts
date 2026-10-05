import type { Env } from "./env";
import * as profile from "./profile";

// Tiap pekerjaan terjadwal bisa dimatikan manual dari Pengaturan. Disimpan sebagai daftar id yang MATI di tabel settings.
export const CRON_JOBS = [
  { id: "reminders", label: "Pengingat tugas", when: "tiap 5 menit", hint: "Kirim pengingat Telegram. Paling sering jalan; matikan jika tak pakai pengingat." },
  { id: "competitors", label: "Riset kompetitor", when: "tiap 2 jam", hint: "Simpan media & nilai iklan kompetitor. Paling boros D1 dan AI." },
  { id: "morning", label: "Briefing pagi", when: "07:00 WIB", hint: "Ringkasan pagi ke Telegram." },
  { id: "meta_sync", label: "Sinkron Meta Ads", when: "07:00 WIB", hint: "Tarik data iklan Meta harian." },
  { id: "intel", label: "Intelijen kreatif", when: "07:00 WIB", hint: "Tag, sinyal pemenang, VOC, brief mingguan." },
  { id: "evening", label: "Rekap malam", when: "21:00 WIB", hint: "Rekap hari ini ke Telegram." },
  { id: "weekly", label: "Review mingguan CEO", when: "Minggu 20:00 WIB", hint: "Review mingguan oleh agen CEO." },
] as const;

export type CronId = (typeof CRON_JOBS)[number]["id"];
const KEY = "cron_disabled";

export async function disabledJobs(env: Env): Promise<Set<string>> {
  try {
    const row = await profile.getSetting(env, KEY);
    const arr = JSON.parse(row?.value ?? "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export async function setJobEnabled(env: Env, id: string, enabled: boolean): Promise<void> {
  if (!CRON_JOBS.some((j) => j.id === id)) throw new Error("Job tidak dikenal");
  const off = await disabledJobs(env);
  if (enabled) off.delete(id);
  else off.add(id);
  await profile.setSetting(env, KEY, JSON.stringify([...off]));
}
