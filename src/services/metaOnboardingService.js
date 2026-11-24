import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { firstOrigin } from '../config/env.js';
import { sealMetaToken } from '../integrations/metaTokens.js';
import {
  assetsForPlatform,
  discoverMetaAssets,
  exchangeMetaCode,
  metaLoginUrl,
  subscribeAsset,
} from '../integrations/metaGraph.js';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

function redirectUri(env) {
  if (env.meta?.redirectUri) return env.meta.redirectUri;
  if (!env.publicBaseUrl) return '';
  return `${env.publicBaseUrl.replace(/\/$/, '')}/api/connections/oauth/callback`;
}

export function createMetaOnboardingService({ models, env, fetchImpl = fetch }) {
  const { MetaConnection, MetaAsset, MetaOnboardingState, ChannelConnection, AuditLog } = models;

  return {
    async start({ tenantId, userId, platform }) {
      if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) throw fail(400, 'validation', 'Choose Facebook, Instagram, or WhatsApp.');
      if (!env.meta?.appId || !env.meta?.appSecret) throw fail(503, 'not_configured', 'The Meta app id and secret are not set.');
      if (!env.meta?.tokenEncryptionKey) throw fail(503, 'not_configured', 'META_TOKEN_ENCRYPTION_KEY is not set.');
      const callback = redirectUri(env);
      if (!callback) throw fail(503, 'not_configured', 'Set PUBLIC_BASE_URL or META_REDIRECT_URI before connecting Meta.');
      const state = `m.${crypto.randomBytes(32).toString('hex')}`;
      await MetaOnboardingState.create({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        provider: platform,
        stateHash: hashState(state),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      return { url: metaLoginUrl({ meta: env.meta, redirectUri: callback, state, platform }) };
    },

    async complete({ code, state }) {
      if (!code || !String(state || '').startsWith('m.')) throw fail(400, 'invalid_token', 'The Meta connection request is not valid.');
      const row = await MetaOnboardingState.findOne({ where: { stateHash: hashState(state) } });
      if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) {
        throw fail(400, 'invalid_token', 'The Meta connection request expired. Start it again.');
      }
      row.usedAt = new Date();
      await row.save();
      const callback = redirectUri(env);
      const granted = await exchangeMetaCode(fetchImpl, env.meta, callback, code);
      const discovered = await discoverMetaAssets(fetchImpl, env.meta, granted.token);
      const selected = assetsForPlatform(discovered, row.provider);
      const connection = await saveConnection({
        models: { MetaConnection, MetaAsset, ChannelConnection, AuditLog },
        env,
        tenantId: row.tenantId,
        userId: row.userId,
        platform: row.provider,
        discovered,
        selected,
        token: granted.token,
        expiresIn: granted.expiresIn,
      });
      const subscribed = [];
      const failures = [];
      for (const asset of selected) {
        try {
          await subscribeAsset(fetchImpl, env.meta, asset, granted.token);
          subscribed.push(asset.externalAssetId);
        } catch (error) {
          failures.push(error.message);
        }
      }
      if (!selected.length || failures.length) {
        const message = !selected.length
          ? 'Meta did not return a Page, Instagram account, or WhatsApp number for this login.'
          : failures[0];
        connection.connectionStatus = !selected.length ? 'permission_missing' : 'error';
        connection.lastErrorCode = !selected.length ? 'no_assets' : 'subscribe_failed';
        connection.lastErrorMessage = message.slice(0, 500);
        await connection.save();
        const channel = await ChannelConnection.findOne({ where: { tenantId: row.tenantId, platform: row.provider } });
        if (channel) {
          channel.status = 'error';
          channel.lastError = connection.lastErrorMessage;
          await channel.save();
        }
      }
      return `${firstOrigin(env.corsOrigin)}/app/inbox?connected=${row.provider}`;
    },

    async disconnect(tenantId, platform) {
      if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) return;
      const connection = await MetaConnection.findOne({ where: { tenantId, provider: platform } });
      if (!connection) return;
      connection.connectionStatus = 'disconnected';
      connection.tokenCiphertext = null;
      connection.lastErrorCode = null;
      connection.lastErrorMessage = null;
      await connection.save();
      await MetaAsset.update({ status: 'disabled' }, { where: { tenantId, metaConnectionId: connection.id } });
    },
  };
}

