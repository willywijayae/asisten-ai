# Asisten AI — Second Brain & Personal Assistant

**Personal AI assistant untuk single user: task manager, note-taking, competitor research, content studio, dan marketing automation.**

## Quick Links

- 🏗️ **[ARCHITECTURE](./ARCHITECTURE.md)** — System design, data flow, modules
- 📋 **[PRD](./PRD.md)** — Product requirements & features
- 🛠️ **[TRD](./TRD.md)** — Technical requirements & stack  
- 🔀 **[APP_FLOW](./APP_FLOW.md)** — User journeys & interaction flows
- 🗄️ **[BACKEND_SCHEMA](./BACKEND_SCHEMA.md)** — Database schema & API contracts
- 🧪 **[TESTING](./TESTING.md)** — Test strategy, cases, manual testing
- 🎨 **[DESIGN_SYSTEM](./DESIGN_SYSTEM.md)** — UI components, colors, spacing, patterns
- 🤖 **[AGENTS](./AGENTS.md)** — Agent system, tools, prompts
- 🔒 **[SECURITY](./SECURITY.md)** — Authentication, data protection, threat model
- 📝 **[CODE_STYLE](./CODE_STYLE.md)** — Naming, formatting, best practices

## Overview

**asisten-ai** adalah Cloudflare Workers + D1 + Vectorize project yang menyediakan personal AI assistant dalam bentuk Telegram bot. Bot ini menghubungkan chat dengan:

- **Hermes Agent** (lokal, via API tunnel) — Reasoning, task planning, memory extraction
- **Claude / GPT models** (via 9router combo) — Fast (Haiku) & Smart (Opus) tiers
- **Gmail & Google Drive** — Email search, document reading
- **Competitor Ad Library** — Ad library research, analytics
- **Content Studio** — Script generation, hook creation, video storyboarding

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│ Telegram Bot                                                 │
│ @asisten_ai_bot (Webhook mode)                             │
└─────────────────────────────────────────────────────────────┘
                           ↓ (POST /telegram)
┌─────────────────────────────────────────────────────────────┐
│ Cloudflare Worker (asisten-ai.workers.dev)                 │
│ ├─ Routes: /api/*, /telegram, /setup, /status, /authorize  │
│ ├─ Queue: Telegram updates, async jobs (remix/studio/video)│
│ ├─ Cron: 5-min reminders, nightly briefing, weekly review   │
│ └─ OAuth: MCP server for Claude (via Cloudflare Workers)   │
└─────────────────────────────────────────────────────────────┘
    ↓               ↓              ↓               ↓
  D1 DB       Vectorize      KV Store       Hermes API
  (Tasks,      (Memory        (OAuth,      (localhost:3000)
  Notes)      Search)        Media)       with tunnel
    ↓                                            ↓
User Memory                                  9router
(Vectorize                                (Haiku/Opus
 hybrid                                     combos)
 search)
```

## Key Features (Current)

| Feature | Status | Module |
|---------|--------|--------|
| Chat via Telegram | ✅ Live | `telegram.ts`, `agent.ts` |
| Task management | ✅ Live | `db.ts`, `api.ts` |
| Notes & memory | ✅ Live | `memory.ts`, `db.ts` |
| Reminders & briefing | ✅ Live | `briefing.ts`, `activity.ts` |
| Competitor research | ✅ Live | `competitors.ts` |
| Content studio (hooks, scripts) | ✅ Live | `studio.ts` |
| Marketing team delegation | ✅ Live | `marketing.ts`, `agent.ts` |
| Gmail/Drive integration | ✅ Live | `google.ts` |
| MCP connector for Claude | ✅ Live | `mcp.ts`, `oauth.ts` |
| Weekly review (CEO agent) | ✅ Live | `ceo.ts` |
| Paid Ads guide (MCP connector) | ✅ New | `web/src/pages/PaidAds.tsx` |

## Stack

**Frontend**
- React 18 (TypeScript)
- Vite
- Tailwind CSS
- Lucide React (icons)

**Backend**
- Cloudflare Workers (TypeScript)
- D1 (SQLite)
- Vectorize (Vector search)
- Queues (Async jobs)
- KV Namespace (OAuth, media cache)

**AI**
- Claude (via Hermes local router 9router)
- Workers AI (fallback: Gemma)
- MCP Protocol (Claude integration)

**Integration**
- Telegram Bot API (webhook)
- Google APIs (Gmail, Drive, Search)
- Cloudflare OAuth 2.1 (MCP clients)

## Directory Structure

```
asisten-ai/
├── docs/                   # Documentation (you are here)
├── migrations/             # D1 schema versions
├── src/                    # Backend (Cloudflare Worker)
│   ├── index.ts           # Entry point, routes, cron
│   ├── agent.ts           # Main agent + tool definitions
│   ├── api.ts             # REST API (/api/*)
│   ├── db.ts              # D1 database helpers
│   ├── telegram.ts        # Telegram bot handler
│   ├── memory.ts          # Vectorize search + memory ops
│   ├── marketing.ts       # Marketing team delegation
│   ├── studio.ts          # Content studio (studio.ts)
│   ├── competitors.ts     # Ad library research
│   ├── briefing.ts        # Daily briefing generation
│   ├── ceo.ts             # Weekly review agent
│   ├── google.ts          # Gmail/Drive integration
│   ├── mcp.ts             # MCP server (Claude)
│   ├── oauth.ts           # OAuth authorize endpoint
│   ├── activity.ts        # Activity logging
│   ├── auth.ts            # Auth helpers
│   ├── profile.ts         # User profile & preferences
│   ├── time.ts            # Timezone utilities
│   ├── env.ts             # Type definitions (Env, JobMessage)
│   └── ...
├── web/                    # Frontend (React SPA)
│   ├── src/
│   │   ├── pages/         # Page components (Dashboard, Chat, Tasks, Notes, etc.)
│   │   ├── components/    # Reusable UI components
│   │   ├── lib/           # Utilities (API client, hooks, time)
│   │   ├── office/        # 3D office scene (Three.js)
│   │   ├── styles.css     # Tailwind config
│   │   ├── App.tsx        # Main routing
│   │   └── main.tsx       # Entry point
│   ├── vite.config.ts
│   └── dist/              # Built assets
├── wrangler.jsonc         # Cloudflare config
├── package.json
└── tsconfig.json
```

## Environment Variables

**Required (.env)**
```
# Telegram
TELEGRAM_BOT_TOKEN=          # From @BotFather
TELEGRAM_ALLOWED_USERS=      # Comma-separated chat IDs
TELEGRAM_WEBHOOK_SECRET=     # Random token for webhook auth

# Hermes (local AI router)
HERMES_API_ENDPOINT=http://localhost:3000
HERMES_API_KEY=              # Bearer token

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=       # From dashboard
PUBLIC_URL=                  # auto-detected if empty

# Owner
OWNER_NAME=                  # Display name
OWNER_CHAT_ID=               # Your Telegram chat ID

# Models
MODEL_FAST=                  # e.g. "smart-easy-claude" (Haiku)
MODEL_SMART=                 # e.g. "smart-hard-claude" (Opus)
FALLBACK_MODEL=              # e.g. "@cf/google/gemma-4-26b-a4b-it"

# Other
TIMEZONE_OFFSET=+07:00       # Your timezone
```

## Key Concepts

### Agents
- **Chief of Staff** — Main bot, handles chat, tasks, notes
- **Marketing Team** — Delegated content work (hooks, copy, strategy)
- **CEO** — Weekly review & insights
- **Specialists** — Domain experts (video script, competitor audit, etc.)

### Memory Tiers
1. **Activity Log** — Real-time chat/action snapshots (24h)
2. **Short-term Memory** — Extracted facts (Vectorize, hybrid search)
3. **Long-term Memory** — Notes, preferences, learnings
4. **Task Log** — Open, pending, done tasks

### Job Queue
- `remix` — Competitor research + scoring
- `studio` — Content generation stages
- `video` — Video creation tasks

### Crons
- `*/5 * * * *` — Reminders, media import, competitor scoring
- `0 0 * * *` — Nightly briefing, activity pruning
- `0 14 * * *` — Evening summary
- `0 13 * * SUN` — Weekly CEO review

## Getting Started

### Local Development

```bash
# Install
npm install

