# Duplikasi Asisten AI / Second Brain

Panduan untuk memasang salinan aplikasi ini milikmu sendiri: bot Telegram pribadi, website admin, tim agen AI, memori jangka panjang, dan riset iklan kompetitor. Semuanya berjalan di akun Cloudflare-mu sendiri, dan datanya terpisah total dari pemilik asli.

- **Waktu:** ±30 menit
- **Biaya:** Rp0 (paket gratis Cloudflare). Opsional: kuota Claude lewat Puter.
- **Keahlian:** cukup bisa membuka Terminal dan menyalin perintah

---

## Apa yang kamu dapat

| Fitur | Isinya |
|---|---|
| **Bot Telegram pribadi** | Catat tugas & pengingat dari chat, voice note, foto, atau pesan terusan. Pengingat tepat waktu, briefing pagi 07:00 & rekap malam 21:00. |
| **Website admin** | Dashboard, tugas, catatan (Second Brain), chat AI, profil & memori. Login pakai kode yang dikirim ke Telegram, tanpa password. |
| **Tim agen AI + Kantor 3D** | CEO, Manajer Operasional, dan Manajer Marketing beserta anak buahnya (Copywriter, Perencana Konten, Analis Iklan, Riset), tampil bergerak di kantor 3D sesuai kerja aslinya. |
| **Memori jangka panjang** | Fakta penting dari obrolan diingat otomatis, dan pencarian berdasarkan makna. |
| **Riset Kompetitor** | Iklan Meta Ad Library lengkap dengan gambar/video, lama tayang, dan urutan impresi; laporan "bedah iklan"; tombol "Bikin 5 konten mirip". |
| **Konektor Claude (MCP)** | Claude di claude.ai/desktop bisa membaca & menulis tugas, catatan, memori, dan riset kompetitormu. |

---

## Yang perlu disiapkan

