import Link from 'next/link';
import { getBoard, GAME_VERSIONS, type BoardCharacter } from '@/lib/board';
import AddCharacterForm from '@/components/AddCharacterForm';
import TaskChecklist from '@/components/TaskChecklist';
import RefreshButton from '@/components/RefreshButton';
import VersionTabs from '@/components/VersionTabs';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ version?: string }>;
};

export default async function BoardPage({ searchParams }: Props) {
  const { version: versionParam } = await searchParams;
  const version = (GAME_VERSIONS.find((v) => v.code === versionParam)?.code ??
    'retail') as (typeof GAME_VERSIONS)[number]['code'];

  const board = await getBoard(version);
  const hasCharacters = board.characters.length > 0;

  // Group characters by user-defined group; ungrouped go last under their own heading.
  const groups = new Map<string, BoardCharacter[]>();
  for (const c of board.characters) {
    const key = c.groupName ?? 'Ungrouped';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <VersionTabs versions={GAME_VERSIONS} active={version} />
        <RefreshAllButton characterIds={board.characters.map((c) => c.id)} />
      </div>

      <AddCharacterForm defaultVersion={version} defaultRegion="eu" />

      {!hasCharacters && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-[var(--muted)]">
          No characters yet. Add your first character above — it will be fetched
          from the Blizzard API immediately.
        </div>
      )}

      {[...groups.entries()].map(([group, chars]) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            {group}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {chars.map((c) => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RefreshAllButton({ characterIds }: { characterIds: string[] }) {
  return (
    <RefreshButton
      characterId={null}
      characterIds={characterIds}
      label="Refresh all"
    />
  );
}

function CharacterCard({ character }: { character: BoardCharacter }) {
  const portrait =
    (character.snapshot?.payload?.media as { assets?: { key: string; value: string }[] } | undefined)
      ?.assets?.find((a) => a.key === 'avatar')?.value;

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portrait}
            alt=""
            width={56}
            height={56}
            className="rounded border border-[var(--border)] bg-black/30 object-cover"
          />
        ) : (
          <div className="h-14 w-14 rounded border border-[var(--border)] bg-black/30" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <Link
              href={`/character/${character.id}`}
              className="font-semibold truncate hover:text-[var(--accent)]"
            >
              {character.name}
            </Link>
            <span className="text-xs text-[var(--muted)] shrink-0">
              {character.region.toUpperCase()} · {character.realmSlug}
            </span>
          </div>
          <div className="text-sm text-[var(--muted)] truncate">
            {[character.level, character.characterClass, character.spec, character.guildName]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
          <div className="text-sm mt-1 flex gap-3">
            {character.snapshot?.ilvl !== null && character.snapshot?.ilvl !== undefined && (
              <span>ilvl {character.snapshot.ilvl}</span>
            )}
            {character.snapshot?.mplusRating !== null &&
              character.snapshot?.mplusRating !== undefined && (
                <span className="text-[var(--accent)]">
                  M+ {character.snapshot.mplusRating}
                </span>
              )}
          </div>
        </div>
      </div>

      {character.lastFetchError && (
        <div className="rounded border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-xs text-[var(--error)]">
          Fetch error: {character.lastFetchError}
          <span className="block text-[var(--muted)] mt-0.5">
            Showing last known data.
          </span>
        </div>
      )}

      <TaskChecklist characterId={character.id} tasks={character.tasks} />

      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          Week {character.weekKey}
          {character.snapshot
            ? ` · fetched ${new Date(character.snapshot.capturedAt).toLocaleString()}`
            : ' · no snapshot yet'}
        </span>
        <RefreshButton characterId={character.id} label="Refresh" />
      </div>
    </article>
  );
}
