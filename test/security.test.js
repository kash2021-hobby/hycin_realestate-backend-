import test from 'node:test';
import assert from 'node:assert/strict';
import { firstOrigin } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/error.js';
import { requireTenant } from '../src/middleware/auth.js';

test('the OAuth return address still works when several origins are configured', () => {
  assert.equal(firstOrigin(['http://127.0.0.1:5173/', 'http://localhost:5173']), 'http://127.0.0.1:5173');
  assert.equal(firstOrigin('http://localhost:5173/'), 'http://localhost:5173');
});

test('a server error does not return its internal message', () => {
  const write = console.error;
  console.error = () => {};
  const res = {
    headersSent: false,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const error = new Error('JWT secret and SQL are in this message');
  error.status = 500;
  errorHandler(error, {}, res, () => {});
  assert.equal(res.code, 500);
  assert.equal(res.body.error.message, 'Something went wrong.');
  assert.equal(JSON.stringify(res.body).includes('JWT secret'), false);
  console.error = write;
});

test('a client cannot choose the workspace by sending tenantId', () => {
  const req = { auth: { tenantId: 'workspace-a' }, body: { tenantId: 'workspace-b', name: 'Neha' } };
  let called = false;
  requireTenant(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.body.tenantId, undefined);
  assert.equal(req.body.name, 'Neha');
});
