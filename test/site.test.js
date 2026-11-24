import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCustomDomain, buildSlots, defaultHeadline, normalizeDomain } from '../src/services/siteService.js';

test('a headline uses the areas the workspace actually covers', () => {
  assert.equal(defaultHeadline(['Baner', 'Kothrud']), 'Homes in Baner & Kothrud, chosen with care.');
  assert.equal(defaultHeadline([]), 'Homes chosen with care.');
});

test('a custom domain is a hostname, and the HYCIN address is rejected', () => {
  assert.equal(normalizeDomain('https://Homes.Example.com/path'), 'homes.example.com');
  assert.equal(normalizeDomain('  '), null);
  assert.throws(() => normalizeDomain('not a domain'), (error) => error.code === 'validation');
  assert.throws(() => normalizeDomain('me.hycin.site'), (error) => error.code === 'validation');
});

test('a workspace without the Elite feature cannot save a custom domain', () => {
  assert.throws(() => assertCustomDomain(false, 'homes.example.com'), (error) => error.code === 'plan_required' && error.status === 403);
  assert.equal(assertCustomDomain(true, 'homes.example.com'), 'homes.example.com');
  assert.equal(assertCustomDomain(false, ''), null);
});

test('visit slots skip the notice window and times that are already booked', () => {
  const now = new Date('2026-11-23T08:00:00');
  const busyStart = new Date('2026-11-23T11:00:00');
  const slots = buildSlots({
    now,
    days: 1,
    workDays: [1],
    workFrom: '10:00',
    workTo: '13:00',
    visitMinutes: 60,
    noticeHours: 3,
    busy: [{ startAt: busyStart, endAt: new Date(busyStart.getTime() + 60 * 60 * 1000) }],
  });
  const times = slots.flatMap((group) => group.slots);
  assert.equal(times.includes(new Date('2026-11-23T10:00:00').toISOString()), false);
  assert.equal(times.includes(busyStart.toISOString()), false);
  assert.equal(times.includes(new Date('2026-11-23T12:00:00').toISOString()), true);
});
