# Security & Data Protection

## 1. Authentication & Authorization

### 1.1 Telegram Webhook

**Validation (every POST /telegram):**
```
Header: x-telegram-bot-api-secret-token
Must equal: env.TELEGRAM_WEBHOOK_SECRET (32-char random)
If mismatch → 403 Forbidden
```

**Idempotency:**
```
Track: updates_processed.update_id
Query: UPDATE updates_processed SET processed_at = NOW()
If update_id already exists → skip (Telegram might retry)
```

**Owner Check:**
```
message.chat.id must equal env.OWNER_CHAT_ID
If not → reject silently (don't reply)
```

### 1.2 OAuth 2.1 (MCP Clients)

**Flow:**
```
Claude Client
  ↓
POST /oauth/register (dynamic client registration)
  → Generate client_id, client_secret
  ↓
GET /oauth/authorize (user consent screen)
  → User grants "mcp" scope (read tasks, notes, memory)
  ↓
POST /oauth/token (code exchange)
  → Issue access_token (short-lived, 1h)
  → Issue refresh_token (long-lived, 30d)
  ↓
POST /mcp (MCP resource server)
  → Header: Authorization: Bearer {access_token}
  → Return user's tasks, notes, memory (read-only)
```

**Security:**
- PKCE (Proof Key for Public Clients) — prevents code interception
- Random nonce per request
- Scope limitation: `mcp` only (no write, no delete)
- Token expiration: 1h access, 30d refresh

### 1.3 Hermes API Bridge

**Auth:**
```
Header: Authorization: Bearer {HERMES_API_KEY}
Must match: env.HERMES_API_KEY (stored in Cloudflare Secrets)
Connection: Cloudflare Quick Tunnel (localhost:3000)
```

**Risk:**
- Tunnel is temporary (URL changes on restart)
- Key exposed in env → guard .env file

---

## 2. Data Protection

### 2.1 Encryption at Rest

**D1 Database:**
- Encrypted by Cloudflare (AES-256)
- Managed keys (user cannot export)
- Backup: automatic, encrypted

**KV Namespace:**
- Encrypted by Cloudflare
- No user key management

**Vectorize:**
- Encrypted by Cloudflare
- Vector index only (cannot recover plaintext)

### 2.2 Encryption in Transit

**All requests HTTPS/TLS 1.3**
- Worker → Telegram: TLS 1.3
- Worker → Hermes: TLS 1.3 (tunnel)
- Worker ← Claude: TLS 1.3
- Worker ↔ D1: TLS (internal Cloudflare network)

### 2.3 Secrets Management

**Environment variables:**
```
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_USERS
HERMES_API_KEY
HERMES_API_ENDPOINT
OWNER_CHAT_ID
CLOUDFLARE_ACCOUNT_ID
MODEL_FAST, MODEL_SMART
TIMEZONE_OFFSET
```

**Storage:**
- Cloudflare Secrets (encrypted)
- Never logged, never in version control
- `.env` local only (git-ignored)

**Rotation:**
- Token revocation via Cloudflare dashboard
- Telegram: ask @BotFather for new token
- Hermes: regenerate key manually

---

## 3. Privacy & Data Retention

### 3.1 User Data Stored

| Data | Where | Retention | Compliance |
|------|-------|-----------|-----------|
| Tasks | D1 | Until deleted by user | User owns |
| Notes | D1 | Until deleted by user | User owns |
| Memories | D1 + Vectorize | Until deleted by user | User owns |
| Activity log | D1 | 24 hours (auto-delete) | Short-lived |
| Chat history | Session memory | During conversation only | Not persisted |
| Media (competitor ads) | KV | 7 days (TTL) | Cacheable, expires |
| OAuth tokens | KV | 1h access, 30d refresh | Managed by Cloudflare |

### 3.2 Data User Cannot Access

- Other users' data (single-user design)
- Cloudflare's internal logs
- Hermes gateway internal state
- Model weights (Claude API)

### 3.3 GDPR Compliance

**Right to deletion:**
- User can delete tasks, notes, memories via API
- Bulk delete: `DELETE FROM tasks WHERE user_id = ?`
- Activity log auto-deletes after 24h
- No backup export for user

**Data portability:**
- Can export via `GET /api/tasks` + `GET /api/notes`
- Manual JSON export recommended

**Transparency:**
- Privacy policy: link to Cloudflare, Google, Telegram T&C
- User must consent to data storage (in bot intro)

---

## 4. Threat Model

### 4.1 Attacker: Unauthorized Telegram User

**Attack:** Forge message as owner

**Mitigation:**
- Telegram API validates message signature
- Worker checks `message.chat.id == OWNER_CHAT_ID`
- Webhook secret prevents replay

