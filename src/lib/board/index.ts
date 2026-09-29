// Board service: read-time task state assembly + character refresh.
// Server Components and API routes both call these functions directly.

import { prisma } from '@/server/prisma';
import { currentWeekId } from '@/lib/week';
import {
  deriveTasks,
  mergeTasks,
  type CatalogTask,
  type TaskState,
} from '@/lib/tasks';
import { getAdapter } from '@/lib/adapters';
import type { GameVersion, Region } from '@/lib/blizzard/client';

export const GAME_VERSIONS: { code: GameVersion; label: string }[] = [
  { code: 'retail', label: 'Retail' },
  { code: 'classic1x', label: 'Classic' },
];

export type BoardTask = {
  taskKey: string;
  label: string;
  category: string;
  scope: string;
  source: string;
  state: TaskState;
  manuallySet: boolean;
};

export type BoardCharacter = {
  id: string;
  name: string;
  characterClass: string | null;
  spec: string | null;
  level: number | null;
  guildName: string | null;
  region: string;
  realmSlug: string;
  groupName: string | null;
  priority: number;
  weekId: string;
  snapshot: {
    capturedAt: Date;
    ilvl: number | null;
    mplusRating: number | null;
    achievementPoints: number | null;
    payload: Record<string, unknown>;
  } | null;
  tasks: BoardTask[];
  lastFetchedAt: Date | null;
  lastFetchError: string | null;
};

