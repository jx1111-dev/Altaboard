'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

type Props = {
  versions: { code: string; label: string }[];
  active: string;
};

export default function VersionTabs({ versions, active }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const currentVersion = params.get('version');

  return (
    <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
      {versions.map((v) => {
        const search = new URLSearchParams(currentVersion ? { version: v.code } : {});
        if (v.code === 'retail') search.delete('version');
        const href = `${pathname}${search.toString() ? `?${search}` : ''}`;
        const isActive = v.code === active;
        return (
          <Link
            key={v.code}
            href={href}
            className={
              'px-4 py-1.5 rounded-md text-sm ' +
              (isActive
                ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-medium'
                : 'text-[var(--muted)] hover:text-[var(--text)]')
            }
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
