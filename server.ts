import 'dotenv/config';
import http from 'http';
import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { setupWebSocketServer } from './src/server/ws.ts';
import { createRateLimiter } from './src/server/rateLimit.ts';
import { UPLOADS_ROOT } from './src/server/upload.ts';

import authRoutes from './src/server/routes/auth.ts';
import socialRoutes from './src/server/routes/social.ts';
import storiesRoutes from './src/server/routes/stories.ts';
import reelsRoutes from './src/server/routes/reels.ts';
import liveRoutes from './src/server/routes/live.ts';
import chatRoutes from './src/server/routes/chat.ts';
import cloudRoutes from './src/server/routes/cloud.ts';
import aiRoutes from './src/server/routes/ai.ts';
import communityRoutes from './src/server/routes/community.ts';
import platformRoutes from './src/server/routes/platform.ts';
import locationRoutes from './src/server/routes/location.ts';
import { hasValidGeminiKey } from './src/server/gemini.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);

  const allowedOrigins = new Set(
    (
      process.env.ALLOWED_ORIGINS ||
      'https://tiger-omar.samarelgaly84.workers.dev'
    )
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );

  // Security & CORS headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : '';
    if (
      origin &&
      (allowedOrigins.has(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:'))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
    }

    next();
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Rate limiting
  app.use('/api', createRateLimiter({ windowMs: 60_000, max: 300 }));
  app.use('/api/ai', createRateLimiter({ windowMs: 60_000, max: 30, message: 'AI rate limit reached. Please wait a minute.' }));

  // Static uploaded media & files
  app.use('/uploads', express.static(UPLOADS_ROOT, { maxAge: '7d' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'TIGER Platform',
      aiConfigured: hasValidGeminiKey(),
      timestamp: new Date().toISOString(),
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/stories', storiesRoutes);
  app.use('/api/reels', reelsRoutes);
  app.use('/api/live', liveRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/cloud', cloudRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/location', locationRoutes);

  // API 404 fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Attach WebSocket server on same HTTP server & port
  setupWebSocketServer(server);

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled server error:', err);
    const status = err?.status || (err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    res.status(status).json({
      error: err?.message || 'Internal server error',
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TIGER Platform server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start TIGER server:', err);
  process.exit(1);
});
