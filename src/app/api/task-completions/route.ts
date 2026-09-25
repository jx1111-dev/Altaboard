import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { toggleTaskCompletion } from '@/lib/board';
import { DEFAULT_SCHEDULES, weekKeyFor } from '@/lib/week';

export const dynamic = 'force-dynamic';

type ToggleBody = {
  characterId?: string;
  taskKey?: string;
  /** Omit for one_time tasks — resolved per character region for weekly tasks. */
  weekKey?: string | null;
  on?: boolean;
};

/**
 * Toggle a manual check. Toggle on → upsert row; toggle off → delete row
 * (state falls back to derived). Auto tasks are never persisted.
 */
export async function POST(req: NextRequest) {
  let body: ToggleBody;
  try {
    body = (await req.json()) as ToggleBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { characterId, taskKey } = body;
  if (!characterId || !taskKey) {
    return NextResponse.json({ error: 'characterId and taskKey are required' }, { status: 400 });
  }

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) {
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }

  const task = await prisma.taskCatalog.findUnique({
    where: { gameVersion_taskKey: { gameVersion: character.gameVersion, taskKey } },
  });
  if (!task || !task.active) {
    return NextResponse.json({ error: 'unknown task' }, { status: 400 });
  }

  let weekKey: string | null;
  if (task.scope === 'one_time') {
    weekKey = null;
  } else if (body.weekKey) {
    weekKey = body.weekKey;
  } else {
    weekKey = weekKeyFor(character.region, new Date(), DEFAULT_SCHEDULES);
  }

  await toggleTaskCompletion(characterId, taskKey, weekKey, body.on !== false);
  return NextResponse.json({ ok: true, taskKey, weekKey, on: body.on !== false });
}
