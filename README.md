# Asisten AI Pribadi

Asisten AI pribadi ala "AI Chief of Staff" yang hidup di Telegram dan jalan di Cloudflare Workers.

## Fitur

- **Chat bebas** — "ingetin aku meeting sama Budi besok jam 10" → tugas + pengingat tercatat.
- **Approval-first** — forward pesan/screenshot chat WhatsApp atau kirim voice note → AI mengekstrak komitmen & deadline, lalu mengusulkan tugas dengan tombol ✅ Simpan / ❌ Buang.
- **Voice note** — ditranskrip otomatis (Whisper di Workers AI), lalu dirangkum.
- **Second brain** — "catat bahwa…" disimpan, bisa ditanya balik kapan saja.
- **Pengingat otomatis** — 60 menit sebelum deadline (atau jam yang kamu minta), dengan tombol Selesai / Tunda 1 jam.
- **Briefing pagi 07:00 & rekap malam 21:00 WIB** dikirim otomatis.
- **Kenal kamu** — `/profil` memulai wawancara 5–7 pertanyaan; koreksi seperti "jangan panggil aku bro" disimpan sebagai preferensi permanen.
- **Konteks otomatis** — setiap pesan otomatis dilengkapi catatan & tugas yang relevan (pencarian kata kunci, tanpa biaya AI), dan jawaban menyebut sumbernya.
- **Privat** — bot hanya melayani `OWNER_CHAT_ID`; semua data ada di database D1 milikmu sendiri.

## Website admin

Buka `https://asisten-ai.<subdomain>.workers.dev` → klik **Kirim kode ke Telegram** → masukkan kode 6 digit dari bot. Sesi berlaku 30 hari.

- **Dashboard** — agenda hari ini, yang terlewat, usulan yang menunggu approval, catatan terbaru, dan *Tangkap cepat*.
- **Tugas** — filter per status/waktu, cari, ubah, tandai selesai, setujui/buang usulan.
- **Second Brain** — semua catatan, cari & filter per tag.
- **Chat AI** — otak & riwayat yang sama dengan bot Telegram.
- **Profil & Memori** — profil kamu (hasil wawancara `/profil` atau ditulis sendiri) dan daftar preferensi permanen; keduanya ikut dibaca di setiap percakapan.
- **Sistem** — status bot/webhook/model, kirim briefing manual, reset riwayat.

Modul baru (mis. Marketing & Riset) ditambahkan di `web/src/components/Layout.tsx` (menu) dan `web/src/App.tsx` (halaman), dengan endpoint di `src/api.ts`.

## Arsitektur

```
Telegram ──webhook──▶ Worker /telegram ──▶ Queue ──▶ consumer
                                                     ├─ Workers AI (Whisper) untuk voice note
                                                     ├─ Claude via Puter (utama) / GLM-5.3 Flash Workers AI (cadangan)
                                                     └─ D1: tasks, notes, history
Cron (tiap 5 menit / 07:00 / 21:00) ──▶ pengingat & briefing ──▶ Telegram
```

| File | Isi |
|---|---|
| `src/index.ts` | Route webhook, consumer queue, perintah, tombol approval, cron |
| `src/mcp.ts`, `src/oauth.ts` | Server MCP untuk Claude & halaman izin OAuth |
| `src/google.ts` | OAuth Google, Gmail (cari/baca/draf), Drive (cari/baca/simpan) |
| `src/api.ts`, `src/auth.ts` | REST API website admin & login kode Telegram |
| `web/` | Website admin (React + Vite + Tailwind), build ke `web/dist` |
| `src/agent.ts` | Prompt sistem, tool, dan loop Claude |
| `src/db.ts` | Query D1 |
| `src/telegram.ts` | Klien Telegram Bot API |
| `src/time.ts` | Konversi zona waktu (default WIB, `TIMEZONE_OFFSET`) |
| `migrations/` | Skema database |

## Setup

