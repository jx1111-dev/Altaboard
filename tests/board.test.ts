// Pins the refreshCharacter seam (lib/board): the adapter is the only fetch
// boundary (getAdapter stubbed) and Postgres is the only write boundary
// (prisma mocked, the violation helpers kept real). Locks down the snapshot
// upsert key (characterId_weekId, weekId derived from the injected now), the
// permanent-vs-transient failure bookkeeping (lastFetchedAt for a 404 vs
// exponential backoff capped at 24 h), and the guarantee that a DB failure
// while recording a fetch error never masks the original error.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdapter } from '@/lib/adapters';
import { NotFoundError } from '@/lib/blizzard/errors';
import { refreshCharacter } from '@/lib/board';
import { currentWeekId } from '@/lib/week';

const prismaMock = vi.hoisted(() => ({
  character: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  characterSnapshot: { upsert: vi.fn() },
  $transaction: vi.fn(),
}));

// prisma is the mock; isUniqueViolation/isNotFoundViolation stay real.
vi.mock('@/server/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/prisma')>();
  return { ...actual, prisma: prismaMock };
});

vi.mock('@/lib/adapters', () => ({ getAdapter: vi.fn() }));

const getAdapterMock = vi.mocked(getAdapter);

// Fixed instant: Friday 2026-09-25 12:00 UTC (EU week is 2026-09-23).
const NOW = new Date('2026-09-25T12:00:00.000Z');
const EU_WEEK_ID = currentWeekId('eu', NOW);

const CHARACTER = {
  id: 'c1',
  name: 'Testchar',
  gameVersion: 'retail',
  region: 'eu',
  realmSlug: 'moon-guard',
  nameLower: 'testchar',
  fetchFailures: 0,
};

// Plain object, deliberately not typed as FetchedCharacterData: the summary
// shape is the adapter's concern and this suite must not pin its internals.
const FETCHED = {
  payload: { profile: { name: 'Testchar' } },
  summary: {
    name: 'Testchar',
    characterClass: 'Warrior',
    spec: 'Arms',
    level: 70,
    guildName: 'Guild',
    ilvl: 410.5,
    mplusRating: 2500,
    achievementPoints: 31000,
  },
};

const NOT_FOUND_PATH = '/profile/wow/character/moon-guard/testchar';

let fetchCharacter: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchCharacter = vi.fn(async () => FETCHED);
  getAdapterMock.mockReturnValue(
    { version: 'retail', fetchCharacter } as unknown as ReturnType<typeof getAdapter>,
  );
  prismaMock.character.findUnique.mockResolvedValue(CHARACTER);
  // The snapshot write path re-reads the row's region for the weekId.
  prismaMock.character.findUniqueOrThrow.mockResolvedValue({ region: 'eu' });
  prismaMock.character.update.mockResolvedValue({});
  prismaMock.characterSnapshot.upsert.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue([]);
});

describe('refreshCharacter - success', () => {
  it('updates the character and upserts the snapshot keyed characterId_weekId', async () => {
    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.character.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(getAdapterMock).toHaveBeenCalledWith('retail');
    expect(fetchCharacter).toHaveBeenCalledWith({
      gameVersion: 'retail',
      region: 'eu',
      realmSlug: 'moon-guard',
      nameLower: 'testchar',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(2);
    expect(prismaMock.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        name: 'Testchar',
        characterClass: 'Warrior',
        spec: 'Arms',
        level: 70,
        guildName: 'Guild',
        lastFetchedAt: NOW,
        lastFetchError: null,
        fetchFailures: 0,
        nextAttemptAt: null,
      },
    });
    expect(prismaMock.characterSnapshot.upsert).toHaveBeenCalledWith({
      where: { characterId_weekId: { characterId: 'c1', weekId: EU_WEEK_ID } },
      update: {
        capturedAt: NOW,
        payload: FETCHED.payload,
        ilvl: 410.5,
        mplusRating: 2500,
        achievementPoints: 31000,
      },
      create: {
        characterId: 'c1',
        weekId: EU_WEEK_ID,
        capturedAt: NOW,
        payload: FETCHED.payload,
        ilvl: 410.5,
        mplusRating: 2500,
        achievementPoints: 31000,
      },
    });
  });

  it('returns character not found without any DB write', async () => {
    prismaMock.character.findUnique.mockResolvedValue(null);

    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: false, error: 'character not found' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.character.update).not.toHaveBeenCalled();
  });
});

describe('refreshCharacter - permanent failure (NotFoundError)', () => {
  it('advances lastFetchedAt + lastFetchError, no backoff fields', async () => {
    fetchCharacter.mockRejectedValue(new NotFoundError(NOT_FOUND_PATH));

    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: false, error: `404: ${NOT_FOUND_PATH}` });
    // Exact data object: fetchFailures/nextAttemptAt must be absent so the
    // daily sweep does not keep retrying a lost cause.
    expect(prismaMock.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lastFetchError: `404: ${NOT_FOUND_PATH}`, lastFetchedAt: NOW },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('refreshCharacter - transient failure', () => {
  it('backs off 10 min doubled per failure (0 previous -> now + 20 min)', async () => {
    fetchCharacter.mockRejectedValue(new Error('boom'));

    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(prismaMock.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        lastFetchError: 'boom',
        fetchFailures: 1,
        nextAttemptAt: new Date(NOW.getTime() + 20 * 60 * 1000),
      },
    });
    // lastFetchedAt stays untouched so the character remains "stale".
    expect(prismaMock.character.update.mock.calls[0][0].data).not.toHaveProperty('lastFetchedAt');
  });

  it('caps the backoff at 24 h (19 previous failures -> now + 24 h)', async () => {
    prismaMock.character.findUnique.mockResolvedValue({ ...CHARACTER, fetchFailures: 19 });
    fetchCharacter.mockRejectedValue(new Error('boom'));

    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(prismaMock.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        lastFetchError: 'boom',
        fetchFailures: 20,
        nextAttemptAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  });
});

describe('refreshCharacter - recording-write failure', () => {
  it('a DB failure while recording the error does not mask the fetch error', async () => {
    fetchCharacter.mockRejectedValue(new NotFoundError(NOT_FOUND_PATH));
    prismaMock.character.update.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await refreshCharacter('c1', { now: NOW });

    expect(result).toEqual({ ok: false, error: `404: ${NOT_FOUND_PATH}` });
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
