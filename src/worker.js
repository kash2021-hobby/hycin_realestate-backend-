import { Worker, Queue } from 'bullmq';
import { loadEnv } from './config/env.js';
import { initDatabase } from './database/init.js';
import { createRedis } from './queues/redis.js';
import { createSheetsService } from './services/sheetsService.js';
import { createInboxService } from './services/inboxService.js';
import { createAlertService } from './services/alertService.js';

const env = loadEnv();
const connection = createRedis(env);
if (!connection) {
  console.error('REDIS_URL is required for the worker.');
  process.exit(1);
}
let redisReady = false;
connection.on('error', (error) => {
  if (redisReady) console.error(`Redis error: ${error.message}`);
});
try {
  await connection.connect();
  const reply = await connection.ping();
  if (reply !== 'PONG') throw new Error(`Unexpected Redis reply: ${reply}`);
  redisReady = true;
} catch (error) {
  console.error(`Worker stopped. Redis is not reachable: ${error.message}`);
  process.exit(1);
}

const { models } = await initDatabase(env);
const sheets = createSheetsService({ models, env, redis: connection });
const alerts = createAlertService({ models, env, redis: connection });
const inbox = createInboxService({ models, env, redis: connection, emit: () => {}, onAlert: (tenantId, note) => alerts.enqueue(tenantId, note) });

const sheetsWorker = new Worker('sheets-sync', async (job) => {
  if (job.name === 'poll') {
    await sheets.pollAll();
    return;
  }
  await sheets.appendJob(job.data.eventId);
}, { connection: connection.duplicate() });
sheetsWorker.on('failed', (job, error) => {
  console.error(`[sheets-sync] ${job?.id} failed: ${error.message}`);
});

const pollQueue = new Queue('sheets-sync', { connection: connection.duplicate() });
await pollQueue.add('poll', {}, {
  repeat: { every: 15 * 1000 },
  jobId: 'sheets-poll',
});

const webhookWorker = new Worker('webhook-events', async (job) => {
  const threadId = job.data.threadId;
  if (job.name === 'public-post' && threadId && job.data.tenantId) {
    const decision = await inbox.releaseQueued(job.data.tenantId, threadId);
    if (decision.post) throw new Error('Public posting is disabled while the bot is off.');
    return decision;
  }
  await inbox.ingestJob(job.data.eventId);
}, { connection: connection.duplicate() });
webhookWorker.on('failed', (job, error) => {
  console.error(`[webhook-events] ${job?.id} failed: ${error.message}`);
});

const notificationWorker = new Worker('notifications', async (job) => {
  return alerts.deliverJob(job.data.tenantId, job.data.notificationId);
}, { connection: connection.duplicate() });
notificationWorker.on('failed', (job, error) => {
  console.error(`[notifications] ${job?.id} failed: ${error.message}`);
});

console.log('HYCIN worker started. Sheets sync and inbox webhooks are active. The bot does not send replies.');
