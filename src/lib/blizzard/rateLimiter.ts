// Per-process token-bucket rate limiter.
//
// Blizzard's quota is ~36,000 requests/hour (= 10 req/s sustained). Web and
// worker are separate processes, so each runs this bucket; the combined budget
// stays under quota for realistic single-user loads.
//
// Upgrade path (documented): move to a shared Redis-backed bucket
// (e.g. GCRA / redis-cell) when multi-instance becomes a reality.

const REFILL_PER_SECOND = 9; // slightly under the 10/s quota, headroom for bursts
const BURST_CAPACITY = 60;

type Bucket = { tokens: number; lastRefillMs: number };

const globalForLimiter = globalThis as unknown as { __altaboardBucket?: Bucket };

function bucket(): Bucket {
  if (!globalForLimiter.__altaboardBucket) {
    globalForLimiter.__altaboardBucket = { tokens: BURST_CAPACITY, lastRefillMs: Date.now() };
  }
  return globalForLimiter.__altaboardBucket;
}

export class RateLimiter {
  constructor(
    private readonly refillPerSecond = REFILL_PER_SECOND,
    private readonly capacity = BURST_CAPACITY,
  ) {}

  /** Milliseconds to wait before a request may fire (0 = immediately). */
  delayForRequest(): number {
    const b = bucket();
    const now = Date.now();
    const elapsed = (now - b.lastRefillMs) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.lastRefillMs = now;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }

    const deficit = 1 - b.tokens;
    b.tokens = 0;
    return Math.ceil((deficit / this.refillPerSecond) * 1000);
  }

  /** Test helper / maintenance: current token count. */
  availableTokens(): number {
    const b = bucket();
    const now = Date.now();
    const elapsed = (now - b.lastRefillMs) / 1000;
    return Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
  }
}

// Shared limiter instances (web + worker each get one per process).
export const blizzardLimiter = new RateLimiter();

export async function acquireSlot(): Promise<void> {
  const delay = blizzardLimiter.delayForRequest();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
