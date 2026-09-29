-- TaskCompletion.taskKey is validated against TaskCatalog(gameVersion, taskKey)
-- by the toggle route at write time; the FK is dropped so completion rows are
-- plain user overrides that survive catalog edits (deactivate/rekey).

ALTER TABLE "TaskCompletion" DROP CONSTRAINT "TaskCompletion_taskKey_fkey";

-- PostgreSQL does not dedupe NULLs in unique indexes: without this partial
-- index, multiple one_time completion rows (weekId IS NULL) could coexist.
-- Prisma cannot model it; re-asserted here in case a regenerated migration
-- ever drops it.
CREATE UNIQUE INDEX IF NOT EXISTS "TaskCompletion_characterId_taskKey_one_time_key" ON "TaskCompletion"("characterId", "taskKey") WHERE "weekId" IS NULL;
