import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { toggleTaskCompletion } from '@/lib/board';
import { DEFAULT_SCHEDULES, currentWeekId } from '@/lib/week';
import { isSameOrigin } from '@/lib/http';

export const dynamic = 'force-dynamic';

const WEEK_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

type ToggleBody = {
  characterId?: string;
  taskKey?: string;
  weekId?: string | null;
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

  let weekId: string | null;
  if (task.scope === 'one_time') {
    weekId = null;
  } else if (body.weekId) {
    // Client-supplied weekIds are persisted verbatim.
    if (!WEEK_ID_RE.test(body.weekId)) {
      return NextResponse.json({ error: 'weekId must be YYYY-MM-DD' }, { status: 400 });
    }
    weekId = body.weekId;
  } else {
    weekId = currentWeekId(character.region, new Date(), DEFAULT_SCHEDULES);
  }

  try {
    await toggleTaskCompletion(characterId, taskKey, weekId, body.on !== false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'toggle failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, taskKey, weekId, on: body.on !== false });
}
