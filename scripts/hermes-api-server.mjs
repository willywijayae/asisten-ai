#!/usr/bin/env node
// Hermes API: jembatan Worker Cloudflare -> router lokal (9router). Tool-calls dikembalikan ke Worker.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.HERMES_API_PORT || 3000);
const ROUTER = (process.env.HERMES_ROUTER_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
const ROUTER_KEY = process.env.NINEROUTER_API_KEY || "";
const API_KEY = process.env.HERMES_API_KEY || "";
const MODELS = { fast: process.env.MODEL_FAST || "smart-easy-claude", smart: process.env.MODEL_SMART || "smart-hard-claude" };
if (!API_KEY) { console.error("HERMES_API_KEY wajib di-set"); process.exit(1); }

const authOk = (h) => {
  const a = Buffer.from(String(h || "")), b = Buffer.from(`Bearer ${API_KEY}`);
  return a.length === b.length && timingSafeEqual(a, b);
};
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

async function callRouter({ messages, tools, max_tokens = 4096, tier = "fast" }) {
  const model = MODELS[tier] || MODELS.fast;
  const r = await fetch(`${ROUTER}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ROUTER_KEY}` },
    body: JSON.stringify({ model, messages, ...(tools?.length ? { tools } : {}), max_tokens, stream: false }),
    signal: AbortSignal.timeout(110_000),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`router ${r.status}: bukan JSON: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`router ${r.status}: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("respons router tidak terduga");
  return { message: { content: msg.content ?? null, tool_calls: msg.tool_calls ?? [] }, model };
}

http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (req.method === "GET" && path === "/health") return send(res, 200, { status: "ok", models: MODELS });
  if (req.method === "POST" && path === "/api/agent") {
    if (!authOk(req.headers.authorization)) return send(res, 401, { error: "unauthorized" });
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const out = await callRouter(JSON.parse(body));
        console.log(`[${new Date().toISOString()}] ok model=${out.model} tools=${out.message.tool_calls.length}`);
        send(res, 200, out);
      } catch (e) {
        console.error(`[${new Date().toISOString()}] error`, e.message);
        send(res, 502, { error: e.message });
      }
    });
    return;
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`hermes-api on 127.0.0.1:${PORT} -> ${ROUTER}`));
