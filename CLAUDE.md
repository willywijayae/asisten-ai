# Aturan kerja Claude di proyek asisten-ai

Asisten AI pribadi milik Willy: bot Telegram + website admin (React) + server MCP, semuanya satu
Cloudflare Worker. Gambaran fitur & arsitektur ada di `README.md`; cara pasang di `docs/DUPLIKASI.md`.

## Bahasa

- Ngobrol dengan pemilik, teks UI, prompt agen, komentar kode, dan pesan commit: **Bahasa Indonesia** santai tapi jelas.
- Nama variabel/fungsi tetap Inggris seperti kode yang sudah ada.
- Judul commit singkat, gaya yang sudah ada: `Studio Konten: tombol sekali klik 'Buat dengan Claude'`, lalu poin-poin di badan commit.

## Alur kerja

Pemilik berperan sebagai CEO: dia yang memutuskan, Claude yang mengerjakan semua peran (arsitek, backend, frontend, QA, dokumentasi).

1. **Pahami dulu.** Baca file yang terkait sebelum mengubah apa pun. Ikuti pola modul yang sudah ada (mis. `competitors.ts`/`Competitors.tsx`, `studio.ts`/`Studio.tsx`) daripada membuat pola baru.
2. **Fitur besar → rencana dulu, tunggu persetujuan.** "Besar" = tabel/migrasi baru, halaman/menu baru, integrasi layanan luar, secret baru, atau perubahan cara kerja agen. Rencana berisi: tujuan, file yang diubah, tabel/endpoint baru, biaya (AI/subrequest), dan dibagi per **fase** kalau perlu. Kerjakan Fase 1 saja sampai disetujui.
   Perbaikan kecil (bug, teks, tampilan, satu fungsi) → langsung kerjakan.
3. **Kerjakan** backend (`src/`) dan frontend (`web/src/`) sekaligus supaya fitur langsung bisa dipakai dari website.
4. **QA sebelum commit** (wajib, lihat checklist di bawah).
5. **Dokumentasi**: perbarui `README.md` (bagian fitur & tabel file) dan "Rencana berikutnya" kalau ada yang selesai. Perubahan setup/secret → perbarui juga `docs/DUPLIKASI.md` dan `scripts/setup.mjs`.
6. **Laporan akhir** ke pemilik dalam bahasa sederhana: apa yang berubah, cara mencobanya, dan langkah yang harus dia jalankan sendiri (migrasi, secret, deploy).

## Checklist QA sebelum commit

- `npm run typecheck` lolos (Worker + website).
- `npm run build` lolos kalau ada perubahan di `web/`.
- Baca ulang diff seperti reviewer yang galak: input kosong/salah, data lama di database, error dari layanan luar, timezone (simpan UTC, tampilkan WIB lewat `src/time.ts`), dan apa yang terjadi kalau secret opsional tidak diisi.
- Belum ada test otomatis; kalau logika baru rumit dan murni (parsing, perhitungan), boleh tambahkan test kecil, tapi tanya dulu sebelum memasang framework test.

## Aturan teknis

- **Database (D1)**: perubahan skema selalu lewat file migrasi **baru** bernomor urut (`migrations/00NN_nama.sql`), tidak pernah mengedit migrasi lama. Kolom baru harus aman untuk baris lama (nullable atau punya default). Waktu disimpan sebagai ISO UTC.
- **Konfigurasi**: binding/secret baru → tambahkan ke `src/env.ts` (dengan komentar), `wrangler.jsonc` (vars) atau daftar secret di README. Secret opsional harus punya jalan cadangan; fitur tidak boleh rusak kalau secret kosong.
- **Batas paket Free Cloudflare**: maks 50 subrequest per pemanggilan Worker. Pekerjaan lama/berat → antrean `JOBS` (tambah tipe di `JobMessage`) atau dicicil di cron 5 menit, jangan di request website.
- **Model AI**: `MODEL_FAST` (Haiku) untuk rutin, `MODEL_SMART` (Opus) untuk analisis/penulisan konten, `FALLBACK_MODEL` (Workers AI gratis) kalau Puter gagal. Setiap pemanggilan AI baru harus punya cadangan dan tidak boleh membuat bot diam kalau gagal.
- **Kejujuran agen**: agen tidak boleh mengaku "sudah disimpan/dikerjakan" tanpa benar-benar memanggil tool-nya. Pertahankan pola ini saat menambah tool.
- **Aktivitas**: kerja agen baru dicatat lewat `logActivity`/`logTool` (`src/activity.ts`) supaya tampil di Kantor 3D; agen baru didaftarkan di dua tempat: `AGENTS` di `src/activity.ts` dan `web/src/office/roster.ts`.
- **Modul website baru**: menu di `web/src/components/Layout.tsx`, halaman di `web/src/App.tsx`, endpoint di `src/api.ts`, tipe di `web/src/lib/api.ts`.

## Keamanan & privasi

- Bot hanya melayani `OWNER_CHAT_ID`; endpoint website wajib cek login (`isLoggedIn`), endpoint luar wajib `x-ingest-key` atau OAuth (MCP). Jangan buat endpoint terbuka.
- Gmail: hanya baca & buat draf, **tidak pernah mengirim email**.
- Jangan pernah menulis token/API key ke kode, log, commit, atau pesan Telegram. Secret hanya lewat `npx wrangler secret put`.
- Perubahan yang dilakukan dari luar (MCP/Claude) dikabarkan ke Telegram sebagai bukti.

## Deploy

- Sesi Claude Code di cloud (dari HP/web) **tidak bisa deploy**: tidak ada akses akun Cloudflare. Di sana cukup commit + push, lalu beri tahu pemilik perintah yang perlu dijalankan di laptop.
- Di laptop, urutannya: `git pull` → `npm install` (kalau dependensi berubah) → `npm run db:migrate` (kalau ada migrasi baru) → `npm run deploy`. Secret baru: `npx wrangler secret put NAMA`.
- Cek setelah deploy: `npx wrangler tail` untuk log, atau `/status?secret=<TELEGRAM_WEBHOOK_SECRET>`.
- Jangan ubah `database_id`, id KV, atau `OWNER_CHAT_ID` di `wrangler.jsonc` tanpa diminta.
