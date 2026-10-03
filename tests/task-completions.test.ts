// Pins the F-8 regression on POST /api/task-completions: weekId is derived
// server-side per region (currentWeekId(region, now, DEFAULT_SCHEDULES)),
// never taken from the client - a weekly task toggles with the region's
// current weekId, a one_time task with null, and the response echoes exactly
// what toggleTaskCompletion received. Also pins the 400 (unknown task /
// missing fields), 404 (unknown character) and 403 (cross-origin) branches.
// Requests are duck-typed to { headers, json } (undici drops forbidden
// headers); the clock is frozen so the derived weekId is deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_SCHEDULES, currentWeekId } from '@/lib/week';
import { toggleTaskCompletion } from '@/lib/board';

const prismaMock = vi.hoisted(() => ({
  character: { findUnique: vi.fn() },
  taskCatalog: { findUnique: vi.fn() },
}));

// prisma is the mock; the violation helpers stay real (unused on this route).
vi.mock('@/server/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/prisma')>();
  return { ...actual, prisma: prismaMock };
});

vi.mock('@/lib/board', () => ({ toggleTaskCompletion: vi.fn() }));

import { POST } from '@/app/api/task-completions/route';

const toggleMock = vi.mocked(toggleTaskCompletion);

// Frozen instant: Friday 2026-09-25 12:00 UTC (EU week is 2026-09-23). The
// route's internal new Date() and the expected weekId below both read it.
const NOW = new Date('2026-09-25T12:00:00.000Z');
const EU_WEEK_ID = currentWeekId('eu', NOW, DEFAULT_SCHEDULES);

const CHARACTER = { id: 'c1', gameVersion: 'retail', region: 'eu' };

function req(body?: unknown): NextRequest {
  return {
    headers: new Headers({ host: 'localhost:3000', origin: 'http://localhost:3000' }),
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  prismaMock.character.findUnique.mockResolvedValue(CHARACTER);
  prismaMock.taskCatalog.findUnique.mockResolvedValue({
    taskKey: 'vault_mplus_1',
    active: true,
    scope: 'weekly',
  });
  toggleMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/task-completions', () => {
  it('weekly task: derives the region weekId server-side, on defaults to true', async () => {
    const res = await POST(req({ characterId: 'c1', taskKey: 'vault_mplus_1' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      taskKey: 'vault_mplus_1',
      weekId: EU_WEEK_ID,
      on: true,
    });
    expect(toggleMock).toHaveBeenCalledWith('c1', 'vault_mplus_1', EU_WEEK_ID, true);
    expect(prismaMock.taskCatalog.findUnique).toHaveBeenCalledWith({
      where: { gameVersion_taskKey: { gameVersion: 'retail', taskKey: 'vault_mplus_1' } },
    });
  });

  it('one_time task: weekId is null', async () => {
    prismaMock.taskCatalog.findUnique.mockResolvedValue({
      taskKey: 'renown_80',
      active: true,
      scope: 'one_time',
    });

    const res = await POST(req({ characterId: 'c1', taskKey: 'renown_80' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      taskKey: 'renown_80',
      weekId: null,
      on: true,
    });
    expect(toggleMock).toHaveBeenCalledWith('c1', 'renown_80', null, true);
  });

  it('propagates on: false so a toggle-off reaches toggleTaskCompletion', async () => {
    const res = await POST(req({ characterId: 'c1', taskKey: 'vault_mplus_1', on: false }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      taskKey: 'vault_mplus_1',
      weekId: EU_WEEK_ID,
      on: false,
    });
    expect(toggleMock).toHaveBeenCalledWith('c1', 'vault_mplus_1', EU_WEEK_ID, false);
  });

  it('400: unknown or inactive task', async () => {
    prismaMock.taskCatalog.findUnique.mockResolvedValue(null);
    const missing = await POST(req({ characterId: 'c1', taskKey: 'nope' }));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: 'unknown task' });

    prismaMock.taskCatalog.findUnique.mockResolvedValue({
      taskKey: 'vault_mplus_1',
      active: false,
      scope: 'weekly',
    });
    const inactive = await POST(req({ characterId: 'c1', taskKey: 'vault_mplus_1' }));
    expect(inactive.status).toBe(400);
    await expect(inactive.json()).resolves.toEqual({ error: 'unknown task' });

    expect(toggleMock).not.toHaveBeenCalled();
  });

  it('400: missing characterId or taskKey', async () => {
    const res = await POST(req({ taskKey: 'vault_mplus_1' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'characterId and taskKey are required',
    });
    expect(prismaMock.character.findUnique).not.toHaveBeenCalled();
  });

  it('404: unknown character', async () => {
    prismaMock.character.findUnique.mockResolvedValue(null);

    const res = await POST(req({ characterId: 'ghost', taskKey: 'vault_mplus_1' }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'character not found' });
    expect(prismaMock.taskCatalog.findUnique).not.toHaveBeenCalled();
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it('403: cross-origin request is rejected before any DB access', async () => {
    const evil = {
      headers: new Headers({ host: 'localhost:3000', origin: 'http://evil.example' }),
      json: async () => ({ characterId: 'c1', taskKey: 'vault_mplus_1' }),
    } as unknown as NextRequest;

    const res = await POST(evil);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'cross-origin request rejected' });
    expect(prismaMock.character.findUnique).not.toHaveBeenCalled();
  });
});