Yang dibutuhkan: akun Cloudflare (Free cukup), akun [Puter](https://puter.com) (gratis, ada jatah kredit bulanan), dan bot Telegram dari [@BotFather](https://t.me/BotFather) (`/newbot` → simpan tokennya).

```bash
npm install
npx wrangler login

# 1. Buat database & queue, lalu salin database_id ke wrangler.jsonc
npx wrangler d1 create asisten-ai-db
npx wrangler queues create asisten-ai-jobs
npm run db:migrate

# 2. Simpan secret
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # string acak bebas, mis. hasil `openssl rand -hex 24`

# 3. Login Puter (browser terbuka, token langsung disimpan sebagai secret)
npm run puter:login

# 4. Build website + deploy
npm run deploy
```

Setelah deploy:

1. Buka `https://asisten-ai.<subdomain>.workers.dev/setup?secret=<TELEGRAM_WEBHOOK_SECRET>` sekali untuk mendaftarkan webhook.
2. Chat bot kamu di Telegram → bot membalas dengan chat ID kamu.
3. Isi `OWNER_CHAT_ID` di `wrangler.jsonc` dengan angka itu, lalu `npm run deploy` lagi.

## Konektor Claude (MCP)

Second Brain juga tersedia sebagai server MCP di `https://asisten-ai.<subdomain>.workers.dev/mcp`, sehingga Claude (desktop, web, HP) bisa membaca & menambah tugas, catatan, dan profil. Gabungkan dengan konektor Gmail/Calendar bawaan Claude, mis. "cek email hari ini, masukkan yang perlu dikerjakan ke tugasku".

1. claude.ai → **Settings → Connectors → Add custom connector**, isi URL di atas.
2. Klik **Connect** → halaman izin Second Brain → masuk dengan kode Telegram → **Izinkan**.

Tool: `get_overview`, `list_tasks`, `add_tasks`, `update_task`, `search_notes`, `add_note`, `update_note`, `get_profile`, `add_preference`. Setiap perubahan dari Claude dikabarkan ke Telegram sebagai bukti. Akses dilindungi OAuth 2.1 (`@cloudflare/workers-oauth-provider`, token di KV `OAUTH_KV`).

## Gmail & Google Drive

Izin yang diminta (minimal): baca Gmail, buat draf (bot **tidak pernah mengirim** email), baca Drive, dan tulis file buatan app sendiri (folder "Second Brain").

1. Buka [console.cloud.google.com](https://console.cloud.google.com) → buat project baru (mis. `asisten-ai`).
2. **APIs & Services → Library** → aktifkan **Gmail API** dan **Google Drive API**.
3. **Google Auth Platform → Branding**: isi nama app & email. **Audience**: External, tambahkan email kamu sebagai test user, lalu klik **Publish app** (status *In production*). Kalau tetap *Testing*, token kedaluwarsa tiap 7 hari.
4. **Clients → Create client** → *Web application* → Authorized redirect URI:
   `https://asisten-ai.<subdomain>.workers.dev/api/google/callback`
5. Simpan kredensialnya:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put ENCRYPTION_KEY   # string acak, mis. `openssl rand -hex 32`
   ```
6. Website admin → **Sistem → Hubungkan Google**. Layar "Google hasn't verified this app" wajar untuk app pribadi: klik *Advanced → Go to …*, lalu centang semua izin.

Setelah terhubung, asisten bisa: mencari & membaca email, membuat draf balasan, mencari & membaca Docs/Sheets/Slides, dan menyimpan hasil ke Drive. Briefing pagi ikut merangkum email belum dibaca 24 jam terakhir.

## Pengaturan

- `MODEL_FAST` — model Claude (Puter) untuk pekerjaan rutin: mencatat, tugas, pertanyaan singkat, briefing (default `claude-haiku-4-5`; bisa diganti `claude-sonnet-5-5`).
- `MODEL_SMART` — model ahli (default `claude-opus-5-5`). Dipanggil otomatis saat model rutin menilai permintaannya rumit (analisis, strategi, riset, tulisan panjang), atau saat pesan berisi "pakai opus" / `/opus`.
- `FALLBACK_MODEL` — model Workers AI gratis yang dipakai kalau jatah Puter habis atau Puter error (default `@cf/google/gemma-4-26b-a4b-it`; pilih model yang tidak berlabel `require_workers_paid` kalau pakai paket Free). Tanpa `PUTER_AUTH_TOKEN`, bot langsung memakai model ini.
- `/status?secret=<TELEGRAM_WEBHOOK_SECRET>` — cek status webhook & konfigurasi.
- `TIMEZONE_OFFSET` — default `+07:00` (WIB). Jadwal cron di `wrangler.jsonc` dalam UTC.
- Log: `npx wrangler tail`.
- Development lokal: `npm run dev` (Worker + website di http://localhost:8787, jalankan `npm run build` dulu) atau `npm run dev:web` untuk hot reload di port 5173.

## Rencana berikutnya

- Google Calendar & Gmail (OAuth) supaya briefing ikut membaca jadwal dan email.
- Notion sync.
- WhatsApp: API resmi WhatsApp tidak bisa membaca chat pribadi, jadi untuk sekarang cukup forward pesan, screenshot, atau voice note ke bot.
