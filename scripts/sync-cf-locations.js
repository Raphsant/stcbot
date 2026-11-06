import 'dotenv/config';
import { connectToMongo } from '../mongo-client.js';
import mongoose from '../mongo-client.js';
import { syncAllCfLocations } from '../cf-location.js';
import { REGION_NAMES } from '../cf-regions.js';

// Mirrors ClickFunnels addresses onto DiscordUser.cfLocation — the same job
// the bot runs nightly at 03:30 Chicago. Use it for the first backfill.
//
// Usage:
//   node scripts/sync-cf-locations.js --dry-run   # report what would be stored, no writes
//   node scripts/sync-cf-locations.js             # apply

const dryRun = process.argv.includes('--dry-run');

async function main() {
  // A dry run must not write anything, indexes included.
  if (dryRun) mongoose.set('autoIndex', false);
  await connectToMongo();

  const byCountry = new Map();
  // Regions in countries we have a table for that still didn't resolve to it.
  const unmapped = new Map();
  let done = 0;
  const stats = await syncAllCfLocations({
    dryRun,
    onResult: (_u, loc) => {
      if (++done % 50 === 0) console.log(`  …${done}`);
      const c = loc.country ?? '(sin ubicación)';
      if (!byCountry.has(c)) byCountry.set(c, { n: 0, regions: new Map(), cities: new Map() });
      const e = byCountry.get(c);
      e.n++;
      if (loc.region) e.regions.set(loc.region, (e.regions.get(loc.region) || 0) + 1);
      if (loc.region && REGION_NAMES[c] && !Object.hasOwn(REGION_NAMES[c], loc.regionKey)) {
        const k = `${c} / ${loc.region}`;
        unmapped.set(k, (unmapped.get(k) || 0) + 1);
      }
      if (loc.cityKey) e.cities.set(loc.cityKey, (e.cities.get(loc.cityKey) || 0) + 1);
    },
  });

  console.log('\n', stats);
  for (const [c, e] of [...byCountry].sort((a, b) => b[1].n - a[1].n)) {
    const top = [...e.regions].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `${r} ${n}`).join(', ');
    console.log(`${c.padEnd(16)} ${String(e.n).padStart(4)}  ${e.regions.size} regions, ${e.cities.size} cities  [${top}]`);
  }
  if (unmapped.size) {
    console.log('\nUnmapped regions (kept as typed):');
    for (const [k, n] of [...unmapped].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${n}`);
  }
  console.log(dryRun ? '\n[dry-run] No changes written.' : '\nLocations written.');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
