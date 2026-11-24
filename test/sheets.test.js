import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySheetRows, leadRow, publicSheetsStatus, spreadsheetIdFrom } from '../src/integrations/googleSheets.js';

test('a spreadsheet link and a bare id both resolve to the id', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWx';
  assert.equal(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(spreadsheetIdFrom(id), id);
  assert.throws(() => spreadsheetIdFrom('not-a-sheet'), (error) => error.code === 'validation');
});

test('the service-account status never includes the private key', () => {
  const status = publicSheetsStatus(JSON.stringify({
    client_email: 'sheets@example.iam.gserviceaccount.com',
    private_key: 'secret-key',
  }));
  assert.deepEqual(status, { configured: true, email: 'sheets@example.iam.gserviceaccount.com' });
  assert.equal(JSON.stringify(status).includes('secret-key'), false);
  assert.deepEqual(publicSheetsStatus(''), { configured: false, email: null });
  assert.deepEqual(publicSheetsStatus('{'), { configured: false, email: null });
});

test('inbound rows that this workspace already exported are skipped', () => {
  const rows = [
    ['HYCIN lead id', 'Name', 'Phone', 'Email'],
    ['lead-1', 'Neha', '+919900000000', 'neha@example.com'],
    ['', 'Asha', '+919811111111', ''],
    ['', '', '', ''],
  ];
  const result = classifySheetRows(rows, new Set(['lead-1']));
  assert.equal(result.skipped, 2);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].name, 'Asha');
  assert.equal(result.imported[0].rowNumber, 3);
});

test('a Meta instant-form header imports the name, phone, and email', () => {
  const rows = [
    ['id', 'created_time', 'full_name', 'phone', 'email_address'],
    ['123', '2026-11-14T10:00:00+0000', 'Asha Rao', '919800000000', 'asha@example.com'],
  ];
  const result = classifySheetRows(rows, new Set());
  assert.equal(result.error, undefined);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].name, 'Asha Rao');
  assert.equal(result.imported[0].phone, '919800000000');
  assert.equal(result.imported[0].email, 'asha@example.com');
});

test('an outbound row keeps the lead id in the first column', () => {
  const row = leadRow(['HYCIN lead id', 'Name', 'Phone'], { id: 'lead-9', name: 'Meera', phone: '+91 98111 22233' }, 'Baner Crest');
  assert.deepEqual(row, ['lead-9', 'Meera', '+91 98111 22233']);
});
