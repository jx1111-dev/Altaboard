// PostgreSQL-backed API cache (api_cache table), shared by web + worker.
// TTL classes: profile 15 min, achievements 2 h, media/static 24 h.

import { prisma } from '@/server/prisma';

export type TtlClass = 'profile' | 'achievements' | 'static';

export const TTL_MS: Record<TtlClass, number> = {
  profile: 15 * 60 * 1000,
  achievements: 2 * 60 * 60 * 1000,
  static: 24 * 60 * 60 * 1000,
};

// Cache key format: v{version}:r{region}:{endpoint}:{params}, endpoint
// excludes the query string. The (short) params string is embedded verbatim;
// hashing it would add a collision class (two param-sets serving each other's
// cached payload) for no space saved.
export function cacheKey(
  gameVersion: string,
  region: string,
  endpoint: string,
  params: Record<string, string> = {},
): string {
  const paramStr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return `v${gameVersion}:r${region}:${endpoint}:${paramStr || 'noparams'}`;
}

export async function getCached<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.apiCache.findUnique({ where: { key } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row.payload as T;
}

export async function putCached(key: string, payload: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.apiCache.upsert({
    where: { key },
    update: { payload: payload as object, expiresAt },
    create: { key, payload: payload as object, expiresAt },
  });
}

// Opportunistic cleanup, called from the worker tick.
export async function purgeExpiredCache(): Promise<number> {
  const res = await prisma.apiCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}
