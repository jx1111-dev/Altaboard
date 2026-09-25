import { PrismaClient } from '@prisma/client';
import { gameVersions, resetSchedules, taskCatalog } from './seeds';

const prisma = new PrismaClient();

async function main() {
  for (const gv of gameVersions) {
    await prisma.gameVersion.upsert({
      where: { code: gv.code },
      update: { label: gv.label, namespacePrefix: gv.namespacePrefix, active: gv.active },
      create: gv,
    });
  }

  for (const rs of resetSchedules) {
    await prisma.resetSchedule.upsert({
      where: { region: rs.region },
      update: { resetDow: rs.resetDow, resetHourUtc: rs.resetHourUtc },
      create: rs,
    });
  }

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

  console.log('Seed complete:', {
    gameVersions: gameVersions.length,
    resetSchedules: resetSchedules.length,
    taskCatalog: taskCatalog.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
