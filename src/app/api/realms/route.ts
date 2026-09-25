import { NextRequest, NextResponse } from 'next/server';
import { fetchRealms } from '@/lib/blizzard/realms';

export const dynamic = 'force-dynamic';

const VERSIONS = new Set(['retail', 'classic1x']);
const REGIONS = new Set(['us', 'eu', 'kr', 'tw']);

export async function GET(req: NextRequest) {
  const version = req.nextUrl.searchParams.get('version') ?? '';
  const region = (req.nextUrl.searchParams.get('region') ?? '').toLowerCase();

  if (!VERSIONS.has(version) || !REGIONS.has(region)) {
    return NextResponse.json(
      { error: 'version must be retail|classic1x, region must be us|eu|kr|tw' },
      { status: 400 },
    );
  }

  try {
    const realms = await fetchRealms(version as 'retail' | 'classic1x', region as 'us' | 'eu' | 'kr' | 'tw');
    return NextResponse.json({ realms });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'realm fetch failed' },
      { status: 502 },
    );
  }
}
