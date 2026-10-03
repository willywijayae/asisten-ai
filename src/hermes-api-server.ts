/**
 * Hermes API Server: HTTP wrapper untuk Hermes agent
 * 
 * Menerima POST request dari Cloudflare Worker dengan format:
 * {
 *   messages: [{role, content}, ...],
 *   tools: [{name, description, ...}, ...],
 *   max_tokens: number,
 *   tier: "fast" | "smart"
 * }
 * 
 * Return response dalam format compatible dengan runAgent() expectations.
 * 
 * Usage:
 *   node --loader ts-node/esm src/hermes-api-server.ts
 *   Atau compile dulu: npx tsc src/hermes-api-server.ts && node src/hermes-api-server.js
 */

import http from "http";

const PORT = process.env.HERMES_API_PORT || 3000;

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
 * Mock implementation untuk demo. Dalam production, panggil actual Hermes agent.
 * Untuk sekarang, proxy ke smartcombo router lokal atau return mock response.
 */
async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  const { messages, tools, max_tokens = 4096, tier = "fast" } = req;

  // TODO: Implement actual call ke Hermes agent
  // Untuk sekarang, return mock response untuk testing
  console.log(`[Hermes Agent] tier=${tier}, tools=${tools?.length || 0}, max_tokens=${max_tokens}`);
  console.log(`[Hermes Agent] messages[${messages.length}]:`, messages.map(m => `${m.role}: ${m.content.slice(0, 60)}...`));

  // Mock response
  return {
    message: {
      content: `[Mock Hermes Response] Pesan diterima. Tier: ${tier}. Messages: ${messages.length}. Tools: ${tools?.length || 0}`,
      tool_calls: [],
    },
    model: tier === "fast" ? "haiku" : "opus",
    escalated: false,
  };
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (req.url !== "/api/agent") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    try {
      const payload = JSON.parse(body) as AgentRequest;
      console.log(`\n[${new Date().toISOString()}] Agent request received`);

      const response = await handleAgentRequest(payload);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (err) {
      console.error("Error processing agent request:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Hermes API Server listening on http://127.0.0.1:${PORT}`);
  console.log(`   Endpoint: POST http://127.0.0.1:${PORT}/api/agent`);
  console.log(`\n   Untuk production (dengan tunnel):`);
  console.log(`   - Setup ngrok atau cloudflared tunnel`);
  console.log(`   - Set HERMES_API_ENDPOINT di Worker ke URL tunnel`);
  console.log(`\n   Untuk dev lokal (wrangler dev):`);
  console.log(`   - Server ini sudah listen di 127.0.0.1:${PORT}`);
  console.log(`   - Worker dan Hermes API share localhost`);
});
