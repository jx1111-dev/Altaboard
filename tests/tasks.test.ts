import { describe, expect, it } from 'vitest';
import {
  deriveTasks,
  mergeTasks,
  type CatalogTask,
  type SnapshotLike,
} from '@/lib/tasks';

const WEEK = '2026-09-23';
const NOW = new Date('2026-09-25T12:00:00Z'); // inside the EU week 2026-09-23

function makePeriod(opts: {
  runs?: { completed: boolean; dungeon?: { slug: string } }[];
  startTimestamp?: number;
  endTimestamp?: number;
}) {
  return {
    mythicKeystoneProfile: {
      current_period: {
        period: 1310,
        ...(opts.startTimestamp !== undefined
          ? { period_start_timestamp: opts.startTimestamp }
          : {}),
        ...(opts.endTimestamp !== undefined ? { period_end_timestamp: opts.endTimestamp } : {}),
        runs: opts.runs,
      },
    },
  };
}

const catalog: CatalogTask[] = [
  { taskKey: 'vault_mplus_1', label: 'M+ 1', category: 'mplus', scope: 'weekly', source: 'auto:mplus_runs_1', sortOrder: 10 },
  { taskKey: 'vault_mplus_4', label: 'M+ 4', category: 'mplus', scope: 'weekly', source: 'auto:mplus_runs_4', sortOrder: 11 },
  { taskKey: 'vault_mplus_8', label: 'M+ 8', category: 'mplus', scope: 'weekly', source: 'auto:mplus_runs_8', sortOrder: 12 },
  { taskKey: 'vault_raid', label: 'Raid vault', category: 'raid', scope: 'weekly', source: 'auto:raid_vault', sortOrder: 20 },
  { taskKey: 'weekly_event', label: 'Weekly event', category: 'other', scope: 'weekly', source: 'manual', sortOrder: 40 },
];

function run(snapshot: SnapshotLike, region = 'eu') {
  return deriveTasks(snapshot, catalog, WEEK, region, NOW);
}

function byKey(tasks: ReturnType<typeof run>) {
  return Object.fromEntries(tasks.map((t) => [t.taskKey, t.state]));
}

describe('deriveTasks - no snapshot / mismatched week', () => {
  it('returns unknown for everything when there is no snapshot', () => {
    const states = byKey(run(null));
    expect(states).toEqual({
      vault_mplus_1: 'unknown',
      vault_mplus_4: 'unknown',
      vault_mplus_8: 'unknown',
      vault_raid: 'unknown',
      weekly_event: 'unknown',
    });
  });

  it('returns unknown when the snapshot belongs to a previous week', () => {
    const snapshot = { weekId: '2026-09-16', payload: makePeriod({ runs: [] }) };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });
});

describe('deriveTasks - M+ vault thresholds', () => {
  const START = Date.parse('2026-09-23T07:00:00Z');
  const END = Date.parse('2026-09-30T07:00:00Z');

  function snapshotWithRuns(count: number): SnapshotLike {
    const runs = Array.from({ length: count }, (_, i) => ({
      completed: true,
      dungeon: { slug: `dungeon-${i}` },
    }));
    return { weekId: WEEK, payload: makePeriod({ runs, startTimestamp: START, endTimestamp: END }) };
  }

  it('0 completed dungeons → all not_done (a real 0, not unknown)', () => {
    const states = byKey(run(snapshotWithRuns(0)));
    expect(states.vault_mplus_1).toBe('not_done');
    expect(states.vault_mplus_4).toBe('not_done');
    expect(states.vault_mplus_8).toBe('not_done');
  });

  it('1 dungeon unlocks slot 1 only', () => {
    const states = byKey(run(snapshotWithRuns(1)));
    expect(states.vault_mplus_1).toBe('done');
    expect(states.vault_mplus_4).toBe('not_done');
    expect(states.vault_mplus_8).toBe('not_done');
  });

  it('4 dungeons unlock slot 2', () => {
    const states = byKey(run(snapshotWithRuns(4)));
    expect(states.vault_mplus_1).toBe('done');
    expect(states.vault_mplus_4).toBe('done');
    expect(states.vault_mplus_8).toBe('not_done');
  });

  it('8 dungeons unlock all three slots', () => {
    const states = byKey(run(snapshotWithRuns(8)));
    expect(states.vault_mplus_1).toBe('done');
    expect(states.vault_mplus_4).toBe('done');
    expect(states.vault_mplus_8).toBe('done');
  });

  it('counts distinct dungeons, not repeated runs of the same one', () => {
    const runs = Array.from({ length: 6 }, () => ({
      completed: true,
      dungeon: { slug: 'same-dungeon' },
    }));
    const snapshot = { weekId: WEEK, payload: makePeriod({ runs, startTimestamp: START, endTimestamp: END }) };
    expect(byKey(run(snapshot)).vault_mplus_4).toBe('not_done');
  });

  it('ignores incomplete runs', () => {
    const runs = [
      { completed: true, dungeon: { slug: 'a' } },
      { completed: false, dungeon: { slug: 'b' } },
      { completed: true, dungeon: { slug: 'c' } },
    ];
    const snapshot = { weekId: WEEK, payload: makePeriod({ runs, startTimestamp: START, endTimestamp: END }) };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('done');
    expect(byKey(run(snapshot)).vault_mplus_4).toBe('not_done');
  });
});

