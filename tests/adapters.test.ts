// Regression tests for the adapter boundary (F-1): a profile 404 must reach
// refreshCharacter as NotFoundError, not as a generic Error that the
// permanence check cannot classify - the exact test that would have caught
// F-1. Also pins the build path and the "one bad endpoint must not sink the
// fetch" contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/blizzard/errors';
import { retailAdapter } from '@/lib/adapters/retail';
import { classic1xAdapter } from '@/lib/adapters/classic1x';
import type { CharacterRef } from '@/lib/adapters/types';

// Token and API cache live in Postgres; stub the DB-backed cache module
// (keeping cacheKey/TTL_MS real) and answer the token POST from the fetch stub.
vi.mock('@/lib/blizzard/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/blizzard/cache')>();
  return {
    ...actual,
    getCached: vi.fn(async () => null),
    putCached: vi.fn(async () => {}),
  };
});

const TOKEN_URL = 'https://oauth.battle.net/token';
const PROFILE_PATH = '/profile/wow/character/moon-guard/testchar';

// credentials() gates on env vars before the fetch stub can answer the token
// POST; dummies are enough.
process.env.BLIZZARD_CLIENT_ID = 'test-id';
process.env.BLIZZARD_CLIENT_SECRET = 'test-secret';

const ref: CharacterRef = {
  gameVersion: 'retail',
  region: 'us',
  realmSlug: 'moon-guard',
  nameLower: 'testchar',
};

let fetchMock: ReturnType<typeof vi.fn>;

// One stub for every HTTP call: the OAuth token plus all character endpoints,
// with per-path bodies and (optionally) per-path statuses.
function stubResponses(
  bodies: Record<string, unknown>,
  statusByPath: Record<string, number> = {},
): void {
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const href = String(input);
    if (href.startsWith(TOKEN_URL)) {
      return new Response(
        JSON.stringify({ access_token: 'test-token', expires_in: 3600, token_type: 'bearer' }),
        { status: 200 },
      );
    }
    const path = new URL(href).pathname;
    return new Response(JSON.stringify(bodies[path] ?? {}), {
      status: statusByPath[path] ?? 200,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  stubResponses({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCharacter - profile 404 surfaces as NotFoundError (F-1)', () => {
  it('retail adapter rethrows the profile endpoint NotFoundError', async () => {
    stubResponses({}, { [PROFILE_PATH]: 404 });
    await expect(retailAdapter.fetchCharacter(ref)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('classic adapter rethrows the profile endpoint NotFoundError', async () => {
    stubResponses({}, { [PROFILE_PATH]: 404 });
    await expect(
      classic1xAdapter.fetchCharacter({ ...ref, gameVersion: 'classic1x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('fetchCharacter - success path', () => {
  it('merges the endpoints into payload and summary', async () => {
    stubResponses({
      [PROFILE_PATH]: {
        name: 'Testchar',
        character_class: { name: 'Warrior' },
        active_spec: { name: 'Arms' },
        level: 70,
        guild: { name: 'Guild' },
        average_item_level: 410.5,
        achievement_points: 31000,
      },
      [`${PROFILE_PATH}/character-media`]: {
        assets: [{ key: 'avatar', value: 'https://render.example/testchar-avatar.jpg' }],
      },
      [`${PROFILE_PATH}/mythic-keystone-profile`]: {
        current_period: { period: 1310 },
        season: { ratings: [{ rating: 2500 }] },
      },
    });

    const data = await retailAdapter.fetchCharacter(ref);

    expect(data.summary).toEqual({
      name: 'Testchar',
      characterClass: 'Warrior',
      spec: 'Arms',
      level: 70,
      guildName: 'Guild',
      ilvl: 410.5,
      mplusRating: 2500,
      achievementPoints: 31000,
      portraitUrl: 'https://render.example/testchar-avatar.jpg',
    });
    expect(data.payload.profile).toBeDefined();
    expect(data.payload._endpointErrors).toEqual({});
    expect(data.payload._fetchedVersion).toBe('retail');
  });

  it('a non-profile endpoint failing is recorded, the fetch still succeeds', async () => {
    stubResponses(
      { [PROFILE_PATH]: { name: 'Testchar' } },
      { [`${PROFILE_PATH}/achievements`]: 404 },
    );

    const data = await retailAdapter.fetchCharacter(ref);

    expect(data.summary.name).toBe('Testchar');
    expect(Object.keys(data.payload._endpointErrors as Record<string, string>)).toEqual([
      'achievements',
    ]);
  });
});
