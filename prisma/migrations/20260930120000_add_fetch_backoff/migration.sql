-- Transient-failure backoff for the refresh loop: fetchFailures counts
-- consecutive transient failures and nextAttemptAt defers the next attempt
-- (exponential, see refreshCharacter in lib/board). The worker's daily sweep
-- skips characters whose nextAttemptAt is still in the future, so a failing
-- character no longer retries on every 10-minute tick.

ALTER TABLE "Character" ADD COLUMN "fetchFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
