import { NextRequest, NextResponse } from 'next/server';
import { fetchRealms } from '@/lib/blizzard/realms';
import { MOCK_BLIZZARD } from '@/lib/adapters';

export const dynamic = 'force-dynamic';

const VERSIONS = new Set(['retail', 'classic1x']);
const REGIONS = new Set(['us', 'eu', 'kr', 'tw']);

const MOCK_REALMS = [
  'Argent Dawn', 'Antonidas', 'Blackmoore', 'Kazzak', 'Ravencrest',
  'Tarren Mill', 'Thrall', 'Stormrage', 'Illidan', 'Hydraxis',
].map((name) => ({ name, slug: name.toLowerCase().replace(/[^a-z]/g, '-') }));

export async function GET(req: NextRequest) {
  const version = req.nextUrl.searchParams.get('version') ?? '';
  const region = (req.nextUrl.searchParams.get('region') ?? '').toLowerCase();

  if (!VERSIONS.has(version) || !REGIONS.has(region)) {
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
