# Asisten AI Pribadi

Asisten AI pribadi ala "AI Chief of Staff" yang hidup di Telegram dan jalan di Cloudflare Workers.

## Fitur

- **Chat bebas** — "ingetin aku meeting sama Budi besok jam 10" → tugas + pengingat tercatat.
- **Approval-first** — forward pesan/screenshot chat WhatsApp atau kirim voice note → AI mengekstrak komitmen & deadline, lalu mengusulkan tugas dengan tombol ✅ Simpan / ❌ Buang.
- **Voice note** — ditranskrip otomatis (Whisper di Workers AI), lalu dirangkum.
- **Second brain** — "catat bahwa…" disimpan, bisa ditanya balik kapan saja.
- **Riset** — AI bisa mencari di web lalu merangkum beserta sumbernya.
- **Pengingat otomatis** — 60 menit sebelum deadline (atau jam yang kamu minta), dengan tombol Selesai / Tunda 1 jam.
- **Briefing pagi 07:00 & rekap malam 21:00 WIB** dikirim otomatis.
- **Privat** — bot hanya melayani `OWNER_CHAT_ID`; semua data ada di database D1 milikmu sendiri.

## Arsitektur

```
Telegram ──webhook──▶ Worker /telegram ──▶ Queue ──▶ consumer
                                                     ├─ Workers AI (Whisper) untuk voice note
                                                     ├─ Claude API (tool use + web search)
                                                     └─ D1: tasks, notes, history
Cron (tiap 5 menit / 07:00 / 21:00) ──▶ pengingat & briefing ──▶ Telegram
```

| File | Isi |
|---|---|
| `src/index.ts` | Route webhook, consumer queue, perintah, tombol approval, cron |
| `src/agent.ts` | Prompt sistem, tool, dan loop Claude |
| `src/db.ts` | Query D1 |
| `src/telegram.ts` | Klien Telegram Bot API |
| `src/time.ts` | Konversi zona waktu (default WIB, `TIMEZONE_OFFSET`) |
| `migrations/` | Skema database |

## Setup

Yang dibutuhkan: akun Cloudflare (Free cukup), API key Anthropic (console.anthropic.com), dan bot Telegram dari [@BotFather](https://t.me/BotFather) (`/newbot` → simpan tokennya).

```bash
npm install
npx wrangler login

# 1. Buat database & queue, lalu salin database_id ke wrangler.jsonc
npx wrangler d1 create asisten-ai-db
npx wrangler queues create asisten-ai-jobs
npm run db:migrate

# 2. Simpan secret
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # string acak bebas, mis. hasil `openssl rand -hex 24`

# 3. Deploy
npm run deploy
```

Setelah deploy:

1. Buka `https://asisten-ai.<subdomain>.workers.dev/setup?secret=<TELEGRAM_WEBHOOK_SECRET>` sekali untuk mendaftarkan webhook.
2. Chat bot kamu di Telegram → bot membalas dengan chat ID kamu.
3. Isi `OWNER_CHAT_ID` di `wrangler.jsonc` dengan angka itu, lalu `npm run deploy` lagi.

## Pengaturan

- `MODEL` — model Claude (default `claude-opus-5-5`).
- `TIMEZONE_OFFSET` — default `+07:00` (WIB). Jadwal cron di `wrangler.jsonc` dalam UTC.
- Log: `npx wrangler tail`.

## Rencana berikutnya

- Google Calendar & Gmail (OAuth) supaya briefing ikut membaca jadwal dan email.
- Notion sync.
- WhatsApp: API resmi WhatsApp tidak bisa membaca chat pribadi, jadi untuk sekarang cukup forward pesan, screenshot, atau voice note ke bot.