# Build
npm run build

# Deploy
npm run deploy

# Test bot
curl "https://asisten-ai.willywijaya46.workers.dev/setup?secret=<TELEGRAM_WEBHOOK_SECRET>"
```

### Telegram Setup
```bash
# Get token from @BotFather
# Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET in .env
# Deploy to Cloudflare
# Register webhook via /setup endpoint
```

## Deployment

**Cloudflare Workers**
- Requires: Node.js 18+, Wrangler 4+
- Account ID + API token (from Cloudflare dashboard)
- Automatic asset upload (React SPA)
- D1 database auto-created on first deploy

## Testing

See [TESTING.md](./TESTING.md) for:
- Unit test strategy
- Integration test examples
- Manual test cases
- Debugging endpoints

## Contributing

See [CODE_STYLE.md](./CODE_STYLE.md) for:
- Naming conventions
- TypeScript patterns
- File organization
- Git commit style

## Security

See [SECURITY.md](./SECURITY.md) for:
- OAuth 2.1 (MCP clients)
- Telegram webhook validation
- Env secret management
- Data retention & privacy
- Threat model

## Troubleshooting

### Bot not responding
- Check `systemctl --user status hermes-gateway` (is it running?)
- Verify `HERMES_API_ENDPOINT` & `HERMES_API_KEY` in Worker
- Tail logs: `journalctl --user -u hermes-gateway -f`

### Tasks not saving
- Check D1 migration status: `wrangler d1 list`
- Verify schema: `wrangler d1 execute asisten-ai-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"`

### Telegram webhook issues
- Call `/status?secret=<secret>` to diagnose
- Check `TELEGRAM_WEBHOOK_SECRET` matches config
- Verify bot token hasn't been revoked

## Performance

**Target metrics**
- Chat response: < 5 seconds (Haiku), < 15s (Opus)
- Task add: < 1s
- Memory search: < 500ms (Vectorize)
- Briefing generation: < 2 minutes (nightly cron)

**Limits**
- D1: 10GB limit (current ~5MB)
- Vectorize: 1M dims, ~1k vectors per user
- Workers: 50ms CPU time soft, 30s hard timeout
- KV: 25 namespaces, 1GB per namespace

## Roadmap

- [ ] Named tunnel (instead of quick-tunnel)
- [ ] Self-hosted Hermes bridge (instead of localhost:3000)
- [ ] WhatsApp integration (parallel to Telegram)
- [ ] Slack integration
- [ ] Google Calendar sync
- [ ] Expense tracking
- [ ] Custom agent creation UI
- [ ] Workflow automation (if X then Y)

## License

MIT (see LICENSE file)

## Support

Contact: [Your email]
