import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { errorHandler } from './backend/src/middleware/auth.ts';
import { apiRouter } from './backend/src/routes/api.ts';
import { discordAuthRouter } from './backend/src/routes/discordAuth.ts';
import { realtimeHub } from './backend/src/ws/realtime.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', apiRouter);
  app.use(discordAuthRouter);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  const server = http.createServer(app);
  realtimeHub.attach(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ShadowSpace full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ShadowSpace server:', err);
  process.exit(1);
});
