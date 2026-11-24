import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSameTenant, can } from '@hycin/shared';
import { leadWhere, normalizePhone } from '../src/services/crmService.js';

test('a resource from another tenant is rejected', () => {
  assert.throws(
    () => assertSameTenant('tenant-a', 'tenant-b'),
    (error) => error.code === 'tenant_forbidden' && error.status === 403,
  );
});

test('a missing workspace on the token is rejected', () => {
  assert.throws(
    () => assertSameTenant('tenant-a', null),
    (error) => error.code === 'tenant_forbidden',
  );
});

test('the same workspace is allowed', () => {
  assert.doesNotThrow(() => assertSameTenant('tenant-a', 'tenant-a'));
});

test('a viewer cannot manage the workspace', () => {
  assert.equal(can('viewer', 'workspace.view'), true);
  assert.equal(can('viewer', 'workspace.write'), false);
  assert.equal(can('agent', 'workspace.write'), true);
  assert.equal(can('agent', 'workspace.admin'), false);
  assert.equal(can('tenant_admin', 'workspace.admin'), true);
  assert.equal(can('super_admin', 'platform.admin'), true);
  assert.equal(can('tenant_admin', 'platform.admin'), false);
});

test('lead queries stay inside the signed-in workspace', () => {
  const where = leadWhere('tenant-a', { q: 'priya', stage: 'new', source: 'instagram' });
  assert.equal(where.tenantId, 'tenant-a');
  assert.equal(where.stage, 'new');
  assert.equal(where.source, 'instagram');
  assert.equal(normalizePhone('+91 98220 41876'), '+919822041876');
});

test('the mobile screen list stays at 42', async () => {
  const screens = (await import('../../mobile/src/screens/index.js')).MOBILE_SCREENS;
  assert.equal(screens.length, 42);
  assert.equal(new Set(screens).size, 42);
});
