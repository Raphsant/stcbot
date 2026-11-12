import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSubscription, toMembership } from './cf-membership.js';

const delta = { original_product: { name: 'Grupo Delta' }, products_price: { interval: 'months', interval_count: 1 } };
const sub = (over) => ({ order_type: 'subscription-order', line_items: [delta], ...over });

const EMPTY = {
  status: null, orderId: null, productName: null, interval: null,
  expiresAt: null, expirySource: null, nextChargeAt: null, canceledAt: null,
};

test('an active subscription maps to its paid_until', () => {
  const m = toMembership([sub({
    id: 6990265, service_status: 'active',
    paid_until: '2026-12-01T03:35:18.000Z', next_charge_at: '2026-12-01T04:35:18.000Z', renewal_at: '2026-12-01T03:35:18.000Z',
    canceled_at: null,
  })]);
  assert.deepEqual(m, {
    status: 'active', orderId: 6990265, productName: 'Grupo Delta', interval: 'months',
    expiresAt: new Date('2026-12-01T03:35:18.000Z'), expirySource: 'paid_until',
    nextChargeAt: new Date('2026-12-01T04:35:18.000Z'), canceledAt: null,
  });
});

test('never-paid checkouts are ignored even though they carry next_charge_at', () => {
  const abandoned = sub({ id: 1, service_status: 'abandoned', paid_until: null, next_charge_at: '2025-12-11T01:03:45.000Z', renewal_at: '2025-12-11T01:03:45.000Z' });
  assert.deepEqual(toMembership([abandoned]), EMPTY);
  assert.deepEqual(toMembership([]), EMPTY);
  assert.deepEqual(toMembership(null), EMPTY);
});

test('one-time orders are not memberships', () => {
  const event = { id: 2, order_type: 'one-time-order', service_status: 'completed', paid_until: '2027-01-01T00:00:00.000Z' };
  assert.deepEqual(toMembership([event]), EMPTY);
});

test('a lapsed member keeps the most recent paid-through date', () => {
  const old = sub({ id: 2187095, service_status: 'churned', paid_until: '2025-06-03T22:02:59.000Z', canceled_at: '2025-07-06T23:06:01.000Z', next_charge_at: '2025-07-06T23:06:01.000Z' });
  const recent = sub({ id: 7110039, service_status: 'churned', paid_until: '2026-11-12T17:44:46.000Z', canceled_at: '2026-10-12T17:45:03.000Z' });
  const m = toMembership([old, recent]);
  assert.equal(m.orderId, 7110039);
  assert.equal(m.status, 'churned');
  assert.deepEqual(m.expiresAt, new Date('2026-11-12T17:44:46.000Z'));
  assert.deepEqual(m.canceledAt, new Date('2026-10-12T17:45:03.000Z'));
  assert.equal(m.nextChargeAt, null); // it will not renew
});

test('an active subscription wins over a canceled one paid further ahead', () => {
  const canceled = sub({ id: 10, service_status: 'canceled', paid_until: '2026-12-20T00:00:00.000Z' });
  const active = sub({ id: 11, service_status: 'active', paid_until: '2026-12-01T00:00:00.000Z' });
  assert.equal(pickSubscription([canceled, active]).id, 11);
});

test('multi-month prices keep their count, missing line items do not break', () => {
  const quarterly = sub({ id: 3, service_status: 'active', paid_until: '2027-01-01T00:00:00.000Z', line_items: [{ products_variant: { name: 'Delta trimestral' }, products_price: { interval: 'months', interval_count: 3 } }] });
  assert.equal(toMembership([quarterly]).interval, '3 months');
  assert.equal(toMembership([quarterly]).productName, 'Delta trimestral');
  const bare = sub({ id: 4, service_status: 'active', paid_until: '2027-01-01T00:00:00.000Z', line_items: undefined });
  assert.equal(toMembership([bare]).productName, null);
  assert.equal(toMembership([bare]).interval, null);
});
