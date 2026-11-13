import { DiscordUser } from './models/DiscordUser.js';
import { fetchOrders, toLocation } from './cf-location.js';

// Mirrors each linked member's ClickFunnels subscription onto
// DiscordUser.cfMembership so stc-front's Reportes page can filter by
// "expires this week / this month" without calling CF.
//
// What real orders look like (scripts/probe-cf-order.js):
//   - a paid subscription-order carries `paid_until`, whether it is active,
//     canceled or churned — that is the date access runs out, so it is the
//     expiry we store;
//   - a checkout that was never paid is service_status "abandoned" (or
//     "pending"): it has next_charge_at / renewal_at but no paid_until, so
//     those two fields must not be used as an expiry;
//   - one-time orders (events, conferences) are not memberships.

const toDate = v => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---- mapping (pure) ----

// The subscription that decides the member's access: an active one if there
// is any, otherwise the one paid furthest into the future.
export function pickSubscription(orders) {
  const subs = (orders || []).filter(o => o.order_type === 'subscription-order' && toDate(o.paid_until));
  subs.sort((a, b) =>
    (b.service_status === 'active') - (a.service_status === 'active')
    || toDate(b.paid_until) - toDate(a.paid_until));
  return subs[0] ?? null;
}

function describeItem(order) {
  const li = order.line_items?.[0];
  const price = li?.products_price;
  const count = price?.interval_count;
  return {
    productName: li?.original_product?.name ?? li?.products_variant?.name ?? null,
    interval: price?.interval ? (count > 1 ? `${count} ${price.interval}` : price.interval) : null,
  };
}

// Orders → the fields stored on DiscordUser.cfMembership (all null when the
// contact has no paid subscription).
export function toMembership(orders) {
  const o = pickSubscription(orders);
  if (!o) {
    return {
      status: null, orderId: null, productName: null, interval: null,
      expiresAt: null, expirySource: null, nextChargeAt: null, canceledAt: null,
    };
  }
  return {
    status: o.service_status ?? null,
    orderId: o.id ?? null,
    ...describeItem(o),
    expiresAt: toDate(o.paid_until),
    expirySource: 'paid_until',
    // Only meaningful while the subscription is still going to renew
    nextChargeAt: o.service_status === 'active' ? toDate(o.next_charge_at) : null,
    canceledAt: toDate(o.canceled_at),
  };
}

// ---- sync ----

export async function syncCfMembership(discordId, contactId) {
  const membership = toMembership(await fetchOrders(contactId));
  await DiscordUser.updateOne(
    { _id: discordId },
    { $set: { cfMembership: { ...membership, syncedAt: new Date() } } },
  );
  return membership;
}

// One CF call per member feeds both mirrors (address and subscription).
export async function syncCfUser(discordId, contactId) {
  const orders = await fetchOrders(contactId);
  const now = new Date();
  const location = toLocation(orders);
  const membership = toMembership(orders);
  await DiscordUser.updateOne(
    { _id: discordId },
    { $set: { cfLocation: { ...location, syncedAt: now }, cfMembership: { ...membership, syncedAt: now } } },
  );
  return { location, membership };
}

// Sequential on purpose: ~0.5s per contact keeps us well under CF's rate limit.
// `only: 'membership'` leaves cfLocation alone (used by the backfill script).
export async function syncAllCf({ dryRun = false, only = null, onResult } = {}) {
  const users = await DiscordUser.find({ cfContactId: { $ne: null } }, { _id: 1, cfContactId: 1 }).lean();
  const stats = { total: users.length, located: 0, noAddress: 0, withExpiry: 0, noSubscription: 0, failed: 0 };
  for (const u of users) {
    try {
      let location = null;
      let membership;
      if (dryRun) {
        const orders = await fetchOrders(u.cfContactId);
        location = toLocation(orders);
        membership = toMembership(orders);
      } else if (only === 'membership') {
        membership = await syncCfMembership(u._id, u.cfContactId);
      } else {
        ({ location, membership } = await syncCfUser(u._id, u.cfContactId));
      }
      if (location) { if (location.country) stats.located++; else stats.noAddress++; }
      if (membership.expiresAt) stats.withExpiry++; else stats.noSubscription++;
      onResult?.(u, membership, location);
    } catch (e) {
      stats.failed++;
      console.error(`CF sync failed for ${u._id}:`, e.message);
    }
  }
  return stats;
}
