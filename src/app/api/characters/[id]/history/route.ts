import { NextRequest, NextResponse } from 'next/server';
import { getCharacterHistory } from '@/lib/board';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getCharacterHistory(id);
  if (!result) {
    return NextResponse.json({ error: 'character not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}
