import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const PORT = Number(process.env.PORT ?? 3000);

// When running in compose, "fastapi" is the service name (DNS)
const FASTAPI_BASE = process.env.FASTAPI_BASE ?? "http://fastapi:8000";

// Shared schema: accepts number or numeric string, coerces to number, validates finite
const CoercedNumber = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n), { message: "must be a valid number" });

function makeServer() {
  const server = new McpServer({
    name: "fastapi-proxy-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "ping_api",
    {
      title: "Ping API",
      description: "Check whether the FastAPI backend is alive.",
      // MCP tools expect a Zod schema; ping takes no args
      inputSchema: z.object({}).optional(),
    },
    async () => {
      const r = await fetch(`${FASTAPI_BASE}/ping`);
      const data = await r.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  );

  server.registerTool(
    "add_numbers",
    {
      title: "Add Numbers",
      description:
        "Add two numbers using the backend API. Accepts numeric values or strings that contain numbers (e.g. '1000').",
      inputSchema: z.object({
        a: CoercedNumber,
        b: CoercedNumber,
      }),
    },
    async ({ a, b }) => {
      // a and b are guaranteed finite numbers here
      const r = await fetch(`${FASTAPI_BASE}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a, b }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`FastAPI /add failed (${r.status}): ${text}`);
      }

      const data = await r.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  );

  return server;
}

async function main() {
  const app = express();
  app.use(express.json());

  // sessionId -> transport
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // POST /mcp handles initialize + normal requests
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Create new session transport
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          // transport is defined in this branch
          transports[newSessionId] = transport!;
        },
      });

      transport.onclose = () => {
        if (transport?.sessionId) delete transports[transport.sessionId];
      };

      const server = makeServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp opens SSE stream (requires session)
  // DELETE /mcp closes session (requires session)
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  // Simple REST bridge for n8n
  app.get("/bridge/ping", async (_req: Request, res: Response) => {
    try {
      const r = await fetch(`${FASTAPI_BASE}/ping`);
      const data = await r.json();
      res.json(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  // Make this bridge tolerant too: accept strings or numbers
  app.post("/bridge/add", async (req: Request, res: Response) => {
    try {
      const parsed = z
        .object({ a: CoercedNumber, b: CoercedNumber })
        .safeParse(req.body ?? {});

      if (!parsed.success) {
        res.status(400).json({
          error: "Body must be JSON: { a: number|string, b: number|string }",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { a, b } = parsed.data;

      const r = await fetch(`${FASTAPI_BASE}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a, b }),
      });

      const text = await r.text();

      // forward JSON response if possible
      try {
        res.status(r.status).json(JSON.parse(text));
      } catch {
        res.status(r.status).send(text);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.listen(PORT, () => {
    console.log(`MCP HTTP server listening on http://0.0.0.0:${PORT}/mcp`);
    console.log(`FastAPI base: ${FASTAPI_BASE}`);
  });
}

main().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});
