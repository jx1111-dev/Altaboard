-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "GameVersion" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "namespacePrefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GameVersion_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ResetSchedule" (
    "region" TEXT NOT NULL,
    "resetDow" INTEGER NOT NULL,
    "resetHourUtc" INTEGER NOT NULL,

    CONSTRAINT "ResetSchedule_pkey" PRIMARY KEY ("region")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "realmSlug" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "characterClass" TEXT,
    "spec" TEXT,
    "level" INTEGER,
    "guildName" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "groupName" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchedAt" TIMESTAMP(3),
    "lastFetchError" TEXT,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSnapshot" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "ilvl" DOUBLE PRECISION,
    "mplusRating" INTEGER,
    "achievementPoints" INTEGER,

    CONSTRAINT "CharacterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCatalog" (
    "id" TEXT NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCompletion" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "weekKey" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "detail" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Character_archived_priority_idx" ON "Character"("archived", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Character_gameVersion_region_realmSlug_nameLower_key" ON "Character"("gameVersion", "region", "realmSlug", "nameLower");

-- CreateIndex
CREATE INDEX "CharacterSnapshot_characterId_capturedAt_idx" ON "CharacterSnapshot"("characterId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSnapshot_characterId_weekKey_key" ON "CharacterSnapshot"("characterId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCatalog_gameVersion_taskKey_key" ON "TaskCatalog"("gameVersion", "taskKey");

-- CreateIndex
CREATE INDEX "TaskCompletion_characterId_weekKey_idx" ON "TaskCompletion"("characterId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_characterId_taskKey_weekKey_key" ON "TaskCompletion"("characterId", "taskKey", "weekKey");

-- CreateIndex
CREATE INDEX "ApiCache_expiresAt_idx" ON "ApiCache"("expiresAt");

-- AddForeignKey
ALTER TABLE "CharacterSnapshot" ADD CONSTRAINT "CharacterSnapshot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_taskKey_fkey" FOREIGN KEY ("taskKey") REFERENCES "TaskCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- PostgreSQL does not dedupe NULLs in unique indexes: without this partial
-- index, multiple one_time completion rows (weekKey IS NULL) could coexist.
CREATE UNIQUE INDEX "TaskCompletion_characterId_taskKey_one_time_key" ON "TaskCompletion"("characterId", "taskKey") WHERE "weekKey" IS NULL;
