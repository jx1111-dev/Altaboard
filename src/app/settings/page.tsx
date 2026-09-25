import { prisma } from '@/server/prisma';
import CharacterSettingsTable from '@/components/CharacterSettingsTable';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const characters = await prisma.character.findMany({
    where: { archived: false },
    orderBy: [{ priority: 'asc' }, { nameLower: 'asc' }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Default region: EU. Priority ordering and group management below.
          Archived characters keep their snapshots but leave the board.
        </p>
      </div>

      <CharacterSettingsTable
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          gameVersion: c.gameVersion,
          region: c.region,
          realmSlug: c.realmSlug,
          priority: c.priority,
          groupName: c.groupName,
        }))}
      />
    </div>
  );
}