export async function getBoard(version: GameVersion): Promise<{
  version: GameVersion;
  characters: BoardCharacter[];
}> {
  const [characters, catalog] = await Promise.all([
    prisma.character.findMany({
      where: { gameVersion: version, archived: false },
      orderBy: [{ priority: 'asc' }, { nameLower: 'asc' }],
      include: {
        snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
    }),
    prisma.taskCatalog.findMany({
      where: { gameVersion: version, active: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  const now = new Date();
  const catalogTasks: CatalogTask[] = catalog.map((t) => ({
    taskKey: t.taskKey,
    label: t.label,
    category: t.category,
    scope: t.scope,
    source: t.source,
    sortOrder: t.sortOrder,
  }));

  const board: BoardCharacter[] = await Promise.all(
    characters.map(async (c) => {
      const weekId = currentWeekId(c.region, now);
      const completions = await prisma.taskCompletion.findMany({
        where: {
          characterId: c.id,
          OR: [{ weekId }, { weekId: null }],
        },
      });

      const latest = c.snapshots[0] ?? null;
      const derived = deriveTasks(
        latest ? { weekId: latest.weekId, payload: latest.payload } : null,
        catalogTasks,
        weekId,
        c.region,
        now,
      );
      const merged = mergeTasks(
        derived,
        completions.map((row) => ({ taskKey: row.taskKey, done: row.done })),
      );

      return {
        id: c.id,
        name: c.name,
        characterClass: c.characterClass,
        spec: c.spec,
        level: c.level,
        guildName: c.guildName,
        region: c.region,
        realmSlug: c.realmSlug,
        groupName: c.groupName,
        priority: c.priority,
        weekId,
        snapshot: latest
          ? {
              capturedAt: latest.capturedAt,
              ilvl: latest.ilvl,
              mplusRating: latest.mplusRating,
              achievementPoints: latest.achievementPoints,
              payload: latest.payload as Record<string, unknown>,
            }
          : null,
        tasks: merged.map(
          ({ taskKey, label, category, scope, source, state, manuallySet }) => ({
            taskKey,
            label,
            category,
            scope,
            source,
            state,
            manuallySet,
          }),
        ),
        lastFetchedAt: c.lastFetchedAt,
        lastFetchError: c.lastFetchError,
      };
    }),
  );

  return { version, characters: board };
}

export async function toggleTaskCompletion(
  characterId: string,
  taskKey: string,
  weekId: string | null,
  on: boolean,
): Promise<void> {
  if (on) {
    // weekId can be null (one_time tasks) so the compound-unique selector
    // can't be used - find first, then update or create.
    const existing = await prisma.taskCompletion.findFirst({
      where: { characterId, taskKey, weekId },
    });
    if (existing) {
      await prisma.taskCompletion.update({
        where: { id: existing.id },
        data: { done: true },
      });
    } else {
      await prisma.taskCompletion.create({
        data: { characterId, taskKey, weekId, done: true },
      });
    }
  } else {
    // Toggle off deletes the row - state falls back to derived.
    await prisma.taskCompletion.deleteMany({
      where: { characterId, taskKey, weekId },
    });
  }
}

export type RefreshResult = {
  ok: boolean;
  error?: string;
};

// Fetch fresh data via the character's adapter and upsert the week's snapshot.
// One bad character never throws into the caller's lap - errors are returned.
export async function refreshCharacter(
  characterId: string,
  opts: { bypassCache?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return { ok: false, error: 'character not found' };

  try {
    const adapter = getAdapter(character.gameVersion as GameVersion);
    const data = await adapter.fetchCharacter({
      gameVersion: character.gameVersion as GameVersion,
      region: character.region as Region,
      realmSlug: character.realmSlug,
      nameLower: character.nameLower,
    });

    const weekId = currentWeekId(character.region, now);
    await prisma.$transaction([
      prisma.character.update({
        where: { id: characterId },
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
        where: {
          characterId_weekId: { characterId, weekId },
        },
        update: {
          capturedAt: now,
          payload: data.payload as object,
          ilvl: data.summary.ilvl,
          mplusRating: data.summary.mplusRating,
          achievementPoints: data.summary.achievementPoints,
        },
        create: {
          characterId,
          weekId,
          capturedAt: now,
          payload: data.payload as object,
          ilvl: data.summary.ilvl,
          mplusRating: data.summary.mplusRating,
          achievementPoints: data.summary.achievementPoints,
        },
      }),
    ]);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.character.update({
      where: { id: characterId },
      data: { lastFetchError: message, lastFetchedAt: now },
    });
    return { ok: false, error: message };
  }
}

export type HistoryEntry = {
  weekId: string;
  capturedAt: Date;
  ilvl: number | null;
  mplusRating: number | null;
  achievementPoints: number | null;
  deltas: {
    ilvl: number | null;
    mplusRating: number | null;
    achievementPoints: number | null;
  };
};

export async function getCharacterHistory(characterId: string): Promise<{
  character: { id: string; name: string; gameVersion: string; region: string; realmSlug: string; nameLower: string };
  history: HistoryEntry[];
} | null> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      snapshots: { orderBy: [{ weekId: 'desc' }, { capturedAt: 'desc' }] },
    },
  });
  if (!character) return null;

  // One entry per week (the latest snapshot of that week).
  const byWeek = new Map<string, (typeof character.snapshots)[number]>();
  for (const snap of character.snapshots) {
    if (!byWeek.has(snap.weekId)) byWeek.set(snap.weekId, snap);
  }
  const weeks = [...byWeek.values()].sort((a, b) => (a.weekId < b.weekId ? 1 : -1));

  const history: HistoryEntry[] = weeks.map((snap, i) => {
    const prev = weeks[i + 1];
    const diff = (a: number | null, b: number | null) =>
      a === null || b === null ? null : a - b;
    return {
      weekId: snap.weekId,
      capturedAt: snap.capturedAt,
      ilvl: snap.ilvl,
      mplusRating: snap.mplusRating,
      achievementPoints: snap.achievementPoints,
      deltas: {
        ilvl: prev ? diff(snap.ilvl, prev.ilvl) : null,
        mplusRating: prev ? diff(snap.mplusRating, prev.mplusRating) : null,
        achievementPoints: prev ? diff(snap.achievementPoints, prev.achievementPoints) : null,
      },
    };
  });

  return {
    character: {
      id: character.id,
      name: character.name,
      gameVersion: character.gameVersion,
      region: character.region,
      realmSlug: character.realmSlug,
      nameLower: character.nameLower,
    },
    history,
  };
}
