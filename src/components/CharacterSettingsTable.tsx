'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Row = {
  id: string;
  name: string;
  gameVersion: string;
  region: string;
  realmSlug: string;
  priority: number;
  groupName: string | null;
};

export default function CharacterSettingsTable({ characters }: { characters: Row[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setSaving(id);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'update failed');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setSaving(null);
    }
  }

  async function archive(id: string) {
    if (!window.confirm('Archive this character? It leaves the board but keeps its snapshots.'))
      return;
    await patch(id, { archived: true });
  }

  if (characters.length === 0) {
    return <p className="text-[var(--muted)]">No characters yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Version</th>
            <th className="py-2 pr-4">Priority</th>
            <th className="py-2 pr-4">Group</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {characters.map((c) => (
            <tr key={c.id} className="border-b border-[var(--border)]/50">
              <td className="py-2 pr-4 font-medium">
                {c.name}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {c.region.toUpperCase()} · {c.realmSlug}
                </span>
              </td>
              <td className="py-2 pr-4 text-[var(--muted)]">{c.gameVersion}</td>
              <td className="py-2 pr-4">
                <input
                  type="number"
                  defaultValue={c.priority}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== c.priority) patch(c.id, { priority: v });
                  }}
                  className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  defaultValue={c.groupName ?? ''}
                  placeholder="—"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== c.groupName) patch(c.id, { groupName: v });
                  }}
                  className="w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
                />
              </td>
              <td className="py-2 pr-4 text-right">
                <button
                  type="button"
                  onClick={() => archive(c.id)}
                  disabled={saving === c.id}
                  className="text-xs text-[var(--muted)] hover:text-[var(--error)] disabled:opacity-40"
                >
                  archive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {saving && <p className="text-xs text-[var(--muted)]">saving…</p>}
    </div>
  );
}
