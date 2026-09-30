// Retail adapter: profile summary, equipment, media, achievements, statistics
// and mythic-keystone-profile, merged into one snapshot payload.

import { blizzardGet } from '@/lib/blizzard/client';
import { describeError, NotFoundError } from '@/lib/blizzard/errors';
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

// equipped_items is an array of equipped items, each with its slot and ilvl.
type EquippedItem = {
  slot?: { type?: string };
  item_level?: { display_value?: string };
};

type EquipmentPayload = {
  equipped_items?: EquippedItem[];
};

type MediaPayload = {
  assets?: { key?: string; value?: string }[];
};

type MplusProfile = {
  current_period?: unknown;
  season?: { slots?: unknown[]; best_runs?: unknown[] };
};

type EndpointResponse = ProfileSummary | EquipmentPayload | MediaPayload | MplusProfile | Record<string, unknown>;

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
    const endpointErrors: Record<string, string> = {};
    // The caught error instances, kept beside their describeError strings so a
    // typed class (NotFoundError) can be rethrown across the adapter boundary.
    const endpointFailures: Record<string, unknown> = {};
    const payload: Record<string, unknown> = {};

    await Promise.all(
      characterEndpoints(ref).map(async (spec) => {
        try {
          payload[spec.payloadKey] = (await blizzardGet<EndpointResponse>(
            spec.path,
            {},
            {
              version: 'retail',
              region: ref.region,
              namespaceKind: spec.namespaceKind,
              ttlClass: spec.ttlClass,
            },
          )) as Record<string, unknown>;
        } catch (err) {
          endpointErrors[spec.payloadKey] = describeError(err);
          endpointFailures[spec.payloadKey] = err;
        }
      }),
    );

    const profile = payload.profile as ProfileSummary | undefined;
    if (!profile) {
      // The core profile is the one thing we cannot do without. A profile 404
      // is rethrown as-is so refreshCharacter can classify it as permanent; a
      // generic Error would make that check unreachable and the character
      // would be retried at tick cadence forever.
      if (endpointFailures.profile instanceof NotFoundError) throw endpointFailures.profile;
      const firstError = Object.values(endpointErrors)[0] ?? 'profile fetch failed';
      throw new Error(firstError, { cause: { endpointErrors } });
    }

    payload._endpointErrors = endpointErrors;
    payload._fetchedVersion = 'retail';

    const media = payload.media as MediaPayload | undefined;
    const portrait =
      media?.assets?.find((a) => a.key === 'avatar')?.value ??
      media?.assets?.find((a) => a.key === 'inset')?.value ??
      null;

    return {
      payload,
      summary: {
        name: profile.name ?? ref.nameLower,
        characterClass: profile.character_class?.name ?? null,
        spec: profile.active_spec?.name ?? null,
        level: profile.level ?? null,
        guildName: profile.guild?.name ?? null,
        ilvl: typeof profile.average_item_level === 'number' ? profile.average_item_level : null,
        mplusRating: extractMplusRating(payload.mythicKeystoneProfile as MplusProfile | undefined),
        achievementPoints: profile.achievement_points ?? null,
        portraitUrl: portrait,
      },
    };
  },
};

function extractMplusRating(profile: MplusProfile | undefined): number | null {
  const rating = (profile?.season as { ratings?: { rating?: number }[] } | undefined)?.ratings;
  if (Array.isArray(rating)) {
    // take the current (last) season rating
    const current = rating[rating.length - 1];
    if (typeof current?.rating === 'number') return current.rating;
  }
  return null;
}
