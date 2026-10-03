# Migrasi Puter ke Hermes: Setup Guide

## Status Saat Ini

- ✅ **Worker code** sudah diupdate (Puter → Hermes)
- ✅ **API endpoint skeleton** siap (`src/hermes-api-server.ts`)
- ⏳ **Tunnel setup** — belum, butuh untuk connect local Hermes ke cloud Worker

## Architecture Baru

```
User (Telegram)
  ↓ webhook
Cloudflare Worker (Cloud)
  ↓ HTTP POST
Hermes Local (Localhost)
  ├─ API Server (src/hermes-api-server.ts)
  └─ Agent Logic (runAgent)
  ↓ Response
Worker ↓
D1 (Store tasks/notes/memories, unchanged)
```

## Setup Steps

### Opsi A: Development Lokal (wrangler dev)

**Untuk testing cepat tanpa tunnel.**

```bash
# 1. Terminal 1: Jalankan Hermes API Server
cd /tmp/asisten-ai
# Compile TypeScript (atau gunakan ts-node)
npx tsc src/hermes-api-server.ts -d
# Atau pakai ts-node/esm
npm exec ts-node -- src/hermes-api-server.ts

# Expect output: ✅ Hermes API Server listening on http://127.0.0.1:3000

# 2. Terminal 2: Jalankan Worker lokal (dev mode)
cd /tmp/asisten-ai
npm run dev

# Expect output: ⛅ Cloudflare Workers... listening on http://localhost:8787
```

**Modify wrangler.jsonc untuk dev:**
```jsonc
"vars": {
  ...
  "HERMES_API_ENDPOINT": "http://127.0.0.1:3000/api/agent"  // Local dev
}
```

**Test:**
```bash
# Curl ke local Worker
curl -X POST http://localhost:8787/telegram \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: YOUR_SECRET" \
  -d '{
    "update_id": 1,
    "message": {
      "chat": {"id": 1001715052},
      "text": "Ingetin aku meeting besok jam 10"
    }
  }'
```

---

### Opsi B: Production (Cloud dengan Tunnel)

**Untuk deploy dan production.**

#### 1. Setup Tunnel (pilih salah satu)

**Via ngrok (paling mudah):**
```bash
# Install ngrok (dulu kalau belum)
# Dari: https://ngrok.com/download

# Jalankan tunnel
ngrok http 3000

# Output:
# Forwarding                    https://xxxx-xxxx-xxxx.ngrok-free.app -> http://localhost:3000
# Copy URL itu

# Update Cloudflare Worker secret:
npx wrangler secret put HERMES_API_ENDPOINT
# Paste: https://xxxx-xxxx-xxxx.ngrok-free.app/api/agent
```

**Via Cloudflare Tunnel (gratis, resmi):**
```bash
# Install cloudflared
# Dari: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/installation/

# Atur domain (atau subdomain di Cloudflare DNS)
# Contoh: hermes.example.com → Cloudflare

# Buat tunnel
cloudflared tunnel create asisten-ai-hermes
# Output: UUID dan token

# Route ke local server
cloudflared tunnel route dns asisten-ai-hermes hermes.example.com

# Jalankan tunnel
cloudflared tunnel run --url http://localhost:3000 asisten-ai-hermes

# Update Worker secret:
npx wrangler secret put HERMES_API_ENDPOINT
# Paste: https://hermes.example.com/api/agent
```

#### 2. Jalankan Hermes API Server di Production

**Opsi: PM2 (process manager)**
```bash
# Install PM2
npm install -g pm2

# Buat ecosystem.config.js
cat > ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: "hermes-api",
    script: "scripts/hermes-api-server.mjs",
    watch: false,
    env: {
      HERMES_API_PORT: 3000
    }
  }]
};
EOF

# Compile & start
npm run build
pm2 start ecosystem.config.js
pm2 logs hermes-api
```

**Opsi: Docker (recommended untuk production)**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
EXPOSE 3000
CMD ["node", "scripts/hermes-api-server.mjs"]
```

```bash
docker build -t asisten-ai-hermes .
docker run -p 3000:3000 \
  -e HERMES_API_PORT=3000 \
  asisten-ai-hermes
```

#### 3. Deploy Worker

```bash
# Set secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put HERMES_API_ENDPOINT

# Deploy
npm run deploy

# Verify webhook
curl "https://api.telegram.org/botTOKEN/getWebhookInfo"
```

---

## Checklist Implementation

- [ ] **Hermes API Server** berjalan (localhost:3000 atau tunnel)
- [ ] **wrangler.jsonc** set `HERMES_API_ENDPOINT` dengan benar
- [ ] **Worker** deployed (test: `npm run deploy`)
- [ ] **Webhook** setup di Telegram
- [ ] **Test flow**: Kirim pesan Telegram → Agent respond → Task disimpan di D1
- [ ] **D1 Data** tetap intact (tidak hilang saat migrasi)

---

## Troubleshooting

**Q: Worker error "HERMES_API_ENDPOINT not defined"**
- Check wrangler.jsonc: `HERMES_API_ENDPOINT` ada di `vars`?
- Atau set sebagai secret: `npx wrangler secret put HERMES_API_ENDPOINT`

**Q: Hermes API Server tidak respond**
- Cek server running: `curl http://127.0.0.1:3000/health` (belum ada, tambahkan nanti)
- Cek logs: `npx wrangler tail` (dev mode)

**Q: "Connection refused" dari Worker ke Hermes**
- Di dev: HERMES_API_ENDPOINT harus `http://127.0.0.1:3000/api/agent`
- Di production: tunnel harus running, URL harus accessible dari cloudflare

**Q: D1 data hilang**
- D1 tidak ter-touch, tetap intact di Cloudflare
- Cek: `npx wrangler d1 execute asisten-ai-db --command \"SELECT COUNT(*) FROM tasks\"`

---

## Next Steps

1. Buat endpoint `/health` di Hermes API Server untuk quick diagnostics
2. Integrate actual `runAgent()` logic (sekarang masih mock)
3. Setup proper error handling & retry logic
4. Add logging & monitoring
5. Load testing sebelum production switch

---

## Rollback Plan

Kalau ada issue di production:

```bash
# Revert ke Puter (di git history tersedia)
git revert 3ad6cb2  # Commit yang ganti Puter
npm run deploy

# Atau stay dengan Hermes tapi pake fallback terus
# (sudah ada di code: jatuh ke Workers AI Gemma kalau Hermes fail)
```

---

## Local Testing Tanpa Tunnel

```bash
# Terminal 1: Hermes API Server
npm exec ts-node -- src/hermes-api-server.ts

# Terminal 2: Worker dev
npm run dev

# Terminal 3: Manual test
curl http://localhost:8787/telegram \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: test_secret" \
  -d '{"update_id":1,"message":{"chat":{"id":1001715052},"text":"test"}}'

# Check D1 (via wrangler):
npx wrangler d1 execute asisten-ai-db --command \"SELECT * FROM tasks ORDER BY id DESC LIMIT 1\"
```

---

## Production Checklist

- [ ] Hermes API Server dalam container / PM2
- [ ] Tunnel (ngrok / cloudflared) aktif dan stable
- [ ] Worker secret `HERMES_API_ENDPOINT` pointing ke tunnel URL
- [ ] Webhook Telegram pointing ke Worker URL
- [ ] Monitoring/logging setup
- [ ] Gradual rollout: enable untuk subset user dulu
- [ ] Performance baseline established
- [ ] Rollback procedure tested

Siap lanjut ke mana?
