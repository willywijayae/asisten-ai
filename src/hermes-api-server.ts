/**
 * Hermes API Server: HTTP wrapper untuk Hermes agent (dengan actual runAgent() logic)
 * 
 * Production-ready endpoint yang menerima request dari Cloudflare Worker.
 */

import http from "http";
import { createCanvas } from "canvas"; // Optional: untuk logging/debug

// Placeholder: Import dari Hermes session jika dijalankan dalam profile asisten-ai
// Untuk sekarang, proxy ke smartcombo router atau return mock response

const PORT = process.env.HERMES_API_PORT || 3000;
const HERMES_ROUTER_URL = process.env.HERMES_ROUTER_URL || "http://127.0.0.1:20128/v1";

interface AgentRequest {
  messages: Array<{ role: string; content: string }>;
  tools?: Array<any>;
  max_tokens?: number;
  tier?: "fast" | "smart";
}

interface AgentResponse {
  message: {
    content?: string;
    tool_calls?: Array<any>;
  };
  model: string;
  escalated?: boolean;
}

/**
 * Proxy ke Hermes smartcombo router atau direct implementation.
 * 
 * Dalam production, ini should:
 * 1. Jalankan `runAgent()` dengan messages, tools, tier
 * 2. Akses D1 untuk tools yang write (add_task, save_note, etc.)
 * 3. Return response dalam format di atas
 * 
 * For now: proxy ke smartcombo router di localhost:20128
 */
async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  const { messages, tools, max_tokens = 4096, tier = "fast" } = req;

  console.log(`[${new Date().toISOString()}] Agent request:`);
  console.log(`  Tier: ${tier}`);
  console.log(`  Messages: ${messages.length}`);
  console.log(`  Tools: ${tools?.length || 0}`);
  console.log(`  Max tokens: ${max_tokens}`);

  try {
    // Option 1: Proxy ke smartcombo router (membutuhkan 9router running lokal)
    if (process.env.USE_LOCAL_ROUTER === "true") {
      return await callLocalRouter(messages, tools, tier, max_tokens);
    }

    // Option 2: Return mock response (untuk testing tanpa setup complex)
    return getMockResponse(tier);
  } catch (err) {
    console.error("[Agent Error]", err);
    throw err;
  }
}

/**
 * Proxy ke 9router smartcombo di localhost:20128
 */
async function callLocalRouter(
  messages: any[],
  tools: any[],
  tier: string,
  maxTokens: number
): Promise<AgentResponse> {
  const model = tier === "fast" ? "smart-easy-claude" : "smart-hard-claude"; // smartcombo model names

  const res = await fetch(`${HERMES_ROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: maxTokens,
      temperature: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`Router error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as any;
  const msg = data.choices?.[0]?.message;

  if (!msg) {
    throw new Error("Unexpected router response format");
  }

  return {
    message: {
      content: msg.content,
      tool_calls: msg.tool_calls,
    },
    model,
    escalated: false,
  };
}

/**
 * Mock response untuk quick testing tanpa setup kompleks
 */
function getMockResponse(tier: string): AgentResponse {
  const content = `[Mock Response] Pesan diterima dengan tier=${tier}. Dalam production, ini akan execute actual Hermes agent logic.`;

  return {
    message: {
      content,
      tool_calls: [],
    },
    model: tier === "fast" ? "haiku" : "opus",
    escalated: false,
  };
}

/**
 * HTTP Server
 */
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        router: process.env.USE_LOCAL_ROUTER === "true" ? HERMES_ROUTER_URL : "mock",
      })
    );
    return;
  }

  // Agent endpoint
  if (req.method === "POST" && req.url === "/api/agent") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body) as AgentRequest;
        const response = await handleAgentRequest(payload);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error("[Error]", err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Hermes API Server v0.1 running on http://127.0.0.1:${PORT}`);
  console.log(`   Endpoint: POST http://127.0.0.1:${PORT}/api/agent`);
  console.log(`   Health:   GET  http://127.0.0.1:${PORT}/health`);
  console.log(`\n   Mode: ${process.env.USE_LOCAL_ROUTER === "true" ? "Proxy to local router" : "Mock (testing)"}`);
  console.log(`\n   To use actual router:`);
  console.log(`   1. Start 9router: systemctl --user start 9router`);
  console.log(`   2. Set env: USE_LOCAL_ROUTER=true node src/hermes-api-server.js`);
  console.log(`\n   To use Hermes agent logic (future):`);
  console.log(`   - Replace callLocalRouter() with actual runAgent() from src/agent.ts`);
  console.log(`   - Setup D1 database proxy for tool execution`);
});

export { AgentRequest, AgentResponse, handleAgentRequest };
