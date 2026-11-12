import 'dotenv/config';
import { connectToMongo } from '../mongo-client.js';
import mongoose from '../mongo-client.js';
import { syncAllCf } from '../cf-membership.js';

// Mirrors ClickFunnels subscriptions onto DiscordUser.cfMembership — the same
// job the bot runs nightly at 03:30 Chicago (there it also refreshes
// cfLocation). Use it for the first backfill.
//
// Usage:
//   node scripts/sync-cf-memberships.js --dry-run   # report what would be stored, no writes
//   node scripts/sync-cf-memberships.js             # apply (cfMembership only)

const dryRun = process.argv.includes('--dry-run');
const DAY = 24 * 60 * 60 * 1000;

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}
function printCounts(title, map) {
  console.log(`\n${title}`);
  for (const [k, n] of [...map].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
}

async function main() {
  // A dry run must not write anything, indexes included.
  if (dryRun) mongoose.set('autoIndex', false);
  await connectToMongo();

  const now = Date.now();
  const byStatus = new Map();
  const byProduct = new Map();
  const byWindow = new Map();
  let done = 0;

  const stats = await syncAllCf({
    dryRun,
    only: 'membership',
    onResult: (_u, m) => {
      if (++done % 50 === 0) console.log(`  …${done}`);
      bump(byStatus, m.status ?? '(sin suscripción pagada)');
      if (m.productName) bump(byProduct, m.productName);
      if (!m.expiresAt) return;
      const days = Math.floor((m.expiresAt.getTime() - now) / DAY);
      bump(byWindow, days < 0 ? 'vencida' : days <= 7 ? '≤ 7 días' : days <= 30 ? '8–30 días' : days <= 90 ? '31–90 días' : '> 90 días');
    },
  });

  printCounts('Por estado', byStatus);
  printCounts('Por producto', byProduct);
  printCounts('Por vencimiento', byWindow);
  console.log(`\n${dryRun ? '[dry-run] ' : ''}${stats.total} vinculados · ${stats.withExpiry} con vencimiento · ${stats.noSubscription} sin suscripción pagada · ${stats.failed} fallidos`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
