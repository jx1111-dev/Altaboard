import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULES } from '@/lib/week';
import { resetSchedules } from '../prisma/seeds';

// Reset times are load-bearing constants kept in two places: the week engine
// and the seed data. This pure check replaces the DB-dependent
// scripts/check-schedules.ts.
describe('seeded reset schedules match the week engine', () => {
  it('covers exactly the engine regions', () => {
    expect(new Set(resetSchedules.map((s) => s.region))).toEqual(
      new Set(Object.keys(DEFAULT_SCHEDULES)),
    );
  });

  it('every seeded region matches DEFAULT_SCHEDULES exactly', () => {
    for (const s of resetSchedules) {
      const engine = DEFAULT_SCHEDULES[s.region];
      if (!engine) throw new Error(`region ${s.region} missing from DEFAULT_SCHEDULES`);
      expect(s.resetDow).toBe(engine.resetDow);
      expect(s.resetHourUtc).toBe(engine.resetHourUtc);
    }
  });

  it('KR/TW stand at Thursday 23:00 UTC', () => {
    expect(DEFAULT_SCHEDULES.kr).toMatchObject({ resetDow: 4, resetHourUtc: 23 });
    expect(DEFAULT_SCHEDULES.tw).toMatchObject({ resetDow: 4, resetHourUtc: 23 });
  });
});
