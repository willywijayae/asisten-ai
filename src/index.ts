import { Buffer } from "node:buffer";
import type { Env } from "./env";
import * as db from "./db";
import { puterPing, runAgent, type UserPart } from "./agent";
import { Telegram, type TgCallbackQuery, type TgMessage, type TgUpdate } from "./telegram";
import { formatLocal } from "./time";
import { sendBriefing } from "./briefing";
import { clip, logActivity, pruneActivity } from "./activity";
import { extractMemories, reindexAll } from "./memory";
import { weeklyReview } from "./ceo";
import { handleApi } from "./api";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./mcp";
import { handleAuthorize } from "./oauth";
import * as profile from "./profile";

const HELP = `Halo! Aku asisten pribadimu 🤖

Yang bisa kamu lakukan:
- Chat biasa: "ingetin aku meeting sama Budi besok jam 10"
- Teruskan (forward) pesan / screenshot chat WhatsApp → aku usulkan tugasnya, kamu tinggal approve
- Kirim voice note → aku transkrip & catat poin pentingnya
- "catat bahwa password wifi kantor ada di laci" → tersimpan di second brain
- Tanya: "apa aja tugasku minggu ini?", "aku pernah catat apa soal Budi?"
- Urusan marketing: "bikinin 5 hook video Wellous", "ide konten minggu depan" → dikerjakan tim marketing

Perintah:
/tugas — daftar tugas aktif
/briefing — briefing sekarang
/review — review mingguan dari CEO tim AI
/profil — diwawancara supaya aku lebih kenal kamu
/batal — batalkan wawancara profil
/reset — lupakan riwayat obrolan
/id — lihat chat ID

Otomatis: briefing pagi 07:00, rekap malam 21:00, dan pengingat sebelum deadline.`;

const app = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Halaman izin OAuth untuk konektor MCP (Claude).
    if (url.pathname === "/authorize") return handleAuthorize(req, env);

    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url, ctx);

    if (req.method === "POST" && url.pathname === "/telegram") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await req.json()) as TgUpdate;
      await env.JOBS.send(update);
      return new Response("ok");
    }

    // Sekali jalan setelah deploy: daftarkan webhook & menu perintah ke Telegram.
    if (url.pathname === "/setup") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
      const webhook = await tg.call("setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      await tg.call("setMyCommands", {
        commands: [
          { command: "tugas", description: "Daftar tugas aktif" },
          { command: "briefing", description: "Briefing sekarang" },
          { command: "review", description: "Review mingguan dari CEO tim AI" },
          { command: "profil", description: "Wawancara profil supaya asisten lebih kenal kamu" },
          { command: "batal", description: "Batalkan wawancara profil" },
          { command: "reset", description: "Lupakan riwayat obrolan" },
          { command: "id", description: "Lihat chat ID" },
        ],
      });
      return Response.json({ webhook, url: `${url.origin}/telegram` });
    }

    // Diagnosa: status webhook dari sisi Telegram (error terakhir, antrean update).
    if (url.pathname === "/status") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
      const [bot, info] = await Promise.all([
        tg.call<{ username: string }>("getMe", {}),
        tg.call("getWebhookInfo", {}),
      ]);
      return Response.json({
        bot: `@${bot.username}`,
        webhook: info,
        owner_set: !!env.OWNER_CHAT_ID,
        puter: !!env.PUTER_AUTH_TOKEN,
        ...(url.searchParams.has("ping") ? { puterPing: await puterPing(env) } : {}),
        ...(url.searchParams.has("reindex") ? { reindex: await reindexAll(env) } : {}),
      });
    }

    return new Response("asisten-ai jalan ✅");
  },

  async queue(batch: MessageBatch<TgUpdate>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        if (await db.claimUpdate(env.DB, msg.body.update_id)) await handleUpdate(env, msg.body);
      } catch (err) {
        console.error("Gagal memproses update", err);
        const chatId = msg.body.message?.chat.id ?? msg.body.callback_query?.message?.chat.id;
        if (chatId && isOwner(env, chatId)) {
          await new Telegram(env.TELEGRAM_BOT_TOKEN)
            .send(
              chatId,
              `⚠️ Maaf, pesan terakhir gagal diproses (otak AI sedang bermasalah). Cek /tugas untuk melihat apa yang sudah tersimpan, lalu coba kirim lagi.\n\nDetail: ${String(err).slice(0, 300)}`,
            )
            .catch(() => {});
        }
      }
      msg.ack();
    }
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    if (!env.OWNER_CHAT_ID) return;
    if (event.cron === "*/5 * * * *") await sendReminders(env);
    else if (event.cron === "0 0 * * *") {
      await pruneActivity(env).catch((err) => console.error("Gagal membersihkan aktivitas", err));
      await sendBriefing(env, "morning");
    }
    else if (event.cron === "0 14 * * *") await sendBriefing(env, "evening");
    else if (event.cron === "0 13 * * SUN") await weeklyReview(env);
  },
} satisfies ExportedHandler<Env, TgUpdate>;

