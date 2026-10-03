// Blizzard API client, one implementation shared by web + worker.
// Cache-first with TTL classes, rate-limited via a per-process token bucket.
// Namespaces:
//   retail:  profile-{region} | dynamic-{region} | static-{region}
//   classic: profile-classic1x-{region} | dynamic-classic1x-{region}

import { acquireSlot } from './rateLimiter';
import { cacheKey, getCached, putCached, TTL_MS, type TtlClass } from './cache';
import { getToken } from './token';
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from './errors';

export type Region = 'us' | 'eu' | 'kr' | 'tw';
export type GameVersion = 'retail' | 'classic1x';
export type NamespaceKind = 'profile' | 'dynamic' | 'static';

function apiHost(region: string): string {
  return `https://${region}.api.blizzard.com`;
}

function namespace(
  version: GameVersion,
  kind: NamespaceKind,
  region: Region,
): string {
  if (version === 'classic1x') {
    return kind === 'static' ? `static-classic1x-${region}` : `${kind}-classic1x-${region}`;
  }
  return `${kind}-${region}`;
}

export type FetchOptions = {
  version: GameVersion;
  region: Region;
  namespaceKind?: NamespaceKind;
  ttlClass?: TtlClass;
  // Skip the cache read (manual refresh); result still written to cache.
  bypassCache?: boolean;
  maxRetries?: number;
};

const RETRYABLE_5XX = new Set([500, 502, 503, 504]);
// Hung requests must not pin worker slots / rate-limiter tokens forever.
const FETCH_TIMEOUT_MS = 15_000;

function jitteredDelay(attempt: number): number {
  const base = 500 * Math.pow(2, attempt);
  return base + Math.random() * base * 0.5;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function blizzardGet<T = unknown>(
  endpoint: string,
  params: Record<string, string> = {},
  options: FetchOptions,
): Promise<T> {
  const { version, region, namespaceKind } = options;
  const key = cacheKey(version, region, endpoint, params);

  if (!options.bypassCache) {
    const hit = await getCached<T>(key);
    if (hit !== null) return hit;
  }

  const query = new URLSearchParams(params);
  if (namespaceKind) {
    query.set('namespace', namespace(version, namespaceKind, region));
    // Must be en_US (underscore): an invalid locale makes Blizzard return
    // localized name objects ({ en_US: ... }) instead of plain strings.
    query.set('locale', 'en_US');
  }

  return fetchWithAuth<T>(`${apiHost(region)}${endpoint}`, query, key, options, 0);
}

async function fetchWithAuth<T>(
  url: string,
  query: URLSearchParams,
  key: string,
  options: FetchOptions,
  attempt: number,
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  await acquireSlot();

  const token = await getToken();
  const fullUrl = `${url}?${query.toString()}`;
  const res = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.ok) {
    const payload = (await res.json()) as T;
    await putCached(key, payload, TTL_MS[options.ttlClass ?? 'profile']);
    return payload;
  }

  // 401/403: refresh the machine token once and retry; classic endpoints also
  // 403 intermittently simply because data is unavailable.
  if (res.status === 401 || res.status === 403) {
    if (attempt === 0) {
      await getToken(true);
      return fetchWithAuth<T>(url, query, key, options, 1);
    }
    throw new AuthError(res.status, url);
  }

  if (res.status === 404) throw new NotFoundError(url);

  if (res.status === 429) {
    // One retry - honoring Retry-After when Blizzard sends a numeric one,
    // else a jittered delay (the token bucket may already cover the burst).
    // A second 429 surfaces as RateLimitError to the caller.
    if (attempt < 1) {
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : jitteredDelay(attempt);
      await sleep(delay);
      return fetchWithAuth<T>(url, query, key, options, attempt + 1);
    }
    throw new RateLimitError(url);
  }

  if (RETRYABLE_5XX.has(res.status) && attempt < maxRetries) {
    await sleep(jitteredDelay(attempt));
    return fetchWithAuth<T>(url, query, key, options, attempt + 1);
  }

  throw new ServerError(res.status, url);
}
