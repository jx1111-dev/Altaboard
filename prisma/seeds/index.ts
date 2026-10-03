// Static seed data for Altaboard.

// Weekly reset times in UTC. All four regions are verified values and mirror
// the week engine's DEFAULT_SCHEDULES (kept in lockstep by tests/schedules.test.ts).
export const resetSchedules = [
  { region: 'us', resetDow: 2, resetHourUtc: 15 }, // Tuesday 15:00 UTC
  { region: 'eu', resetDow: 3, resetHourUtc: 7 }, // Wednesday 07:00 UTC (primary path)
  { region: 'kr', resetDow: 4, resetHourUtc: 23 }, // Thursday 23:00 UTC
  { region: 'tw', resetDow: 4, resetHourUtc: 23 }, // Thursday 23:00 UTC
];

type SeedTask = {
  gameVersion: string;
  taskKey: string;
  label: string;
  category: string;
  scope: 'weekly' | 'one_time';
  source: string;
  sortOrder: number;
  active?: boolean;
};

const retailTasks: SeedTask[] = [
  // Two adjacent vocabularies, deliberately distinct: taskKey ('vault_mplus_N')
  // names the user-facing catalog row, while the derivation key inside source
  // ('auto:mplus_runs_N') names the engine rule in lib/tasks that derives it.
  // Great Vault M+ slots, derived from mythic-keystone-profile runs.
  {
    gameVersion: 'retail',
    taskKey: 'vault_mplus_1',
    label: 'M+: 1 dungeon for first Vault slot',
    category: 'mplus',
    scope: 'weekly',
    source: 'auto:mplus_runs_1',
    sortOrder: 10,
  },
  {
    gameVersion: 'retail',
    taskKey: 'vault_mplus_4',
    label: 'M+: 4 dungeons for second Vault slot',
    category: 'mplus',
    scope: 'weekly',
    source: 'auto:mplus_runs_4',
    sortOrder: 11,
  },
  {
    gameVersion: 'retail',
    taskKey: 'vault_mplus_8',
    label: 'M+: 8 dungeons for third Vault slot',
    category: 'mplus',
    scope: 'weekly',
    source: 'auto:mplus_runs_8',
    sortOrder: 12,
  },
  // Raid + world rows come from achievements/statistics timestamps where possible;
  // derivations that cannot conclude return "unknown".
  {
    gameVersion: 'retail',
    taskKey: 'vault_raid',
    label: 'Raid: bosses for Vault raid row',
    category: 'raid',
    scope: 'weekly',
    source: 'auto:raid_vault',
    sortOrder: 20,
  },
  {
    gameVersion: 'retail',
    taskKey: 'vault_world',
    label: 'World content for Vault world row',
    category: 'world',
    scope: 'weekly',
    source: 'auto:world_vault',
    sortOrder: 30,
  },
  {
    gameVersion: 'retail',
    taskKey: 'weekly_event',
    label: 'Complete the weekly event quest',
    category: 'other',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 40,
  },
  {
    gameVersion: 'retail',
    taskKey: 'prof_cooldowns',
    label: 'Use weekly profession cooldowns',
    category: 'profession',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 50,
  },
];

const classicTasks: SeedTask[] = [
  // Classic is mostly manual - thin API data degrades to manual checks by design.
  {
    gameVersion: 'classic1x',
    taskKey: 'lockout_mc',
    label: 'Molten Core (clear lockout)',
    category: 'raid',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 10,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'lockout_bwl',
    label: 'Blackwing Lair (clear lockout)',
    category: 'raid',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 11,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'lockout_onyxia',
    label: 'Onyxia (clear lockout)',
    category: 'raid',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 12,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'lockout_aq',
    label: 'Ahn\'Qiraj (AQ20 / AQ40 clear lockout)',
    category: 'raid',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 13,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'lockout_naxx',
    label: 'Naxxramas (clear lockout)',
    category: 'raid',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 14,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'world_azuregos',
    label: 'World boss: Azuregos',
    category: 'world',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 20,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'world_kazzak',
    label: 'World boss: Lord Kazzak',
    category: 'world',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 21,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'attunement_mc',
    label: 'Attunement: Molten Core',
    category: 'attunement',
    scope: 'one_time',
    source: 'manual',
    sortOrder: 30,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'attunement_onyxia',
    label: 'Attunement: Onyxia',
    category: 'attunement',
    scope: 'one_time',
    source: 'manual',
    sortOrder: 31,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'attunement_bwl',
    label: 'Attunement: Blackwing Lair',
    category: 'attunement',
    scope: 'one_time',
    source: 'manual',
    sortOrder: 32,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'attunement_naxx',
    label: 'Attunement: Naxxramas',
    category: 'attunement',
    scope: 'one_time',
    source: 'manual',
    sortOrder: 33,
  },
  {
    gameVersion: 'classic1x',
    taskKey: 'prof_cooldowns',
    label: 'Weekly profession cooldowns',
    category: 'profession',
    scope: 'weekly',
    source: 'manual',
    sortOrder: 40,
  },
];

export const taskCatalog: SeedTask[] = [...retailTasks, ...classicTasks].map((t) => ({
  ...t,
  active: t.active ?? true,
}));

// Demo characters for mock mode (MOCK_BLIZZARD=1): the seed fetches their
// snapshot through the mock adapter. Real (non-mock) seeds never touch them.
export type DemoCharacter = {
  gameVersion: string;
  region: string;
  realmSlug: string;
  name: string;
  groupName?: string;
  priority?: number;
};

export const demoClassicCharacters: DemoCharacter[] = [
  { gameVersion: 'classic1x', region: 'eu', realmSlug: 'mirage-raceway', name: 'Thrag', groupName: 'Raid Core', priority: 10 },
  { gameVersion: 'classic1x', region: 'eu', realmSlug: 'mirage-raceway', name: 'Elowen', groupName: 'Raid Core', priority: 20 },
  { gameVersion: 'classic1x', region: 'eu', realmSlug: 'nethergarde-keep', name: 'Grimwald', groupName: 'Alts', priority: 80 },
  { gameVersion: 'classic1x', region: 'eu', realmSlug: 'patchwerk', name: 'Sylvara', groupName: 'Alts', priority: 90 },
  { gameVersion: 'classic1x', region: 'eu', realmSlug: 'patchwerk', name: 'Borin' },
];