**Risk Level:** 🟢 LOW

---

### 4.2 Attacker: MCP Client (Malicious Claude)

**Attack:** Extract user data via MCP

**Mitigation:**
- OAuth scope limits to read-only
- Claude is trusted client (user authorized it)
- Could read: tasks, notes, memory (no secrets)
- Cannot: delete, modify, access Telegram token

**Risk Level:** 🟡 MEDIUM (requires user's explicit OAuth approval)

---

### 4.3 Attacker: Network Eavesdropper

**Attack:** Intercept TLS traffic

**Mitigation:**
- All connections TLS 1.3
- Certificate pinning (via Cloudflare)
- HSTS headers

**Risk Level:** 🟢 LOW

---

### 4.4 Attacker: Cloudflare Account Compromise

**Attack:** Access user's data in D1, KV, Vectorize

**Mitigation:**
- Cloudflare SOC 2 certified
- MFA on Cloudflare account strongly recommended
- Regular security audits by Cloudflare
- Limited damage: single user's data only

**Risk Level:** 🟠 MEDIUM-HIGH (depends on Cloudflare's security)

---

### 4.5 Attacker: Hermes Bot Hijack

**Attack:** Steal HERMES_API_KEY, get full control

**Mitigation:**
- Key stored in Cloudflare Secrets (not in code)
- Quick tunnel only for this Worker
- Hermes runs locally (separate from Worker)
- Compromise requires both Cloudflare + local access

**Risk Level:** 🟠 MEDIUM (requires multiple compromises)

---

### 4.6 Attacker: SQL Injection (D1)

**Attack:** Craft malicious task title to extract data

**Mitigation:**
- Parameterized queries (all D1 calls)
- Input validation (zod schemas)
- No dynamic SQL

**Example (safe):**
```typescript
db.prepare("SELECT * FROM tasks WHERE user_id = ? AND title = ?")
  .bind(userId, userInput)  // Bound, not concatenated
```

**Risk Level:** 🟢 LOW

---

### 4.7 Attacker: Agent Jailbreak

**Attack:** Craft message to make agent call delete_all_tasks()

**Mitigation:**
- Destructive tools require explicit user confirmation
- No delete_all_task tool (only update_task with status="cancelled")
- Agent system prompt forbids automation without approval

**Risk Level:** 🟢 LOW

---

## 5. Security Checklist

### Pre-Deployment

- [ ] All secrets in Cloudflare (not git, not .env in repo)
- [ ] `.env` file in `.gitignore`
- [ ] TELEGRAM_WEBHOOK_SECRET is random 32+ chars
- [ ] HERMES_API_KEY is strong (32+ chars)
- [ ] D1 migrations reviewed (no SQL injection)
- [ ] OAuth scopes limited to "mcp" only
- [ ] Error messages don't leak internal details

### Post-Deployment

- [ ] Cloudflare MFA enabled
- [ ] Telegram webhook validation working (`/status`)
- [ ] D1 backups enabled
- [ ] Activity log auto-pruning running (cron)
- [ ] OAuth token expiration working

### Ongoing

- [ ] Monitor error logs for SQL errors
- [ ] Audit OAuth tokens monthly (revoke unused)
- [ ] Rotate HERMES_API_KEY every 90 days
- [ ] Review D1 access logs (if available)
- [ ] Keep dependencies updated (npm audit)

---

## 6. Incident Response

### If Token Leaked

**Action:**
1. Immediately revoke token in Cloudflare dashboard
2. Generate new token
3. Update `.env` + redeploy
4. Check D1 logs for unauthorized access
5. Review OAuth tokens (revoke if unused)

**Timeline:** < 5 minutes

---

### If D1 Data Corrupted

**Action:**
1. Cloudflare manages backups (auto-restore available)
2. Contact Cloudflare support if manual restore needed
3. User data recoverable up to last backup (hourly)

---

### If MCP Token Compromised

**Action:**
1. OAuth token expires in 1h (access)
2. Refresh token revocable via user's settings
3. Attacker gains read-only access to tasks/notes
4. No production data loss (no write scope)

**Mitigation:** User revokes all MCP clients, re-authorizes

---

## 7. Security Best Practices

**For developers:**
- Never log secrets
- Use parameterized queries
- Validate user input (zod)
- Fail securely (no info leaks in error messages)
- Keep dependencies updated
- Test error scenarios

**For users:**
- Use strong Telegram password
- Enable 2FA on Cloudflare account
- Revoke unused OAuth tokens
- Don't share OWNER_CHAT_ID
- Rotate Hermes API key every 90 days

