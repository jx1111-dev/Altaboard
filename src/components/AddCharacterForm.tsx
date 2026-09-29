'use client';

import { useEffect, useState } from 'react';

type Props = {
  defaultVersion: string;
  defaultRegion: string;
};

type Realm = { name: string; slug: string };

export default function AddCharacterForm({ defaultVersion, defaultRegion }: Props) {
  const [version, setVersion] = useState(defaultVersion);
  const [region, setRegion] = useState(defaultRegion);
  const [name, setName] = useState('');
  const [realmSlug, setRealmSlug] = useState('');
  const [realms, setRealms] = useState<Realm[]>([]);
  const [realmQuery, setRealmQuery] = useState('');
  const [loadingRealms, setLoadingRealms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load realm list for autocomplete whenever version/region changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingRealms(true);
    fetch(`/api/realms?version=${version}&region=${region}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'realm fetch failed');
        return res.json();
      })
      .then((data: { realms: Realm[] }) => {
        if (!cancelled) {
          setRealms(data.realms);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Could not load realms: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingRealms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version, region]);

  const filtered = realms
    .filter((r) => r.name.toLowerCase().includes(realmQuery.toLowerCase()))
    .slice(0, 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, realmSlug, region, gameVersion: version }),
      });
      // A proxy/HTML error page has no JSON body - never trust res.json().
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'add failed');
      } else {
        setMessage(
          data.refresh?.ok
            ? `${data.character.name} added and fetched.`
            : `${data.character.name} added, but the first fetch failed: ${data.refresh?.error ?? 'unknown error'}`,
        );
        setName('');
        setRealmQuery('');
        setRealmSlug('');
        // Reload so the server-rendered board picks up the new character.
        setTimeout(() => window.location.reload(), 800);
      }
    } catch {
      setError('add failed - network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        Version
        <select
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
        >
          <option value="retail">Retail</option>
          <option value="classic1x">Classic</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        Region
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
        >
          <option value="eu">EU</option>
          <option value="us">US</option>
          <option value="kr">KR</option>
          <option value="tw">TW</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        Character name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Thrall"
          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] w-36"
        />
      </label>

      <div className="relative flex flex-col gap-1 text-xs text-[var(--muted)]">
        Realm
        <input
          value={realmSlug ? realms.find((r) => r.slug === realmSlug)?.name ?? realmSlug : realmQuery}
          onChange={(e) => {
            setRealmQuery(e.target.value);
            setRealmSlug('');
          }}
          required
          placeholder={loadingRealms ? 'loading realms…' : 'pick a realm'}
          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] w-48"
        />
        {realmQuery && !realmSlug && filtered.length > 0 && (
          <ul className="absolute z-10 top-full mt-1 w-64 max-h-56 overflow-auto rounded border border-[var(--border)] bg-[var(--panel)] shadow-lg">
            {filtered.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => {
                    setRealmSlug(r.slug);
                    setRealmQuery(r.name);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--accent)]/10"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting || !realmSlug || !name}
        className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
      >
        {submitting ? 'Adding…' : 'Add character'}
      </button>

      {message && <span className="text-xs text-[var(--done)]">{message}</span>}
      {error && <span className="text-xs text-[var(--error)]">{error}</span>}
    </form>
  );
}
