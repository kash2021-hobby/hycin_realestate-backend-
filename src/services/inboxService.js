import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Queue } from 'bullmq';
import { Op } from 'sequelize';
import { firstOrigin } from '../config/env.js';
import { facebookDialog, graphBase } from '../integrations/metaConfig.js';
import { parseMetaWebhook, sendChannelMessage } from '../integrations/metaGraph.js';
import { findAssetOwner, openAssetToken } from '../services/metaOnboardingService.js';
import { open, seal } from '../integrations/channelCrypto.js';
import {
  PLATFORMS,
  metaEventId,
  metaSignatureValid,
  presentConnection,
  providerConfigured,
  safeEqual,
  saveInboundMessage,
  shouldPostPublic,
  telegramInbound,
  threadWhere,
} from '../integrations/inboxRules.js';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export function createInboxService({ models, env, redis, emit, onAlert, metaOnboarding }) {
  const { ChannelConnection, Thread, Message, WebhookEvent, Notification, Lead, Property, Visit, User, Membership, MetaConnection, MetaAsset, SocialComment } = models;
  let queue;

  function jobs() {
    if (!redis) return null;
    if (!queue) queue = new Queue('webhook-events', { connection: redis.duplicate() });
    return queue;
  }

  function notify(tenantId, payload) {
    try {
      emit?.(tenantId, 'inbox', payload);
    } catch (error) {
      console.error(`Inbox emit failed: ${error.message}`);
    }
  }

  async function remember(tenantId, platform, fields) {
    const [row, created] = await ChannelConnection.findOrCreate({
      where: { tenantId, platform },
      defaults: { id: crypto.randomUUID(), status: 'off', ...fields },
    });
    if (!created) {
      Object.assign(row, fields);
      await row.save();
    }
    return row;
  }

  async function listConnections(tenantId) {
    const rows = await ChannelConnection.findAll({ where: { tenantId } });
    return PLATFORMS.map((platform) => presentConnection(rows.find((row) => row.platform === platform) || { platform, status: 'off' }, env));
  }

  async function connectTelegram(tenantId, botToken) {
    const token = String(botToken || '').trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw fail(400, 'validation', 'Paste the bot token from BotFather.');
    const meResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const me = await readJson(meResponse);
    if (!meResponse.ok || !me.ok) {
      const message = me.description || 'Telegram rejected the token.';
      await remember(tenantId, 'telegram', { status: 'error', tokenCiphertext: null, scopes: null, lastError: message, lastCheckedAt: new Date(), displayName: null });
      throw fail(400, 'telegram_rejected', message);
    }
    const webhookSecret = crypto.randomBytes(24).toString('hex');
    let status = 'connecting';
    let lastError = 'Inbound webhook is not registered. Set PUBLIC_BASE_URL so Telegram can reach HYCIN.';
    if (env.publicBaseUrl) {
      const hookResponse = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: `${env.publicBaseUrl.replace(/\/$/, '')}/api/webhooks/telegram/${tenantId}`,
          secret_token: webhookSecret,
          allowed_updates: ['message'],
        }),
      });
      const hook = await readJson(hookResponse);
      if (hookResponse.ok && hook.ok) {
        status = 'on';
        lastError = null;
      } else {
        status = 'error';
        lastError = hook.description || 'Telegram did not register the webhook.';
      }
    }
    const row = await remember(tenantId, 'telegram', {
      status,
      displayName: me.result?.username ? `@${me.result.username}` : 'Telegram',
      externalAccountId: me.result?.id ? String(me.result.id) : null,
      tokenCiphertext: status === 'error' ? null : seal(env.jwt.accessSecret, token),
      scopes: status === 'error' ? null : { webhookSecret },
      lastError,
      lastCheckedAt: new Date(),
    });
    return presentConnection(row, env);
  }

  async function connectWhatsapp(tenantId, accessToken, phoneNumberId) {
    const token = String(accessToken || '').trim();
    const phoneId = String(phoneNumberId || '').trim();
    if (!token || !/^\d{6,}$/.test(phoneId)) throw fail(400, 'validation', 'Enter the phone number ID and the access token.');
    const response = await fetch(`${graphBase(env.meta)}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readJson(response);
    if (!response.ok) {
      const message = body.error?.message || 'WhatsApp rejected the token.';
      await remember(tenantId, 'whatsapp', { status: 'error', tokenCiphertext: null, lastError: message, lastCheckedAt: new Date(), displayName: null });
      throw fail(400, 'whatsapp_rejected', message);
    }
    const row = await remember(tenantId, 'whatsapp', {
      status: 'connecting',
      displayName: body.verified_name || body.display_phone_number || 'WhatsApp',
      externalAccountId: phoneId,
      tokenCiphertext: seal(env.jwt.accessSecret, token),
      lastError: 'The token can read this number. Inbound messages stay off until the Meta webhook is registered.',
      lastCheckedAt: new Date(),
    });
    return presentConnection(row, env);
  }

  function oauthUrl(tenantId, userId, platform) {
    if (!PLATFORMS.includes(platform)) throw fail(400, 'validation', 'Choose a channel.');
    if (metaOnboarding && ['facebook', 'instagram', 'whatsapp'].includes(platform)) {
      return metaOnboarding.start({ tenantId, userId, platform });
    }
    if (!providerConfigured(env, platform)) throw fail(503, 'not_configured', 'This provider is not configured on the server.');
    if (!env.publicBaseUrl) throw fail(503, 'not_configured', 'Set PUBLIC_BASE_URL before starting OAuth.');
    const redirectUri = `${env.publicBaseUrl.replace(/\/$/, '')}/api/connections/oauth/callback`;
    const state = jwt.sign({ purpose: 'oauth', tenantId, sub: userId, platform }, env.jwt.accessSecret, { expiresIn: '10m' });
    if (platform === 'instagram' || platform === 'facebook') {
      const scope = 'pages_show_list,pages_messaging,instagram_manage_messages,pages_read_engagement';
      const url = new URL(facebookDialog(env.meta));
      url.searchParams.set('client_id', env.meta.appId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('scope', scope);
      return { url: url.toString() };
    }
    const scope = platform === 'youtube'
      ? 'https://www.googleapis.com/auth/youtube.readonly'
      : 'https://www.googleapis.com/auth/business.manage';
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.googleOauth.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    return { url: url.toString() };
  }

  async function oauthCallback(code, state) {
    if (metaOnboarding && String(state || '').startsWith('m.')) return metaOnboarding.complete({ code, state });
    let payload;
    try {
      payload = jwt.verify(state, env.jwt.accessSecret);
    } catch {
      throw fail(400, 'invalid_token', 'The connection request expired. Start it again.');
    }
    if (payload.purpose !== 'oauth' || !payload.tenantId || !payload.platform) throw fail(400, 'invalid_token', 'The connection request is not valid.');
    const membership = await Membership.findOne({ where: { tenantId: payload.tenantId, userId: payload.sub } });
    if (!membership) throw fail(403, 'forbidden', 'That workspace membership is gone.');
    if (!providerConfigured(env, payload.platform) || !env.publicBaseUrl) throw fail(503, 'not_configured', 'This provider is not configured on the server.');
    const redirectUri = `${env.publicBaseUrl.replace(/\/$/, '')}/api/connections/oauth/callback`;
    const granted = payload.platform === 'instagram' || payload.platform === 'facebook'
      ? await exchangeMeta(code, redirectUri)
      : await exchangeGoogle(code, redirectUri);
    await remember(payload.tenantId, payload.platform, {
      status: 'on',
      displayName: granted.displayName,
      externalAccountId: granted.externalAccountId,
      tokenCiphertext: seal(env.jwt.accessSecret, granted.token),
      lastError: null,
      lastCheckedAt: new Date(),
    });
    return `${firstOrigin(env.corsOrigin)}/app/inbox?connected=${payload.platform}`;
  }

  async function exchangeMeta(code, redirectUri) {
    const url = new URL(`${graphBase(env.meta)}/oauth/access_token`);
    url.searchParams.set('client_id', env.meta.appId);
    url.searchParams.set('client_secret', env.meta.appSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);
    const tokenResponse = await fetch(url);
    const tokenBody = await readJson(tokenResponse);
    if (!tokenResponse.ok || !tokenBody.access_token) throw fail(400, 'oauth_rejected', tokenBody.error?.message || 'Meta did not return a token.');
    const meResponse = await fetch(`${graphBase(env.meta)}/me?fields=id,name`, { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
    const me = await readJson(meResponse);
    if (!meResponse.ok || !me.id) throw fail(400, 'oauth_rejected', me.error?.message || 'Meta did not return the account.');
    return { token: tokenBody.access_token, displayName: me.name || 'Meta', externalAccountId: String(me.id) };
  }

  async function exchangeGoogle(code, redirectUri) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.googleOauth.clientId,
        client_secret: env.googleOauth.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const body = await readJson(response);
    if (!response.ok || !body.access_token) throw fail(400, 'oauth_rejected', body.error_description || 'Google did not return a token.');
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${body.access_token}` } });
    const profile = await readJson(profileResponse);
    return {
      token: body.refresh_token || body.access_token,
      displayName: profile.email || profile.name || 'Google',
      externalAccountId: profile.id ? String(profile.id) : null,
    };
  }

  async function disconnect(tenantId, platform) {
    if (!PLATFORMS.includes(platform)) throw fail(400, 'validation', 'Choose a channel.');
    const row = await ChannelConnection.findOne({ where: { tenantId, platform } });
    if (row?.platform === 'telegram' && row.tokenCiphertext && row.status !== 'error') {
      try {
        const token = open(env.jwt.accessSecret, row.tokenCiphertext);
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' });
      } catch (error) {
        console.error(`Telegram disconnect did not delete the webhook: ${error.message}`);
      }
    }
    if (metaOnboarding) await metaOnboarding.disconnect(tenantId, platform);
    if (row) {
      row.status = 'off';
      row.tokenCiphertext = null;
      row.scopes = null;
      row.externalAccountId = null;
      row.lastError = null;
      row.lastCheckedAt = new Date();
      await row.save();
      return presentConnection(row, env);
    }
    return presentConnection({ platform, status: 'off' }, env);
  }

  function presentThread(thread) {
    return {
      id: thread.id,
      platform: thread.platform,
      kind: thread.kind,
      status: thread.status,
      contactName: thread.contactName,
      preview: thread.preview,
      aiPaused: true,
      assigneeUserId: thread.assigneeUserId,
      lastActivityAt: thread.lastActivityAt,
      bot: 'disabled',
    };
  }

  async function list(tenantId, filter) {
    const threads = await Thread.findAll({ where: threadWhere(tenantId, filter), order: [['lastActivityAt', 'DESC']], limit: 100 });
    const handoffCount = await Thread.count({ where: { tenantId, status: 'handoff' } });
    return { threads: threads.map(presentThread), handoffCount, bot: 'disabled' };
  }

  async function leadSummary(tenantId, leadId) {
    if (!leadId) return null;
    const lead = await Lead.findOne({ where: { id: leadId, tenantId, archivedAt: null } });
    if (!lead) return null;
    const property = lead.propertyId ? await Property.findOne({ where: { id: lead.propertyId, tenantId } }) : null;
    const visit = await Visit.findOne({ where: { tenantId, leadId: lead.id, status: 'booked' }, order: [['startAt', 'DESC']] });
    return {
      id: lead.id,
      name: lead.name,
      need: lead.need,
      budget: lead.budget,
      score: lead.score,
      source: lead.source,
      propertyName: property?.name || null,
      visitAt: visit?.startAt || null,
    };
  }

  async function getThread(tenantId, threadId) {
    const thread = await Thread.findOne({ where: { id: threadId, tenantId } });
    if (!thread) throw fail(404, 'not_found', 'That conversation is not in this workspace.');
    const messages = await Message.findAll({ where: { tenantId, threadId: thread.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    messages.sort((left, right) => {
      const delta = new Date(left.createdAt) - new Date(right.createdAt);
      if (delta) return delta;
      if (left.direction !== right.direction) return left.direction === 'in' ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    });
    const assignee = thread.assigneeUserId ? await User.findByPk(thread.assigneeUserId, { attributes: ['id', 'name'] }) : null;
    return {
      thread: presentThread(thread),
      assigneeName: assignee?.name || null,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        author: message.author,
        body: message.body,
        delivery: message.delivery,
        errorMessage: message.errorMessage || null,
        createdAt: message.createdAt,
      })),
      lead: await leadSummary(tenantId, thread.leadId),
      bot: 'disabled',
    };
  }

  async function logThread(tenantId, input) {
    const platform = String(input.platform || '');
    const kind = ['dm', 'comment', 'review'].includes(input.kind) ? input.kind : 'dm';
    const contactName = String(input.contactName || '').trim();
    const body = String(input.body || '').trim();
    if (!PLATFORMS.includes(platform)) throw fail(400, 'validation', 'Choose a channel.');
    if (!contactName || !body) throw fail(400, 'validation', 'Add a name and the message you want to keep.');
    const now = new Date();
    const thread = await Thread.create({
      id: crypto.randomUUID(),
      tenantId,
      platform,
      kind,
      externalThreadId: `local:${crypto.randomUUID()}`,
      status: 'new',
      contactName,
      preview: body.slice(0, 180),
      aiPaused: true,
      lastActivityAt: now,
    });
    await Message.create({
      id: crypto.randomUUID(),
      tenantId,
      threadId: thread.id,
      direction: 'in',
      author: 'customer',
      body,
      delivery: 'stored',
    });
    notify(tenantId, { threadId: thread.id });
    return getThread(tenantId, thread.id);
  }

  async function applyDeliveryStatus(item) {
    const message = await Message.findOne({ where: { externalId: item.externalMessageId } });
    if (!message) return;
    if (item.status === 'failed') {
      message.delivery = 'failed';
      message.errorMessage = item.error || 'WhatsApp reported a failure.';
    } else if (item.status === 'read') {
      message.delivery = 'sent';
      message.readAt = new Date();
    } else if (item.status === 'delivered') {
      message.delivery = 'sent';
      message.deliveredAt = new Date();
    } else if (item.status === 'sent') {
      message.delivery = 'sent';
      message.sentAt = message.sentAt || new Date();
    }
    await message.save();
  }

  async function deliverReply(thread, text) {
    const loggedHere = String(thread.externalThreadId || '').startsWith('local:');
    if (loggedHere || !['facebook', 'instagram', 'whatsapp'].includes(thread.platform)) {
      return { delivery: 'not_delivered', externalId: null, error: 'This conversation is only stored in HYCIN.' };
    }
    const asset = thread.metaAssetId && MetaAsset
      ? await MetaAsset.findOne({ where: { id: thread.metaAssetId, tenantId: thread.tenantId, status: 'active' } })
      : null;
    const connection = asset && MetaConnection
      ? await MetaConnection.findOne({ where: { id: asset.metaConnectionId, tenantId: thread.tenantId, connectionStatus: 'connected' } })
      : null;
    if (!asset || !connection?.tokenCiphertext) {
      return { delivery: 'failed', externalId: null, error: 'The Meta account for this conversation is not connected.' };
    }
    if (thread.platform === 'whatsapp') {
      const latest = await Message.findOne({ where: { tenantId: thread.tenantId, threadId: thread.id, direction: 'in' }, order: [['createdAt', 'DESC']] });
      const fresh = latest && Date.now() - new Date(latest.createdAt).getTime() < 24 * 60 * 60 * 1000;
      if (!fresh) {
        return { delivery: 'failed', externalId: null, error: 'WhatsApp only accepts an approved template after 24 hours. Template sending is not available.' };
      }
    }
    try {
      const tokens = await openAssetToken(env, connection, asset.externalAssetId);
      const sent = await sendChannelMessage(fetch, env.meta, {
        assetType: asset.assetType,
        externalAssetId: asset.externalAssetId,
        parentExternalAssetId: asset.parentExternalAssetId,
        token: tokens.assetToken,
      }, tokens.userToken, {
        contactId: thread.externalContactId,
        text,
        kind: thread.kind,
        externalId: thread.kind === 'comment' ? `meta:${String(thread.externalThreadId).replace('meta-comment:', '')}` : null,
      });
      return { delivery: 'sent', externalId: sent.id, error: null };
    } catch (error) {
      return { delivery: 'failed', externalId: null, error: String(error.message || 'Meta did not accept the reply.').slice(0, 500) };
    }
  }

  async function addMessage(tenantId, userId, threadId, body) {
    const text = String(body || '').trim();
    if (!text) throw fail(400, 'validation', 'Write a reply first.');
    const thread = await Thread.findOne({ where: { id: threadId, tenantId } });
    if (!thread) throw fail(404, 'not_found', 'That conversation is not in this workspace.');
    const now = new Date();
    const outcome = await deliverReply(thread, text);
    await Message.create({
      id: crypto.randomUUID(),
      tenantId,
      threadId: thread.id,
      direction: 'out',
      author: 'agent',
      body: text,
      externalId: outcome.externalId,
      delivery: outcome.delivery,
      sentAt: outcome.delivery === 'sent' ? now : null,
      errorMessage: outcome.error,
    });
    thread.status = 'agent_replied';
    thread.aiPaused = true;
    thread.preview = text.slice(0, 180);
    thread.lastActivityAt = now;
    if (!thread.assigneeUserId) thread.assigneeUserId = userId;
    await thread.save();
    notify(tenantId, { threadId: thread.id });
    return getThread(tenantId, thread.id);
  }

  async function patchThread(tenantId, userId, threadId, input) {
    const thread = await Thread.findOne({ where: { id: threadId, tenantId } });
    if (!thread) throw fail(404, 'not_found', 'That conversation is not in this workspace.');
    if (input.action === 'takeover') {
      thread.assigneeUserId = userId;
      thread.aiPaused = true;
      if (thread.status === 'new' || thread.status === 'queued') thread.status = 'handoff';
      thread.handoffReason = 'An agent took over. Automatic replies are off.';
    } else if (input.action === 'handback') {
      thread.assigneeUserId = null;
      thread.aiPaused = true;
      if (thread.status === 'handoff') thread.status = 'new';
      thread.handoffReason = 'Handed back. Automatic replies stay off.';
    } else if (Object.prototype.hasOwnProperty.call(input, 'assigneeUserId')) {
      if (!input.assigneeUserId) {
        thread.assigneeUserId = null;
      } else {
        const member = await Membership.findOne({ where: { tenantId, userId: input.assigneeUserId } });
        if (!member) throw fail(400, 'validation', 'Assign someone in this workspace.');
        thread.assigneeUserId = input.assigneeUserId;
        thread.aiPaused = true;
      }
    }
    await thread.save();
    notify(tenantId, { threadId: thread.id });
    return getThread(tenantId, thread.id);
  }

  async function listNotifications(tenantId) {
    const rows = await Notification.findAll({ where: { tenantId }, order: [['createdAt', 'DESC']], limit: 30 });
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        deepLink: row.deepLink,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
    };
  }

  async function markRead(tenantId, notificationId) {
    const row = await Notification.findOne({ where: { id: notificationId, tenantId } });
    if (!row) throw fail(404, 'not_found', 'That notification is not in this workspace.');
    row.readAt = new Date();
    await row.save();
    return { id: row.id, readAt: row.readAt };
  }

  async function acceptWebhook({ provider, externalEventId, tenantId, payload }) {
    const [event, created] = await WebhookEvent.findOrCreate({
      where: { provider, externalEventId },
      defaults: { id: crypto.randomUUID(), tenantId, payload, status: 'pending' },
    });
    return { event, duplicate: !created };
  }

  async function acceptMeta(rawBody, signature) {
    if (!env.meta?.appSecret) throw fail(503, 'not_configured', 'Meta is not configured.');
    if (!metaSignatureValid(env.meta.appSecret, rawBody, signature)) throw fail(401, 'invalid_signature', 'The webhook signature does not match.');
    const payload = JSON.parse(rawBody.toString('utf8'));
    return acceptWebhook({ provider: 'meta', externalEventId: metaEventId(payload, rawBody), tenantId: null, payload });
  }

  async function acceptTelegram(tenantId, secretHeader, payload) {
    const row = await ChannelConnection.findOne({ where: { tenantId, platform: 'telegram' } });
    const expected = row?.scopes?.webhookSecret || '';
    if (!expected || !safeEqual(expected, String(secretHeader || ''))) throw fail(401, 'invalid_signature', 'The webhook secret does not match.');
    if (payload?.update_id == null) throw fail(400, 'validation', 'Telegram update is missing an id.');
    return acceptWebhook({ provider: 'telegram', externalEventId: `telegram:${payload.update_id}`, tenantId, payload });
  }

  async function enqueue(eventId) {
    const pending = jobs();
    if (!pending) {
      await ingestJob(eventId);
      return;
    }
    try {
      await pending.add('ingest', { eventId }, { jobId: eventId, attempts: 5, removeOnComplete: 200, removeOnFail: 200 });
    } catch (error) {
      console.error(`Webhook enqueue failed: ${error.message}`);
      await ingestJob(eventId);
    }
  }

  async function storeInbound(tenantId, platform, item) {
    const now = new Date();
    const [thread] = await Thread.findOrCreate({
      where: { tenantId, platform, externalThreadId: item.externalThreadId },
      defaults: {
        id: crypto.randomUUID(),
        kind: item.kind,
        status: 'new',
        contactName: item.contactName,
        preview: item.body.slice(0, 180),
        aiPaused: true,
        lastActivityAt: now,
        metaAssetId: item.metaAssetId || null,
        externalContactId: item.contactId || null,
        unreadCount: 1,
      },
    });
    const saved = await saveInboundMessage(models, {
      id: crypto.randomUUID(),
      tenantId,
      threadId: thread.id,
      direction: 'in',
      author: 'customer',
      body: item.body,
      externalId: item.externalMessageId,
      delivery: 'stored',
    });
    if (saved.created) {
      thread.preview = item.body.slice(0, 180);
      thread.lastActivityAt = now;
      if (thread.status !== 'handoff' && thread.status !== 'agent_replied') thread.status = 'new';
      await thread.save();
      const note = await Notification.create({
        id: crypto.randomUUID(),
        tenantId,
        type: 'inbox',
        title: thread.contactName,
        body: item.body.slice(0, 180),
        deepLink: `/app/inbox?thread=${thread.id}`,
      });
      try {
        await onAlert?.(tenantId, note);
      } catch (error) {
        console.error(`Alert enqueue failed: ${error.message}`);
      }
      notify(tenantId, { threadId: thread.id });
    }
    return saved;
  }

  async function ingestJob(eventId) {
    const [claimed] = await WebhookEvent.update({ status: 'processing' }, { where: { id: eventId, status: 'pending' } });
    if (!claimed) return;
    const event = await WebhookEvent.findByPk(eventId);
    try {
      if (event.provider === 'telegram' && event.tenantId) {
        const item = telegramInbound(event.payload);
        if (item) await storeInbound(event.tenantId, 'telegram', item);
      }
      if (event.provider === 'meta') {
        for (const item of parseMetaWebhook(event.payload)) {
          if (item.type === 'status') {
            await applyDeliveryStatus(item);
            continue;
          }
          const asset = await findAssetOwner(models, [item.accountId]);
          const connection = asset ? null : await ChannelConnection.findOne({
            where: { externalAccountId: item.accountId, status: { [Op.in]: ['on', 'connecting'] } },
          });
          const tenantId = asset?.tenantId || connection?.tenantId;
          const platform = item.platform || (asset?.assetType === 'instagram_account' ? 'instagram' : asset?.assetType === 'whatsapp_phone_number' ? 'whatsapp' : connection?.platform || 'facebook');
          if (!tenantId) continue;
          if (item.type === 'comment' && SocialComment) {
            await SocialComment.findOrCreate({
              where: { tenantId, externalCommentId: item.externalCommentId },
              defaults: {
                id: crypto.randomUUID(),
                metaAssetId: asset?.id || null,
                externalPostId: item.externalPostId,
                authorExternalId: item.contactId || null,
                authorName: item.contactName,
                body: item.body,
                parentCommentId: item.parentId,
                replyStatus: 'not_sent',
              },
            });
          }
          const externalThreadId = item.kind === 'comment'
            ? `meta-comment:${item.externalCommentId}`
            : `meta:${item.accountId}:${item.contactId}`;
          await storeInbound(tenantId, platform, { ...item, externalThreadId, metaAssetId: asset?.id || null });
        }
      }
      event.status = 'processed';
      event.lastError = null;
      await event.save();
    } catch (error) {
      event.status = 'failed';
      event.lastError = error.message?.slice(0, 500) || 'Webhook processing failed.';
      await event.save();
      throw error;
    }
  }

  async function releaseQueued(tenantId, threadId) {
    const thread = await Thread.findOne({ where: { id: threadId, tenantId } });
    const decision = shouldPostPublic(thread);
    if (thread && decision.reason === 'held' && thread.queuedPostAt) {
      thread.queuedPostAt = null;
      await thread.save();
    }
    return decision;
  }

  function verifyMetaChallenge(query) {
    if (!env.meta?.verifyToken) throw fail(503, 'not_configured', 'Meta is not configured.');
    const mode = query['hub.mode'] || query.hub?.mode;
    const token = query['hub.verify_token'] || query.hub?.verify_token;
    const challenge = query['hub.challenge'] || query.hub?.challenge;
    if (mode === 'subscribe' && token === env.meta.verifyToken && challenge) return String(challenge);
    throw fail(403, 'forbidden', 'The Meta verify token does not match.');
  }

  return {
    listConnections,
    connectTelegram,
    connectWhatsapp,
    oauthUrl,
    oauthCallback,
    disconnect,
    list,
    getThread,
    logThread,
    addMessage,
    patchThread,
    listNotifications,
    markRead,
    acceptMeta,
    acceptTelegram,
    enqueue,
    ingestJob,
    releaseQueued,
    verifyMetaChallenge,
  };
}
