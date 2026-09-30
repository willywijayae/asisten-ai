const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DAYS_LONG = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function offsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!m) return 7 * 60;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

/** Date yang field getUTC*-nya berisi jam lokal. */
function shifted(d: Date, tz: string): Date {
  return new Date(d.getTime() + offsetMinutes(tz) * 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Ubah waktu lokal ("2026-10-01", "2026-10-01 14:00", "2026-10-01T14:00") ke ISO UTC.
 * Kalau cuma tanggal, dianggap jam 09:00.
 */
export function localToUtc(local: string | null | undefined, tz: string): string | null {
  if (!local) return null;
  let s = local.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T09:00";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(s + tz);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Sen, 30 Sep 14:00" */
export function formatLocal(iso: string | null | undefined, tz: string): string {
  if (!iso) return "-";
  const d = shifted(new Date(iso), tz);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Konteks waktu sekarang untuk prompt. */
export function nowContext(tz: string, now = new Date()): string {
  const d = shifted(now, tz);
  const isoLocal = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${DAYS_LONG[d.getUTCDay()]}, ${isoLocal} (UTC${tz})`;
}

/** Awal & akhir hari lokal (dalam ISO UTC), dengan geser hari opsional. */
export function localDayRange(tz: string, dayOffset = 0, now = new Date()): [string, string] {
  const d = shifted(now, tz);
  const startLocal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset);
  const start = startLocal - offsetMinutes(tz) * 60_000;
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()];
}
