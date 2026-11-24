import test from 'node:test';
import assert from 'node:assert/strict';
import { adminMetaStatus, presentMetaAsset, presentMetaConnection, publicMetaConfig } from '../src/integrations/metaConfig.js';
import { openMetaToken, sealMetaToken } from '../src/integrations/metaTokens.js';
import { createMetaConnectionService } from '../src/services/metaConnectionService.js';

test('Meta status never includes the app secret or encryption key', () => {
  const meta = {
    appId: '123',
    appSecret: 'app-secret-value',
    verifyToken: 'verify-value',
    tokenEncryptionKey: 'encryption-key-value',
    embeddedSignupConfigId: 'config-1',
    redirectUri: 'https://example.com/api/meta/callback',
    graphVersion: 'v22.0',
  };
  const body = JSON.stringify({ public: publicMetaConfig(meta), admin: adminMetaStatus(meta) });
  assert.equal(body.includes('app-secret-value'), false);
  assert.equal(body.includes('verify-value'), false);
  assert.equal(body.includes('encryption-key-value'), false);
  assert.equal(publicMetaConfig(meta).appId, '123');
  assert.equal(publicMetaConfig(meta).graphVersion, 'v22.0');
  assert.equal(publicMetaConfig(meta).onboarding, 'not_available');
  assert.equal(adminMetaStatus(meta).readiness.appSecret, true);
  assert.equal(adminMetaStatus(meta).appReview.status, 'not_confirmed');
});

test('a Meta token round-trips and a missing key is refused', () => {
  const packed = sealMetaToken('test-key', 'page-token');
  assert.equal(packed.includes('page-token'), false);
  assert.equal(openMetaToken('test-key', packed), 'page-token');
  assert.throws(() => sealMetaToken('', 'page-token'), (error) => error.code === 'not_configured');
});

test('connection responses omit stored credentials', () => {
  const presented = presentMetaConnection({
    id: 'c1',
    provider: 'whatsapp',
    connectionStatus: 'not_connected',
    tokenCiphertext: 'sealed-token',
    metaUserId: 'user-1',
  });
  assert.equal(JSON.stringify(presented).includes('sealed-token'), false);
  assert.equal(presented.metaUserId, 'user-1');
  const asset = presentMetaAsset({ id: 'a1', metaConnectionId: 'c1', assetType: 'facebook_page', externalAssetId: 'page-1', status: 'active', metadataJson: { access_token: 'nope' } });
  assert.equal(JSON.stringify(asset).includes('nope'), false);
});

test('a workspace Meta list is queried only for that tenant', async () => {
  const calls = [];
  const service = createMetaConnectionService({
    models: {
      MetaConnection: { findAll: async (options) => { calls.push(options.where); return []; } },
      MetaAsset: { findAll: async (options) => { calls.push(options.where); return []; } },
    },
  });
  await service.workspace('tenant-a');
  await service.workspace('tenant-b');
  assert.deepEqual(calls, [
    { tenantId: 'tenant-a' },
    { tenantId: 'tenant-a' },
    { tenantId: 'tenant-b' },
    { tenantId: 'tenant-b' },
  ]);
});
