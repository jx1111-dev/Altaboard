// Client-credentials OAuth token for Blizzard APIs (machine-to-machine);
// there is no user login in Altaboard. Cached in api_cache with its real
// expiry, minus a safety margin.

import { getCached, putCached } from './cache';
import { AuthError } from './errors';

const TOKEN_URL = 'https://oauth.battle.net/token';
const EXPIRY_MARGIN_MS = 60 * 1000; // refresh a minute early
// Kept in step with the API timeout in client.ts (importing it back would cycle).
const FETCH_TIMEOUT_MS = 15_000;

function credentials(): { id: string; secret: string } {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new AuthError(
      500,
      'BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET missing - set them in .env',
    );
  }
  return { id, secret };
}

type TokenPayload = { access_token: string; expires_in: number; token_type: string };

// De-dupes concurrent fetches: on a cold start the adapters call getToken
// under a Promise.all, and without this a cache miss fires one
// client-credentials POST per endpoint instead of one.
let inFlight: Promise<string> | null = null;

// forceRefresh invalidates the cache (used on 401/403).
export async function getToken(forceRefresh = false): Promise<string> {
  const key = 'token:client_credentials';
  if (!forceRefresh) {
    const cached = await getCached<TokenPayload>(key);
    if (cached?.access_token) return cached.access_token;
  }

  if (!inFlight) {
    inFlight = fetchToken(key).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function fetchToken(key: string): Promise<string> {
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new AuthError(res.status, TOKEN_URL);
  }

  const payload = (await res.json()) as TokenPayload;
  // A missing/NaN expires_in would make the TTL NaN and the cache write fail
  // on an invalid date (opaque Prisma error); fail with a readable label.
  if (!Number.isFinite(payload.expires_in)) {
    throw new AuthError(500, 'token response missing expires_in');
  }
  const ttl = payload.expires_in * 1000 - EXPIRY_MARGIN_MS;
  await putCached(key, payload, ttl);
  return payload.access_token;
}
