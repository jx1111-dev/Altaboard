// Worker — one container, one loop.
//
// Every 10 minutes it evaluates explicit triggers (no TTL conflation):
//   (a) rollover sweep — a region's weekKey changed since the last tick →
//       refresh all characters in that region (new week starts with fresh
//       fetches; previous week's snapshot stands as history)
//   (b) daily sweep — characters whose lastFetchedAt is older than 24 h
// plus it purges expired cache rows and logs each sweep to job_runs.
//
// Sweeps are rate-budgeted (the shared token bucket) and resumable: each
// character refresh is independent and one bad character never crashes the
// worker.

import { prisma } from '@/server/prisma';
import { weekKeyFor, DEFAULT_SCHEDULES } from '@/lib/week';
import { refreshCharacter } from '@/lib/board';
import { purgeExpiredCache } from '@/lib/blizzard/cache';

const TICK_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_STALENESS_MS = 24 * 60 * 60 * 1000;
const REGIONS = ['us', 'eu', 'kr', 'tw'];

async function main() {
  console.log('[worker] started — ticking every', TICK_INTERVAL_MS / 60000, 'min');
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
    if (rolledRegions.length > 0) {
      console.log('[worker] rollover detected for regions:', rolledRegions.join(', '));
    }
  } catch (err) {
    console.error('[worker] tick failed:', err);
  }
}

/**
 * Compare each region's current weekKey against the one recorded in the last
 * successful rollover sweep. Refresh all characters of changed regions.
 * Returns the list of regions that rolled over.
 */
async function rolloverSweep(now: Date): Promise<string[]> {
  const lastSweep = await prisma.jobRun.findFirst({
    where: { type: 'rollover_sweep', status: { in: ['success', 'partial'] } },
    orderBy: { startedAt: 'desc' },
  });

  const lastWeekKeys: Record<string, string> =
    (lastSweep?.detail as { weekKeys?: Record<string, string> } | null)?.weekKeys ?? {};

  const currentWeekKeys: Record<string, string> = {};
  for (const region of REGIONS) {
    try {
      currentWeekKeys[region] = weekKeyFor(region, now, DEFAULT_SCHEDULES);
    } catch {
      // region not in schedule — skip
    }
  }

  const changed = REGIONS.filter(
    (r) => currentWeekKeys[r] !== undefined && currentWeekKeys[r] !== lastWeekKeys[r],
  );

  const job = await prisma.jobRun.create({
    data: { type: 'rollover_sweep', status: 'running' },
  });

  let status = 'success';
  if (changed.length > 0) {
    const failures = await refreshByFilter(
      { region: { in: changed }, archived: false },
      now,
    );
    status = failures === 0 ? 'success' : 'partial';
  }

  await prisma.jobRun.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      detail: {
        weekKeys: currentWeekKeys,
        rolledRegions: changed,
      },
    },
  });

  return changed;
}

/**
 * Refresh characters whose lastFetchedAt is older than 24 h (or never fetched).
 */
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

async function refreshByFilter(
  where: { region?: { in: string[] }; archived: boolean },
  now: Date,
): Promise<number> {
  const chars = await prisma.character.findMany({ where, select: { id: true } });
  return refreshByIds(chars.map((c) => c.id), now);
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
