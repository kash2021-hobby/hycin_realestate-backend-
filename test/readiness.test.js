import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MYSQL_DATABASE = 'hycin_test';
process.env.DB_NAME = 'hycin_test';

const stamp = Date.now().toString(36);
const password = `Readiness-${stamp}-pw`;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function call(port, path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data, text };
}

test('readiness covers isolation, webhooks, and a short health burst', async (t) => {
  const { loadEnv } = await import('../src/config/env.js');
  const env = loadEnv();
  assert.equal(env.mysql.database, 'hycin_test');
  assert.notEqual(env.mysql.database, 'hycin_db');
  assert.notEqual(env.mysql.database, 'crm_db');
  env.meta = { ...env.meta, appSecret: 'readiness-secret' };
  env.redisUrl = '';

  const { createHttpServer } = await import('../src/createServer.js');
  const started = await createHttpServer(env);
  const port = await listen(started.server);
  t.after(async () => {
    started.io.close();
    started.server.closeAllConnections?.();
    await new Promise((resolve) => started.server.close(resolve));
    await started.models.Tenant.sequelize.close();
    started.redis?.disconnect();
  });

  const health = await call(port, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.database, 'up');
  assert.equal(health.data.bot, 'disabled');

  const columns = await started.models.Tenant.sequelize.query(
    `SELECT TABLE_NAME AS tableName, IS_NULLABLE AS nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'hycin_test' AND COLUMN_NAME = 'tenant_id'`,
    { type: 'SELECT' },
  );
  const required = ['leads', 'properties', 'visits', 'timeline_events', 'sites', 'threads', 'messages', 'notifications', 'channel_connections', 'sheet_integrations'];
  for (const name of required) {
    const column = columns.find((row) => row.tableName === name);
    assert.ok(column, `${name}.tenant_id is missing`);
    assert.equal(column.nullable, 'NO', `${name}.tenant_id must be required`);
  }

  const admin = await call(port, '/api/auth/login', {
    method: 'POST',
    body: { email: env.superAdmin.email, password: env.superAdmin.password },
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.isSuperAdmin, true);
  const blocked = await call(port, '/api/leads', { token: admin.data.accessToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'tenant_required');

  const wrong = await call(port, '/api/auth/login', {
    method: 'POST',
    body: { email: env.superAdmin.email, password: 'not-the-password' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.stringify(wrong.data).includes(env.superAdmin.password), false);

  async function workspace(slug, email) {
    const created = await call(port, '/api/admin/tenants', {
      method: 'POST',
      token: admin.data.accessToken,
      body: { name: slug, slug, market: 'IN', adminEmail: email, adminPassword: password, adminName: 'Readiness Admin' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const session = await call(port, '/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(session.status, 200);
    return { id: created.data.tenant.id, token: session.data.accessToken };
  }

  const east = await workspace(`east-${stamp}`, `east-${stamp}@hycin.test`);
  const west = await workspace(`west-${stamp}`, `west-${stamp}@hycin.test`);

  const lead = await call(port, '/api/leads', {
    method: 'POST',
    token: east.token,
    body: { name: 'Isolation Lead', phone: '+919800000099', tenantId: west.id },
  });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const stored = await started.models.Lead.findByPk(lead.data.lead.id);
  assert.equal(stored.tenantId, east.id);
  const foreign = await call(port, `/api/leads/${lead.data.lead.id}`, { token: west.token });
  assert.equal(foreign.status, 404);
  const westList = await call(port, '/api/leads', { token: west.token });
  assert.equal(westList.data.leads.some((row) => row.id === lead.data.lead.id), false);

  const viewer = await call(port, '/api/members', {
    method: 'POST',
    token: east.token,
    body: { name: 'Readiness Viewer', email: `view-${stamp}@hycin.test`, password, role: 'viewer' },
  });
  assert.equal(viewer.status, 201, JSON.stringify(viewer.data));
  const viewerSession = await call(port, '/api/auth/login', {
    method: 'POST',
    body: { email: `view-${stamp}@hycin.test`, password },
  });
  const denied = await call(port, '/api/leads', {
    method: 'POST',
    token: viewerSession.data.accessToken,
    body: { name: 'Viewer Lead' },
  });
  assert.equal(denied.status, 403);

  const suspended = await call(port, `/api/admin/tenants/${west.id}`, {
    method: 'PATCH',
    token: admin.data.accessToken,
    body: { status: 'suspended' },
  });
  assert.equal(suspended.status, 200);
  const westLogin = await call(port, '/api/auth/login', { method: 'POST', body: { email: `west-${stamp}@hycin.test`, password } });
  const frozen = await call(port, '/api/leads', {
    method: 'POST',
    token: westLogin.data.accessToken,
    body: { name: 'Suspended Lead' },
  });
  assert.equal(frozen.status, 403);
  assert.equal(frozen.data.error.code, 'tenant_suspended');

  const policy = await call(port, '/api/reply-policy', {
    method: 'PATCH',
    token: east.token,
    body: { bot: 'enabled', comments: true },
  });
  assert.equal(policy.status, 200);
  assert.equal(policy.data.policy.bot, 'disabled');
  const probe = await call(port, '/api/reply-policy/test', { method: 'POST', token: east.token, body: { text: 'hello' } });
  assert.equal(probe.status, 503);
  assert.equal(probe.data.error.code, 'bot_disabled');

  const sheets = await call(port, '/api/tenant/integrations/google-sheets', { token: east.token });
  assert.equal(sheets.status, 200);
  assert.equal(JSON.stringify(sheets.data).includes('PRIVATE KEY'), false);
  assert.equal(JSON.stringify(sheets.data).includes('private_key'), false);

  const webhook = await call(port, '/api/webhooks/meta', {
    method: 'POST',
    body: { entry: [] },
    headers: { 'x-hub-signature-256': 'sha256=not-the-signature' },
  });
  assert.equal(webhook.status, 401);
  assert.equal(webhook.data.error.code, 'invalid_signature');
  const storedEvents = await started.models.WebhookEvent.count();
  assert.equal(storedEvents, 0);

  const burst = await Promise.all(Array.from({ length: 30 }, async () => {
    const began = Date.now();
    const result = await call(port, '/api/health');
    return { status: result.status, ms: Date.now() - began };
  }));
  assert.equal(burst.every((item) => item.status === 200), true);
  const slowest = Math.max(...burst.map((item) => item.ms));
  assert.ok(slowest < 3000, `health burst slowest ${slowest}ms`);
  console.log(`health burst 30 max ${slowest}ms`);
});
