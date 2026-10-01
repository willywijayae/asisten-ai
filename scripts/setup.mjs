#!/usr/bin/env node
// Setup otomatis untuk duplikat baru Asisten AI / Second Brain.
// Membuat semua resource Cloudflare di akun yang sedang login, mengisi wrangler.jsonc,
// menyambungkan bot Telegram, memasang secret, migrasi database, lalu deploy.
//
// Pemakaian:  npm run setup
// Aman diulang: resource yang sudah ada dipakai ulang, bukan dibuat dobel.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CONFIG = "wrangler.jsonc";
const rl = createInterface({ input: stdin, output: stdout });
const say = (s = "") => console.log(s);
const step = (n, s) => say(`\n\x1b[1m[${n}] ${s}\x1b[0m`);
const ok = (s) => say(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => say(`  \x1b[33m!\x1b[0m ${s}`);
const fail = (s) => {
  say(`\n\x1b[31m✗ ${s}\x1b[0m`);
  process.exit(1);
};

async function ask(q, def = "") {
  const a = (await rl.question(`  ${q}${def ? ` [${def}]` : ""}: `)).trim();
  return a || def;
}

/** Jalankan perintah; output ditampilkan sekaligus dikumpulkan. `interactive` = pengguna bisa menjawab prompt. */
function run(cmd, args, { interactive = false, quiet = false, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: [interactive ? "inherit" : "pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!quiet) stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d;
      if (!quiet) process.stderr.write(d);
    });
    if (!interactive) {
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code, out }));
  });
}
const wrangler = (args, opts) => run("npx", ["wrangler", ...args], opts);

async function wranglerJson(args) {
  const { code, out } = await wrangler(args, { quiet: true });
  if (code !== 0) return [];
  try {
    return JSON.parse(out.slice(out.indexOf("[")));
  } catch {
    return [];
  }
}