// OAuthProvider membungkus fetch: /mcp butuh token OAuth yang disetujui pemilik; /.well-known/*, /oauth/token,
// dan /oauth/register dilayani library; sisanya (website, API, webhook Telegram) diteruskan ke `app`.
let provider: OAuthProvider<Env> | undefined;
function oauthProvider(env: Env): OAuthProvider<Env> {
  provider ??= new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpHandler,
    defaultHandler: { fetch: app.fetch },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["mcp", "offline_access"],
    requiredScopes: ["mcp"],
    resourceMetadata: {
      resource: `${env.PUBLIC_URL}/mcp`,
      authorization_servers: [env.PUBLIC_URL],
      resource_name: "Second Brain",
    },
    clientIdMetadataDocumentEnabled: true,
  });
  return provider;
}

export default {
  fetch: (req, env, ctx) => oauthProvider(env).fetch(req, env, ctx),
  queue: app.queue,
  scheduled: app.scheduled,
} satisfies ExportedHandler<Env, TgUpdate>;

function isOwner(env: Env, chatId: number): boolean {
  return !!env.OWNER_CHAT_ID && String(chatId) === env.OWNER_CHAT_ID;
}

async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);

  if (update.callback_query) {
    const cq = update.callback_query;
    if (!cq.message || !isOwner(env, cq.message.chat.id)) return tg.answerCallback(cq.id);
    return handleCallback(env, tg, cq);
  }

  const m = update.message;
  if (!m || m.chat.type !== "private") return;

  if (!env.OWNER_CHAT_ID) {
    await tg.send(
      m.chat.id,
      `Chat ID kamu: ${m.chat.id}\n\nIsi OWNER_CHAT_ID di wrangler.jsonc dengan angka ini lalu deploy ulang, supaya bot hanya melayani kamu.`,
    );
    return;
  }
  if (!isOwner(env, m.chat.id)) return; // bot pribadi: abaikan orang lain

  const text = (m.text ?? "").trim();
  if (text.startsWith("/")) {
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    if (cmd === "/start" || cmd === "/help") return tg.send(m.chat.id, HELP);
    if (cmd === "/id") return tg.send(m.chat.id, `Chat ID: ${m.chat.id}`);
    if (cmd === "/reset") {
      await db.clearHistory(env.DB);
      return tg.send(m.chat.id, "Riwayat obrolan dihapus. Tugas & catatan tetap aman.");
    }
    if (cmd === "/tugas") return tg.send(m.chat.id, await taskOverview(env));
    if (cmd === "/briefing") return sendBriefing(env, "morning");
    if (cmd === "/review") {
      await tg.send(m.chat.id, "👔 CEO sedang menyusun review mingguan…");
      await weeklyReview(env);
      return;
    }
    if (cmd === "/batal") {
      const active = await profile.interviewActive(env);
      await profile.stopInterview(env);
      return tg.send(m.chat.id, active ? "Wawancara profil dibatalkan." : "Tidak ada yang sedang berjalan.");
    }
  }

  await tg.typing(m.chat.id);
  let { content, historyText, source } = await buildUserContent(env, tg, m);
  if (!content.length) return tg.send(m.chat.id, "Jenis pesan ini belum didukung. Coba kirim teks, foto, atau voice note.");
  if (text.toLowerCase().startsWith("/profil")) {
    await profile.startInterview(env);
    content = [{ type: "text", text: profile.INTERVIEW_KICKOFF }];
  }

  const history = await db.getHistory(env.DB);
  const { text: reply, proposed, receipt, attachments } = await runAgent(env, content, {
    source,
    useTools: true,
    history,
  });

  await db.appendHistory(env.DB, "user", historyText);
  await db.appendHistory(env.DB, "assistant", reply);
  await tg.send(m.chat.id, reply);
  for (const a of attachments) await tg.send(m.chat.id, a);
  if (receipt) await tg.send(m.chat.id, receipt);

  for (const id of proposed) {
    const t = await db.getTask(env.DB, id);
    if (!t) continue;
    await tg.send(m.chat.id, `📝 Usulan tugas:\n${db.formatTask(t, env.TIMEZONE_OFFSET)}`, [
      [
        { text: "✅ Simpan", callback_data: `ok:${id}` },
        { text: "❌ Buang", callback_data: `no:${id}` },
      ],
    ]);
  }

  // Setelah semua balasan terkirim: ambil fakta tahan lama untuk memori jangka panjang.
  // Saat wawancara profil dilewati (hasilnya sudah masuk profil).
  if (!(await profile.interviewActive(env))) await extractMemories(env, { user: historyText, reply, source });
}

