// Adapter registry — one interface, per-version implementations.

import type { GameVersion } from '@/lib/blizzard/client';
import type { CharacterAdapter } from './types';
import { retailAdapter } from './retail';
import { classic1xAdapter } from './classic1x';

export const adapters: Record<string, CharacterAdapter> = {
  retail: retailAdapter,
  classic1x: classic1xAdapter,
};

export function getAdapter(version: GameVersion): CharacterAdapter {
  const adapter = adapters[version];
  if (!adapter) throw new Error(`No adapter for game version "${version}"`);
  return adapter;
}

export type { CharacterAdapter, CharacterRef, FetchedCharacterData } from './types';
