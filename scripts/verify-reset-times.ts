// One-time verification of DEFAULT_SCHEDULES against Blizzard reality (F-10
// in ADVERSARIAL-REVIEW.md): the tests pin engine consistency, not that the
// fixed-UTC reset constants match the live API. This script fetches the M+
// period index per region through the existing blizzard client and compares
// the current period's start instant to the reset instant the week engine
// computes; both flip at the same real instant, so the verdict is stable no
// matter when it runs.
//
//   npx tsx scripts/verify-reset-times.ts
//
// Needs BLIZZARD_CLIENT_ID/SECRET in .env and a reachable DATABASE_URL (the
// client writes the fetched payloads into api_cache). Exits nonzero on any
// mismatch or fetch error. Constants in src/lib/week.ts change only on this
// script's evidence: a mismatch means the real reset has shifted (e.g. a DST
// move in a local-time region) and DEFAULT_SCHEDULES must follow.

import { prisma } from '@/server/prisma';
import { blizzardGet } from '@/lib/blizzard/client';
import type { Region } from '@/lib/blizzard/client';
import { DEFAULT_SCHEDULES, currentWeekId, lastReset, formatWeekId } from '@/lib/week';

type PeriodIndex = {
  current_period: {
    id: number;
    start_timestamp: number | string;
    end_timestamp: number | string;
  };
};

// The API mixes conventions across endpoints (ms epoch numbers on the
// keystone profile, ISO 8601 strings on the period index); accept both.
function startMs(ts: number | string): number {
  return typeof ts === 'number' ? ts : Date.parse(ts);
}

const REGIONS: Region[] = ['us', 'eu', 'kr', 'tw'];

async function main(): Promise<number> {
  const now = new Date();
  let mismatches = 0;

  for (const region of REGIONS) {
    try {
      const data = await blizzardGet<PeriodIndex>(
        '/data/wow/mythic-keystone/period/index',
        {},
        { version: 'retail', region, namespaceKind: 'dynamic', ttlClass: 'profile' },
      );
      const period = data.current_period;
      const apiStart = startMs(period.start_timestamp);
      const engineReset = lastReset(now, DEFAULT_SCHEDULES[region]).getTime();
      const driftMin = Math.round((engineReset - apiStart) / 60000);
      const ok = driftMin === 0;
      if (!ok) mismatches += 1;
      console.log(
        `${ok ? 'OK      ' : 'MISMATCH'} ${region.toUpperCase()}: period ${period.id} ` +
          `starts ${new Date(apiStart).toISOString()}, engine reset ` +
          `${new Date(engineReset).toISOString()} (weekId ` +
          `${formatWeekId(new Date(engineReset))}, engine weekId ` +
          `${currentWeekId(region, now, DEFAULT_SCHEDULES)}), drift ${driftMin} min`,
      );
    } catch (err) {
      mismatches += 1;
      console.error(`ERROR    ${region.toUpperCase()}:`, err instanceof Error ? err.message : err);
    }
  }

  return mismatches;
}

main()
  .then((mismatches) => {
    console.log(
      mismatches === 0
        ? 'All regions match DEFAULT_SCHEDULES.'
        : `${mismatches} region(s) mismatch DEFAULT_SCHEDULES - see src/lib/week.ts.`,
    );
    process.exitCode = mismatches === 0 ? 0 : 1;
  })
  .catch((err) => {
    console.error('[verify-reset-times] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
