// Semua tampilan waktu mengikuti WIB, sama dengan bot.
const OFFSET_MS = 7 * 3600_000;
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const shifted = (iso: string | number) => new Date((typeof iso === "number" ? iso : Date.parse(iso)) + OFFSET_MS);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** ISO UTC → nilai untuk <input type="datetime-local"> dalam WIB. */
export function toInputValue(iso: string | null): string {
  return iso ? shifted(iso).toISOString().slice(0, 16) : "";
}

export function hhmm(iso: string): string {
  return shifted(iso).toISOString().slice(11, 16);
}

/** "Hari ini 14:00", "Besok 09:00", "Kemarin 10:00", "Kam, 3 Okt 10:00" */
export function fmtWhen(iso: string): string {
  const d = shifted(iso);
  const today = shifted(Date.now());
  const diffDays = Math.round((Date.parse(dayKey(d)) - Date.parse(dayKey(today))) / 86_400_000);
  const time = hhmm(iso);
  if (diffDays === 0) return `Hari ini ${time}`;
  if (diffDays === 1) return `Besok ${time}`;
  if (diffDays === -1) return `Kemarin ${time}`;
  const year = d.getUTCFullYear() !== today.getUTCFullYear() ? ` ${d.getUTCFullYear()}` : "";
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} ${time}`;
}

export function fmtDate(iso: string): string {
  const d = shifted(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isOverdue(iso: string | null): boolean {
  return !!iso && Date.parse(iso) < Date.now();
}

export function greeting(): string {
  const h = shifted(Date.now()).getUTCHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 19) return "Selamat sore";
  return "Selamat malam";
}

export function todayLabel(): string {
  const d = shifted(Date.now());
  const long = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return `${long[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
