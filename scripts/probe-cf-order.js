import 'dotenv/config';

// Read-only probe: prints which subscription / expiry fields ClickFunnels
// actually returns for a contact's orders and invoices. It decides the field
// mapping for the membership-expiry sync (DiscordUser.cfMembership) that
// stc-front's Reportes page reads. Nothing is written anywhere.
//
// Personal data is not printed: only ids, statuses, dates, product / price
// names and the list of keys each object has.
//
// Usage:
//   node scripts/probe-cf-order.js <cfContactId> [<cfContactId> ...]
//   node scripts/probe-cf-order.js --discord <discordId>   # looks up cfContactId in Mongo
//   node scripts/probe-cf-order.js --raw <cfContactId>     # also dump the newest subscription order, PII keys removed
//
// Worth running on: an active Delta, a cancelled Delta, a "Delta." and an Alpha.

const CF_BASE = 'https://eduardobricenosteam309bd.myclickfunnels.com/api/v2';
const headers = { Authorization: `Bearer ${process.env.CF2_TOKEN}`, accept: 'application/json' };

const ORDER_FIELDS = [
  'id', 'order_type', 'service_status', 'billing_status', 'in_trial', 'created_at', 'activated_at',
  'canceled_at', 'churned_at', 'trial_end_at', 'next_charge_at', 'renewal_at', 'paid_until',
  'cancel_at_period_end', 'payment_processor',
];
const INVOICE_FIELDS = ['id', 'invoice_type', 'status', 'due_at', 'paid_at', 'issued_at'];
const PII = /address|email|phone|first_name|last_name|name_on|ip|card|notes|contact$/i;

async function cfGet(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`CF ${res.status} on ${url}`);
  return res.json();
}

const pick = (obj, fields) => Object.fromEntries(fields.map(f => [f, obj[f] === undefined ? '(absent)' : obj[f]]));

function lineItems(obj) {
  return (obj.line_items || []).map(li => ({
    product: li.original_product?.name ?? li.products_variant?.name ?? li.description ?? null,
    price: li.products_price?.name ?? null,
    interval: li.products_price?.interval ?? null,
    interval_count: li.products_price?.interval_count ?? null,
    period_start_at: li.period_start_at ?? '(absent)',
    period_end_at: li.period_end_at ?? '(absent)',
  }));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !PII.test(k)).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

async function probe(contactId, raw) {
  console.log(`\n══ contact ${contactId} ══`);
  const contact = await cfGet(`${CF_BASE}/contacts/${contactId}`);
  const ws = contact.workspace_id ?? process.env.WORKSPACE_ID;
  const orders = await cfGet(`${CF_BASE}/workspaces/${ws}/orders?filter[contact_id]=${contactId}&per_page=100&sort_order=desc`);
  console.log(`orders: ${orders.length}`);

  for (const o of orders) {
    console.log('\n── order');
    console.table([pick(o, ORDER_FIELDS)]);
    const items = lineItems(o);
    if (items.length) console.table(items);
    else console.log('  (no line_items on the list response)');
  }
  if (orders[0]) console.log('\norder keys:', Object.keys(orders[0]).filter(k => !PII.test(k)).join(', '));

  const sub = orders.find(o => o.order_type === 'subscription-order' && o.service_status === 'active')
    ?? orders.find(o => o.order_type === 'subscription-order')
    ?? orders[0];
  if (!sub) return;

  try {
    const invoices = await cfGet(`${CF_BASE}/orders/${sub.id}/invoices?per_page=100&sort_order=desc`);
    console.log(`\n── invoices of order ${sub.id}: ${invoices.length}`);
    console.table(invoices.slice(0, 6).map(i => ({ ...pick(i, INVOICE_FIELDS), ...(lineItems(i)[0] ?? {}) })));
    if (invoices[0]) console.log('invoice keys:', Object.keys(invoices[0]).filter(k => !PII.test(k)).join(', '));
  } catch (e) {
    console.log(`\ninvoices of order ${sub.id}: ${e.message}`);
  }

  if (raw) {
    console.log(`\n── raw order ${sub.id} (PII keys removed)`);
    console.log(JSON.stringify(redact(sub), null, 2));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const raw = args.includes('--raw');
  let ids = args.filter(a => /^\d+$/.test(a));

  const d = args.indexOf('--discord');
  if (d !== -1) {
    const [{ connectToMongo, default: mongoose }, { DiscordUser }] = await Promise.all([
      import('../mongo-client.js'),
      import('../models/DiscordUser.js'),
    ]);
    mongoose.set('autoIndex', false); // read-only: don't build indexes either
    await connectToMongo();
    const user = await DiscordUser.findById(args[d + 1]).select('username roles cfContactId').lean();
    await mongoose.disconnect();
    if (!user?.cfContactId) throw new Error(`Discord user ${args[d + 1]} has no cfContactId`);
    console.log(`discord ${args[d + 1]} → roles [${(user.roles || []).filter(r => r !== '@everyone').join(', ')}], cfContactId ${user.cfContactId}`);
    ids = [String(user.cfContactId)];
  }

  if (!ids.length) {
    console.log('Usage: node scripts/probe-cf-order.js <cfContactId> [...] | --discord <discordId> [--raw]');
    process.exit(1);
  }
  if (!process.env.CF2_TOKEN) throw new Error('CF2_TOKEN is not set');
  for (const id of ids) await probe(id, raw);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
