// Retail adapter: profile summary, equipment, media, achievements, statistics
// and mythic-keystone-profile, merged into one snapshot payload.

import { asNumber, fetchEndpoints, isRecord, requireProfile } from './shared';
import type {
  CharacterAdapter,
  CharacterRef,
  EndpointSpec,
  FetchedCharacterData,
} from './types';

type ProfileSummary = {
  name?: string;
  character_class?: { name?: string };
  active_spec?: { name?: string };
  level?: number;
  guild?: { name?: string };
  average_item_level?: number;
  achievement_points?: number;
};

function characterEndpoints(ref: CharacterRef): EndpointSpec[] {
  const base = `/profile/wow/character/${ref.realmSlug}/${ref.nameLower}`;
  return [
    { path: base, namespaceKind: 'profile', ttlClass: 'profile', payloadKey: 'profile' },
    { path: `${base}/equipment`, namespaceKind: 'profile', ttlClass: 'profile', payloadKey: 'equipment' },
    { path: `${base}/character-media`, namespaceKind: 'profile', ttlClass: 'static', payloadKey: 'media' },
    { path: `${base}/achievements`, namespaceKind: 'profile', ttlClass: 'achievements', payloadKey: 'achievements' },
    { path: `${base}/mythic-keystone-profile`, namespaceKind: 'profile', ttlClass: 'profile', payloadKey: 'mythicKeystoneProfile' },
  ];
}

export const retailAdapter: CharacterAdapter = {
  version: 'retail',

  async fetchCharacter(ref: CharacterRef): Promise<FetchedCharacterData> {
    const fetched = await fetchEndpoints(ref, 'retail', characterEndpoints(ref));
    const profile = requireProfile(
      fetched.payload.profile,
      fetched.endpointFailures,
      fetched.endpointErrors,
    ) as ProfileSummary;

    return {
      payload: fetched.payload,
      summary: {
        name: profile.name ?? ref.nameLower,
        characterClass: profile.character_class?.name ?? null,
        spec: profile.active_spec?.name ?? null,
        level: asNumber(profile.level),
        guildName: profile.guild?.name ?? null,
        ilvl: asNumber(profile.average_item_level),
        mplusRating: extractMplusRating(fetched.payload.mythicKeystoneProfile),
        achievementPoints: asNumber(profile.achievement_points),
      },
    };
  },
};

// Take the current (last) season rating; absent or malformed keystone data
// degrades to null (the task engine renders that as unknown).
function extractMplusRating(profile: unknown): number | null {
  const season = isRecord(profile) ? profile.season : null;
  const ratings = isRecord(season) && Array.isArray(season.ratings) ? season.ratings : [];
  const current = ratings[ratings.length - 1];
  return asNumber(isRecord(current) ? current.rating : null);
}
