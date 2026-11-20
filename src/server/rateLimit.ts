import { Request, Response, NextFunction } from 'express';

interface RateEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; message?: string }) {
  const store = new Map<string, RateEntry>();

  // Periodic cleanup to avoid memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, Math.max(options.windowMs, 60_000)).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl}`;
    const now = Date.now();
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (existing.count >= options.max) {
      return res.status(429).json({
        error: options.message || 'Too many requests. Please slow down and try again shortly.',
      });
    }

    existing.count += 1;
    next();
  };
}
