// Realm autocomplete for the add-character form; in mock mode a fixed list is
// served instead of hitting Blizzard's realm index.

import { NextRequest, NextResponse } from 'next/server';
import { fetchRealms } from '@/lib/blizzard/realms';
import { MOCK_BLIZZARD } from '@/lib/adapters';
import { MOCK_REALMS } from '@/lib/adapters/mock';
import { GAME_VERSIONS, REGIONS } from '@/lib/board';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const version = req.nextUrl.searchParams.get('version') ?? '';
  const region = (req.nextUrl.searchParams.get('region') ?? '').toLowerCase();

  if (!GAME_VERSIONS.some((v) => v.code === version) || !REGIONS.has(region)) {
    return NextResponse.json(
      { error: 'version must be retail|classic1x, region must be us|eu|kr|tw' },
      { status: 400 },
    );
  }

  if (MOCK_BLIZZARD) {
    return NextResponse.json({ realms: MOCK_REALMS });
  }

  try {
    const realms = await fetchRealms(version as 'retail' | 'classic1x', region as 'us' | 'eu' | 'kr' | 'tw');
    return NextResponse.json({ realms });
  } catch (err) {
    // Short fixed label in the body, detail to the server log.
    console.error('[realms] realm fetch failed:', err);
    return NextResponse.json({ error: 'realm fetch failed' }, { status: 502 });
  }
}
