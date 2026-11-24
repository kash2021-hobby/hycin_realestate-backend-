import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  authorizeInboxSocket,
  metaSignatureValid,
  presentConnection,
  saveInboundMessage,
  shouldPostPublic,
  threadWhere,
} from '../src/integrations/inboxRules.js';

test('a provider with no server secret cannot be shown as connected', () => {
  const shown = presentConnection({
    platform: 'instagram',
    status: 'on',
    tokenCiphertext: 'ciphertext-secret',
    displayName: 'Harbour page',
  }, { meta: {}, googleOauth: {} });
  assert.equal(shown.status, 'off');
  assert.equal(shown.configured, false);
  assert.equal(JSON.stringify(shown).includes('ciphertext-secret'), false);
  assert.equal(presentConnection({ platform: 'whatsapp', status: 'on', tokenCiphertext: '' }, {}).status, 'off');
});

test('a Meta webhook with the wrong signature is rejected', () => {
  const body = Buffer.from('{"entry":[]}');
  const good = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  assert.equal(metaSignatureValid('app-secret', body, good), true);
  assert.equal(metaSignatureValid('app-secret', body, 'sha256=not-the-signature'), false);
  assert.equal(metaSignatureValid('', body, good), false);
});

test('the same inbound message id is stored once', async () => {
  const rows = [];
  const Message = {
    async findOne({ where }) {
      return rows.find((row) => row.tenantId === where.tenantId && row.externalId === where.externalId) || null;
    },
    async create(row) {
      if (rows.some((item) => item.externalId === row.externalId && item.tenantId === row.tenantId)) {
        const error = new Error('duplicate');
        error.name = 'SequelizeUniqueConstraintError';
        throw error;
      }
      rows.push(row);
      return row;
    },
  };
  const input = { id: 'm1', tenantId: 'tenant-a', threadId: 't1', externalId: 'meta:1', body: 'Hi', direction: 'in', author: 'customer', delivery: 'stored' };
  const first = await saveInboundMessage({ Message }, input);
  const second = await saveInboundMessage({ Message }, { ...input, id: 'm2' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(rows.length, 1);
});

test('thread queries stay inside the signed-in workspace', () => {
  const where = threadWhere('tenant-a', 'handoff');
  assert.equal(where.tenantId, 'tenant-a');
  assert.equal(where.status, 'handoff');
  assert.equal(threadWhere('tenant-b', 'all').tenantId, 'tenant-b');
});

test('a queued public reply is re-read and is not posted while the bot is off', () => {
  const held = shouldPostPublic({ status: 'agent_replied', queuedPostAt: new Date(), aiPaused: false });
  assert.equal(held.post, false);
  assert.equal(held.reason, 'held');
  const ready = shouldPostPublic({ status: 'queued', queuedPostAt: new Date(), aiPaused: false });
  assert.equal(ready.post, false);
  assert.equal(ready.reason, 'bot_disabled');
});

test('a super admin socket cannot join a private inbox room', () => {
  assert.equal(authorizeInboxSocket({ super: true, sub: 'admin' }), null);
  assert.equal(authorizeInboxSocket({ tenantId: null, sub: 'admin' }), null);
  assert.deepEqual(authorizeInboxSocket({ tenantId: 'tenant-a', sub: 'agent-1' }), { tenantId: 'tenant-a', userId: 'agent-1' });
});
