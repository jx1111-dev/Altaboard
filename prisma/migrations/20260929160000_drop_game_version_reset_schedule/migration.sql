-- GameVersion and ResetSchedule were write-only: nothing ever read them.
-- Code uses the GAME_VERSIONS constant (lib/board) and DEFAULT_SCHEDULES
-- (lib/week); the schedules are pinned against the engine by
-- tests/schedules.test.ts.

DROP TABLE "GameVersion";
DROP TABLE "ResetSchedule";
