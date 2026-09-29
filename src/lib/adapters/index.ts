// Adapter registry - one interface, per-version implementations.

import type { GameVersion } from '@/lib/blizzard/client';
import type { CharacterAdapter } from './types';
import { retailAdapter } from './retail';
import { classic1xAdapter } from './classic1x';
import { mockAdapter } from './mock';

export const MOCK_BLIZZARD = process.env.MOCK_BLIZZARD === '1';

function adapters(): Record<string, CharacterAdapter> {
  return MOCK_BLIZZARD
    ? { retail: mockAdapter, classic1x: mockAdapter }
    : { retail: retailAdapter, classic1x: classic1xAdapter };
}

export function getAdapter(version: GameVersion): CharacterAdapter {
  const adapter = adapters()[version];
  if (!adapter) throw new Error(`No adapter for game version "${version}"`);
  return adapter;
}

export type { CharacterAdapter, CharacterRef, FetchedCharacterData } from './types';
