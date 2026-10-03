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

// Milliseconds to wait before a request may fire (0 = immediately). The token
// is reserved before computing the delay and the balance may go negative:
// every concurrent caller owns a definite future token, so K sleepers wake
// one refill apart instead of all firing together on the same refill.
function delayForRequest(): number {
  const bucketState = bucket();
  const now = Date.now();
  const elapsed = (now - bucketState.lastRefillMs) / 1000;
  bucketState.tokens = Math.min(BURST_CAPACITY, bucketState.tokens + elapsed * REFILL_PER_SECOND);
  bucketState.lastRefillMs = now;

  bucketState.tokens -= 1;
  if (bucketState.tokens >= 0) return 0;
  return Math.ceil((-bucketState.tokens / REFILL_PER_SECOND) * 1000);
}

export async function acquireSlot(): Promise<void> {
  const delay = delayForRequest();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

// Test seam: drop the bucket so the next acquire starts from a fresh full
// burst, exactly like a new process. Only tests should call this.
export function resetForTests(): void {
  globalBucket.bucket = undefined;
}
