import { NextRequest, NextResponse } from 'next/server';
import { prisma, isNotFoundViolation } from '@/server/prisma';
import { isSameOrigin, parseJsonBody, routeError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const PRIORITY_MIN = 0;
const PRIORITY_MAX = 1000;

type PatchBody = {
  priority?: number;
  groupName?: string | null;
  archived?: boolean;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 403 });
  }
  const { id } = await params;
  const body = (await parseJsonBody(req)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.priority === 'number' && Number.isFinite(body.priority)) {
    // Round + clamp instead of letting the client own the sort order.
    data.priority = Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(body.priority)));
  }
  if (body.groupName !== undefined) {
    data.groupName = body.groupName === null || body.groupName === '' ? null : String(body.groupName);
  }
  if (typeof body.archived === 'boolean') data.archived = body.archived;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  try {
    const character = await prisma.character.update({ where: { id }, data });
    return NextResponse.json({ character });
  } catch (err) {
    // Only a genuine record-not-found is a 404; anything else (DB down,
    // schema drift) must surface as a real 5xx, not masquerade as a bad id.
    if (isNotFoundViolation(err)) {
      return NextResponse.json({ error: 'character not found' }, { status: 404 });
    }
    return routeError(err, 'character update failed');
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 403 });
  }
  const { id } = await params;
  try {
    await prisma.character.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Same distinction as PATCH: 404 only for a genuine record-not-found.
    if (isNotFoundViolation(err)) {
      return NextResponse.json({ error: 'character not found' }, { status: 404 });
    }
    return routeError(err, 'character delete failed');
  }
}
