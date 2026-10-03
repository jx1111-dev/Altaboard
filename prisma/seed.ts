import { PrismaClient } from '@prisma/client';
import { taskCatalog, demoClassicCharacters } from './seeds';
import { mockAdapter } from '@/lib/adapters/mock';
import { persistCharacterSnapshot } from '@/lib/board';
import type { GameVersion, Region } from '@/lib/blizzard/client';

const prisma = new PrismaClient();

async function main() {
  for (const task of taskCatalog) {
    // Create-only (empty update): hand edits to labels/order/active in the DB
    // must survive the migrate job that runs on every docker compose up.
    await prisma.taskCatalog.upsert({
      where: { gameVersion_taskKey: { gameVersion: task.gameVersion, taskKey: task.taskKey } },
      update: {},
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
      // The shared persist path also resets lastFetchError / fetchFailures /
      // nextAttemptAt - harmless for seed rows, which carry no fetch history.
      await persistCharacterSnapshot(character.id, data, new Date());
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
