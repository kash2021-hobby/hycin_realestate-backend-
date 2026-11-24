import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy, sendTelegramAlert, shouldEnqueueAlert } from '../src/integrations/alertRules.js';

test('an empty Telegram chat does not qualify for an alert', () => {
  assert.equal(shouldEnqueueAlert(''), false);
  assert.equal(shouldEnqueueAlert('  '), false);
  assert.equal(shouldEnqueueAlert('not-a-chat'), false);
  assert.equal(shouldEnqueueAlert('-100123'), true);
});

test('reply rules cannot turn the bot on', () => {
  const saved = normalizePolicy({ comments: true, bot: 'enabled', delay: 99, complaint: false });
  assert.equal(saved.bot, 'disabled');
  assert.equal(saved.comments, true);
  assert.equal(saved.delayMin, 30);
  assert.equal(saved.complaint, false);
});

test('a missing alert bot does not call Telegram', async () => {
  let called = false;
  const result = await sendTelegramAlert({
    token: '',
    chatId: '42',
    text: 'Hello',
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ ok: true }) }; },
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_configured');
  assert.equal(called, false);
});

test('a Telegram failure does not include the bot token', async () => {
  const token = '123456:secret-token';
  await assert.rejects(
    () => sendTelegramAlert({
      token,
      chatId: '42',
      text: 'Hello',
      fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, description: `bad token ${token}` }) }),
    }),
    (error) => {
      assert.equal(error.message.includes(token), false);
      assert.equal(error.message, 'Telegram did not accept the alert.');
      return true;
    },
  );
});
