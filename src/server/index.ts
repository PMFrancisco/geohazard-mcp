#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `quiet: true` suppresses dotenv's v17+ startup banner. Critical for stdio
// transport — any stdout noise corrupts the MCP JSON-RPC stream.
config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools/registry.js';
import { buildHttpApp } from './http.js';

const server = new McpServer({ name: 'geohazard-mcp', version: '1.0.0' });

// Register every tool once against the MCP server
for (const [name, { description, schema, handler }] of Object.entries(TOOLS)) {
  server.tool(
    name,
    description,
    schema.shape,
    async (args: Record<string, unknown>) => {
      const result = await handler(args as Parameters<typeof handler>[0]);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );
}

if (process.env.MCP_TRANSPORT === 'http') {
  const app = buildHttpApp(server);
  const port = Number(process.env.MCP_PORT ?? 3000);
  app.listen(port, () => console.log(`mcp-server HTTP on :${port}`));
} else {
  await server.connect(new StdioServerTransport());
}
