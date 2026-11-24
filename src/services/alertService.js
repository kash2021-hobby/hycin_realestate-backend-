import { Queue } from 'bullmq';
import { alertText, normalizePolicy, sendTelegramAlert, shouldEnqueueAlert } from '../integrations/alertRules.js';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanChat(value) {
  const chat = String(value || '').trim();
  if (!chat) return null;
  if (!shouldEnqueueAlert(chat)) throw fail(400, 'validation', 'Use the numeric Telegram chat id.');
  return chat;
}

export function createAlertService({ models, env, redis }) {
  const { Tenant, Notification } = models;
  let queue;

  function jobs() {
    if (!redis) return null;
    if (!queue) queue = new Queue('notifications', { connection: redis.duplicate() });
    return queue;
  }

  async function tenantOrThrow(tenantId) {
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) throw fail(404, 'not_found', 'This workspace was not found.');
    return tenant;
  }

  function present(tenant) {
    const chatId = tenant.alertChatId || '';
    const configured = Boolean(env.telegramAlertToken);
    return {
      chatId,
      configured,
      sending: Boolean(chatId && configured),
      bot: 'disabled',
    };
  }

  return {
    async get(tenantId) {
      return present(await tenantOrThrow(tenantId));
    },
    async setChat(tenantId, chatId) {
      const tenant = await tenantOrThrow(tenantId);
      tenant.alertChatId = cleanChat(chatId);
      await tenant.save();
      return present(tenant);
    },
    async policy(tenantId) {
      const tenant = await tenantOrThrow(tenantId);
      return normalizePolicy(tenant.replyPolicy || {});
    },
    async savePolicy(tenantId, input) {
      const tenant = await tenantOrThrow(tenantId);
      const policy = normalizePolicy(input);
      tenant.replyPolicy = policy;
      await tenant.save();
      return policy;
    },
    async enqueue(tenantId, notification) {
      const tenant = await Tenant.findByPk(tenantId);
      if (!shouldEnqueueAlert(tenant?.alertChatId)) return { queued: false, reason: 'unset' };
      if (!redis || redis.status !== 'ready') return { queued: false, reason: 'redis_down' };
      const pending = jobs();
      if (!pending) return { queued: false, reason: 'redis_down' };
      await pending.add('telegram', { tenantId, notificationId: notification.id }, { jobId: `alert:${notification.id}` });
      return { queued: true };
    },
    async deliverJob(tenantId, notificationId) {
      const tenant = await Tenant.findByPk(tenantId);
      const note = await Notification.findOne({ where: { id: notificationId, tenantId } });
      if (!note || !shouldEnqueueAlert(tenant?.alertChatId)) return { sent: false, reason: 'unset' };
      return sendTelegramAlert({ token: env.telegramAlertToken, chatId: tenant.alertChatId, text: alertText(note) });
    },
  };
}
