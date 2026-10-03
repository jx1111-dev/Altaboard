// Weekly reset, pure functions, no I/O. Vitest-tested (tests/week.test.ts)
// weekId = UTC calendar date (YYYY-MM-DD) of the most recent reset in each region.

export type ResetSchedule = {
  region: string;
  resetDow: number; // Reset day of week, 0 = sunday... 6 = saturday.
  resetHourUtc: number;
};

export type ScheduleMap = Record<string, ResetSchedule>;

export const DEFAULT_SCHEDULES: ScheduleMap = {
  us: { region: 'us', resetDow: 2, resetHourUtc: 15 }, // Tue 15:00 UTC
  eu: { region: 'eu', resetDow: 3, resetHourUtc: 7 }, // Wed 07:00 UTC
  kr: { region: 'kr', resetDow: 4, resetHourUtc: 23 }, // Thu 23:00 UTC
  tw: { region: 'tw', resetDow: 4, resetHourUtc: 23 }, // Thu 23:00 UTC
};

const WEEK_MS = 7 * 86_400_000;

// The most recent reset instant at or before `now`; its UTC calendar date is
// the region's weekId.
export function lastReset(now: Date, schedule: ResetSchedule): Date {
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
  // If the date is in the future, goes back a week.
  if (candidate.getTime() > now.getTime()) {
    return new Date(candidate.getTime() - WEEK_MS);
  }
  return candidate;
}

/**
 * weekId for a region at `now`: ISO date (YYYY-MM-DD) of the most recent reset.
 * e.g. EU on 2026-09-25 (Friday) -> '2026-09-23' (Wednesday 07:00 UTC reset).
 */
export function currentWeekId(
  region: string,
  now: Date = new Date(),
  schedules: ScheduleMap = DEFAULT_SCHEDULES,
): string {
  const schedule = schedules[region];
  if (!schedule) throw new Error(`No reset schedule for region "${region}"`);
  return formatWeekId(lastReset(now, schedule));
}

export function formatWeekId(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseWeekId(weekId: string): Date {
  const [y, m, d] = weekId.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
