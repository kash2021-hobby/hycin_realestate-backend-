import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { initDatabase } from './database/init.js';
import { createAuthService } from './services/authService.js';
import { createTenantService } from './services/tenantService.js';
import { createSettingsService } from './services/settingsService.js';
import { createCrmService } from './services/crmService.js';
import { createSiteService } from './services/siteService.js';
import { createSheetsService } from './services/sheetsService.js';
import { createInboxService } from './services/inboxService.js';
import { createAlertService } from './services/alertService.js';
import { createMetaConnectionService } from './services/metaConnectionService.js';
import { createMetaOnboardingService } from './services/metaOnboardingService.js';
import { attachInboxSocket } from './realtime/inboxSocket.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { createRedis, redisStatus } from './queues/redis.js';

export async function createHttpServer(env) {
  const { models } = await initDatabase(env);
  const redis = createRedis(env);
  redis?.on('error', () => {});
  const auth = createAuthService({ models, env });
  const tenants = createTenantService({ models });
  const settings = createSettingsService({ models });
  const crm = createCrmService({ models });
  const site = createSiteService({ models });
  const sheets = createSheetsService({ models, env, redis });
  const alerts = createAlertService({ models, env, redis });
  const meta = createMetaConnectionService({ models });
  const metaOnboarding = createMetaOnboardingService({ models, env });
  const server = createServer();
  const io = attachInboxSocket(server, env);
  const inbox = createInboxService({
    models,
    env,
    redis,
    emit: (tenantId, event, payload) => io.to(`tenant:${tenantId}`).emit(event, payload),
    onAlert: (tenantId, note) => alerts.enqueue(tenantId, note),
    metaOnboarding,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => { req.rawBody = buf; },
  }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true }));
  app.use('/api/public', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true }));
  app.use('/api/e', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true }));

  app.get('/api/health', async (req, res) => {
    let database = 'down';
    try {
      await models.Tenant.sequelize.authenticate();
      database = 'up';
    } catch {
      database = 'down';
    }
    const redisState = await redisStatus(redis);
    res.status(database === 'up' ? 200 : 503).json({
      database,
      redis: redisState,
      bot: 'disabled',
    });
  });

  app.use('/api/webhooks', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true }));
  app.use('/api', apiRouter({ auth, tenants, settings, crm, site, sheets, inbox, alerts, meta, models, env }));
  app.use(errorHandler);

  server.on('request', (req, res) => {
    if (req.url?.startsWith('/socket.io')) return;
    app(req, res);
  });

  return { server, io, models, redis, sheets };
}
