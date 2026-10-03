import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { toggleTaskCompletion } from '@/lib/board';
import { DEFAULT_SCHEDULES, currentWeekId } from '@/lib/week';
import { isSameOrigin, parseJsonBody, routeError } from '@/lib/http';

export const dynamic = 'force-dynamic';

type ToggleBody = {
  characterId?: string;
  taskKey?: string;
  on?: boolean;
};

// Toggle a task: on upserts the user's completion row, off deletes it (state
// falls back to derived). Clearing a derived-done checkmark has no row to
// delete, so it persists an explicit not-done row instead. Rows are user
// overrides on ANY catalog task, auto tasks stay derived until overridden.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 403 });
  }

  const body = (await parseJsonBody(req)) as ToggleBody | null;
  if (!body) {
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

  // weekId is always derived server-side (null for one_time tasks): a
  // client-supplied value could drift from the region's real week and create
  // an orphan row the board never reads.
  const weekId =
    task.scope === 'one_time'
      ? null
      : currentWeekId(character.region, new Date(), DEFAULT_SCHEDULES);

  try {
    await toggleTaskCompletion(characterId, taskKey, weekId, body.on !== false);
  } catch (err) {
    // Short fixed label in the body, detail to the server log: the raw
    // message (often Prisma internals) renders verbatim under the task row.
    return routeError(err, 'toggle failed');
  }
  return NextResponse.json({ ok: true, taskKey, weekId, on: body.on !== false });
}
