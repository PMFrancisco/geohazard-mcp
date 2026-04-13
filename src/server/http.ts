import express, { type Express } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { corsMiddleware } from './middleware/cors.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { loggerMiddleware } from './middleware/logger.js';
import { TOOLS } from './tools/registry.js';

export function buildHttpApp(server: McpServer): Express {
  const app = express();
  app.use(corsMiddleware);
  app.use(rateLimitMiddleware);
  app.use(loggerMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '1.0.0', tools: Object.keys(TOOLS) });
  });

  // JSON-RPC MCP endpoint (Claude, MCP Inspector, etc.)
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  server.connect(mcpTransport);
  app.post('/mcp', (req, res) => mcpTransport.handleRequest(req, res));

  // Simple REST wrapper (the private repo's mcpClient.ts calls this)
  app.post('/tools/:name', async (req, res) => {
    const tool = TOOLS[req.params.name as keyof typeof TOOLS];
    if (!tool) {
      res.status(404).json({ error: `unknown tool: ${req.params.name}` });
      return;
    }
    const parsed = tool.schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    try {
      const result = await tool.handler(
        parsed.data as Parameters<typeof tool.handler>[0],
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