describe('deriveTasks - period alignment and missing data', () => {
  it('missing current_period → unknown', () => {
    const snapshot = { weekId: WEEK, payload: { mythicKeystoneProfile: {} } };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });

  it('missing keystone profile entirely → unknown', () => {
    const snapshot = { weekId: WEEK, payload: {} };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });

  it('period not covering the current week → unknown, never a wrong ✓', () => {
    // Period ended before the snapshot week began.
    const payload = makePeriod({
      runs: [{ completed: true, dungeon: { slug: 'a' } }],
      startTimestamp: Date.parse('2026-09-09T07:00:00Z'),
      endTimestamp: Date.parse('2026-09-16T07:00:00Z'),
    });
    const snapshot = { weekId: WEEK, payload };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });

  it('period covering the current week → derivable', () => {
    const payload = makePeriod({
      runs: [{ completed: true, dungeon: { slug: 'a' } }],
      startTimestamp: Date.parse('2026-09-23T07:00:00Z'),
      endTimestamp: Date.parse('2026-09-30T07:00:00Z'),
    });
    const snapshot = { weekId: WEEK, payload };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('done');
  });

  it('period in the future → unknown', () => {
    const payload = makePeriod({
      runs: [{ completed: true, dungeon: { slug: 'a' } }],
      startTimestamp: Date.parse('2026-09-30T07:00:00Z'),
      endTimestamp: Date.parse('2026-10-07T07:00:00Z'),
    });
    const snapshot = { weekId: WEEK, payload };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });
});

describe('deriveTasks - manual and inconclusive tasks', () => {
  it('manual tasks are always unknown (unchecked box until toggled)', () => {
    expect(byKey(run(null)).weekly_event).toBe('unknown');
  });

  it('raid vault stays unknown until a verified derivation exists', () => {
    const snapshot = {
      weekId: WEEK,
      payload: makePeriod({
        runs: [{ completed: true, dungeon: { slug: 'a' } }],
        startTimestamp: Date.parse('2026-09-23T07:00:00Z'),
        endTimestamp: Date.parse('2026-09-30T07:00:00Z'),
      }),
    };
    expect(byKey(run(snapshot)).vault_raid).toBe('unknown');
  });

  it('a malformed payload degrades to unknown instead of throwing', () => {
    const snapshot = { weekId: WEEK, payload: { mythicKeystoneProfile: 'garbage' } };
    expect(byKey(run(snapshot)).vault_mplus_1).toBe('unknown');
  });
});

describe('mergeTasks - precedence manual > derived > unknown', () => {
  const derived = [
    { taskKey: 'a', label: 'a', category: 'mplus', scope: 'weekly', source: 'auto:mplus_runs_1', sortOrder: 1, state: 'not_done' as const },
    { taskKey: 'b', label: 'b', category: 'other', scope: 'weekly', source: 'manual', sortOrder: 2, state: 'unknown' as const },
    { taskKey: 'c', label: 'c', category: 'mplus', scope: 'weekly', source: 'auto:mplus_runs_4', sortOrder: 3, state: 'done' as const },
  ];

  it('a manual done row overrides derived not_done', () => {
    const merged = mergeTasks(derived, [{ taskKey: 'a', done: true }]);
    expect(merged.find((t) => t.taskKey === 'a')).toMatchObject({ state: 'done', manuallySet: true });
  });

  it('a manual not-done row overrides derived done', () => {
    const merged = mergeTasks(derived, [{ taskKey: 'c', done: false }]);
    expect(merged.find((t) => t.taskKey === 'c')).toMatchObject({ state: 'not_done', manuallySet: true });
  });

  it('a manual row resolves an unknown state', () => {
    const merged = mergeTasks(derived, [{ taskKey: 'b', done: true }]);
    expect(merged.find((t) => t.taskKey === 'b')).toMatchObject({ state: 'done', manuallySet: true });
  });

  it('no manual row leaves derived state untouched', () => {
    const merged = mergeTasks(derived, []);
    expect(merged.every((t) => !t.manuallySet)).toBe(true);
    expect(merged.find((t) => t.taskKey === 'a')!.state).toBe('not_done');
  });
});
