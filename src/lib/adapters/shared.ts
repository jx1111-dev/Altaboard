// Shared orchestration for the Blizzard-backed adapters: the endpoint fan-out,
// the profile-or-throw gate, and runtime guards for untrusted payload reads.
// Each version adapter reduces to its endpoint list plus its summary mapping.

import { blizzardGet } from '@/lib/blizzard/client';
import { describeError, NotFoundError } from '@/lib/blizzard/errors';
import type { GameVersion } from '@/lib/blizzard/client';
import type { CharacterRef, EndpointSpec } from './types';

// Untrusted payload field reads go through these guards instead of chained
// `as` casts: Blizzard (and the mock) answer JSON whose shape can drift.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export type FetchedEndpoints = {
  payload: Record<string, unknown>;
  endpointErrors: Record<string, string>;
  endpointFailures: Record<string, unknown>;
};

// Fan out every endpoint in parallel: one 404/403 must not sink the whole
// fetch - the failing section is omitted and its error recorded (classic
// endpoints intermittently 403 when data is unavailable; only the profile is
// load-bearing). The caught error instances are kept beside their
// describeError strings so a typed class (NotFoundError) can be rethrown
// across the adapter boundary by requireProfile.
export async function fetchEndpoints(
  ref: CharacterRef,
  version: GameVersion,
  specs: EndpointSpec[],
): Promise<FetchedEndpoints> {
  const endpointErrors: Record<string, string> = {};
  const endpointFailures: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};

  await Promise.all(
    specs.map(async (spec) => {
      try {
        payload[spec.payloadKey] = await blizzardGet<Record<string, unknown>>(
          spec.path,
          {},
          {
            version,
            region: ref.region,
            namespaceKind: spec.namespaceKind,
            ttlClass: spec.ttlClass,
          },
        );
      } catch (err) {
        endpointErrors[spec.payloadKey] = describeError(err);
        endpointFailures[spec.payloadKey] = err;
      }
    }),
  );

  payload._endpointErrors = endpointErrors;
  payload._fetchedVersion = version;

  return { payload, endpointErrors, endpointFailures };
}

// The core profile is the one thing we cannot do without. A profile 404 is
// rethrown as-is so refreshCharacter can classify it as permanent; a generic
// Error would make that check unreachable and the character would be retried
// at tick cadence forever.
export function requireProfile(
  profile: unknown,
  endpointFailures: Record<string, unknown>,
  endpointErrors: Record<string, string>,
): Record<string, unknown> {
  if (isRecord(profile)) return profile;
  if (endpointFailures.profile instanceof NotFoundError) throw endpointFailures.profile;
  const firstError = Object.values(endpointErrors)[0] ?? 'profile fetch failed';
  // cause carries the full error map so a partial fetch failure stays
  // debuggable from the thrown error alone.
  throw new Error(firstError, { cause: { endpointErrors } });
}
