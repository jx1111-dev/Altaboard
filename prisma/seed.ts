import { PrismaClient } from '@prisma/client';
import { taskCatalog, demoClassicCharacters } from './seeds';
import { mockAdapter } from '@/lib/adapters/mock';
import { currentWeekId } from '@/lib/week';
import type { GameVersion, Region } from '@/lib/blizzard/client';

const prisma = new PrismaClient();

async function main() {
  for (const task of taskCatalog) {
    await prisma.taskCatalog.upsert({
      where: { gameVersion_taskKey: { gameVersion: task.gameVersion, taskKey: task.taskKey } },
      update: {
        label: task.label,
        category: task.category,
        scope: task.scope,
        source: task.source,
        sortOrder: task.sortOrder,
        active: task.active,
      },
      create: task,
    });
  }

  // Mock mode only: demo Classic characters with real-looking snapshots, via
  // the same fetch path a manual add would take.
  let demoCharacters = 0;
  if (process.env.MOCK_BLIZZARD === '1') {
    for (const demo of demoClassicCharacters) {
      const nameLower = demo.name.toLowerCase();
      const character = await prisma.character.upsert({
        where: {
          gameVersion_region_realmSlug_nameLower: {
            gameVersion: demo.gameVersion,
            region: demo.region,
            realmSlug: demo.realmSlug,
            nameLower,
          },
        },
        update: {},
        create: {
          gameVersion: demo.gameVersion,
          region: demo.region,
          realmSlug: demo.realmSlug,
          nameLower,
          name: demo.name,
          groupName: demo.groupName,
          priority: demo.priority,
        },
      });

      const data = await mockAdapter.fetchCharacter({
        gameVersion: demo.gameVersion as GameVersion,
        region: demo.region as Region,
        realmSlug: demo.realmSlug,
        nameLower,
      });
      const now = new Date();
      const weekId = currentWeekId(demo.region, now);

      await prisma.$transaction([
        prisma.character.update({
          where: { id: character.id },
          data: {
            name: data.summary.name,
            characterClass: data.summary.characterClass,
            spec: data.summary.spec,
            level: data.summary.level,
            guildName: data.summary.guildName,
            lastFetchedAt: now,
            lastFetchError: null,
          },
        }),
        prisma.characterSnapshot.upsert({
          where: { characterId_weekId: { characterId: character.id, weekId } },
          update: {
            capturedAt: now,
            payload: data.payload as object,
            ilvl: data.summary.ilvl,
            mplusRating: data.summary.mplusRating,
            achievementPoints: data.summary.achievementPoints,
          },
          create: {
            characterId: character.id,
            weekId,
            capturedAt: now,
            payload: data.payload as object,
            ilvl: data.summary.ilvl,
            mplusRating: data.summary.mplusRating,
            achievementPoints: data.summary.achievementPoints,
          },
        }),
      ]);
      demoCharacters++;
    }
  }

  console.log('Seed complete:', {
    taskCatalog: taskCatalog.length,
    demoCharacters: process.env.MOCK_BLIZZARD === '1' ? demoCharacters : 0,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
