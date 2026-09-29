// Realm resolution for the add-character form autocomplete: fetches the
// realm-index endpoint per game version so realm slugs resolve automatically.

import { blizzardGet } from './client';

export type RealmEntry = { name: string; slug: string; type?: string };

type RetailRealmIndex = {
  realms?: { name?: string; slug?: string; type?: { name?: string } }[];
};

type ClassicRealmIndex = {
  realms?: {
    name?: { en_US?: string };
    slug?: string;
    type?: { name?: { en_US?: string } };
  }[];
};

export async function fetchRealms(
  version: 'retail' | 'classic1x',
  region: 'us' | 'eu' | 'kr' | 'tw',
): Promise<RealmEntry[]> {
  if (version === 'classic1x') {
    const data = await blizzardGet<ClassicRealmIndex>(
      '/data/wow/realm/index',
      {},
      { version, region, namespaceKind: 'dynamic', ttlClass: 'static' },
    );
    return (data.realms ?? [])
      .filter((r) => r.slug && r.name?.en_US)
      .map((r) => ({
        name: r.name!.en_US!,
        slug: r.slug!,
        type: r.type?.name?.en_US,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const data = await blizzardGet<RetailRealmIndex>(
    '/data/wow/realm/index',
    {},
    { version, region, namespaceKind: 'dynamic', ttlClass: 'static' },
  );
  return (data.realms ?? [])
    .filter((r) => r.slug && r.name)
    .map((r) => ({ name: r.name!, slug: r.slug!, type: r.type?.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
