// Worker: one container, one loop. Every 10 minutes it evaluates explicit
// triggers (no TTL conflation):
// - rollover sweep: a region's weekId changed since the last tick -> refresh
//   all characters in that region (previous week's snapshot stands as history)
// - daily sweep: characters whose lastFetchedAt is older than 24 h, minus
//   transient failures still inside their exponential backoff window
// plus it purges expired cache rows and logs each sweep to job_runs.
// Sweeps are rate-budgeted (shared token bucket); one bad character never
// crashes the worker.

import { pathToFileURL } from 'node:url';
import { prisma } from '@/server/prisma';
import { currentWeekId, DEFAULT_SCHEDULES } from '@/lib/week';
import { refreshCharacter, REGIONS } from '@/lib/board';
import { purgeExpiredCache } from '@/lib/blizzard/cache';

const TICK_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_STALENESS_MS = 24 * 60 * 60 * 1000;
const JOB_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
// Exported for tests (tests/worker.test.ts pins the rollover seam); the
// process itself only ever runs it from tick().
export async function rolloverSweep(now: Date): Promise<string[]> {
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
    } catch (err) {
      // Region not in the schedule - skip it, but say so: silence here would
      // read as a dead region on the board.
      console.warn(`[worker] rollover skipping region ${region}:`, err);
    }
  }

  // REGIONS is a Set (shared with the API routes); filter needs an array.
  const changed = [...REGIONS].filter(
    (r) => currentWeekIds[r] !== undefined && currentWeekIds[r] !== lastWeekIds[r],
  );

  const job = await prisma.jobRun.create({
    data: { type: 'rollover_sweep', status: 'running' },
  });

  const recordedWeekIds: Record<string, string> = { ...lastWeekIds };
  const failedIdsByRegion: Record<string, string[]> = {};
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
      const failedIds = await refreshByIds(idsByRegion.get(region) ?? [], now);
      if (failedIds.length === 0) {
        recordedWeekIds[region] = currentWeekIds[region];
      } else {
        status = 'partial';
        failedIdsByRegion[region] = failedIds;
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
        failedIdsByRegion,
      },
    },
  });

  return changed;
}

// Refresh characters whose lastFetchedAt is older than 24 h (or never
// fetched), minus transient failures still inside their backoff window
// (fetchFailures/nextAttemptAt, set by refreshCharacter) - a backed-off
// character waits even while stale.
async function dailySweep(now: Date): Promise<void> {
  const job = await prisma.jobRun.create({
    data: { type: 'daily_sweep', status: 'running' },
  });

  const cutoff = new Date(now.getTime() - DAILY_STALENESS_MS);
  const stale = await prisma.character.findMany({
    where: {
      archived: false,
      AND: [
        { OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: cutoff } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    select: { id: true },
  });

  const failedIds = await refreshByIds(
    stale.map((c) => c.id),
    now,
  );

  await prisma.jobRun.update({
    where: { id: job.id },
    data: {
      status: failedIds.length === 0 ? 'success' : 'partial',
      finishedAt: new Date(),
      detail: { candidates: stale.length, failures: failedIds.length, failedIds },
    },
  });
}

// job_runs detail carries the failing ids so a partial sweep is actionable
// from the record alone; the cap keeps a pathological all-failed sweep from
// turning the detail blob into a log dump.
const FAILED_IDS_DETAIL_CAP = 20;

async function refreshByIds(ids: string[], now: Date): Promise<string[]> {
  const failedIds: string[] = [];
  for (const id of ids) {
    const result = await refreshCharacter(id, { now });
    if (!result.ok) {
      if (failedIds.length < FAILED_IDS_DETAIL_CAP) failedIds.push(id);
      console.warn(`[worker] refresh failed for ${id}: ${result.error}`);
    }
  }
  return failedIds;
}

// job_runs is append-per-tick and only ever queried for the latest row per
// type - anything older than 30 days is noise.
async function pruneOldJobRuns(now: Date): Promise<number> {
  const res = await prisma.jobRun.deleteMany({
    where: { startedAt: { lt: new Date(now.getTime() - JOB_RUN_RETENTION_MS) } },
  });
  return res.count;
}

// Auto-run only when executed directly (`tsx worker/index.ts`): tests import
// the sweep functions, and an import that starts timers would never let the
// process exit.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}
