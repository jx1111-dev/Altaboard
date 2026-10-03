// Pins the honest-404 contract of the characters [id] route (PATCH/DELETE):
// only a genuine Prisma P2025 record-not-found maps to a 404 body, any other
// rejection must exit through routeError with the fixed label plus a
// server-side log, and cross-origin / host-less requests get 403 before any
// DB access. Requests are duck-typed to { headers, json } because undici
// drops forbidden headers on a real Request; the handlers only read those.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  character: { update: vi.fn(), delete: vi.fn() },
}));

// prisma is the mock; the real isNotFoundViolation classifies the P2025.
vi.mock('@/server/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/prisma')>();
  return { ...actual, prisma: prismaMock };
});

import { DELETE, PATCH } from '@/app/api/characters/[id]/route';

const SAME_ORIGIN = { host: 'localhost:3000', origin: 'http://localhost:3000' };

// Duck-typed NextRequest: handlers only use req.headers and req.json().
function req(body?: unknown, headers: Record<string, string> = SAME_ORIGIN): NextRequest {
  return {
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ id: 'c1' }) };

// Real Prisma error instance so the instanceof check in isNotFoundViolation
// (kept via importOriginal) classifies it.
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('test', { code, clientVersion: 'test' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /api/characters/[id]', () => {
  it('200: writes the parsed body and echoes the updated character', async () => {
    prismaMock.character.update.mockResolvedValue({ id: 'c1', priority: 5 });

    const res = await PATCH(req({ priority: 5 }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ character: { id: 'c1', priority: 5 } });
    expect(prismaMock.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { priority: 5 },
    });
  });

  it('404: a P2025 rejection is a genuine record-not-found', async () => {
    prismaMock.character.update.mockRejectedValue(prismaError('P2025'));

    const res = await PATCH(req({ priority: 5 }), ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'character not found' });
  });

  it('500: any other rejection exits through routeError with the fixed label', async () => {
    prismaMock.character.update.mockRejectedValue(new Error('db down'));

    const res = await PATCH(req({ priority: 5 }), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'character update failed' });
    expect(console.error).toHaveBeenCalledWith(
      '[route-error] character update failed:',
      expect.any(Error),
    );
  });

  it('403: cross-origin and missing-host requests never reach the DB', async () => {
    const crossOrigin = await PATCH(
      req({ priority: 5 }, { host: 'localhost:3000', origin: 'http://evil.example' }),
      ctx,
    );
    const noHost = await PATCH(
      req({ priority: 5 }, { origin: 'http://localhost:3000' }),
      ctx,
    );

    expect(crossOrigin.status).toBe(403);
    expect(noHost.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toEqual({ error: 'cross-origin request rejected' });
    expect(prismaMock.character.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/characters/[id]', () => {
  it('200: deletes the character', async () => {
    prismaMock.character.delete.mockResolvedValue({ id: 'c1' });

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(prismaMock.character.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('404: a P2025 rejection is a genuine record-not-found', async () => {
    prismaMock.character.delete.mockRejectedValue(prismaError('P2025'));

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'character not found' });
  });

  it('500: any other rejection exits through routeError with the fixed label', async () => {
    prismaMock.character.delete.mockRejectedValue(new Error('db down'));

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'character delete failed' });
    expect(console.error).toHaveBeenCalledWith(
      '[route-error] character delete failed:',
      expect.any(Error),
    );
  });

  it('403: cross-origin requests never reach the DB', async () => {
    const res = await DELETE(
      req(undefined, { host: 'localhost:3000', origin: 'http://evil.example' }),
      ctx,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'cross-origin request rejected' });
    expect(prismaMock.character.delete).not.toHaveBeenCalled();
  });
});
