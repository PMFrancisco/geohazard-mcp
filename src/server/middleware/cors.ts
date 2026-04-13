import cors from 'cors';

const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS
  ? process.env.MCP_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : undefined;

export const corsMiddleware = cors({
  origin: allowedOrigins ?? '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
