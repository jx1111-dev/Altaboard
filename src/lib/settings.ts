// Settings page read: the active and archived character rows the settings
// table renders. Kept out of board/index.ts - that module owns board assembly
// and refresh; this is an admin listing.

import { prisma } from '@/server/prisma';

export async function getCharacterSettings() {
  const [characters, archived] = await Promise.all([
    prisma.character.findMany({
      where: { archived: false },
      orderBy: [{ priority: 'asc' }, { nameLower: 'asc' }],
    }),
    prisma.character.findMany({
      where: { archived: true },
      orderBy: { nameLower: 'asc' },
    }),
  ]);
  return { characters, archived };
}
