import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools/registry.js';
import { buildHttpApp } from './http.js';

const server = new McpServer({ name: 'planetary-risk', version: '1.0.0' });

// Register every tool once against the MCP server
for (const [name, { description, schema, handler }] of Object.entries(TOOLS)) {
  server.tool(name, description, schema.shape, async (args) => {
    const result = await handler(args as Parameters<typeof handler>[0]);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });
}

if (process.env.MCP_TRANSPORT === 'http') {
  const app = buildHttpApp(server);
  const port = Number(process.env.MCP_PORT ?? 3000);
  app.listen(port, () => console.log(`mcp-server HTTP on :${port}`));
} else {
  await server.connect(new StdioServerTransport());
}
