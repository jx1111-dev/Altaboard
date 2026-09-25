import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Altaboard — WoW Alt Manager',
  description: 'Weekly reset dashboard for all WoW characters',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-wide text-[var(--accent)]">
            ALTABOARD
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--muted)]">
            <Link href="/" className="hover:text-[var(--text)]">
              Board
            </Link>
            <Link href="/settings" className="hover:text-[var(--text)]">
              Settings
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
