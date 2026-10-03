// Classic Era adapter (classic1x): only the character summary and equipment
// are exposed. Achievements/statistics and keystone data are not available,
// so classic boards are mostly manual checks by design.

import { blizzardGet } from '@/lib/blizzard/client';
import { describeError, NotFoundError } from '@/lib/blizzard/errors';
import type {
  CharacterAdapter,
  CharacterRef,
  EndpointSpec,
  FetchedCharacterData,
} from './types';

type ClassicProfile = {
  name?: string;
  // With locale=en_US Blizzard returns plain strings, not localized objects.
  character_class?: { name?: string };
  level?: number;
  guild?: { name?: string };
  average_item_level?: number;
  achievement_points?: number;
  race?: { name?: string };
};

type MediaPayload = {
  assets?: { key?: string; value?: string }[];
};

function characterEndpoints(ref: CharacterRef): EndpointSpec[] {
  const base = `/profile/wow/character/${ref.realmSlug}/${ref.nameLower}`;
  return [
    { path: base, namespaceKind: 'profile', ttlClass: 'profile', payloadKey: 'profile' },
    { path: `${base}/equipment`, namespaceKind: 'profile', ttlClass: 'profile', payloadKey: 'equipment' },
    { path: `${base}/character-media`, namespaceKind: 'profile', ttlClass: 'static', payloadKey: 'media' },
  ];
}

export const classic1xAdapter: CharacterAdapter = {
  version: 'classic1x',

  async fetchCharacter(ref: CharacterRef): Promise<FetchedCharacterData> {
    const endpointErrors: Record<string, string> = {};
    // The caught error instances, kept beside their describeError strings so a
    // typed class (NotFoundError) can be rethrown across the adapter boundary.
    const endpointFailures: Record<string, unknown> = {};
    const payload: Record<string, unknown> = {};

    await Promise.all(
      characterEndpoints(ref).map(async (spec) => {
        try {
          payload[spec.payloadKey] = (await blizzardGet<Record<string, unknown>>(
            spec.path,
            {},
            {
              version: 'classic1x',
              region: ref.region,
              namespaceKind: spec.namespaceKind,
              ttlClass: spec.ttlClass,
            },
          )) as Record<string, unknown>;
        } catch (err) {
          // Classic endpoints intermittently 403 (data unavailable); only the
          // profile is load-bearing.
          endpointErrors[spec.payloadKey] = describeError(err);
          endpointFailures[spec.payloadKey] = err;
        }
      }),
    );

    const profile = payload.profile as ClassicProfile | undefined;
    if (!profile) {
      // A profile 404 is rethrown as-is so refreshCharacter can classify it as
      // permanent instead of retrying the character at tick cadence forever.
      if (endpointFailures.profile instanceof NotFoundError) throw endpointFailures.profile;
      throw new Error(Object.values(endpointErrors)[0] ?? 'profile fetch failed');
    }

    payload._endpointErrors = endpointErrors;
    payload._fetchedVersion = 'classic1x';

    const media = payload.media as MediaPayload | undefined;
    const portrait = media?.assets?.find((a) => a.key === 'avatar')?.value ?? null;

    return {
      payload,
      summary: {
        name: profile.name ?? ref.nameLower,
        characterClass: profile.character_class?.name ?? null,
        spec: null,
        level: profile.level ?? null,
        guildName: profile.guild?.name ?? null,
        ilvl: typeof profile.average_item_level === 'number' ? profile.average_item_level : null,
        mplusRating: null,
        achievementPoints:
          typeof profile.achievement_points === 'number' ? profile.achievement_points : null,
        portraitUrl: portrait,
      },
    };
  },
};
