// Mock adapter for MOCK_BLIZZARD=1 (see adapters/index.ts): exercises the whole
// UI without Blizzard API access. Deterministic per character name so cards
// vary - some derive vault slots, some unknown.

import { DEFAULT_SCHEDULES, currentWeekId, parseWeekId } from '@/lib/week';
import type {
  CharacterAdapter,
  CharacterRef,
  FetchedCharacterData,
} from './types';

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const CLASSES = [
  'Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman',
  'Mage', 'Warlock', 'Monk', 'Druid', 'Death Knight', 'Demon Hunter', 'Evoker',
];

const SPECS: Record<string, string[]> = {
  Warrior: ['Arms', 'Fury', 'Protection'],
  Paladin: ['Holy', 'Protection', 'Retribution'],
  Hunter: ['Beast Mastery', 'Marksmanship', 'Survival'],
  Mage: ['Arcane', 'Fire', 'Frost'],
  Priest: ['Discipline', 'Holy', 'Shadow'],
  Druid: ['Balance', 'Feral', 'Guardian', 'Restoration'],
};

const DUNGEONS = [
  'ara-kara-city-of-echoes', 'the-dawnbreaker', 'priory-of-the-sacred-flame',
  'the-ravening-ruin', 'operation-floodgate', 'cinderbrew-meadery',
  'darkflame-cleft', 'the-waterworks',
];

const GUILDS = ['Ashen Order', 'Night Watch', null, null];

// Reset moment of the character's current region week, as epoch ms, used to
// fabricate an M+ period the task engine's alignment check accepts.
function currentPeriodBounds(region: string): { start: number; end: number } {
  const weekId = currentWeekId(region);
  const schedule = DEFAULT_SCHEDULES[region] ?? DEFAULT_SCHEDULES.eu;
  const start = parseWeekId(weekId).getTime() + schedule.resetHourUtc * 3_600_000;
  return { start, end: start + 7 * 86_400_000 };
}

function retailPayload(ref: CharacterRef) {
  const h = hash(ref.nameLower + ref.realmSlug);
  const region = ref.region;
  const bounds = currentPeriodBounds(region);

  // Deterministic variety: ~1 in 5 characters has no keystone profile at all
  // (all M+ tasks derive unknown), the rest have 0..9 distinct dungeons.
  const hasKeystoneData = h % 5 !== 0;
  const runCount = h % 10;
  const runs = Array.from({ length: runCount }, (_, i) => ({
    completed: true,
    dungeon: { name: DUNGEONS[i % DUNGEONS.length], slug: DUNGEONS[i % DUNGEONS.length] },
    keystone_level: 2 + ((h + i) % 10),
  }));

  const characterClass = CLASSES[h % CLASSES.length];
  const spec = (SPECS[characterClass] ?? [null])[h % (SPECS[characterClass]?.length ?? 1)] ?? null;

  return {
    profile: {
      name: ref.nameLower,
      character_class: { name: characterClass },
      active_spec: spec ? { name: spec } : undefined,
      level: 70,
      guild: GUILDS[h % GUILDS.length] ? { name: GUILDS[h % GUILDS.length] } : undefined,
      average_item_level: 590 + (h % 60),
      achievement_points: 30_000 + (h % 5_000),
    },
    equipment: { equipped_items: {} },
    media: { assets: [] },
    achievements: { achievements: [] },
    ...(hasKeystoneData
      ? {
          mythicKeystoneProfile: {
            current_period: {
              period: 1310,
              period_start_timestamp: bounds.start,
              period_end_timestamp: bounds.end,
              runs,
            },
          },
        }
      : {}),
    _mock: true,
  };
}

function classicPayload(ref: CharacterRef) {
  const h = hash(ref.nameLower + ref.realmSlug);
  return {
    profile: {
      name: ref.nameLower,
      character_class: { name: { en_US: CLASSES[h % 9] } },
      level: 60,
      guild: h % 3 === 0 ? { name: { en_US: 'Immortal' } } : undefined,
      average_item_level: null,
      achievement_points: 4_000 + (h % 1_000),
    },
    equipment: { equipped_items: {} },
    media: { assets: [] },
    _mock: true,
  };
}

export const mockAdapter: CharacterAdapter = {
  version: 'retail', // registered for both versions; data branches on ref.gameVersion

  async fetchCharacter(ref: CharacterRef): Promise<FetchedCharacterData> {
    const payload =
      ref.gameVersion === 'classic1x' ? classicPayload(ref) : retailPayload(ref);
    const profile = payload.profile as Record<string, unknown>;

    const characterClass =
      ref.gameVersion === 'classic1x'
        ? ((profile.character_class as { name?: { en_US?: string } })?.name?.en_US ?? null)
        : ((profile.character_class as { name?: string })?.name ?? null);

    return {
      payload: payload as Record<string, unknown>,
      summary: {
        name: ref.nameLower.charAt(0).toUpperCase() + ref.nameLower.slice(1),
        characterClass,
        spec:
          ref.gameVersion === 'retail'
            ? ((profile.active_spec as { name?: string } | undefined)?.name ?? null)
            : null,
        level: (profile.level as number) ?? null,
        guildName:
          (profile.guild as { name?: unknown } | undefined)?.name instanceof Object
            ? ((profile.guild as { name: { en_US?: string } }).name.en_US ?? null)
            : ((profile.guild as { name?: string } | undefined)?.name ?? null),
        ilvl:
          ref.gameVersion === 'retail'
            ? ((profile.average_item_level as number) ?? null)
            : null,
        mplusRating: ref.gameVersion === 'retail' && 'mythicKeystoneProfile' in payload
          ? 1500 + (hash(ref.nameLower) % 2500)
          : null,
        achievementPoints: (profile.achievement_points as number) ?? null,
        portraitUrl: null,
      },
    };
  },
};
