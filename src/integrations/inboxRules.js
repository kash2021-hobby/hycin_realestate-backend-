import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PLATFORMS = ['instagram', 'facebook', 'whatsapp', 'youtube', 'google', 'telegram'];

export function providerConfigured(env, platform) {
  if (platform === 'instagram' || platform === 'facebook') return Boolean(env.meta?.appId && env.meta?.appSecret);
  if (platform === 'youtube' || platform === 'google') return Boolean(env.googleOauth?.clientId && env.googleOauth?.clientSecret);
  if (platform === 'whatsapp' || platform === 'telegram') return true;
  return false;
}

export function presentConnection(row, env) {
  const platform = row?.platform;
  const configured = providerConfigured(env, platform);
  const hasToken = Boolean(row?.tokenCiphertext);
  let status = row?.status || 'off';
  let lastError = row?.lastError || null;
  if (!configured && status !== 'off') {
    status = 'off';
    lastError = 'This provider is not configured on the server.';
  }
  const metaChannel = ['facebook', 'instagram', 'whatsapp'].includes(platform);
  if (status === 'on' && !hasToken && !metaChannel) {
    status = 'off';
    lastError = 'No credential is stored for this channel.';
  }
  return {
    platform,
    status,
    displayName: row?.displayName || null,
    externalAccountId: row?.externalAccountId || null,
    lastError,
    lastCheckedAt: row?.lastCheckedAt || null,
    configured,
  };
}

export function threadWhere(tenantId, filter) {
  const where = { tenantId };
  if (filter === 'handoff') where.status = 'handoff';
  else if (filter === 'dm') where.kind = 'dm';
  else if (filter === 'comment') where.kind = ['comment', 'review'];
  return where;
}

export function shouldPostPublic(thread) {
  if (!thread?.queuedPostAt) return { post: false, reason: 'not_queued' };
  if (['agent_replied', 'handoff', 'booked'].includes(thread.status) || thread.aiPaused) {
    return { post: false, reason: 'held' };
  }
  return { post: false, reason: 'bot_disabled' };
}

export function authorizeInboxSocket(payload) {
  if (!payload || payload.super || !payload.tenantId) return null;
  return { tenantId: payload.tenantId, userId: payload.sub || null };
}

export function metaSignatureValid(secret, rawBody, header) {
  if (!secret || !rawBody || !header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const actual = Buffer.from(String(header));
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function metaEventId(payload, rawBody) {
  const mid = payload?.entry?.[0]?.messaging?.[0]?.message?.mid
    || payload?.entry?.[0]?.changes?.[0]?.value?.comment_id;
  if (mid) return `meta:${mid}`;
  return `meta:${createHash('sha256').update(rawBody).digest('hex')}`;
}

export function metaInbound(payload) {
  const found = [];
  for (const entry of payload?.entry || []) {
    const accountId = entry?.id ? String(entry.id) : '';
    for (const event of entry.messaging || []) {
      const text = event?.message?.text;
      const mid = event?.message?.mid;
      if (!text || !mid || !event?.sender?.id) continue;
      found.push({
        accountId,
        externalThreadId: `meta:${event.sender.id}`,
        externalMessageId: `meta:${mid}`,
        contactName: 'Instagram contact',
        body: String(text),
        kind: 'dm',
      });
    }
    for (const change of entry.changes || []) {
      const value = change?.value || {};
      const commentId = value.comment_id || value.id;
      const text = value.message || value.text;
      if (!commentId || !text) continue;
      found.push({
        accountId,
        externalThreadId: `meta-comment:${commentId}`,
        externalMessageId: `meta:${commentId}`,
        contactName: value.from?.name || 'Comment',
        body: String(text),
        kind: 'comment',
      });
    }
  }
  return found;
}

export function telegramInbound(payload) {
  const text = payload?.message?.text;
  const chatId = payload?.message?.chat?.id;
  const messageId = payload?.message?.message_id;
  if (!text || chatId == null || messageId == null) return null;
  const chat = payload.message.chat;
  return {
    externalThreadId: `telegram:${chatId}`,
    externalMessageId: `telegram:${chatId}:${messageId}`,
    contactName: chat.first_name || chat.username || 'Telegram',
    body: String(text),
    kind: 'dm',
  };
}

export async function saveInboundMessage(models, input) {
  if (input.externalId) {
    const existing = await models.Message.findOne({ where: { tenantId: input.tenantId, externalId: input.externalId } });
    if (existing) return { message: existing, created: false };
  }
  try {
    const message = await models.Message.create(input);
    return { message, created: true };
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' && input.externalId) {
      const message = await models.Message.findOne({ where: { tenantId: input.tenantId, externalId: input.externalId } });
      return { message, created: false };
    }
    throw error;
  }
}
