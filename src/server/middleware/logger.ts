import type { Request, Response, NextFunction } from 'express';

export function loggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on('finish', () => {
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - start,
      ip: req.ip ?? req.socket.remoteAddress,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  });

  next();
}
