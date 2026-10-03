#!/usr/bin/env node

import http from "http";
import { URL } from "url";

const PORT = process.env.HERMES_API_PORT || 3000;
const HERMES_ROUTER_URL = process.env.HERMES_ROUTER_URL || "http://127.0.0.1:20128/v1";
const USE_LOCAL_ROUTER = process.env.USE_LOCAL_ROUTER === "true";

async function callLocalRouter(messages, tools, tier, maxTokens) {
  const model = tier === "fast" ? "smart-easy-claude" : "smart-hard-claude";
  const fetchUrl = new URL("/v1/chat/completions", HERMES_ROUTER_URL).toString();
  console.log(`[Router] Calling ${fetchUrl} with model=${model}`);

  const response = await fetch(fetchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: maxTokens,
      temperature: 1,
    }),
  });

  if (!response.ok) throw new Error(`Router error: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("Unexpected router response format");

  return {
    message: { content: msg.content, tool_calls: msg.tool_calls || [] },
    model, escalated: false,
  };
}

function getMockResponse(tier) {
  return {
    message: {
      content: `[Mock Response - Tier: ${tier}] Pesan diterima. Dalam production, ini akan execute actual Hermes agent logic.`,
      tool_calls: [],
    },
    model: tier === "fast" ? "haiku" : "opus",
    escalated: false,
  };
}

async function handleAgentRequest(req) {
  const { messages, tools, max_tokens = 4096, tier = "fast" } = req;
  console.log(`[${new Date().toISOString()}] Agent request: tier=${tier}, messages=${messages.length}, tools=${tools?.length || 0}`);

  try {
    if (USE_LOCAL_ROUTER) return await callLocalRouter(messages, tools, tier, max_tokens);
    return getMockResponse(tier);
  } catch (err) {
    console.error("[Agent Error]", err);
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok", timestamp: new Date().toISOString(),
      mode: USE_LOCAL_ROUTER ? `Proxy to ${HERMES_ROUTER_URL}` : "Mock (testing)", port: PORT,
    }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/agent") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const response = await handleAgentRequest(payload);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error("[Error]", err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Hermes API Server v0.1 listening on http://127.0.0.1:${PORT}`);
  console.log(`   Endpoint: POST http://127.0.0.1:${PORT}/api/agent`);
  console.log(`   Health:   GET  http://127.0.0.1:${PORT}/health`);
  console.log(`   Mode: ${USE_LOCAL_ROUTER ? `Proxy to ${HERMES_ROUTER_URL}` : "Mock (testing)"}`);
  if (!USE_LOCAL_ROUTER) {
    console.log(`\n   ⚠️  In MOCK mode. To use actual router:`);
    console.log(`   USE_LOCAL_ROUTER=true node scripts/hermes-api-server.mjs`);
  }
});
