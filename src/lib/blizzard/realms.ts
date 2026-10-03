// Realm resolution for the add-character form autocomplete: fetches the
// realm-index endpoint per game version so realm slugs resolve automatically.

import { blizzardGet } from './client';

export type RealmEntry = { name: string; slug: string; type?: string };

// With locale=en_US both retail and classic realm indexes carry plain strings,
// so one payload type and one read path serve both versions.
type RealmIndex = {
  realms?: { name?: string; slug?: string; type?: { name?: string } }[];
};

export async function fetchRealms(
  version: 'retail' | 'classic1x',
  region: 'us' | 'eu' | 'kr' | 'tw',
): Promise<RealmEntry[]> {
  const data = await blizzardGet<RealmIndex>(
    '/data/wow/realm/index',
    {},
    { version, region, namespaceKind: 'dynamic', ttlClass: 'static' },
  );
  return (data.realms ?? [])
    .filter((r) => r.slug && r.name)
    .map((r) => ({ name: r.name!, slug: r.slug!, type: r.type?.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
