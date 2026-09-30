// Regression test for F-4: concurrent acquires must each own a definite
// future token (waking one refill apart, ~111 ms at 9 req/s), not all fire
// together on the same refill as the pre-fix read-modify-write did.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireSlot } from '@/lib/blizzard/rateLimiter';

// The bucket is per-process module state on globalThis; reset it so each test
// starts from a full burst.
function resetBucket(): void {
  (globalThis as unknown as { bucket?: unknown }).bucket = undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetBucket();
});

afterEach(() => {
  vi.useRealTimers();
  resetBucket();
});

describe('acquireSlot under concurrency', () => {
  it('fires the 60-token burst immediately, then serializes one refill apart', async () => {
    const fired: number[] = [];
    const acquires = Array.from({ length: 63 }, () =>
      acquireSlot().then(() => fired.push(Date.now())),
    );

    // Burst capacity is free - flush the microtask queue, nothing sleeps.
    await vi.advanceTimersByTimeAsync(0);
    expect(fired).toHaveLength(60);

    // Acquires 61..63 own future tokens and wake one at a time: 112, 223,
    // 334 ms after the burst. The old behavior fired all three together at
    // 112 ms (asserting 61 here is the regression check).
    await vi.advanceTimersByTimeAsync(112);
    expect(fired).toHaveLength(61);

    await vi.advanceTimersByTimeAsync(111);
    expect(fired).toHaveLength(62);

    await vi.advanceTimersByTimeAsync(112);
    expect(fired).toHaveLength(63);

    // Spacing between the deferred wakes is one refill period (1/9 s ~ 111 ms).
    const late = fired.slice(60);
    expect(late[1] - late[0]).toBeGreaterThanOrEqual(100);
    expect(late[1] - late[0]).toBeLessThanOrEqual(115);
    expect(late[2] - late[1]).toBeGreaterThanOrEqual(100);
    expect(late[2] - late[1]).toBeLessThanOrEqual(115);

    await Promise.all(acquires);
  });
});
