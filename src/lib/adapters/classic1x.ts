// Classic Era adapter (classic1x): only the character summary and equipment
// are exposed. Achievements/statistics and keystone data are not available,
// so classic boards are mostly manual checks by design.

import { blizzardGet } from '@/lib/blizzard/client';
import type {
  CharacterAdapter,
  CharacterRef,
  EndpointSpec,
  FetchedCharacterData,
} from './types';
import { describeError } from './retail';

type ClassicProfile = {
  name?: string;
  character_class?: { name?: { en_US?: string } };
  level?: number;
  guild?: { name?: { en_US?: string } };
  average_item_level?: number;
  achievement_points?: number;
  race?: { name?: { en_US?: string } };
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
        }
      }),
    );

    const profile = payload.profile as ClassicProfile | undefined;
    if (!profile) {
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
        characterClass: profile.character_class?.name?.en_US ?? null,
        spec: null,
        level: profile.level ?? null,
        guildName: profile.guild?.name?.en_US ?? null,
        ilvl: typeof profile.average_item_level === 'number' ? profile.average_item_level : null,
        mplusRating: null,
        achievementPoints:
          typeof profile.achievement_points === 'number' ? profile.achievement_points : null,
        portraitUrl: portrait,
      },
    };
  },
};
