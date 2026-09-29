// Worker: one container, one loop. Every 10 minutes it evaluates explicit
// triggers (no TTL conflation):
// - rollover sweep: a region's weekId changed since the last tick -> refresh
//   all characters in that region (previous week's snapshot stands as history)
// - daily sweep: characters whose lastFetchedAt is older than 24 h
// plus it purges expired cache rows and logs each sweep to job_runs.
// Sweeps are rate-budgeted (shared token bucket); one bad character never
// crashes the worker.

import { prisma } from '@/server/prisma';
import { currentWeekId, DEFAULT_SCHEDULES } from '@/lib/week';
import { refreshCharacter } from '@/lib/board';
import { purgeExpiredCache } from '@/lib/blizzard/cache';

const TICK_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_STALENESS_MS = 24 * 60 * 60 * 1000;
const JOB_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const REGIONS = ['us', 'eu', 'kr', 'tw'];

async function main() {
  console.log('[worker] started - ticking every', TICK_INTERVAL_MS / 60000, 'min');
  await tick(); // run immediately on startup
  setInterval(() => void tick(), TICK_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const now = new Date();
  console.log('[worker] tick', now.toISOString());

  try {
    const rolledRegions = await rolloverSweep(now);
    await dailySweep(now);
    const purged = await purgeExpiredCache();
    if (purged > 0) console.log(`[worker] purged ${purged} expired cache rows`);
    const prunedRuns = await pruneOldJobRuns(now);
    if (prunedRuns > 0) console.log(`[worker] pruned ${prunedRuns} job_runs older than 30 days`);
    if (rolledRegions.length > 0) {
      console.log('[worker] rollover detected for regions:', rolledRegions.join(', '));
    }
  } catch (err) {
    console.error('[worker] tick failed:', err);
  }
}

// Compare each region's current weekId against the one recorded in the last
// sweep, refresh all characters of changed regions. A region's weekId is only
// recorded when its refresh ran with zero failures - failed regions keep the
// old weekId and are picked up again next tick.
async function rolloverSweep(now: Date): Promise<string[]> {
  const lastSweep = await prisma.jobRun.findFirst({
    where: { type: 'rollover_sweep', status: { in: ['success', 'partial'] } },
    orderBy: { startedAt: 'desc' },
  });

  const lastWeekIds: Record<string, string> =
    (lastSweep?.detail as { weekIds?: Record<string, string> } | null)?.weekIds ?? {};

  const currentWeekIds: Record<string, string> = {};
  for (const region of REGIONS) {
    try {
      currentWeekIds[region] = currentWeekId(region, now, DEFAULT_SCHEDULES);
    } catch {
      // region not in schedule - skip
    }
  }

  const changed = REGIONS.filter(
    (r) => currentWeekIds[r] !== undefined && currentWeekIds[r] !== lastWeekIds[r],
  );

  const job = await prisma.jobRun.create({
    data: { type: 'rollover_sweep', status: 'running' },
  });

  const recordedWeekIds: Record<string, string> = { ...lastWeekIds };
  let status = 'success';
  if (changed.length > 0) {
    const chars = await prisma.character.findMany({
      where: { region: { in: changed }, archived: false },
      select: { id: true, region: true },
    });
    const idsByRegion = new Map<string, string[]>();
    for (const c of chars) {
      idsByRegion.set(c.region, [...(idsByRegion.get(c.region) ?? []), c.id]);
    }
    for (const region of changed) {
      const failures = await refreshByIds(idsByRegion.get(region) ?? [], now);
      if (failures === 0) {
        recordedWeekIds[region] = currentWeekIds[region];
      } else {
        status = 'partial';
      }
    }
  }

  await prisma.jobRun.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      detail: {
        weekIds: recordedWeekIds,
        rolledRegions: changed,
      },
    },
  });

  return changed;
}

// Refresh characters whose lastFetchedAt is older than 24 h (or never fetched).
async function dailySweep(now: Date): Promise<void> {
  const job = await prisma.jobRun.create({
    data: { type: 'daily_sweep', status: 'running' },
  });

  const cutoff = new Date(now.getTime() - DAILY_STALENESS_MS);
  const stale = await prisma.character.findMany({
    where: {
      archived: false,
      OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: cutoff } }],
    },
    select: { id: true },
  });

  const failures = await refreshByIds(
    stale.map((c) => c.id),
    now,
  );

  await prisma.jobRun.update({
    where: { id: job.id },
    data: {
      status: failures === 0 ? 'success' : 'partial',
      finishedAt: new Date(),
      detail: { candidates: stale.length, failures },
    },
  });
}

async function refreshByIds(ids: string[], now: Date): Promise<number> {
  let failures = 0;
  for (const id of ids) {
    const result = await refreshCharacter(id, { now });
    if (!result.ok) {
      failures += 1;
      console.warn(`[worker] refresh failed for ${id}: ${result.error}`);
    }
  }
  return failures;
}

// job_runs is append-per-tick and only ever queried for the latest row per
// type - anything older than 30 days is noise.
async function pruneOldJobRuns(now: Date): Promise<number> {
  const res = await prisma.jobRun.deleteMany({
    where: { startedAt: { lt: new Date(now.getTime() - JOB_RUN_RETENTION_MS) } },
  });
  return res.count;
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
