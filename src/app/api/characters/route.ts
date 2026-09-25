import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { refreshCharacter } from '@/lib/board';
import type { GameVersion, Region } from '@/lib/blizzard/client';

export const dynamic = 'force-dynamic';

const VERSIONS = new Set(['retail', 'classic1x']);
const REGIONS = new Set(['us', 'eu', 'kr', 'tw']);

type AddBody = {
  name?: string;
  realmSlug?: string;
  region?: string;
  gameVersion?: string;
};

/**
 * Manual add — the onboarding path. Creates the character row and kicks off
 * the first fetch. Rename/transfer later creates a new row (known limitation).
 */
export async function POST(req: NextRequest) {
  let body: AddBody;
  try {
    body = (await req.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const name = body.name?.trim() ?? '';
  const realmSlug = body.realmSlug?.trim().toLowerCase() ?? '';
  const region = body.region?.toLowerCase() ?? '';
  const gameVersion = body.gameVersion?.toLowerCase() ?? '';

  if (!name || !realmSlug) {
    return NextResponse.json({ error: 'name and realmSlug are required' }, { status: 400 });
  }
  if (!REGIONS.has(region) || !VERSIONS.has(gameVersion)) {
    return NextResponse.json(
      { error: 'region must be us|eu|kr|tw, gameVersion must be retail|classic1x' },
      { status: 400 },
    );
  }

  const nameLower = name.toLowerCase();

  const existing = await prisma.character.findUnique({
    where: {
      gameVersion_region_realmSlug_nameLower: { gameVersion, region, realmSlug, nameLower },
    },
  });
  if (existing) {
    return NextResponse.json({ error: 'character already on the board' }, { status: 409 });
  }

  const character = await prisma.character.create({
    data: { gameVersion, region, realmSlug, nameLower, name },
  });

  // First fetch is synchronous so the user immediately sees the card (or the
  // fetch error badge on it). Rate-limit-guarded inside the client.
  const result = await refreshCharacter(character.id, { bypassCache: true });

  return NextResponse.json(
    { character: { id: character.id, name: character.name }, refresh: result },
    { status: 201 },
  );
}

export async function GET() {
  const characters = await prisma.character.findMany({
    orderBy: [{ priority: 'asc' }, { nameLower: 'asc' }],
  });
  return NextResponse.json({ characters });
}
