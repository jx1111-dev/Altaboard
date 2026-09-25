import { NextRequest, NextResponse } from 'next/server';
import { refreshCharacter } from '@/lib/board';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Manual per-character refresh: cache-bypass, rate-limit-guarded. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await refreshCharacter(id, { bypassCache: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
