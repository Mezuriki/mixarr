import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '2.0.0',
  });
});

healthRouter.get('/ready', async (_req, res) => {
  // TODO: Check database connection
  // TODO: Check Redis connection
  res.json({
    status: 'ready',
    services: {
      database: 'connected',
      redis: 'connected',
    },
  });
});
