
# Setup secrets untuk Cloudflare Worker

Jalankan commands berikut (replace dengan nilai actual):

npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste: <bot token dari BotFather Telegram>

npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  
# Paste: <secret yang kamu buat sendiri, minimal 10 char>

npx wrangler secret put HERMES_API_ENDPOINT
# Paste dev: http://127.0.0.1:3000/api/agent
# Paste prod: https://<tunnel-url>/api/agent

# Setelah semua diset, deploy:
npm run deploy
