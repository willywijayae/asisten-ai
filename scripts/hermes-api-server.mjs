#!/usr/bin/env node
// Hermes API: jembatan Worker Cloudflare -> router lokal (9router). Tool-calls dikembalikan ke Worker.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createSingleFlight, runDelegation } from "./hermes-delegation.mjs";

const delegateSingleFlight = createSingleFlight(runDelegation);
const BODY_LIMIT = 2_000_000;
const SPECIALISTS = new Set(["copywriter", "konten", "analis", "riset"]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT) {
        reject(Object.assign(new Error("payload terlalu besar"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error("JSON tidak valid"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function delegationInput(body) {
  const specialist = String(body?.specialist || "");
  const request = String(body?.request || "").trim();
  if (!SPECIALISTS.has(specialist)) throw Object.assign(new Error("specialist tidak valid"), { status: 400 });
  if (!request || request.length > 20_000) throw Object.assign(new Error("request wajib diisi dan maksimal 20000 karakter"), { status: 400 });
  return {
    specialist,
    specialistName: String(body?.specialist_name || specialist).slice(0, 100),
    brief: String(body?.brief || "").slice(0, 10_000),
    request,
    context: String(body?.context || "").slice(0, 40_000),
    model: body?.model === MODELS.opus ? MODELS.opus : MODELS.smart,
  };
}

export function createServer({ delegate = delegateSingleFlight } = {}) {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && path === "/health") return send(res, 200, { status: "ok", models: MODELS, delegation: true });
    if (req.method !== "POST" || (path !== "/api/agent" && path !== "/api/delegate")) return send(res, 404, { error: "not found" });
    if (!authOk(req.headers.authorization)) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readJson(req);
      if (path === "/api/delegate") {
        const text = await delegate(delegationInput(body));
        console.log(`[${new Date().toISOString()}] delegated specialist=${body.specialist}`);
        return send(res, 200, { text, model: body?.model === MODELS.opus ? MODELS.opus : MODELS.smart, delegated: true });
      }
      const out = await callRouter(body);
      console.log(`[${new Date().toISOString()}] ok model=${out.model} tools=${out.message.tool_calls.length}`);
      return send(res, 200, out);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] error`, e.message);
      return send(res, Number(e.status) || 502, { error: e.message });
    }
  });
}

const PORT = Number(process.env.HERMES_API_PORT || 3000);
const ROUTER = (process.env.HERMES_ROUTER_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
const ROUTER_KEY = process.env.NINEROUTER_API_KEY || "";
const API_KEY = process.env.HERMES_API_KEY || "";
const MODELS = {
  fast: process.env.MODEL_FAST || "smart-easy-claude",
  smart: process.env.MODEL_SMART || "smart-hard-claude",
  opus: process.env.MODEL_OPUS || "content-opus",
};
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

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  createServer().listen(PORT, "127.0.0.1", () => console.log(`hermes-api on 127.0.0.1:${PORT} -> ${ROUTER}`));
}
