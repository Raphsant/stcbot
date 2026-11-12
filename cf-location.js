import { DiscordUser } from './models/DiscordUser.js';
import { REGION_NAMES, REGION_ALIASES } from './cf-regions.js';

// Mirrors each linked member's ClickFunnels address onto DiscordUser.cfLocation
// so stc-front can filter by country → province → city without calling CF.
//
// CF contacts have no address of their own; it lives on their orders. The most
// recent order with an address wins, billing before shipping — the same rule
// stc-front's contact panel uses (server/utils/clickfunnels.ts).

const CF_BASE = 'https://eduardobricenosteam309bd.myclickfunnels.com/api/v2';

// ---- normalization (pure) ----

// Grouping key: case-, accent- and punctuation-insensitive.
// "MÁLAGA", "Malaga" and " málaga " all become "malaga".
export function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const key = value
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key || null;
}

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'of', 'the', 'and']);

// Only re-cases text typed in ALL CAPS or all lowercase; mixed case is kept as typed.
function tidyCase(value) {
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value;
  return value.toLowerCase().split(' ').map((w, i) =>
    i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}

// "Guadalajara, Jal." → "Guadalajara": CF city fields sometimes carry the state.
export function resolveCity(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.split(',')[0].replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const key = normalizeKey(name);
  return key ? { name: tidyCase(name), key } : null;
}

// Known code ("M") or known name ("Madrid") → canonical name, keyed by code.
// Anything else is kept as typed (codes upper-cased), keyed by its normalized text.
export function resolveRegion(country, raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  const table = REGION_NAMES[country];
  if (table) {
    const code = value.toUpperCase();
    if (table[code]) return { name: table[code], key: code };
    const key = normalizeKey(value);
    const alias = REGION_ALIASES[country]?.[key];
    if (alias) return { name: table[alias], key: alias };
    for (const [c, name] of Object.entries(table)) {
      if (normalizeKey(name) === key) return { name, key: c };
    }
  }
  const key = normalizeKey(value);
  if (!key) return null;
  return { name: value.length <= 3 ? value.toUpperCase() : tidyCase(value), key };
}

const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function pickAddress(orders) {
  const sorted = [...(orders || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const o of sorted) {
    for (const prefix of ['billing_address_', 'shipping_address_']) {
      const addr = {
        city: clean(o[`${prefix}city`]),
        region: clean(o[`${prefix}region`]),
        country: clean(o[`${prefix}country`]),
        streetOne: clean(o[`${prefix}street_one`]),
      };
      if (addr.streetOne || addr.city) return addr;
    }
  }
  return null;
}

// Orders → the fields stored on DiscordUser.cfLocation (all null when unknown).
export function toLocation(orders) {
  const addr = pickAddress(orders);
  const country = addr?.country ? addr.country.toUpperCase() : null;
  const region = addr ? resolveRegion(country, addr.region) : null;
  const city = addr ? resolveCity(addr.city) : null;
  return {
    country,
    region: region?.name ?? null,
    regionKey: region?.key ?? null,
    city: city?.name ?? null,
    cityKey: city?.key ?? null,
  };
}

// ---- ClickFunnels I/O ----

// CF's gateway throws the odd 502/429, so retry with backoff.
// Newest first, 100 per page: the default is 20 oldest-first, which hides the
// current order of anyone with a long history.
export async function fetchOrders(contactId) {
  const url = `${CF_BASE}/workspaces/${process.env.WORKSPACE_ID}/orders?filter[contact_id]=${contactId}&per_page=100&sort_order=desc`;
  const headers = { Authorization: `Bearer ${process.env.CF2_TOKEN}`, accept: 'application/json' };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers }).catch(e => ({ ok: false, status: e.message }));
    if (res.ok) return res.json();
    if (res.status === 404) return [];
    if (attempt >= 5) throw new Error(`CF ${res.status} fetching orders for contact ${contactId}`);
    await new Promise(r => setTimeout(r, res.status === 429 ? 15000 : 2000 * attempt));
  }
}

export async function syncCfLocation(discordId, contactId) {
  const location = toLocation(await fetchOrders(contactId));
  await DiscordUser.updateOne(
    { _id: discordId },
    { $set: { cfLocation: { ...location, syncedAt: new Date() } } },
  );
  return location;
}

// Sequential on purpose: ~0.5s per contact keeps us well under CF's rate limit.
export async function syncAllCfLocations({ dryRun = false, onResult } = {}) {
  const users = await DiscordUser.find({ cfContactId: { $ne: null } }, { _id: 1, cfContactId: 1 }).lean();
  const stats = { total: users.length, located: 0, noAddress: 0, failed: 0 };
  for (const u of users) {
    try {
      const location = dryRun
        ? toLocation(await fetchOrders(u.cfContactId))
        : await syncCfLocation(u._id, u.cfContactId);
      if (location.country) stats.located++; else stats.noAddress++;
      onResult?.(u, location);
    } catch (e) {
      stats.failed++;
      console.error(`cfLocation sync failed for ${u._id}:`, e.message);
    }
  }
  return stats;
}
