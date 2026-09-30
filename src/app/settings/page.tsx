import { prisma } from '@/server/prisma';
import { defaultRegion } from '@/lib/board';
import CharacterSettingsTable from '@/components/CharacterSettingsTable';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
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

  const toRow = (c: (typeof characters)[number]) => ({
    id: c.id,
    name: c.name,
    gameVersion: c.gameVersion,
    region: c.region,
    realmSlug: c.realmSlug,
    priority: c.priority,
    groupName: c.groupName,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Default region: {defaultRegion().toUpperCase()} (set DEFAULT_REGION in .env). Priority
          ordering and group management below.
          Archived characters keep their snapshots but leave the board; restore
          or delete them from the archived section.
        </p>
      </div>

      <CharacterSettingsTable
        characters={characters.map(toRow)}
        archived={archived.map(toRow)}
      />
    </div>
  );
}
