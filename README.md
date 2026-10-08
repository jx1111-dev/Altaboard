# Altaboard, WoW Alt Manager

A weekly-reset dashboard for all your WoW characters (Retail + Classic Era),
built as a Next.js fullstack app with PostgreSQL, running via Docker Compose.
Single-user, no login.

## Screenshots

The board: per-character task cards mixing derived checkmarks, manual rows
(dashed) and `unknown` states (?), with snapshot stats and fetch errors.

![The weekly board with per-character task cards](public/screenshots/board.png)

Per-character snapshot history, one row per reset week with deltas:

![Character history with week-over-week deltas](public/screenshots/character.png)

Settings: priority ordering, group names, archiving.

![Settings table with priorities and groups](public/screenshots/settings.png)

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

   > **After code changes, always include `--build`** (or run
   > `docker compose build` first): a plain `docker compose up` reuses the
   > previously built image and keeps serving the old code. Hard-refresh the
   > browser (Ctrl+Shift+R) afterwards so an open tab drops the old build.

### Local development (without Docker)

```sh
npm install
# point DATABASE_URL at a local postgres, e.g.
# postgresql://altaboard:altaboard@localhost:5432/altaboard
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run dev        # web on :3000
npm run worker     # refresh loop (separate terminal)
npm test           # vitest: week + tasks engines, seed/engine schedule pin,
                   # adapters (NotFoundError regression + locale), rate
                   # limiter, TaskChecklist UI, board service
                   # (refreshCharacter permanence/backoff), http isSameOrigin
                   # gate, characters route 404/500 semantics, task-completions
                   # weekId derivation, worker rollover
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (flat config, next/core-web-vitals)
```

Note on running without Docker: the dev script is plain `next dev`, which does
not restrict the host — the dev server binds non-loopback interfaces, so other
machines on the LAN can reach it. The same-origin gate in `src/lib/http.ts`
requires a loopback Host header, so mutations coming from LAN origins get a
403 (GETs are unaffected). The compose `web` service binds `127.0.0.1:3000`
only.

## Architecture

- **Next.js App Router (TypeScript)**, pages are Server Components that call
  lib functions directly; `/api/*` route handlers handle mutations and
  client-side fetches.
- **`lib/blizzard`**, client-credentials OAuth (machine token, no user login),
  one cache (PostgreSQL `api_cache`, TTLs: profile 15 min / achievements 2 h /
  media+static 24 h) and a rate limiter: one module with two independent
  per-process token buckets, one in the web process and one in the worker,
  they do not share state. Redis upgrade path: replace the two functions in
  `cache.ts`.
- **`lib/adapters`**, `retail` and `classic1x` behind one interface. Missing
  classic endpoints are omitted; the task engine degrades gracefully.
- **`lib/week`**, reset engine, pure + vitest-tested. `weekId(region)` = UTC
  date of the most recent reset (US Tue 15:00, EU Wed 07:00, KR/TW Thu 23:00
  UTC). `npx tsx scripts/verify-reset-times.ts` checks those constants
  against the live M+ period index per region (one-time run; needs Blizzard
  credentials and a reachable database); change the constants only on that
  evidence.
- **`lib/tasks`**, `deriveTasks`, pure + vitest-tested. Read-time derivation;
  only user toggles write `task_completions`. `unknown` is a first-class state:
  ambiguous or missing API data is surfaced as "unknown, confirm manually",
  never a wrong ✓/✗.
- **worker** (`worker/index.ts`), ticks every 10 min: rollover sweep (a
  region's weekId changed → refresh all its characters; a region's weekId is
  only recorded when its refresh ran clean, so failed regions retry next
  tick) + daily sweep (`lastFetchedAt` older than 24 h; transient failures
  wait out an exponential backoff (10 min doubling, capped at 24 h) before
  retrying, permanent 404s advance `lastFetchedAt` so they are never retried
  at tick cadence).
  Logged to `job_runs`, pruned after 30 days.

### Codebase tour

