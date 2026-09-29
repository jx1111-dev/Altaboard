-- Rename weekKey columns to weekId; data is preserved.

ALTER TABLE "CharacterSnapshot" RENAME COLUMN "weekKey" TO "weekId";
ALTER TABLE "TaskCompletion" RENAME COLUMN "weekKey" TO "weekId";

ALTER INDEX "CharacterSnapshot_characterId_weekKey_key" RENAME TO "CharacterSnapshot_characterId_weekId_key";
ALTER INDEX "TaskCompletion_characterId_taskKey_weekKey_key" RENAME TO "TaskCompletion_characterId_taskKey_weekId_key";
ALTER INDEX "TaskCompletion_characterId_weekKey_idx" RENAME TO "TaskCompletion_characterId_weekId_idx";
