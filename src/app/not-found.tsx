import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This page may have belonged to a character that was deleted, or to an
        older deployment. If buttons keep landing here, hard-refresh the page
        (Ctrl+Shift+R) so the browser drops the stale build.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]"
      >
        ← back to board
      </Link>
    </div>
  );
}
