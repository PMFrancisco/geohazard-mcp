import rateLimit from 'express-rate-limit';

const windowMs = 60 * 1000;
const limit = Number(process.env.MCP_RATE_LIMIT_PER_MIN) || 60;

export const rateLimitMiddleware = rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests, please try again later.' },
});
