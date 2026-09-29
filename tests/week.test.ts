import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULES,
  currentWeekId,
  formatWeekId,
  lastReset,
  parseWeekId,
} from '@/lib/week';

const EU = DEFAULT_SCHEDULES.eu;
const US = DEFAULT_SCHEDULES.us;

function utc(iso: string): Date {
  return new Date(iso);
}

describe('lastReset - EU (Wed 07:00 UTC)', () => {
  it('returns the current week reset when now is after it', () => {
    // Friday 2026-09-25 12:00 UTC → reset was Wed 2026-09-23 07:00 UTC
    const now = utc('2026-09-25T12:00:00Z');
    expect(lastReset(now, EU).toISOString()).toBe('2026-09-23T07:00:00.000Z');
  });

  it('returns the previous week reset when now is before this week reset', () => {
    // Wednesday 2026-09-23 05:00 UTC (2h before reset)
    const now = utc('2026-09-23T05:00:00Z');
    expect(lastReset(now, EU).toISOString()).toBe('2026-09-16T07:00:00.000Z');
  });

  it('handles the reset instant exactly', () => {
    const now = utc('2026-09-23T07:00:00Z');
    expect(lastReset(now, EU).toISOString()).toBe('2026-09-23T07:00:00.000Z');
  });

  it('handles a reset-adjacent minute', () => {
    const now = utc('2026-09-23T06:59:00Z');
    expect(lastReset(now, EU).toISOString()).toBe('2026-09-16T07:00:00.000Z');
  });
});

describe('lastReset - US (Tue 15:00 UTC)', () => {
  it('returns Tuesday 15:00 UTC for a midweek timestamp', () => {
    // Thursday 2026-09-24 20:00 UTC → reset was Tue 2026-09-22 15:00 UTC
    const now = utc('2026-09-24T20:00:00Z');
    expect(lastReset(now, US).toISOString()).toBe('2026-09-22T15:00:00.000Z');
  });

  it('differs from EU weekId in the Tue-15:00→Wed-07:00 window', () => {
    // Tuesday 2026-09-22 18:00 UTC: US already reset (Sep 22), EU not yet (Sep 16)
    const now = utc('2026-09-22T18:00:00Z');
    expect(currentWeekId('us', now)).toBe('2026-09-22');
    expect(currentWeekId('eu', now)).toBe('2026-09-16');
  });
});

describe('currentWeekId', () => {
  it('formats as YYYY-MM-DD of the most recent reset', () => {
    expect(currentWeekId('eu', utc('2026-09-25T12:00:00Z'))).toBe('2026-09-23');
    expect(currentWeekId('us', utc('2026-09-25T12:00:00Z'))).toBe('2026-09-22');
  });

  it('throws for an unknown region', () => {
    expect(() => currentWeekId('xx', new Date())).toThrow(/No reset schedule/);
  });
});

describe('weekId helpers', () => {
  it('round-trips formatWeekId/parseWeekId', () => {
    const d = parseWeekId('2026-09-23');
    expect(formatWeekId(d)).toBe('2026-09-23');
    expect(d.toISOString()).toBe('2026-09-23T00:00:00.000Z');
  });
});
