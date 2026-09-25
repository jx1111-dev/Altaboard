import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCharacterHistory } from '@/lib/board';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
};

function Delta({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-[var(--muted)]">—</span>;
  const color =
    value > 0 ? 'text-[var(--done)]' : value < 0 ? 'text-[var(--error)]' : 'text-[var(--muted)]';
  return (
    <span className={color}>
      {value > 0 ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

export default async function CharacterPage({ params }: Props) {
  const { id } = await params;
  const data = await getCharacterHistory(id);
  if (!data) notFound();

  const { character, history } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
          ← back to board
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {character.name}{' '}
          <span className="text-sm font-normal text-[var(--muted)]">
            {character.gameVersion} · {character.region.toUpperCase()} · {character.realmSlug}
          </span>
        </h1>
      </div>

      {history.length === 0 ? (
        <p className="text-[var(--muted)]">
          No snapshots yet. Hit refresh on the board or wait for the worker.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <th className="py-2 pr-4">Week</th>
              <th className="py-2 pr-4">Captured</th>
              <th className="py-2 pr-4">ilvl</th>
              <th className="py-2 pr-4">M+ rating</th>
              <th className="py-2 pr-4">Ach. points</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.weekKey} className="border-b border-[var(--border)]/50">
                <td className="py-2 pr-4 font-medium">{entry.weekKey}</td>
                <td className="py-2 pr-4 text-[var(--muted)]">
                  {new Date(entry.capturedAt).toLocaleString()}
                </td>
                <td className="py-2 pr-4">
                  {entry.ilvl ?? '—'} <Delta value={entry.deltas.ilvl} />
                </td>
                <td className="py-2 pr-4">
                  {entry.mplusRating ?? '—'} <Delta value={entry.deltas.mplusRating} />
                </td>
                <td className="py-2 pr-4">
                  {entry.achievementPoints ?? '—'}{' '}
                  <Delta value={entry.deltas.achievementPoints} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
