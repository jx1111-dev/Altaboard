import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';

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
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
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
  } catch {
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await prisma.character.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }
}
