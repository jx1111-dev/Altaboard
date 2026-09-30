// Task engine, pure derivation, no I/O. Vitest-tested (tests/tasks.test.ts).
// 'unknown' is first-class: ambiguous or missing API data must surface as
// unknown, never as a wrong yes/no. Only user toggles write task_completions
// (as overrides on any task); merge precedence (manual row > derived >
// unknown) lives in lib/board.
import { formatWeekId } from '@/lib/week';

export type TaskState = 'done' | 'not_done' | 'unknown';

export type CatalogTask = {
  taskKey: string;
  label: string;
  category: string;
  scope: string; // 'weekly' | 'one_time'
  source: string; // 'auto:<derivationKey>' | 'manual'
  sortOrder: number;
};

export type SnapshotLike = {
  weekId: string;
  payload: unknown;
} | null;

export type DerivedTask = CatalogTask & { state: TaskState };

type MplusRun = {
  completed?: boolean;
  dungeon?: { name?: string; slug?: string };
  keystone_level?: number;
};

type MplusPeriod = {
  period?: number;
  period_start_timestamp?: number; // ms epoch
  period_end_timestamp?: number; // ms epoch
  runs?: MplusRun[];
};

type SnapshotPayload = {
  mythicKeystoneProfile?: { current_period?: MplusPeriod } | null;
  achievements?: { achievements?: { id?: number; timestamp?: number }[] } | null;
  statistics?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type DerivationCtx = {
  weekId: string;
  region: string;
  now: Date;
};

type DerivationFn = (payload: SnapshotPayload, ctx: DerivationCtx) => TaskState;

const derivations: Record<string, DerivationFn> = {
  // Great Vault M+ slots: count distinct dungeons with a completed (timed) run
  // in the keystone profile's current period, aligned to the region reset week.
  mplus_runs_1: mplusVault(1),
  mplus_runs_4: mplusVault(4),
  mplus_runs_8: mplusVault(8),

  // Achievement/statistics timestamps cannot conclusively separate this reset
  // week from earlier activity, so these stay unknown until a verified field
  // exists.
  raid_vault: () => 'unknown',
  world_vault: () => 'unknown',
};

function mplusVault(threshold: number): DerivationFn {
  return (payload, ctx) => {
    const currentPeriod = payload.mythicKeystoneProfile?.current_period;
    if (!currentPeriod) return 'unknown';

    // The current period must cover the character's reset week, otherwise the
    // data belongs to another week -> unknown.
    if (
      typeof currentPeriod.period_start_timestamp === 'number' &&
      typeof currentPeriod.period_end_timestamp === 'number'
    ) {
      const start = new Date(currentPeriod.period_start_timestamp);
      const end = new Date(currentPeriod.period_end_timestamp);
      const coversWeek =
        start.getTime() <= ctx.now.getTime() &&
        ctx.now.getTime() < end.getTime() &&
        ctx.weekId >= formatWeekId(start) &&
        ctx.weekId <= formatWeekId(new Date(end.getTime() - 1));
      if (!coversWeek) return 'unknown';
    }

    const runs = currentPeriod.runs;
    if (!runs) return 'unknown';

    // best_runs is known to come back empty from the API even with completed
    // runs, so we count `runs` and treat an empty list as a real 0 (not_done).
    const completedDungeons = new Set<string>();
    for (const run of runs) {
      if (!run.completed) continue;
      const identity = run.dungeon?.slug ?? run.dungeon?.name;
      // A completed run without dungeon identity cannot be deduped; counting
      // it anyway could inflate the slot count -> unknown, never a wrong ✓.
      if (!identity) return 'unknown';
      completedDungeons.add(identity);
    }

    return completedDungeons.size >= threshold ? 'done' : 'not_done';
  };
}

export function deriveTasks(
  snapshot: SnapshotLike,
  catalog: CatalogTask[],
  weekId: string,
  region: string,
  now: Date = new Date(),
): DerivedTask[] {
  const ctx: DerivationCtx = { weekId, region, now };
  const payload = (snapshot?.payload ?? {}) as SnapshotPayload;
  const snapshotWeek = snapshot?.weekId ?? null;

  return catalog.map((task) => {
    const unknownTask: DerivedTask = { ...task, state: 'unknown' };

    if (task.source === 'manual') {
      // Manual tasks carry no derived signal.
      return unknownTask;
    }

    if (!snapshot || snapshotWeek !== weekId) {
      return unknownTask;
    }

    const derivationKey = task.source.startsWith('auto:') ? task.source.slice(5) : null;
    if (!derivationKey) return unknownTask;

    const derive = derivations[derivationKey];
    if (!derive) return unknownTask;

    try {
      return { ...unknownTask, state: derive(payload, ctx) };
    } catch {
      // A malformed payload must never crash the board, degrade to unknown.
      return unknownTask;
    }
  });
}

export type ManualCompletionRow = {
  taskKey: string;
  done: boolean;
};

// manual row > derived state > unknown
export function mergeTasks(
  derived: DerivedTask[],
  manualRows: ManualCompletionRow[],
): (DerivedTask & { manuallySet: boolean })[] {
  const manual = new Map(manualRows.map((r) => [r.taskKey, r]));
  return derived.map((task) => {
    const row = manual.get(task.taskKey);
    if (!row) return { ...task, manuallySet: false };
    return {
      ...task,
      state: row.done ? 'done' : 'not_done',
      manuallySet: true,
    };
  });
}
