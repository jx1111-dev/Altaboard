'use client';

import { useState, useTransition } from 'react';

type Props = {
  characterId: string | null;
  characterIds?: string[]; // when characterId is null, refresh every id in this list
  label: string;
};

export default function RefreshButton({ characterId, characterIds, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function refresh() {
    setBusy(true);
    try {
      const ids = characterId ? [characterId] : (characterIds ?? []);
      for (const id of ids) {
        await fetch(`/api/characters/${id}/refresh`, { method: 'POST' });
      }
      startTransition(() => {
        window.location.reload();
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={busy}
      className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40"
    >
      {busy ? 'Refreshing…' : label}
    </button>
  );
}
