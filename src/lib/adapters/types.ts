// Adapter interface — one shape for every game version.
// Each adapter fetches the raw endpoints it can for its version and returns a
// merged payload stored in character_snapshots.payload. Missing endpoints are
// simply absent from the payload; the task engine degrades to 'unknown'.

import type { GameVersion, NamespaceKind, Region } from '@/lib/blizzard/client';

export type CharacterRef = {
  gameVersion: GameVersion;
  region: Region;
  realmSlug: string;
  nameLower: string;
};

export type FetchedCharacterData = {
  payload: Record<string, unknown>;
  summary: {
    name: string;
    characterClass: string | null;
    spec: string | null;
    level: number | null;
    guildName: string | null;
    ilvl: number | null;
    mplusRating: number | null;
    achievementPoints: number | null;
    portraitUrl: string | null;
  };
};

export type CharacterAdapter = {
  version: GameVersion;
  /**
   * Fetch all available raw data for a character. Endpoints are fetched
   * independently: one 404/403 must not sink the whole fetch — the failing
   * section is omitted and the error recorded.
   */
  fetchCharacter(ref: CharacterRef): Promise<FetchedCharacterData>;
};

export type EndpointSpec = {
  path: string;
  namespaceKind: NamespaceKind;
  ttlClass: 'profile' | 'achievements' | 'static';
  payloadKey: string;
};
