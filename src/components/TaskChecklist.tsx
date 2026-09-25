'use client';

import { useState, useTransition } from 'react';
import type { BoardTask } from '@/lib/board';

type Props = {
  characterId: string;
  tasks: BoardTask[];
};

/**
 * Task checklist on the character card.
 * - auto tasks: ✓ derived-done, ✗/blank derived-not-done, "?" unknown
 * - manual tasks: unchecked box (⧄) until toggled
 * - toggle on → persist manual row; toggle off → delete row (falls back to
 *   derived state)
 */
export default function TaskChecklist({ characterId, tasks }: Props) {
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<Record<string, boolean>>({});

  async function toggle(task: BoardTask) {
    const isManualSet = task.manuallySet || task.taskKey in local;
    const currentlyOn = isManualSet
      ? (local[task.taskKey] ?? task.state === 'done')
      : false;
    const nextOn = !currentlyOn;

    setLocal((prev) => ({ ...prev, [task.taskKey]: nextOn }));

    startTransition(() => {
      fetch('/api/task-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, taskKey: task.taskKey, on: nextOn }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
        })
        .catch(() => {
          setLocal((prev) => {
            const copy = { ...prev };
            delete copy[task.taskKey];
            return copy;
          });
        });
    });
  }

  function visualState(task: BoardTask): 'done' | 'not_done' | 'unknown' | 'manual_unset' {
    if (task.taskKey in local) {
      return local[task.taskKey] ? 'done' : task.source === 'manual' ? 'manual_unset' : 'not_done';
    }
    if (task.manuallySet) return task.state === 'done' ? 'done' : 'not_done';
    if (task.source === 'manual') return 'manual_unset';
    return task.state === 'done' ? 'done' : task.state === 'unknown' ? 'unknown' : 'not_done';
  }

  if (tasks.length === 0) return null;

  return (
    <ul className="space-y-0.5 text-sm">
      {tasks.map((task) => {
        const state = visualState(task);
        const mark = state === 'done' ? '✓' : state === 'unknown' ? '?' : '';
        return (
          <li key={task.taskKey}>
            <button
              type="button"
              onClick={() => toggle(task)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-white/5"
              title={
                state === 'unknown'
                  ? 'Unknown — confirm manually'
                  : state === 'manual_unset' || state === 'not_done'
                    ? 'Not done — click to mark done'
                    : 'Done — click to clear'
              }
            >
              <span
                className={
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold ' +
                  (state === 'done'
                    ? 'border-[var(--done)] bg-[var(--done)]/20 text-[var(--done)]'
                    : state === 'unknown'
                      ? 'border-[var(--unknown)] text-[var(--unknown)]'
                      : state === 'manual_unset'
                        ? 'border-dashed border-[var(--not-done)] text-transparent'
                        : 'border-[var(--not-done)] text-transparent')
                }
              >
                {mark}
              </span>
              <span
                className={
                  state === 'done'
                    ? 'text-[var(--text)]'
                    : state === 'unknown'
                      ? 'text-[var(--unknown)]'
                      : 'text-[var(--muted)]'
                }
              >
                {task.label}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
