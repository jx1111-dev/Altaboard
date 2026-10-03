// Pins the rollover sweep seam (worker/index.ts rolloverSweep): a region
// whose weekId moved on since the last sweep has all its characters
// refreshed, and its new weekId is only recorded in the job_runs detail when
// every refresh of that region succeeded (failed regions keep the old weekId
// and are picked up again next tick, with the failed ids in
// detail.failedIdsByRegion). Regions without a reset schedule are skipped
// with a console warning naming them, never silently.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The worker lives at the repo root, outside src/, so the '@/...' alias
// (which maps to src/) cannot reach it - import relatively.
import { rolloverSweep } from '../worker/index';
import { currentWeekId, DEFAULT_SCHEDULES } from '@/lib/week';

const prismaMock = vi.hoisted(() => ({
  jobRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  character: { findMany: vi.fn() },
}));

// prisma is the mock; the violation helpers stay real (unused by the sweep).
vi.mock('@/server/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/prisma')>();
  return { ...actual, prisma: prismaMock };
});

const refreshCharacterMock = vi.hoisted(() => vi.fn());

// The worker also imports REGIONS from here; keep the same four regions.
vi.mock('@/lib/board', () => ({
  refreshCharacter: refreshCharacterMock,
  REGIONS: ['us', 'eu', 'kr', 'tw'],
}));

// Partial week mock: currentWeekId throws for the region named by
// weekFail.region (a missing reset schedule), delegating to the real one
// otherwise - so weekIds below are the genuine scheduled values.
const weekFail = vi.hoisted(() => ({ region: null as string | null }));

vi.mock('@/lib/week', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/week')>();
  return {
    ...actual,
    currentWeekId: (region: string, now?: Date, schedules?: typeof actual.DEFAULT_SCHEDULES) => {
      if (weekFail.region === region) {
        throw new Error(`No reset schedule for region "${region}"`);
      }
      return actual.currentWeekId(region, now, schedules ?? actual.DEFAULT_SCHEDULES);
    },
  };
});

// Fixed instant: Friday 2026-09-25 12:00 UTC.
const NOW = new Date('2026-09-25T12:00:00.000Z');

function weekId(region: string): string {
  return currentWeekId(region, NOW, DEFAULT_SCHEDULES);
}

beforeEach(() => {
  vi.clearAllMocks();
  weekFail.region = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // No last sweep on record -> every region counts as changed.
  prismaMock.jobRun.findFirst.mockResolvedValue(null);
  prismaMock.jobRun.create.mockResolvedValue({ id: 'job1' });
  prismaMock.jobRun.update.mockResolvedValue({});
  refreshCharacterMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rolloverSweep', () => {
  it('refreshes every region with no last sweep, records all weekIds, status success', async () => {
    prismaMock.character.findMany.mockResolvedValue([
      { id: 'us1', region: 'us' },
      { id: 'eu1', region: 'eu' },
      { id: 'kr1', region: 'kr' },
      { id: 'tw1', region: 'tw' },
    ]);

    const changed = await rolloverSweep(NOW);

    expect(changed).toEqual(['us', 'eu', 'kr', 'tw']);
    expect(prismaMock.jobRun.findFirst).toHaveBeenCalledWith({
      where: { type: 'rollover_sweep', status: { in: ['success', 'partial'] } },
      orderBy: { startedAt: 'desc' },
    });
    expect(prismaMock.character.findMany).toHaveBeenCalledWith({
      where: { region: { in: ['us', 'eu', 'kr', 'tw'] }, archived: false },
      select: { id: true, region: true },
    });
    expect(refreshCharacterMock).toHaveBeenCalledTimes(4);
    expect(refreshCharacterMock).toHaveBeenCalledWith('us1', { now: NOW });
    expect(prismaMock.jobRun.create).toHaveBeenCalledWith({
      data: { type: 'rollover_sweep', status: 'running' },
    });
    expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: {
        status: 'success',
        finishedAt: expect.any(Date),
        detail: {
          weekIds: {
            us: weekId('us'),
            eu: weekId('eu'),
            kr: weekId('kr'),
            tw: weekId('tw'),
          },
          rolledRegions: ['us', 'eu', 'kr', 'tw'],
          failedIdsByRegion: {},
        },
      },
    });
  });

  it('a failed refresh keeps the region weekId unrecorded and marks the run partial', async () => {
    prismaMock.character.findMany.mockResolvedValue([
      { id: 'eu-ok', region: 'eu' },
      { id: 'eu-bad', region: 'eu' },
      { id: 'us1', region: 'us' },
    ]);
    refreshCharacterMock.mockImplementation(async (id: string) =>
      id === 'eu-bad' ? { ok: false, error: 'boom' } : { ok: true },
    );

    await rolloverSweep(NOW);

    const data = prismaMock.jobRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('partial');
    // eu is missing: its old weekId must stand so the next tick retries it.
    expect(data.detail.weekIds).toEqual({
      us: weekId('us'),
      kr: weekId('kr'),
      tw: weekId('tw'),
    });
    expect(data.detail.weekIds).not.toHaveProperty('eu');
    expect(data.detail.failedIdsByRegion).toEqual({ eu: ['eu-bad'] });
    expect(data.detail.rolledRegions).toEqual(['us', 'eu', 'kr', 'tw']);
    expect(refreshCharacterMock).toHaveBeenCalledWith('eu-bad', { now: NOW });
  });

  it('skips a region without a reset schedule, warning that names it', async () => {
    weekFail.region = 'kr';
    prismaMock.character.findMany.mockResolvedValue([{ id: 'us1', region: 'us' }]);

    const changed = await rolloverSweep(NOW);

    expect(changed).toEqual(['us', 'eu', 'tw']);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('kr'),
      expect.any(Error),
    );
    const data = prismaMock.jobRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('success');
    expect(data.detail.weekIds).toEqual({
      us: weekId('us'),
      eu: weekId('eu'),
      tw: weekId('tw'),
    });
    expect(data.detail.weekIds).not.toHaveProperty('kr');
    expect(data.detail.rolledRegions).toEqual(['us', 'eu', 'tw']);
  });
});
