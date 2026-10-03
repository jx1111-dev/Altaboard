// Docker healthcheck for the worker container: exits 0 only when a sweep has
// actually started recently, so a worker that boots but never sweeps reports
// unhealthy instead of lapping forever as a green container.
//
//   npx tsx scripts/worker-health.ts

import { prisma } from '@/server/prisma';

// The worker ticks every 10 minutes and logs both sweeps to job_runs each
// tick, so any run in the last 30 minutes proves the loop is alive; a wider
// window would pass a wedged worker, a narrower one would flap between ticks.
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const SWEEP_TYPES = ['daily_sweep', 'rollover_sweep'];

async function main(): Promise<number> {
  try {
    const sweep = await prisma.jobRun.findFirst({
      where: {
        type: { in: SWEEP_TYPES },
        startedAt: { gte: new Date(Date.now() - RECENT_WINDOW_MS) },
      },
      orderBy: { startedAt: 'desc' },
      select: { type: true, startedAt: true },
    });
    if (!sweep) {
      console.error('unhealthy: no daily_sweep/rollover_sweep started in the last 30 minutes');
      return 1;
    }
    console.log(`healthy: ${sweep.type} started ${sweep.startedAt.toISOString()}`);
    return 0;
  } catch (err) {
    console.error('[worker-health] failed:', err instanceof Error ? err.message : err);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
