// @vitest-environment jsdom
// Regression test for F-2: a derived-done checkmark must clear on the FIRST
// click (POST on: false). The old toggle gate made the first click a no-op
// that wrote a redundant done=true row, so a wrong derived checkmark could
// never be corrected.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskChecklist from '@/components/TaskChecklist';
import type { BoardTask } from '@/lib/board';

function task(overrides: Partial<BoardTask>): BoardTask {
  return {
    taskKey: 'vault_mplus_1',
    label: 'M+ slot 1',
    category: 'mplus',
    scope: 'weekly',
    source: 'auto:mplus_runs_1',
    state: 'done',
    manuallySet: false,
    ...overrides,
  };
}

// The component posts to /api/task-completions; capture what it sends.
function stubToggleApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function lastPostedBody(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, { body?: string } | undefined];
  expect(url).toBe('/api/task-completions');
  return JSON.parse(init?.body ?? '{}');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskChecklist toggling', () => {
  it('first click on a derived-done checkmark posts on: false (F-2)', async () => {
    const fetchMock = stubToggleApi();
    render(<TaskChecklist characterId="c1" tasks={[task({ state: 'done' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /M\+ slot 1/ }));

    expect(await lastPostedBody(fetchMock)).toEqual({
      characterId: 'c1',
      taskKey: 'vault_mplus_1',
      on: false,
    });
  });

  it('second click on a derived-done checkmark re-marks it (on: true)', async () => {
    const fetchMock = stubToggleApi();
    render(<TaskChecklist characterId="c1" tasks={[task({ state: 'done' })]} />);
    const button = screen.getByRole('button', { name: /M\+ slot 1/ });

    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(button);

    expect(await lastPostedBody(fetchMock)).toEqual({
      characterId: 'c1',
      taskKey: 'vault_mplus_1',
      on: true,
    });
  });

  it('first click on a derived-not-done row posts on: true (unchanged behavior)', async () => {
    const fetchMock = stubToggleApi();
    render(<TaskChecklist characterId="c1" tasks={[task({ state: 'not_done' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /M\+ slot 1/ }));

    expect(await lastPostedBody(fetchMock)).toEqual({
      characterId: 'c1',
      taskKey: 'vault_mplus_1',
      on: true,
    });
  });
});
