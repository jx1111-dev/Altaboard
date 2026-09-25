// Reset engine — pure functions, no I/O. Vitest-tested (tests/week.test.ts).
//
// weekKey = the UTC calendar date (YYYY-MM-DD) of the most recent weekly reset
// moment for a region. All weekly concepts (snapshots, task completions) key on
// this value, so a week "starts" the instant the reset passes.

export type ResetSchedule = {
  region: string;
  resetDow: number; // 0=Sunday .. 6=Saturday (UTC)
  resetHourUtc: number;
};

export type ScheduleMap = Record<string, ResetSchedule>;

export const DEFAULT_SCHEDULES: ScheduleMap = {
  us: { region: 'us', resetDow: 2, resetHourUtc: 15 }, // Tue 15:00 UTC
  eu: { region: 'eu', resetDow: 3, resetHourUtc: 7 }, // Wed 07:00 UTC
  kr: { region: 'kr', resetDow: 4, resetHourUtc: 7 }, // approximate
  tw: { region: 'tw', resetDow: 4, resetHourUtc: 7 }, // approximate
};

const WEEK_MS = 7 * 86_400_000;

/**
 * The most recent reset moment (UTC) at or before `now` for a region.
 */
export function lastResetBefore(now: Date, schedule: ResetSchedule): Date {
  // Today's date at the reset hour, then walk back to the reset day-of-week.
  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      schedule.resetHourUtc,
      0,
      0,
      0,
    ),
  );
  const backToResetDow = (candidate.getUTCDay() - schedule.resetDow + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() - backToResetDow);
  if (candidate.getTime() > now.getTime()) {
    return new Date(candidate.getTime() - WEEK_MS);
  }
  return candidate;
}

/**
 * The next reset moment (UTC) strictly after `now` for a region.
 */
export function nextResetAfter(now: Date, schedule: ResetSchedule): Date {
  const last = lastResetBefore(now, schedule);
  const next = new Date(last.getTime() + WEEK_MS);
  return next.getTime() > now.getTime() ? next : new Date(last.getTime() + 2 * WEEK_MS);
}

/**
 * weekKey for a region at `now`: ISO date (YYYY-MM-DD) of the most recent reset.
 * e.g. EU on 2026-09-25 (Friday) → '2026-09-23' (Wednesday 07:00 UTC reset).
 */
export function weekKeyFor(
  region: string,
  now: Date = new Date(),
  schedules: ScheduleMap = DEFAULT_SCHEDULES,
): string {
  const schedule = schedules[region];
  if (!schedule) throw new Error(`No reset schedule for region "${region}"`);
  return toWeekKey(lastResetBefore(now, schedule));
}

export function toWeekKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromWeekKey(weekKey: string): Date {
  const [y, m, d] = weekKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * True if `weekKeyA` and `weekKeyB` are consecutive reset weeks.
 */
export function isNextWeek(weekKeyA: string, weekKeyB: string): boolean {
  return fromWeekKey(weekKeyB).getTime() - fromWeekKey(weekKeyA).getTime() === WEEK_MS;
}

/**
 * The weekKey a given timestamp belongs to for a region. Used to check that an
 * M+ activity period aligns with the character's reset week.
 */
export function weekKeyForTimestamp(
  at: Date,
  region: string,
  schedules: ScheduleMap = DEFAULT_SCHEDULES,
): string {
  return weekKeyFor(region, at, schedules);
}