The data path runs through four layers. `lib/week` computes the weekly reset
instants per region — pure functions, no I/O; `weekId(region)` is the UTC date
of the most recent reset. `lib/tasks` is the pure derivation engine that turns
snapshot payloads into task states, with `unknown` as a first-class state
(ambiguous or missing API data is surfaced as unknown, never a wrong ✓/✗).
`lib/board` is the service/read model shared by pages and routes, Server
Components and API handlers both call it directly, doing read-time task state
assembly (derivation + merge precedence), character refresh with
permanence/backoff handling, and history. The `src/app/api` route handlers are
thin: same-origin check, body validation, then delegation to the board
service.

**Why the Blizzard cache is Postgres-backed rather than Redis:** `api_cache`
is a keyed table with `expiresAt`; TTL is checked on read and the worker
purges expired rows each tick, so the cache rides the database the app already
runs and adds no new service to operate. For single-user load that is the
whole job. The compose file still ships an optional, password-protected Redis
profile as an upgrade path, swapping it in means replacing the two functions
in `cache.ts`.

## API surface

| Method | Path | Purpose | Status codes |
| --- | --- | --- | --- |
| GET | `/api/health` | DB connectivity probe (`SELECT 1`) | 200, 503 |
| GET | `/api/realms?version=&region=` | Realm list for the add-character form (Blizzard fetch; fixtures under `MOCK_BLIZZARD`) | 200, 400, 502 |
| GET | `/api/characters` | List all characters | 200 |
| POST | `/api/characters` | Add a character; first fetch is synchronous | 201, 400, 403, 409 |
| PATCH | `/api/characters/[id]` | Update priority / group name / archived | 200, 400, 403, 404 |
| DELETE | `/api/characters/[id]` | Remove a character | 200, 403, 404 |
| POST | `/api/characters/[id]/refresh` | Manual per-character refresh, cache bypass | 200, 403, 502 |
| GET | `/api/characters/[id]/history` | Snapshot history for one character | 200, 404 |
| POST | `/api/task-completions` | Toggle a task completion (upsert / delete override row) | 200, 400, 403, 404, 500 |

403 is the cross-origin rejection from the same-origin gate on mutating
routes. On PATCH/DELETE, 404 is returned only for a genuine record-not-found;
any other failure surfaces as a JSON 500 with a fixed label in the body and
the detail in the server log (the same contract as POST `/api/characters` and
`/api/task-completions`).

## Merge precedence

manual completion row > derived state > unknown. Manual rows are user
overrides on **any** catalog task, auto-derived rows too (e.g. to resolve an
`unknown` or correct a wrong ✓). Toggle on → upsert row; toggle off → delete
row (state falls back to derived). Clearing a derived-done ✓ has no row to
delete, so it persists an explicit not-done row instead and the correction
survives reload.

## Known limitations (by design)

- **Rename / realm transfer** creates a new character row; history is not
  migrated.
- **Equipment** is stored in snapshots from day one but not displayed on the
  MVP board.
- **No auth**, anyone who can reach the URL can view/edit. Localhost-only
  contract: Docker Compose binds web (:3000), postgres (:5432) and the
  optional Redis profile (:6379) to
  `127.0.0.1` only. Do not expose publicly without adding an auth layer
  (future migration: users/oauth_tokens tables + session layer).
- **M+ `best_runs`** is known to come back empty from the API, vault slots
  derive from `current_period.runs` instead; an empty runs list means a real
  "not done", and a misaligned/uncoverable period, or a completed run with
  no dungeon identity, means `unknown`.
- **KR/TW reset** lands Thursday 23:00 UTC, same value in the engine
  (`DEFAULT_SCHEDULES`) and the seed data, pinned by `tests/schedules.test.ts`.
- **Raid/world vault rows** currently derive as `unknown` until verified
  achievements/statistics timestamps are mapped; confirm those rows manually.

## Security

Secrets live only in `.env` (`BLIZZARD_CLIENT_ID/SECRET`, `DATABASE_URL`),
shared by web and worker. All Blizzard calls are server-side.

Mutating API routes reject cross-origin requests (an Origin/Host check that
still passes curl and same-origin usage), so a drive-by page cannot relay
POSTs through the user's browser into loopback. Docker Compose binds web
(:3000), postgres (:5432) and the optional Redis profile (:6379,
password-protected via `REDIS_PASSWORD`) to `127.0.0.1` only.

## Disk hygiene

Build-cache pruning and vhdx-compaction notes live in
[docs/disk-hygiene.md](docs/disk-hygiene.md).

## License

MIT — see [LICENSE](LICENSE).