async function buildUserContent(
  env: Env,
  tg: Telegram,
  m: TgMessage,
): Promise<{ content: UserPart[]; historyText: string; source: string }> {
  const content: UserPart[] = [];
  let source = "chat";
  const prefix: string[] = [];

  if (m.forward_origin) {
    source = "forward";
    const o = m.forward_origin;
    const from = o.sender_user?.first_name ?? o.sender_user_name ?? o.chat?.title ?? "seseorang";
    prefix.push(`[Pesan DITERUSKAN dari ${from}]`);
  }

  const audio = m.voice ?? m.audio;
  if (audio) {
    source = "voice";
    await logActivity(env, "whisper", "start", `Mendengarkan voice note ${audio.duration} detik`);
    const buf = await tg.downloadFile(audio.file_id);
    const transcript = await transcribe(env, buf).catch(async (err) => {
      await logActivity(env, "whisper", "error", "Gagal mentranskrip voice note");
      throw err;
    });
    await logActivity(env, "whisper", "done", transcript ? `Transkrip: "${clip(transcript, 120)}"` : "Suaranya tidak terdengar jelas");
    prefix.push(`[Voice note ${audio.duration} detik, transkrip:]\n${transcript || "(tidak terdengar jelas)"}`);
  }

  if (m.photo?.length) {
    source = source === "forward" ? "forward" : "photo";
    const biggest = m.photo[m.photo.length - 1];
    const buf = await tg.downloadFile(biggest.file_id);
    content.push({ type: "image", base64: Buffer.from(buf).toString("base64") });
    prefix.push("[Foto/screenshot terlampir]");
  }

  const body = m.text ?? m.caption ?? "";
  const full = [...prefix, body].filter(Boolean).join("\n");
  if (full) content.push({ type: "text", text: full });
  return { content, historyText: full || "[foto]", source };
}

async function transcribe(env: Env, audio: ArrayBuffer): Promise<string> {
  const res = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as any, {
    audio: Buffer.from(audio).toString("base64"),
    language: "id",
  } as any)) as { text?: string };
  return (res.text ?? "").trim();
}

async function handleCallback(env: Env, tg: Telegram, cq: TgCallbackQuery): Promise<void> {
  const [action, rawId] = (cq.data ?? "").split(":");
  const id = Number(rawId);
  const t = await db.getTask(env.DB, id);
  const msg = cq.message!;
  if (!t) return tg.answerCallback(cq.id, "Tugas tidak ditemukan");

  const tz = env.TIMEZONE_OFFSET;
  switch (action) {
    case "ok":
      await db.updateTask(env.DB, id, { status: "open" });
      await tg.editText(msg.chat.id, msg.message_id, `✅ Disimpan: ${db.formatTask({ ...t, status: "open" }, tz)}`);
      return tg.answerCallback(cq.id, "Disimpan");
    case "no":
      await db.updateTask(env.DB, id, { status: "cancelled" });
      await tg.editText(msg.chat.id, msg.message_id, `🗑️ Dibuang: ${t.title}`);
      return tg.answerCallback(cq.id, "Dibuang");
    case "done":
      await db.updateTask(env.DB, id, { status: "done" });
      await tg.editText(msg.chat.id, msg.message_id, `✅ Selesai: ${t.title}`);
      return tg.answerCallback(cq.id, "Mantap!");
    case "snooze": {
      const at = new Date(Date.now() + 60 * 60_000).toISOString();
      await db.updateTask(env.DB, id, { remind_at: at });
      await tg.editText(msg.chat.id, msg.message_id, `⏰ Ditunda, aku ingatkan lagi ${formatLocal(at, tz)}: ${t.title}`);
      return tg.answerCallback(cq.id, "Ditunda 1 jam");
    }
    default:
      return tg.answerCallback(cq.id);
  }
}

async function sendReminders(env: Env): Promise<void> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  for (const t of await db.dueReminders(env.DB, new Date())) {
    await db.markReminded(env.DB, t.id);
    await logActivity(env, "pengingat", "done", `Mengingatkan: ${t.title}`, "board");
    await tg.send(env.OWNER_CHAT_ID, `⏰ Pengingat:\n${db.formatTask(t, env.TIMEZONE_OFFSET)}`, [
      [
        { text: "✅ Selesai", callback_data: `done:${t.id}` },
        { text: "⏰ Tunda 1 jam", callback_data: `snooze:${t.id}` },
      ],
    ]);
  }
}

async function taskOverview(env: Env): Promise<string> {
  const tz = env.TIMEZONE_OFFSET;
  const open = await db.listTasks(env.DB, { statuses: ["open"] });
  const pending = await db.listTasks(env.DB, { statuses: ["pending"] });
  const lines = [open.length ? `📋 Tugas aktif (${open.length}):` : "📋 Tidak ada tugas aktif. 🎉"];
  lines.push(...open.map((t) => "- " + db.formatTask(t, tz)));
  if (pending.length) {
    lines.push("", `⏳ Menunggu approval (${pending.length}):`, ...pending.map((t) => "- " + db.formatTask(t, tz)));
  }
  return lines.join("\n");
}
