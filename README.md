# Altaboard — WoW Alt Manager

A weekly-reset dashboard for all your WoW characters (Retail + Classic Era),
built as a Next.js fullstack app with PostgreSQL, running via Docker Compose.
Single-user, no login.

## Quick start

1. **Prerequisites**: Docker Desktop running; a Blizzard API client from
   [develop.battle.net](https://develop.battle.net) (no redirect URI needed).

2. **Configure**: copy `.env.example` to `.env` and fill in
   `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET`.

3. **Run**:

   ```sh
   docker compose up --build
   ```

   The `migrate` one-shot job applies migrations + seeds, then `web` serves
   http://localhost:3000 and `worker` runs the refresh loop.

### Local development (without Docker)

```sh
npm install
# point DATABASE_URL at a local postgres, e.g.
# postgresql://altaboard:altaboard@localhost:5432/altaboard
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run dev        # web on :3000
npm run worker     # refresh loop (separate terminal)
npm test           # vitest: week + tasks engines
```

## Architecture

- **Next.js App Router (TypeScript)** — pages are Server Components that call
  lib functions directly; `/api/*` route handlers handle mutations and
  client-side fetches.
- **`lib/blizzard`** — client-credentials OAuth (machine token, no user login),
  one cache (PostgreSQL `api_cache`, TTLs: profile 15 min / achievements 2 h /
  media+static 24 h) and one per-process token-bucket rate limiter shared by
  web + worker. Redis upgrade path: replace the two functions in `cache.ts`.
- **`lib/adapters`** — `retail` and `classic1x` behind one interface. Missing
  classic endpoints are omitted; the task engine degrades gracefully.
- **`lib/week`** — reset engine, pure + vitest-tested. `weekKey(region)` = UTC
  date of the most recent reset (US Tue 15:00, EU Wed 07:00 UTC).
- **`lib/tasks`** — `deriveTasks`, pure + vitest-tested. Read-time derivation;
  only user toggles write `task_completions`. `unknown` is a first-class state:
  ambiguous or missing API data is surfaced as "unknown — confirm manually",
  never a wrong ✓/✗.
- **worker** (`worker/index.ts`) — ticks every 10 min: rollover sweep (a
  region's weekKey changed → refresh all its characters) + daily sweep
  (`lastFetchedAt` older than 24 h). Logged to `job_runs`.

## Merge precedence

manual completion row > derived state > unknown. Toggle on → upsert row;
toggle off → delete row (falls back to derived). Auto tasks are never persisted.

## Known limitations (by design)

- **Rename / realm transfer** creates a new character row; history is not
  migrated.
- **Equipment** is stored in snapshots from day one but not displayed on the
  MVP board.
- **No auth** — anyone who can reach the URL can view/edit. Localhost-only
  contract; do not expose publicly without adding an auth layer (future
  migration: users/oauth_tokens tables + session layer).
- **M+ `best_runs`** is known to come back empty from the API — vault slots
  derive from `current_period.runs` instead; an empty runs list means a real
  "not done", and a misaligned/uncoverable period means `unknown`.
- **KR/TW reset hours** are seeded as approximate (Thursday 07:00 UTC); verify
  before actually playing on those regions.
- **Raid/world vault rows** currently derive as `unknown` until verified
  achievements/statistics timestamps are mapped; confirm those rows manually.

## Security

Secrets live only in `.env` (`BLIZZARD_CLIENT_ID/SECRET`, `DATABASE_URL`),
shared by web and worker. All Blizzard calls are server-side.
