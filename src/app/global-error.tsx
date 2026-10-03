'use client';

// Last-resort boundary for faults in the root layout itself. It renders
// WITHOUT the layout, so globals.css never loads and the theme vars are
// inlined here instead of referenced.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          background: '#0b0e14',
          color: '#d7dce6',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
          }}
        >
          <div
            style={{
              maxWidth: 420,
              textAlign: 'center',
              border: '1px solid rgba(224, 93, 93, 0.4)',
              background: '#131824',
              borderRadius: 8,
              padding: '2rem',
            }}
          >
            <h1 style={{ color: '#e05d5d', fontSize: '1.05rem', marginTop: 0 }}>
              Altaboard failed to start
            </h1>
            <p style={{ color: '#7d879c', fontSize: '0.875rem' }}>
              {error.digest ? `Reference: ${error.digest}` : 'An unexpected error occurred.'}
            </p>
            <button
              onClick={reset}
              style={{
                border: '1px solid #232b3d',
                borderRadius: 6,
                background: 'transparent',
                color: '#d7dce6',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