async function telegram(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} gagal`);
  return json.result;
}

async function main() {
  say("\x1b[1mSetup Asisten AI / Second Brain\x1b[0m");
  say("Semua resource dibuat di akun Cloudflare yang sedang login. Bisa diulang kalau ada langkah yang gagal.\n");
  if (!existsSync(CONFIG)) fail(`Jalankan dari folder proyek (tidak menemukan ${CONFIG}).`);

  // 1. Login Cloudflare
  step(1, "Cek login Cloudflare");
  let who = await wrangler(["whoami"], { quiet: true });
  if (!/associated with the email|You are logged in/i.test(who.out)) {
    warn("Belum login. Browser akan terbuka untuk login Cloudflare…");
    await wrangler(["login"], { interactive: true });
    who = await wrangler(["whoami"], { quiet: true });
    if (!/associated with the email|You are logged in/i.test(who.out)) fail("Login Cloudflare gagal. Jalankan `npx wrangler login` lalu ulangi.");
  }
  ok("Sudah login Cloudflare");

  // 2. Data pemilik
  step(2, "Data pemilik");
  const ownerName = await ask("Nama panggilan kamu (untuk sapaan asisten)", "");
  const worker = (await ask("Nama aplikasi/Worker (huruf kecil & tanda -)", "asisten-ai")).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const tz = await ask("Zona waktu: +07:00 WIB, +08:00 WITA, +09:00 WIT", "+07:00");
  if (!/^[+-]\d{2}:\d{2}$/.test(tz)) fail("Format zona waktu harus seperti +07:00");

  // 3. Bot Telegram
  step(3, "Bot Telegram");
  say("  Buat bot di Telegram: chat @BotFather → /newbot → ikuti langkahnya → salin token.");
  const botToken = await ask("Token bot dari BotFather");
  let bot;
  try {
    bot = await telegram(botToken, "getMe");
  } catch (e) {
    fail(`Token bot tidak valid: ${e.message}`);
  }
  ok(`Bot @${bot.username}`);
  // getUpdates hanya jalan kalau webhook mati.
  await telegram(botToken, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
  say(`  Sekarang buka Telegram, cari @${bot.username}, lalu kirim pesan apa saja (mis. "halo").`);
  let chatId = null;
  let chatName = "";
  for (let i = 0; i < 40 && !chatId; i++) {
    const updates = await telegram(botToken, "getUpdates", { timeout: 3, allowed_updates: ["message"] }).catch(() => []);
    const msg = [...updates].reverse().find((u) => u.message?.chat?.type === "private")?.message;
    if (msg) {
      chatId = String(msg.chat.id);
      chatName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ");
    } else stdout.write(".");
  }
  if (!chatId) chatId = await ask("\n  Belum terdeteksi. Ketik chat ID kamu manual (atau Enter untuk mengisi nanti)", "");
  else ok(`Pemilik: ${chatName} (chat ID ${chatId}) — bot hanya akan melayani akun ini`);

  // 4. Resource Cloudflare
  step(4, "Membuat resource Cloudflare");
  const names = { db: `${worker}-db`, queue: `${worker}-jobs`, index: `${worker}-memory`, kvOauth: `${worker}-oauth`, kvMedia: `${worker}-media` };

  if (!(await wranglerJson(["d1", "list", "--json"])).some((d) => d.name === names.db)) await wrangler(["d1", "create", names.db], { quiet: true });
  const db = (await wranglerJson(["d1", "list", "--json"])).find((d) => d.name === names.db);
  if (!db) fail(`Gagal membuat database D1 ${names.db}`);
  ok(`D1 ${names.db}`);

  const kvId = async (title) => {
    let ns = (await wranglerJson(["kv", "namespace", "list"])).find((n) => n.title === title);
    if (!ns) {
      await wrangler(["kv", "namespace", "create", title], { quiet: true });
      ns = (await wranglerJson(["kv", "namespace", "list"])).find((n) => n.title === title);
    }
    if (!ns) fail(`Gagal membuat KV ${title}`);
    ok(`KV ${title}`);
    return ns.id;
  };
  const oauthKv = await kvId(names.kvOauth);
  const mediaKv = await kvId(names.kvMedia);

  const q = await wrangler(["queues", "create", names.queue], { quiet: true });
  if (q.code !== 0 && !/already exists|already taken/i.test(q.out)) fail(`Gagal membuat queue ${names.queue}:\n${q.out}`);
  ok(`Queue ${names.queue}`);

  if (!(await wranglerJson(["vectorize", "list", "--json"])).some((v) => v.name === names.index)) {
    const v = await wrangler(["vectorize", "create", names.index, "--dimensions=1024", "--metric=cosine"], { quiet: true });
    if (v.code !== 0) fail(`Gagal membuat Vectorize ${names.index}:\n${v.out}`);
  }
  await wrangler(["vectorize", "create-metadata-index", names.index, "--property-name=type", "--type=string"], { quiet: true });
  ok(`Vectorize ${names.index}`);

  // 5. wrangler.jsonc
  step(5, `Menulis ${CONFIG}`);
  if (!existsSync(`${CONFIG}.bak`)) copyFileSync(CONFIG, `${CONFIG}.bak`);
  let cfg = readFileSync(CONFIG, "utf8");
  cfg = cfg.replace(/("name":\s*")[^"]*(")/, `$1${worker}$2`);
  cfg = cfg.replace(/("database_name":\s*")[^"]*(")/, `$1${names.db}$2`);
  cfg = cfg.replace(/("database_id":\s*")[^"]*(")/, `$1${db.uuid}$2`);
  cfg = cfg.replace(/(\{\s*"binding":\s*"MEDIA",\s*"id":\s*")[^"]*(")/, `$1${mediaKv}$2`);
  cfg = cfg.replace(/(\{\s*"binding":\s*"OAUTH_KV",\s*"id":\s*")[^"]*(")/, `$1${oauthKv}$2`);
  cfg = cfg.replace(/("queue":\s*")[^"]*(")/g, `$1${names.queue}$2`);
  cfg = cfg.replace(/("index_name":\s*")[^"]*(")/, `$1${names.index}$2`);
  cfg = cfg.replace(/("PUBLIC_URL":\s*")[^"]*(")/, `$1$2`);
  cfg = cfg.replace(/("OWNER_NAME":\s*")[^"]*(")/, `$1${ownerName.replace(/"/g, "")}$2`);
  cfg = cfg.replace(/("OWNER_CHAT_ID":\s*")[^"]*(")/, `$1${chatId}$2`);
  cfg = cfg.replace(/("TIMEZONE_OFFSET":\s*")[^"]*(")/, `$1${tz}$2`);
  writeFileSync(CONFIG, cfg);
  ok(`${CONFIG} diperbarui (cadangan: ${CONFIG}.bak)`);

  // 6. Database
  step(6, "Membuat tabel database");
  const mig = await new Promise((resolve) =>
    spawn("npx", ["wrangler", "d1", "migrations", "apply", names.db, "--remote"], { stdio: "inherit", shell: process.platform === "win32" }).on(
      "close",
      (code) => resolve({ code }),
    ),
  );
  if (mig.code !== 0) fail("Migrasi database gagal. Ulangi `npm run setup` atau `npm run db:migrate`.");
  ok("Tabel siap");

  // 7. Deploy
  step(7, "Build & deploy (kalau ditanya subdomain workers.dev, pilih nama bebas)");
  // Deploy pertama interaktif penuh (wrangler bisa menanyakan subdomain workers.dev untuk akun baru),
  // lalu deploy ulang singkat untuk membaca URL-nya.
  const first = spawn("npm", ["run", "deploy"], { stdio: "inherit", shell: process.platform === "win32" });
  const firstCode = await new Promise((r) => first.on("close", r));
  if (firstCode !== 0) fail("Deploy gagal. Lihat pesan di atas, perbaiki, lalu ulangi `npm run setup`.");
  const dep = await wrangler(["deploy"], { quiet: true });
  const url = (dep.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) ?? [])[0];
  if (!url) fail("Tidak menemukan URL hasil deploy di output.");
  ok(`Online di ${url}`);

  // 8. Secret
  step(8, "Memasang secret");
  const secrets = {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_WEBHOOK_SECRET: randomBytes(24).toString("hex"),
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    INGEST_KEY: randomBytes(32).toString("hex"),
  };
  const tmp = `.setup-secrets.tmp.json`;
  writeFileSync(tmp, JSON.stringify(secrets));
  const sec = await wrangler(["secret", "bulk", tmp], { quiet: true });
  unlinkSync(tmp);
  if (sec.code !== 0) fail(`Gagal memasang secret:\n${sec.out}`);
  ok("Secret terpasang");
  appendFileSync(
    ".setup-output.txt",
    `# ${new Date().toISOString()} — SIMPAN BAIK-BAIK, JANGAN DIBAGIKAN\nURL=${url}\nBOT=@${bot.username}\nTELEGRAM_WEBHOOK_SECRET=${secrets.TELEGRAM_WEBHOOK_SECRET}\nINGEST_KEY=${secrets.INGEST_KEY}\n\n`,
  );

  // 9. Webhook Telegram (worker butuh beberapa detik untuk memuat secret baru; subdomain baru bisa butuh 1-2 menit)
  step(9, "Menyambungkan webhook Telegram");
  let hooked = false;
  for (let i = 0; i < 12 && !hooked; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const res = await fetch(`${url}/setup?secret=${secrets.TELEGRAM_WEBHOOK_SECRET}`);
      const body = await res.json().catch(() => ({}));
      hooked = res.ok && body.webhook === true;
    } catch {
      /* subdomain belum siap */
    }
    if (!hooked) stdout.write(".");
  }
  if (hooked) ok("Bot tersambung");
  else warn(`Belum tersambung (subdomain baru kadang butuh beberapa menit). Nanti buka: ${url}/setup?secret=<TELEGRAM_WEBHOOK_SECRET di .setup-output.txt>`);

  // 10. Otak Claude lewat Puter (opsional)
  step(10, "Otak Claude lewat Puter (opsional)");
  say("  Tanpa ini asisten tetap jalan memakai model gratis Workers AI (Gemma).");
  if ((await ask("Hubungkan akun Puter sekarang? (y/n)", "y")).toLowerCase().startsWith("y")) {
    await run("npm", ["run", "puter:login"], { interactive: true });
  }

  say(`\n\x1b[1m\x1b[32mSelesai!\x1b[0m`);
  say(`  Website admin : ${url}  (login dengan kode yang dikirim ke Telegram)`);
  say(`  Bot Telegram  : @${bot.username}  → kirim /start lalu /profil`);
  say(`  Konektor Claude (MCP): ${url}/mcp`);
  say(`  Kunci & URL tersimpan di .setup-output.txt (jangan di-commit / dibagikan).`);
  if (!chatId) warn("OWNER_CHAT_ID belum diisi: kirim /id ke bot, isi di wrangler.jsonc, lalu `npm run deploy`.");
  rl.close();
}

main().catch((e) => fail(e.stack ?? String(e)));
