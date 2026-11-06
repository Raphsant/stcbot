import 'dotenv/config';
import { connectToMongo } from '../mongo-client.js';
import mongoose from '../mongo-client.js';
import { DiscordUser } from '../models/DiscordUser.js';

// Sets DiscordUser.cfContactId from ClickFunnels. A contact is linked to a
// Discord user through its `discord_id` custom attribute, which the enroll
// flows write — that is the only match used here, no username guessing.
//
// When several contacts carry the same discord_id, the one with an active
// order wins, then the one with the most orders, then the most recently
// updated. Users with no linked contact are left untouched (never unset).
//
// Usage:
//   node scripts/backfill-cf-contact-id.js --dry-run   # report counts only, no writes
//   node scripts/backfill-cf-contact-id.js             # apply

const dryRun = process.argv.includes('--dry-run');
const CF_BASE = 'https://eduardobricenosteam309bd.myclickfunnels.com/api/v2';
const headers = { Authorization: `Bearer ${process.env.CF2_TOKEN}`, accept: 'application/json' };

// CF's gateway throws the odd 502 on long paginations, so retry with backoff.
async function cfGet(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers }).catch(e => ({ ok: false, status: e.message, headers: new Headers() }));
    if (res.ok) return { data: await res.json(), next: res.headers.get('pagination-next') };
    if (attempt >= 8) throw new Error(`CF ${res.status} on ${url}`);
    await new Promise(r => setTimeout(r, res.status === 429 ? 15000 : 2000 * attempt));
  }
}

async function fetchAllContacts() {
  const base = `${CF_BASE}/workspaces/${process.env.WORKSPACE_ID}/contacts`;
  const all = [];
  let after = null;
  do {
    const { data, next } = await cfGet(after ? `${base}?after=${after}` : base);
    all.push(...data);
    after = data.length ? next : null;
    if (all.length % 2000 === 0) console.log(`  …${all.length} contacts`);
  } while (after);
  return all;
}

async function pickContact(contacts) {
  if (contacts.length === 1) return contacts[0];
  const scored = [];
  for (const c of contacts) {
    const { data: orders } = await cfGet(`${CF_BASE}/workspaces/${process.env.WORKSPACE_ID}/orders?filter[contact_id]=${c.id}`);
    scored.push({ c, active: orders.some(o => o.service_status === 'active'), count: orders.length });
  }
  scored.sort((a, b) => (b.active - a.active) || (b.count - a.count) || (new Date(b.c.updated_at) - new Date(a.c.updated_at)));
  return scored[0].c;
}

async function main() {
  // Mongoose would otherwise build the new cfContactId index on connect —
  // a dry run must not write anything, indexes included.
  if (dryRun) mongoose.set('autoIndex', false);
  await connectToMongo();

  console.log('Fetching ClickFunnels contacts…');
  const contacts = await fetchAllContacts();

  const byDiscordId = new Map();
  for (const c of contacts) {
    const did = c.custom_attributes?.discord_id?.toString().trim();
    if (!did) continue;
    if (!byDiscordId.has(did)) byDiscordId.set(did, []);
    byDiscordId.get(did).push(c);
  }

  const users = await DiscordUser.find({}, { _id: 1, cfContactId: 1, removedAt: 1 }).lean();

  const toSet = [], changed = [], duplicates = [];
  let unchanged = 0, noMatch = 0, noMatchActive = 0;
  for (const u of users) {
    const linked = byDiscordId.get(u._id);
    if (!linked) {
      noMatch++;
      if (!u.removedAt) noMatchActive++;
      continue;
    }
    const contact = await pickContact(linked);
    if (linked.length > 1) duplicates.push({ discordId: u._id, picked: contact.id, others: linked.filter(c => c !== contact).map(c => c.id) });
    if (u.cfContactId === contact.id) { unchanged++; continue; }
    if (u.cfContactId != null) changed.push({ discordId: u._id, from: u.cfContactId, to: contact.id });
    toSet.push({ discordId: u._id, cfContactId: contact.id, inServer: !u.removedAt });
  }

  const userIds = new Set(users.map(u => u._id));
  const orphanLinks = [...byDiscordId.keys()].filter(id => !userIds.has(id)).length;

  console.log(`\nCF contacts:                         ${contacts.length}`);
  console.log(`CF contacts with a discord_id:       ${[...byDiscordId.values()].reduce((n, v) => n + v.length, 0)} (${byDiscordId.size} distinct Discord IDs)`);
  console.log(`DiscordUser records:                 ${users.length}`);
  console.log(`Will set cfContactId:                ${toSet.length} (${toSet.filter(t => t.inServer).length} in server, ${toSet.filter(t => !t.inServer).length} removed)`);
  console.log(`  …of which overwrite a different id: ${changed.length}`);
  console.log(`Already correct:                     ${unchanged}`);
  console.log(`No linked CF contact (left as null): ${noMatch} (${noMatchActive} still in server)`);
  console.log(`Linked CF IDs with no DiscordUser:   ${orphanLinks} (skipped — nothing to attach to)`);
  if (duplicates.length) {
    console.log(`\n${duplicates.length} Discord IDs are linked to several CF contacts; picked:`);
    for (const d of duplicates) console.log(`  ${d.discordId} -> ${d.picked} (also ${d.others.join(', ')})`);
  }
  if (changed.length) {
    console.log('\nOverwrites:');
    for (const c of changed) console.log(`  ${c.discordId}: ${c.from} -> ${c.to}`);
  }

  if (dryRun) {
    console.log('\n[dry-run] No changes written.');
  } else if (toSet.length > 0) {
    const result = await DiscordUser.bulkWrite(toSet.map(t => ({
      updateOne: { filter: { _id: t.discordId }, update: { $set: { cfContactId: t.cfContactId } } },
    })));
    console.log(`\nSet cfContactId on ${result.modifiedCount} user(s).`);
  } else {
    console.log('\nNothing to set — every linked user already has the right cfContactId.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
