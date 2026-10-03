// Classic Era adapter (classic1x): only the character summary and equipment
// are exposed. Achievements/statistics and keystone data are not available,
// so classic boards are mostly manual checks by design.

import { asNumber, fetchEndpoints, requireProfile } from './shared';
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
    const fetched = await fetchEndpoints(ref, 'classic1x', characterEndpoints(ref));
    const profile = requireProfile(
      fetched.payload.profile,
      fetched.endpointFailures,
      fetched.endpointErrors,
    ) as ClassicProfile;

    return {
      payload: fetched.payload,
      summary: {
        name: profile.name ?? ref.nameLower,
        characterClass: profile.character_class?.name ?? null,
        spec: null,
        level: asNumber(profile.level),
        guildName: profile.guild?.name ?? null,
        ilvl: asNumber(profile.average_item_level),
        mplusRating: null,
        achievementPoints: asNumber(profile.achievement_points),
      },
    };
  },
};
