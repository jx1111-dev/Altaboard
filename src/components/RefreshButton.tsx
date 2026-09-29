'use client';

import { useState, useTransition } from 'react';

type Props = {
  characterId: string | null;
  characterIds?: string[]; // when characterId is null, refresh every id in this list
  label: string;
};

// Bounded so the shared rate limiter absorbs bursts instead of tripping 429s.
const CONCURRENCY = 4;

export default function RefreshButton({ characterId, characterIds, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  async function refresh() {
    setBusy(true);
    setFailed(null);
    try {
      const ids = characterId ? [characterId] : (characterIds ?? []);
      // Simple worker pool over a shared cursor - concurrency 4, no deps.
      let cursor = 0;
      let failures = 0;
      const worker = async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          const res = await fetch(`/api/characters/${id}/refresh`, { method: 'POST' });
          if (!res.ok) failures += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

      if (failures > 0) {
        setFailed(failures);
        // Hold the notice a beat before the reload wipes it; failures also
        // show as error badges on the affected cards.
        setTimeout(() => startTransition(() => window.location.reload()), 1500);
      } else {
        startTransition(() => {
          window.location.reload();
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40"
      >
        {busy ? 'Refreshing…' : label}
      </button>
      {failed !== null && failed > 0 && (
        <span className="text-xs text-[var(--error)]">{failed} failed</span>
      )}
    </span>
  );
}