async function saveConnection({ models, env, tenantId, userId, platform, discovered, selected, token, expiresIn }) {
  const { MetaConnection, MetaAsset, ChannelConnection, AuditLog } = models;
  for (const asset of selected) {
    const owner = await MetaAsset.findOne({ where: { assetType: asset.assetType, externalAssetId: asset.externalAssetId } });
    if (owner && owner.tenantId !== tenantId) {
      throw fail(409, 'asset_taken', 'That Meta account is already connected to another workspace.');
    }
  }
  const assetTokens = Object.fromEntries(selected.filter((asset) => asset.token).map((asset) => [asset.externalAssetId, asset.token]));
  const sealed = sealMetaToken(env.meta.tokenEncryptionKey, JSON.stringify({ userToken: token, assets: assetTokens }));
  const [connection] = await MetaConnection.findOrCreate({
    where: { tenantId, provider: platform },
    defaults: { id: crypto.randomUUID(), connectionStatus: 'not_connected' },
  });
  connection.connectionStatus = selected.length ? 'connected' : 'permission_missing';
  connection.metaUserId = discovered.userId;
  connection.tokenCiphertext = sealed;
  connection.tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  connection.lastValidatedAt = new Date();
  connection.lastErrorCode = null;
  connection.lastErrorMessage = null;
  connection.connectedByUserId = userId;
  await connection.save();
  const keep = new Set(selected.map((asset) => asset.externalAssetId));
  const existing = await MetaAsset.findAll({ where: { tenantId, metaConnectionId: connection.id } });
  for (const row of existing) {
    if (!keep.has(row.externalAssetId)) {
      row.status = 'disabled';
      await row.save();
    }
  }
  for (const asset of selected) {
    const [row] = await MetaAsset.findOrCreate({
      where: { assetType: asset.assetType, externalAssetId: asset.externalAssetId },
      defaults: {
        id: crypto.randomUUID(),
        tenantId,
        metaConnectionId: connection.id,
        status: 'active',
      },
    });
    row.tenantId = tenantId;
    row.metaConnectionId = connection.id;
    row.parentExternalAssetId = asset.parentExternalAssetId || null;
    row.displayName = asset.displayName || null;
    row.username = asset.username || null;
    row.phoneNumber = asset.phoneNumber || null;
    row.status = 'active';
    await row.save();
  }
  const names = selected.map((asset) => asset.displayName).filter(Boolean).join(', ');
  const [channel] = await ChannelConnection.findOrCreate({
    where: { tenantId, platform },
    defaults: { id: crypto.randomUUID(), status: 'off' },
  });
  channel.status = selected.length ? 'on' : 'error';
  channel.displayName = names || null;
  channel.externalAccountId = selected[0]?.externalAssetId || null;
  channel.tokenCiphertext = null;
  channel.lastError = selected.length ? null : 'Meta did not return an account for this login.';
  channel.lastCheckedAt = new Date();
  await channel.save();
  if (AuditLog) {
    await AuditLog.create({
      id: crypto.randomUUID(),
      actorUserId: userId,
      tenantId,
      action: 'meta.connect',
      targetType: 'meta_connection',
      targetId: connection.id,
      metadata: { platform, assets: selected.map((asset) => asset.externalAssetId) },
    });
  }
  return connection;
}

export async function openAssetToken(env, connection, assetId) {
  const { openMetaToken } = await import('../integrations/metaTokens.js');
  const packed = JSON.parse(openMetaToken(env.meta.tokenEncryptionKey, connection.tokenCiphertext));
  return {
    userToken: packed.userToken,
    assetToken: packed.assets?.[assetId] || packed.userToken,
  };
}

export async function findAssetOwner(models, externalIds) {
  const ids = externalIds.filter(Boolean);
  if (!ids.length) return null;
  return models.MetaAsset.findOne({
    where: { externalAssetId: { [Op.in]: ids }, status: 'active' },
  });
}
