// Per-process token-bucket rate limiter. Blizzard's quota is ~36,000
// requests/hour (10 req/s sustained). Web and worker are separate processes,
// so each runs its own bucket; combined they stay under quota for realistic
// single-user loads. Shared Redis bucket if multi-instance ever happens.

const REFILL_PER_SECOND = 9; // slightly under the 10/s quota, headroom for bursts
const BURST_CAPACITY = 60;

type Bucket = { tokens: number; lastRefillMs: number };

const globalBucket = globalThis as unknown as { bucket?: Bucket };

function bucket(): Bucket {
  if (!globalBucket.bucket) {
    globalBucket.bucket = { tokens: BURST_CAPACITY, lastRefillMs: Date.now() };
  }
  return globalBucket.bucket;
}

// Milliseconds to wait before a request may fire (0 = immediately).
function delayForRequest(): number {
  const b = bucket();
  const now = Date.now();
  const elapsed = (now - b.lastRefillMs) / 1000;
  b.tokens = Math.min(BURST_CAPACITY, b.tokens + elapsed * REFILL_PER_SECOND);
  b.lastRefillMs = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return 0;
  }

  const deficit = 1 - b.tokens;
  b.tokens = 0;
  return Math.ceil((deficit / REFILL_PER_SECOND) * 1000);
}

export async function acquireSlot(): Promise<void> {
  const delay = delayForRequest();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
