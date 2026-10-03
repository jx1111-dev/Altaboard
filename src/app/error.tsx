'use client';

// Render-time error boundary: an unexpected throw in any Server Component
// lands here instead of Next's unstyled default screen. Renders inside the
// root layout, so the globals.css custom properties are available.

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md space-y-4 rounded-lg border border-[var(--error)]/40 bg-[var(--panel)] p-8 text-center">
        <h1 className="text-lg font-semibold text-[var(--error)]">Something broke</h1>
        <p className="text-sm text-[var(--muted)]">
          The board hit an unexpected error and rendered no data.
          {error.digest ? ` Reference: ${error.digest}` : null}
        </p>
        <button
          onClick={reset}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
