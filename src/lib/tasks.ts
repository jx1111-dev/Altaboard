// Task engine — pure derivation, no I/O. Vitest-tested (tests/tasks.test.ts).
//
// Semantics:
// - deriveTasks reads a character's snapshot + the task catalog and produces the
//   derived state for every catalog task: 'done' | 'not_done' | 'unknown'.
// - 'unknown' is first-class: ambiguous or missing API data must surface as
//   "unknown — confirm manually", never as a wrong ✓/✗.
// - Only user toggles write task_completions. Merge precedence (manual row >
//   derived > unknown) is applied in lib/board, not here.
// - Auto tasks are never persisted from derivation.

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
  weekKey: string;
  payload: unknown;
} | null;

export type DerivedTask = CatalogTask & { state: TaskState };

// ---------------------------------------------------------------- payload types

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

// Great Vault M+ thresholds (retail): slots unlock at 1, 4 and 8 completed
// dungeons per week.
export const MPLUS_VAULT_THRESHOLDS = [1, 4, 8] as const;

// ---------------------------------------------------------------- derivation

type DerivationCtx = {
  weekKey: string;
  region: string;
  now: Date;
};

type DerivationFn = (payload: SnapshotPayload, ctx: DerivationCtx) => TaskState;

const derivations: Record<string, DerivationFn> = {
  // Great Vault M+ slots — count distinct dungeons with a completed (timed) run
  // in the keystone profile's current period, aligned to the character's region
  // reset week.
  mplus_runs_1: mplusVault(1),
  mplus_runs_4: mplusVault(4),
  mplus_runs_8: mplusVault(8),

  // Raid vault row: raid bosses defeated this week. Achievement/statistics
  // timestamps cannot conclusively separate "this reset week" from earlier
  // activity, so unless a verified field lands here the state stays unknown.
  raid_vault: () => 'unknown',

  // World content vault row: world quests / events this week — same situation
  // as raid_vault.
  world_vault: () => 'unknown',
};

function mplusVault(threshold: number): DerivationFn {
  return (payload, ctx) => {
    const currentPeriod = payload.mythicKeystoneProfile?.current_period;
    if (!currentPeriod) return 'unknown';

    // Period alignment: the current period must cover the character's reset
    // week, otherwise the data belongs to another week → unknown, never a
    // wrong ✓/✗.
    if (
      typeof currentPeriod.period_start_timestamp === 'number' &&
      typeof currentPeriod.period_end_timestamp === 'number'
    ) {
      const start = new Date(currentPeriod.period_start_timestamp);
      const end = new Date(currentPeriod.period_end_timestamp);
      const coversWeek =
        start.getTime() <= ctx.now.getTime() &&
        ctx.now.getTime() < end.getTime() &&
        ctx.weekKey >= periodToWeekKey(start) &&
        ctx.weekKey <= periodToWeekKey(new Date(end.getTime() - 1));
      if (!coversWeek) return 'unknown';
    }

    const runs = currentPeriod.runs;
    if (!runs) return 'unknown';

    // best_runs is known to come back empty from the API even with completed
    // runs — we deliberately count `runs` and treat an empty runs list as a
    // real "no dungeons this week" (not_done), never as "0 keys" from best_runs.
    const completedDungeons = new Set<string>();
    for (const run of runs) {
      if (run.completed) {
        const key = run.dungeon?.slug ?? run.dungeon?.name ?? `run-${completedDungeons.size}`;
        completedDungeons.add(key);
      }
    }

    return completedDungeons.size >= threshold ? 'done' : 'not_done';
  };
}

function periodToWeekKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------- public API

/**
 * Derive task state for every active catalog task against a snapshot.
 *
 * @param snapshot  null when the character has no snapshot yet — all auto tasks
 *                  come back 'unknown', manual tasks as 'unknown'.
 * @param catalog   active catalog tasks for the game version, in sort order.
 * @param weekKey   the current reset week for the character's region.
 * @param region    the character's region (drives period alignment).
 * @param now       injectable clock for tests.
 */
export function deriveTasks(
  snapshot: SnapshotLike,
  catalog: CatalogTask[],
  weekKey: string,
  region: string,
  now: Date = new Date(),
): DerivedTask[] {
  const ctx: DerivationCtx = { weekKey, region, now };
  const payload = (snapshot?.payload ?? {}) as SnapshotPayload;
  const snapshotWeek = snapshot?.weekKey ?? null;

  return catalog.map((task) => {
    const base: DerivedTask = { ...task, state: 'unknown' };

    if (task.source === 'manual') {
      // Manual tasks carry no derived signal — they render as an unchecked box
      // until the user toggles them.
      return base;
    }

    if (!snapshot || snapshotWeek !== weekKey) {
      // No snapshot for the current week: nothing to derive from yet.
      return base;
    }

    const derivationKey = task.source.startsWith('auto:') ? task.source.slice(5) : null;
    if (!derivationKey) return base;

    const derive = derivations[derivationKey];
    if (!derive) return base;

    try {
      return { ...base, state: derive(payload, ctx) };
    } catch {
      // A malformed payload must never crash the board — degrade to unknown.
      return base;
    }
  });
}

export type ManualCompletionRow = {
  taskKey: string;
  done: boolean;
};

/**
 * Merge manual completion rows over derived state:
 * manual row > derived state > unknown.
 */
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
