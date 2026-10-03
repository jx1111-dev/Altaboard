'use client';

import { useState, useTransition } from 'react';
import type { BoardTask } from '@/lib/board';
import { responseErrorMessage } from '@/lib/fetchJson';

type Props = {
  characterId: string;
  tasks: BoardTask[];
};

type VisualState = 'done' | 'not_done' | 'unknown' | 'manual_unset';

// One entry per visual state; the 4-level className ternaries these replace
// were unreadable at review distance.
const STATE_STYLES: Record<VisualState, { box: string; label: string }> = {
  done: {
    box: 'border-[var(--done)] bg-[var(--done)]/20 text-[var(--done)]',
    label: 'text-[var(--text)]',
  },
  not_done: {
    box: 'border-[var(--not-done)] text-transparent',
    label: 'text-[var(--muted)]',
  },
  unknown: {
    box: 'border-[var(--unknown)] text-[var(--unknown)]',
    label: 'text-[var(--unknown)]',
  },
  manual_unset: {
    box: 'border-dashed border-[var(--not-done)] text-transparent',
    label: 'text-[var(--muted)]',
  },
};

// Task checklist on the character card. Legend:
// auto tasks: derived-done shows a checkmark, derived-not-done a blank box,
// unknown a "?", manual tasks show a dashed unchecked box until toggled.
// Every row is clickable: toggle on persists a user override for ANY task
// (auto rows included, e.g. to resolve an unknown or correct a wrong ✓),
// toggle off deletes the override and falls back to the derived state.
// Clearing a derived-done checkmark has no override to delete, so it
// persists an explicit not-done row instead, keeping the correction on
// reload.
export default function TaskChecklist({ characterId, tasks }: Props) {
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function toggle(task: BoardTask) {
    // Compute from the effective displayed state, not just the override map:
    // a derived-done checkmark must toggle off on the first click too.
    const currentlyOn = overrides[task.taskKey] ?? task.state === 'done';
    const nextOn = !currentlyOn;

    setOverrides((prev) => ({ ...prev, [task.taskKey]: nextOn }));
    setErrors((prev) => {
      if (!(task.taskKey in prev)) return prev;
      const copy = { ...prev };
      delete copy[task.taskKey];
      return copy;
    });

    startTransition(async () => {
      try {
        const res = await fetch('/api/task-completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId, taskKey: task.taskKey, on: nextOn }),
        });
        if (!res.ok) {
          throw new Error(await responseErrorMessage(res, 'toggle failed'));
        }
      } catch (err) {
        // Revert the optimistic flip and say why, silent reverts read as
        // "the click did nothing".
        setOverrides((prev) => {
          const copy = { ...prev };
          delete copy[task.taskKey];
          return copy;
        });
        setErrors((prev) => ({ ...prev, [task.taskKey]: (err as Error).message }));
      }
    });
  }

  function visualState(task: BoardTask): VisualState {
    if (task.taskKey in overrides) {
      return overrides[task.taskKey] ? 'done' : task.source === 'manual' ? 'manual_unset' : 'not_done';
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
                  STATE_STYLES[state].box
                }
              >
                {mark}
              </span>
              <span className={STATE_STYLES[state].label}>{task.label}</span>
            </button>
            {errors[task.taskKey] && (
              <p className="pl-7 text-xs text-[var(--error)]">{errors[task.taskKey]}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