| Kebutuhan | Wajib? | Cara dapat |
|---|---|---|
| Laptop (Mac / Windows / Linux) dengan **Node.js 20+** dan **Git** | Wajib | [nodejs.org](https://nodejs.org) (pilih LTS), [git-scm.com](https://git-scm.com) |
| Akun **Cloudflare** | Wajib | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), paket Free |
| Akun **Telegram** + bot baru | Wajib | Chat [@BotFather](https://t.me/BotFather) → `/newbot` → simpan **token**-nya |
| Akses ke kode aplikasi | Wajib | Diberikan pemilik asli (lihat bagian terakhir) |
| Akun **Puter** | Opsional | [puter.com](https://puter.com), gratis. Supaya otaknya **Claude** (Haiku/Opus). Tanpa ini memakai model gratis Gemma. |
| Langganan **Claude** | Opsional | Untuk konektor MCP di claude.ai |
| Project **Google Cloud** | Opsional | Untuk Gmail & Google Drive |
| API key **Jev AI** | Opsional | [jev-ai.pro](https://jev-ai.pro), untuk penilai iklan kompetitor |

---

## Langkah 1 — Ambil kodenya

```bash
git clone https://github.com/<pemilik>/asisten-ai.git
cd asisten-ai
```

Kalau kamu menerima file ZIP, ekstrak lalu buka foldernya di Terminal.

## Langkah 2 — Install

```bash
npm install
```

## Langkah 3 — Setup otomatis

```bash
npm run setup
```

Skrip ini bertanya beberapa hal, lalu mengerjakan semuanya sendiri:

1. **Login Cloudflare.** Browser terbuka, lalu klik *Allow*.
2. **Nama panggilanmu**, **nama aplikasi** (default `asisten-ai`), dan **zona waktu** (WIB/WITA/WIT).
3. **Token bot Telegram** dari BotFather. Setelah itu kamu diminta **mengirim pesan apa saja ke bot-mu**. Skrip mendeteksi chat ID-mu, sehingga bot hanya melayani akunmu.
4. Membuat database, antrean, penyimpanan, dan indeks pencarian di Cloudflare.
5. Mengisi `wrangler.jsonc` (cadangan lamanya disimpan sebagai `wrangler.jsonc.bak`).
6. Membuat tabel database.
7. **Deploy.** Untuk akun Cloudflare baru, kamu mungkin ditanya nama subdomain `workers.dev`. Isi bebas, misalnya namamu.
8. Memasang kunci rahasia dan menyambungkan bot Telegram.
9. *(Opsional)* **Login Puter**: browser terbuka, login, dan token tersimpan otomatis.

Di akhir, skrip menampilkan alamat website, bot, dan URL konektor Claude. Kunci penting tersimpan di **`.setup-output.txt`**. Simpan baik-baik dan jangan dibagikan.

> Kalau ada langkah yang gagal, perbaiki penyebabnya lalu jalankan `npm run setup` lagi. Resource yang sudah dibuat akan dipakai ulang, bukan dibuat dobel.

## Langkah 4 — Pakai pertama kali

1. **Telegram:** kirim `/start` ke bot, lalu `/profil`. Asisten mewawancaraimu 5–7 pertanyaan supaya kenal kamu, bisnismu, dan targetmu.
2. **Website admin:** buka alamat dari skrip → **Kirim kode ke Telegram** → masukkan kodenya.
3. **Kantor 3D:** menu *Kantor 3D*. Kirim perintah di kotak bawah dan lihat timnya bekerja.
4. **Riset Kompetitor:** menu *Marketing → Riset Kompetitor*.
   - Seret tombol **"Kirim ke Second Brain"** (di panel *Cara scan*) ke bookmark bar Chrome.
   - Buka [Meta Ad Library](https://www.facebook.com/ads/library/), cari kata kunci, urutkan *Impressions: high to low*, lalu klik bookmark tadi. Iklan beserta gambar & videonya masuk otomatis.
   - Klik **Bikin 5 konten mirip** di iklan mana pun, dan tim marketing akan menulis naskah serta caption untukmu.
5. **Konektor Claude (opsional):** claude.ai → **Settings → Connectors → Add custom connector** → isi `https://<alamat-website>/mcp` → **Connect** → masuk dengan kode Telegram → **Izinkan**.

---

## Opsional

### Otak Claude lewat Puter
Kalau belum dilakukan saat setup, jalankan:
```bash
npm run puter:login
```
Puter memberi jatah gratis bulanan. Kalau jatahnya habis, asisten otomatis memakai Gemma (gratis) sampai jatahnya terisi lagi. Penulisan konten memakai Opus, yang lebih boros jatah.

### Gmail & Google Drive
1. [console.cloud.google.com](https://console.cloud.google.com) → buat project → **APIs & Services → Library** → aktifkan **Gmail API** dan **Google Drive API**.
2. **Google Auth Platform → Branding:** isi nama app & email. **Audience:** *External*, tambahkan emailmu sebagai test user, lalu **Publish app**.
3. **Clients → Create client** → *Web application* → *Authorized redirect URI*: `https://<alamat-website>/api/google/callback`
4. Simpan kredensialnya:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
5. Website → **Sistem → Hubungkan Google**. Kalau muncul layar "Google hasn't verified this app", itu wajar untuk app pribadi: pilih *Advanced → Go to …*.

### Jev AI (penilai iklan kompetitor)
```bash
npx wrangler secret put JEV_API_KEY
```
Kalau kredit Jev habis, iklan otomatis dinilai oleh tim AI sendiri.

### Video otomatis di Studio Konten (berbayar)
Tanpa ini, Studio Konten memberi prompt siap tempel untuk ChatGPT (Sora) atau Grok Imagine, gratis memakai akunmu sendiri. Untuk membuat video langsung dari aplikasi (bayar per detik video):
```bash
npx wrangler secret put OPENAI_API_KEY   # Sora (ChatGPT)
npx wrangler secret put XAI_API_KEY      # Grok Imagine — butuh foto karakter yang diunggah di tahap Hasil
```

### Ubah nama, zona waktu, atau model
Edit bagian `"vars"` di `wrangler.jsonc` (`OWNER_NAME`, `TIMEZONE_OFFSET`, `MODEL_FAST`, `MODEL_SMART`), lalu jalankan `npm run deploy`.

---

## Memperbarui ke versi terbaru

```bash
git pull
npm install
npm run db:migrate
npm run deploy
```

Data (tugas, catatan, memori) tidak hilang saat memperbarui.

---

## Batas paket gratis Cloudflare

Batas ini cukup untuk satu orang. Yang perlu diperhatikan:

| Layanan | Batas gratis | Dipakai untuk |
|---|---|---|
| Workers | 100.000 request/hari | Bot, website, konektor |
| Workers AI | 10.000 neuron/hari | Gemma (cadangan), Whisper (voice note), memori, penilaian iklan |
| D1 | 5 GB, 100.000 tulis/hari | Semua data |
| KV | 1 GB, 1.000 tulis/hari | Gambar/video iklan kompetitor, login konektor |
| Vectorize | ±5 juta dimensi tersimpan | Pencarian makna (±4.800 catatan + memori) |

---

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Bot tidak membalas | Buka `https://<alamat>/setup?secret=<TELEGRAM_WEBHOOK_SECRET>` (nilainya ada di `.setup-output.txt`). Untuk subdomain baru, tunggu 1–2 menit lalu coba lagi. |
| Bot membalas "Chat ID kamu: …" | `OWNER_CHAT_ID` belum terisi. Isi di `wrangler.jsonc`, lalu `npm run deploy`. |
| Kode login website tidak masuk | Pastikan bot sudah di-`/start` dari akun Telegram pemilik. Kode berlaku 5 menit dan bisa diminta lagi setelah 60 detik. |
| Balasan "⚠️ otak AI sedang bermasalah" | Biasanya jatah Puter habis atau gangguan sementara. Cek di website → Kantor 3D (Gemma bekerja = mode cadangan). |
| `npm run setup` gagal di langkah Vectorize/Queue | Pastikan akun Cloudflare sudah terverifikasi email. Ulangi `npm run setup`. |
| Gambar iklan kompetitor kosong | Link media Facebook kedaluwarsa dalam beberapa hari. Scan ulang iklannya. Iklan pemenang disalin permanen otomatis tiap 5 menit. |

---

## Keamanan & privasi

- Setiap duplikat **terpisah total**: database, bot, dan login milikmu sendiri. Pemilik asli tidak bisa melihat datamu, begitu juga sebaliknya.
- Bot hanya melayani chat ID pemilik. Pesan dari orang lain diabaikan.
- Jangan pernah membagikan atau meng-commit `.dev.vars`, `.setup-output.txt`, atau token bot.
- Kalau token bot bocor: @BotFather → `/revoke`, lalu `npx wrangler secret put TELEGRAM_BOT_TOKEN` dan buka `/setup?secret=…` lagi.

---

## Untuk pemilik asli: cara membagikan

1. **Beri akses kode.** Pilih salah satu:
   - GitHub → repo → **Settings → Collaborators → Add people** (akses baca cukup), atau
   - **Code → Download ZIP**, lalu kirim file-nya.
2. **Jangan** ikut membagikan `.dev.vars`, `.setup-output.txt`, token bot, atau akses akun Cloudflare-mu. Penerima membuat semuanya sendiri lewat `npm run setup`.
3. Kirim tautan dokumen ini ke penerima.
