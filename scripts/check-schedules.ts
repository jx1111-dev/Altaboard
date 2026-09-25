// Sanity check: seeded reset_schedules must match the week engine's defaults.
// Run: npx tsx scripts/check-schedules.ts  (requires DATABASE_URL)

import { prisma } from '../src/server/prisma';
import { DEFAULT_SCHEDULES, weekKeyFor } from '../src/lib/week';

async function main() {
  const schedules = await prisma.resetSchedule.findMany();
  let ok = true;

  for (const s of schedules) {
    const expected = DEFAULT_SCHEDULES[s.region];
    if (!expected) {
      console.error(`region ${s.region}: seeded but no engine default`);
      ok = false;
      continue;
    }
    if (expected.resetDow !== s.resetDow || expected.resetHourUtc !== s.resetHourUtc) {
      console.error(
        `region ${s.region}: seed (${s.resetDow}, ${s.resetHourUtc} UTC) != engine (${expected.resetDow}, ${expected.resetHourUtc} UTC)`,
      );
      ok = false;
    }
  }

  for (const region of ['us', 'eu', 'kr', 'tw']) {
    const wk = weekKeyFor(region);
    const next = weekKeyFor(region, new Date(Date.now() + 7.5 * 86_400_000));
    console.log(`${region}: week ${wk} (next week: ${next})`);
  }

  console.log(ok ? 'schedules consistent' : 'SCHEDULE MISMATCH — fix seeds');
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
