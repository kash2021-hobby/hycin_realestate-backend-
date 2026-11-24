import test from 'node:test';
import assert from 'node:assert/strict';
import { assetsForPlatform, metaLoginUrl, parseMetaWebhook } from '../src/integrations/metaGraph.js';
import { createMetaOnboardingService } from '../src/services/metaOnboardingService.js';

test('WhatsApp login requires the Embedded Signup configuration', () => {
  assert.throws(() => metaLoginUrl({
    meta: { appId: '123', graphVersion: 'v21.0' },
    redirectUri: 'https://example.com/api/connections/oauth/callback',
    state: 'm.abc',
    platform: 'whatsapp',
  }), (error) => error.code === 'not_configured');
  const url = new URL(metaLoginUrl({
    meta: { appId: '123', graphVersion: 'v21.0', embeddedSignupConfigId: 'cfg' },
    redirectUri: 'https://example.com/api/connections/oauth/callback',
    state: 'm.abc',
    platform: 'whatsapp',
  }));
  assert.equal(url.searchParams.get('config_id'), 'cfg');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('discovery keeps only the account type that was requested', () => {
  const discovered = {
    pages: [{ id: 'page-1', name: 'Harbour', accessToken: 'page-token', instagram: { id: 'ig-1', name: 'harbour', username: 'harbour' } }],
    phones: [{ phoneNumberId: 'phone-1', wabaId: 'waba-1', display: '+1 555' }],
  };
  assert.equal(assetsForPlatform(discovered, 'facebook')[0].externalAssetId, 'page-1');
  assert.equal(assetsForPlatform(discovered, 'instagram')[0].externalAssetId, 'ig-1');
  assert.equal(assetsForPlatform(discovered, 'whatsapp')[0].parentExternalAssetId, 'waba-1');
});

test('a WhatsApp webhook becomes one inbound message and one status', () => {
  const events = parseMetaWebhook({
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'phone-1' },
          contacts: [{ wa_id: '15551212', profile: { name: 'Asha' } }],
          messages: [{ id: 'm1', from: '15551212', type: 'text', text: { body: 'Hello' } }],
          statuses: [{ id: 'm0', status: 'failed', errors: [{ title: 'Rejected' }] }],
        },
      }],
    }],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].accountId, 'phone-1');
  assert.equal(events[0].body, 'Hello');
  assert.equal(events[1].status, 'failed');
});

test('an expired Meta state is rejected and no token is exchanged', async () => {
  let called = false;
  const service = createMetaOnboardingService({
    models: {
      MetaOnboardingState: {
        findOne: async () => ({ usedAt: null, expiresAt: new Date(Date.now() - 1000), save: async () => {} }),
      },
    },
    env: { meta: { appId: '1', appSecret: '2', tokenEncryptionKey: 'k' }, publicBaseUrl: 'https://example.com', corsOrigin: 'https://app.example.com' },
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; },
  });
  await assert.rejects(() => service.complete({ code: 'code', state: 'm.expired' }), (error) => error.code === 'invalid_token');
  assert.equal(called, false);
});

test('a Page owned by another workspace is refused', async () => {
  const saves = [];
  const service = createMetaOnboardingService({
    models: {
      MetaOnboardingState: {
        findOne: async () => ({
          tenantId: 'tenant-b',
          userId: 'user-1',
          provider: 'facebook',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          save: async () => {},
        }),
      },
      MetaAsset: {
        findOne: async () => ({ tenantId: 'tenant-a' }),
        findAll: async () => [],
        findOrCreate: async () => { throw new Error('should not save'); },
      },
      MetaConnection: { findOrCreate: async () => [{ save: async function save() { saves.push(this); } }] },
      ChannelConnection: { findOrCreate: async () => [{ save: async () => {} }], findOne: async () => null },
      AuditLog: { create: async () => {} },
    },
    env: {
      meta: { appId: '123', appSecret: 'secret', tokenEncryptionKey: 'key', graphVersion: 'v21.0' },
      publicBaseUrl: 'https://example.com',
      corsOrigin: 'https://app.example.com',
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/oauth/access_token')) return { ok: true, json: async () => ({ access_token: 'user-token', expires_in: 100 }) };
      if (target.includes('/me?')) return { ok: true, json: async () => ({ id: 'u1', name: 'Agent' }) };
      if (target.includes('/me/accounts')) return { ok: true, json: async () => ({ data: [{ id: 'page-1', name: 'Harbour', access_token: 'page-token' }] }) };
      if (target.includes('/me/businesses')) return { ok: true, json: async () => ({ data: [] }) };
      return { ok: false, json: async () => ({ error: { message: 'unexpected' } }) };
    },
  });
  await assert.rejects(() => service.complete({ code: 'good-code', state: 'm.fresh' }), (error) => error.code === 'asset_taken');
  assert.equal(saves.length, 0);
});
