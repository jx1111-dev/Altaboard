import { NextRequest, NextResponse } from 'next/server';
import { refreshCharacter } from '@/lib/board';
import { isSameOrigin } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Manual per-character refresh: cache-bypass, rate-limit-guarded.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 403 });
  }
  const { id } = await params;
  const result = await refreshCharacter(id, { bypassCache: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
