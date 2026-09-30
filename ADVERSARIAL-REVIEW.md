# Adversarial Review — Altaboard

Reviewed: working tree at 2026-09-30 (8 commits, plus uncommitted edits — mostly
punctuation churn and a good `?version=` redirect fix in `src/app/page.tsx`).
Every finding below was verified against the actual code; file:line references
are to the current working tree.

**Scope**: all first-party source (~3,800 lines: `src/`, `worker/`, `prisma/`,
infra configs, tests). No code was changed during this review.

---

## 1. Threat model

The README declares the contract honestly: single-user, no auth, localhost-only.
Taking that seriously, the adversaries worth defending against are:

| Adversary | Vector | In scope? |
|---|---|---|
| Drive-by webpage | Fires cross-origin requests at `127.0.0.1:3000` from the user's browser (the browser is a network relay into loopback) | Yes — F-3 |
| Blizzard upstream | Malicious/compromised/buggy API responses: media URLs, malformed payloads, empty fields | Yes — F-7, F-13 |
| Time | DST shifts and wrong reset-hour constants silently mislabeling weeks | Yes — F-10 |
| Quota exhaustion | Anything that spends the 36k/hour Blizzard budget without the user intending it | Yes — F-1, F-3, F-4 |
| LAN peers | Only reachable if an optional compose profile is enabled | Yes — F-9 |
| Remote attackers | Direct hits on :3000/:5432 | Out of scope — loopback binds hold (except F-9) |
| Other tenants/users | No auth exists by design | Out of scope per README |

Severity scale: **P1** = bites in normal use or breaks a stated guarantee;
**P2** = real under plausible conditions, cheap to fix; **P3** = hygiene, latent,
or edge-case.

---

## 2. Executive summary

| ID | Sev | Area | Finding |
|---|---|---|---|
| F-1 | **P1** | worker/adapters | Permanently-dead characters are retried **every 10 minutes, forever** — the 404-is-permanent classification is dead code |
| F-2 | **P1** | UI | A wrongly-derived ✓ can never be unchecked — the app's core "correct the board" interaction doesn't work |
| F-3 | P2 | API | Drive-by CSRF into loopback: unauthenticated add-character flood and quota drain |
| F-4 | P2 | blizzard | Token bucket under-counts concurrent acquires; "Refresh all" bursts over the 10 req/s quota |
| F-5 | P2 | perf | History page loads every snapshot's full JSON payload to render three numbers per week |
| F-6 | P2 | API | Catch-all `catch → 404` on PATCH/DELETE masks real failures; failed deletes read as success |
| F-7 | P3 | API/UI | Raw error messages (incl. full upstream URLs, Prisma text) persisted and rendered |
| F-8 | P3 | API | Client-supplied `weekId` persisted verbatim → invisible orphan rows, no cleanup path |
| F-9 | P3 | infra | Optional Redis profile publishes unauthenticated `0.0.0.0:6379`, contradicting the loopback contract |
| F-10 | P3 | correctness | Fixed-UTC reset constants can't track DST; tests pin internal consistency, not Blizzard reality |
| F-11 | P3 | blizzard | Token-fetch stampede, NaN TTL edge, `Retry-After` ignored |
| F-12 | P3 | cache | 32-bit djb2 cache-key hash — latent collision risk |
| F-13 | P3 | ops/config | Dead `DEFAULT_REGION` env, no `restart` on web, seed clobbers catalog edits, unused standalone build, misleading comments |

---

## 3. Findings

### F-1 — P1: Deleted characters are retried every 10 minutes forever

**The chain:**

1. Both adapters wrap every endpoint call in per-endpoint try/catch and convert
   any failure — including `NotFoundError` — into an entry in
   `endpointErrors` (`src/lib/adapters/retail.ts:75-77`,
   `src/lib/adapters/classic1x.ts:57-61`).
2. When the profile endpoint 404s, the adapter then throws a **generic**
   `new Error(...)` (`retail.ts:84-85`, `classic1x.ts:67`), not the typed
   `NotFoundError` the client produced.
3. `refreshCharacter` classifies permanence with
   `err instanceof NotFoundError` (`src/lib/board/index.ts:280`) — which is now
   **always false**. `lastFetchedAt` is never advanced for 404s.
4. The worker's daily sweep selects characters with
   `lastFetchedAt: null OR < 24h ago` (`worker/index.ts:118-124`) — a deleted
   character qualifies on **every 10-minute tick**, forever. Each attempt fires
   ~5 uncached upstream requests (error responses are never written to cache,
   `blizzard/client.ts:99-103`).

This directly contradicts the code's own comment (`board/index.ts:276-279`:
"advancing lastFetchedAt keeps the daily sweep from retrying a lost cause") and
the README ("permanent 404s are not retried"). The classification logic exists,
is commented, and is unreachable — the adapter boundary silently eats the type.

**Second mechanism, same effect:** a character that has *never* fetched
successfully (`lastFetchedAt: null` — added during an outage, bad first fetch)
is also re-selected every tick. The "daily sweep" is only daily *after* the
first success; before that its cadence is the 10-minute tick.

**Impact:** quota burn against the shared 36k/hour budget, `job_runs` stuck at
`partial` with no signal of *why*, and a permanently stale `lastFetchError`
badge. Not data loss — which is why this is P1 and not P0 — but it silently
breaks a documented operational guarantee and gets worse the longer the app
runs (every character you ever mistype or that gets renamed on-armory is a
permanent 10-minute tax).

**Fix direction:** preserve the error class across the adapter boundary (throw
a typed aggregate error carrying per-endpoint statuses, or have
`refreshCharacter` classify from the stored `endpointErrors` map). Also add a
`nextAttemptAt`/backoff so transiently-failing characters don't retry at tick
cadence.

---

### F-2 — P1: A wrongly-derived ✓ can never be cleared

`src/components/TaskChecklist.tsx:22-27`:

```ts
const isManualSet = task.manuallySet || task.taskKey in overrides;
const currentlyOn = isManualSet
  ? (overrides[task.taskKey] ?? task.state === 'done')
  : false;
const nextOn = !currentlyOn;
```

For a task whose *derived* state is `done` with no manual row:
`isManualSet` is false → `currentlyOn` is false → clicking sends
`on: true` — which **writes a redundant `done=true` override row** and changes
nothing on screen. The second click sees `overrides[key] === true`, flips to
`on: false`, deletes the row, and falls back to… the derived ✓. The cycle is
✓ → ✓ → ✓. There is **no sequence of clicks that produces `not_done`** for a
derived-done task.

This contradicts three places that promise the behavior: the component comment
("toggle off deletes the override and falls back to the derived state", line
15), the tooltip ("Done — click to clear", line 88), and the README's
merge-precedence section ("correct a wrong ✓"). The exact use case the
override system was built for — correcting a wrong auto-derived checkmark — is
the one it can't perform. Bonus damage: the no-op first click silently persists
a row to `task_completions`.

Derived-`not_done` and derived-`unknown` tasks behave correctly; only
derived-`done` is broken, which is why testing with "make things done" never
surfaced it.

**Fix direction (one line):** drop the `isManualSet` gate and compute
`currentlyOn` from the effective displayed state:
`overrides[key] ?? task.state === 'done'`.

---

### F-3 — P2: Drive-by CSRF into loopback: unauthenticated add-flood + quota drain

The localhost bind stops direct remote access, but any website the user visits
can make their browser send cross-origin POSTs to `http://127.0.0.1:3000`:

- `POST /api/characters` is a CORS-simple request (safelisted method; the
  server parses the body with `req.json()` regardless of `Content-Type`,
  `src/app/api/characters/route.ts:24`), so `text/plain` cross-origin POSTs
  land **without a preflight**.
- The route requires no id, has no rate limit, no Origin/Host check, and no
  CSRF token anywhere in the app.
- Each accepted add runs a **synchronous, cache-bypassing, 5-endpoint upstream
  fetch** (`characters/route.ts:76`) — real Blizzard quota, ~5 requests per
  spam row.
- `POST /api/task-completions` and `POST /api/characters/[id]/refresh` are
  equally CSRF-reachable, but they require a valid character `id` (cuid,
  unguessable and unreadable cross-origin), which effectively gates them.

**Honest limits of this finding:** no ambient credentials exist (no cookies),
so this is not classic credential-CSRF — it's using the browser as a relay.
`DELETE`/`PATCH` are not safelisted methods and preflight-fail, so destruction
is blocked. Chrome's Local Network Access rollout will preflight public→local
requests, but Firefox/Safari don't yet, and the app shouldn't depend on browser
mood for its stated security contract.

**Concrete scenario:** a drive-by page loops `POST /api/characters` with
random valid names — unbounded garbage rows, board clutter, and sustained
quota drain that can push the user's Blizzard client into 429s (which then
interacts with F-1's retry cadence). All invisible to the user until the
board fills with junk.

**Fix direction (~3 lines):** a shared check at the top of every mutating
route — reject when `Origin` is present and not same-origin, or (defense in
depth) when `Host` isn't a loopback name. Zero effect on legitimate same-origin
usage.

---

### F-4 — P2: Token bucket under-counts concurrent acquires → bursts over quota

`src/lib/blizzard/rateLimiter.ts:21-41` is a synchronous read-modify-write
(single-threaded JS makes that part safe), but the **deficit path doesn't
reserve**: when balance < 1, every concurrent caller zeroes the same balance
and sleeps the same computed delay. Nothing records that K callers each "own"
a future token. When the delays expire, all K fire together, having consumed
only ~1 token's worth of refill between them.

Under sustained concurrency the effective dispatch rate approaches
**K × 9 req/s**, and K is not hypothetical:

- Adapters fire 3–5 endpoints via `Promise.all` (`retail.ts:62`,
  `classic1x.ts:44`) → 5 concurrent acquires per character.
- "Refresh all" runs a 4-worker pool over characters (`RefreshButton.tsx:12,
  24-34`) → up to ~20 concurrent acquires.
- Web and worker each run their own bucket (`rateLimiter.ts:2-4`) → even
  without clumping, combined worst case is 2 × 9 = 18 req/s against a 10 req/s
  quota.

**Concrete scenario:** a board of 15+ characters, "Refresh all" clicked →
requests dispatch in ~20-request clumps → Blizzard 429s → `RateLimitError`s →
failed refreshes that then feed F-1's retry cadence. With a small board the
burst capacity of 60 masks it entirely — which is why it hasn't bitten yet.

**Fix direction:** the classic one-line-ish fix is to subtract before
sleeping and allow the balance to go negative (each sleeper then owns a
definite future token), or serialize `acquireSlot` per process with a promise
chain.

---

### F-5 — P2: History page loads every snapshot's full payload to show 3 numbers

`getCharacterHistory` (`src/lib/board/index.ts:309-314`) does
`include: { snapshots: ... }` — full rows, each containing the merged
`payload` JSON (profile + equipment + achievements, easily hundreds of KB).
The function then uses only `weekId`, `capturedAt`, `ilvl`, `mplusRating`,
`achievementPoints` (`board/index.ts:324-340`) and discards the payload.

Snapshots accumulate one per character-week with no pruning (the README's
"Disk hygiene" section covers Docker layers, not the database). A year of
history on a handful of characters means a character-page view deserializes
and ships tens of megabytes of JSON from Postgres for a table of five columns.

**Fix direction:** `select` the five scalar columns in the snapshots include.
Optionally a worker sweep can null out `payload` for snapshots older than N
weeks (keeping the scalars) if DB size ever matters.

---

### F-6 — P2: `catch → 404` masks real failures on PATCH/DELETE

`src/app/api/characters/[id]/route.ts:44-46` (PATCH) and `:57-59` (DELETE)
convert **every** error into "character not found". Prisma's actual
not-found code is P2025; everything else (DB down, connection reset, schema
drift) is a real 5xx wearing a 404 costume.

**Concrete scenario:** user clicks delete during a transient DB hiccup → 404 →
UI reports success via the `ok` path? No — the client shows "delete failed"
only on `!res.ok`… and 404 is `!res.ok`, so the user sees a *wrong reason*:
they conclude the character was already gone, when it still exists. On PATCH,
a settings save failing because of an outage reads as "bad id". One of the two
catches should distinguish `isUniqueViolation`/P2025 from everything else and
rethrow the rest.

---

### F-7 — P3: Raw error messages persisted and rendered

- `POST /api/task-completions` returns raw `err.message` in the 500 body —
  including Prisma's internal error text (`task-completions/route.ts:61-62`),
  which the checklist then displays verbatim under the task row.
- `/api/realms` does the same in its 502 (`realms/route.ts:33-37`).
- The adapters compose `describeError()` strings —
  `"404: https://us.api.blizzard.com/profile/wow/character/..."` (`errors.ts:48-51`)
  — into `_endpointErrors`, which is **persisted inside every snapshot payload**
  (`retail.ts:88`), and into the thrown error's message, which
  `refreshCharacter` stores in `lastFetchError` (`board/index.ts:275, 284`) and
  the card renders (`page.tsx:106-113`).

No secrets are in these messages (auth errors carry generic text, and the URLs
contain no query strings), so this is information hygiene, not leakage of
credentials — full upstream URLs and Prisma internals surfaced in a UI that
one human looks at. Worth cleaning at the route boundary: map known error
types to short labels, log the detail server-side.

---

### F-8 — P3: Client-supplied `weekId` persisted verbatim; no cleanup path

`POST /api/task-completions` accepts any regex-valid `YYYY-MM-DD` and persists
it (`task-completions/route.ts:48-53`, with a comment acknowledging the
verbatim policy). `9999-99-99` and `2026-02-31` both pass. The board only ever
reads completions for the *current* region weekIds or `weekId: null`
(`board/index.ts:100-105`), so any row written under any other weekId is
invisible, permanent, and unremovable through the UI — orphan rows with no
cleanup job anywhere. The client currently always omits `weekId`
(`TaskChecklist.tsx:38-42` sends only `characterId/taskKey/on`), so today this
is purely an API-shaped foot-gun — the kind that becomes live data the first
time a script or future feature sends a stale weekId.

**Fix direction:** validate `body.weekId` against the region's actual computed
weekIds (e.g. the last 8), or drop the parameter and always derive
server-side.

---

### F-9 — P3: Optional Redis profile publishes unauthenticated Redis to the LAN

`docker-compose.yml:74-78`: the `--profile redis` service binds
`"6379:6379"` → **all interfaces**, no password, no config file — while every
other port in the file is pinned to `127.0.0.1` and the README's security
section promises exactly that. The app doesn't consume Redis yet (the
"upgrade path" is manual code replacement), so today's impact is a LAN-exposed
stock Redis for anyone who experiments with the profile; tomorrow, when the
cache actually moves to Redis, it becomes a LAN-writable application dependency.

**Fix:** `"127.0.0.1:6379:6379"` and `--requirepass`, one line each.

---

### F-10 — P3: Reset constants are fixed-UTC; tests pin consistency, not reality

`DEFAULT_SCHEDULES` (`src/lib/week.ts:12-17`) hardcodes US Tue 15:00,
EU Wed 07:00, KR/TW Thu 23:00 UTC year-round. Regions that reset on *local*
time (US is nominally 8:00 AM Pacific) shift by an hour against UTC twice a
year, so the computed `weekId` can flip up to an hour early/late around DST
transitions — toggles land in the wrong week for a ≤1-hour window, per affected
region, per year.

Mitigating factors, to the code's credit: per-region schedules exist at all
(many hobby dashboards don't bother), and the task engine's `coversWeek`
alignment check (`tasks.ts:75-87`) demotes any mismatch between the computed
week and the API's M+ period to `unknown` rather than a wrong ✓ — the failure
direction is safe. But note what `tests/schedules.test.ts` actually pins:
engine ↔ seed consistency and the literal constants — **not** that the
constants match Blizzard's real reset behavior. The constants have never been
validated against the live API.

**Fix direction:** verify once against real `period_start_timestamp` values
per region, and prefer the API period as source of truth when present
(falling back to the table).

---

### F-11 — P3: Token/cache minutiae in the Blizzard client

- **Cold-start stampede:** each of the 5 adapter endpoints calls `getToken()`
  concurrently (`client.ts:91` under the adapters' `Promise.all`); on an empty
  token cache that's up to 5 simultaneous client-credentials POSTs, doubled by
  the web+worker pair. Harmless for Blizzard, sloppy for the logs.
- **Token fetch bypasses the rate limiter entirely** (`token.ts:36` — no
  `acquireSlot`).
- **NaN TTL edge:** if the token response lacks `expires_in`,
  `ttl` becomes `NaN` (`token.ts:52`) and `putCached` throws an opaque Prisma
  error on an invalid `expiresAt`. One `Number.isFinite` guard away from safe.
- **`Retry-After` ignored:** the 429 path does one fixed jittered retry
  (`client.ts:117-124`) and discards the header — free information when
  Blizzard says exactly how long to wait. (The single-retry behavior for
  401/403/429 vs. configured `maxRetries` is intentional and commented — not a
  finding, just noting the asymmetry.)

---

### F-12 — P3: 32-bit djb2 cache-key hash

`cacheKey` (`src/lib/blizzard/cache.ts:16-27, 29-33`) hashes params with a
32-bit djb2 variant. A collision between two different param-sets on the same
`version:region:endpoint` would serve one endpoint's cached payload for
another. Today this is effectively unreachable — character identity lives in
the endpoint *path* and every adapter call passes empty params — so it's a
latent risk that activates the moment someone adds a parametrized endpoint.
Replacing `simpleHash` with a 64-bit hash or just embedding the (short)
param string directly removes the class of bug.

---

### F-13 — P3: Ops and config hygiene

- **Dead `DEFAULT_REGION`:** compose passes it to web and worker
  (`docker-compose.yml:43, 65`) and `.env.example` documents it — grep finds
  **zero** readers. `page.tsx:39` hardcodes `defaultRegion="eu"` and the
  settings page hardcodes the text "Default region: EU". A user setting
  `DEFAULT_REGION=us` changes nothing.
- **No `restart` on web:** worker gets `unless-stopped`
  (`docker-compose.yml:59-60`); web gets nothing — a crashed web container
  stays down until manual intervention.
- **Seed clobbers catalog edits:** `prisma/seed.ts:11-23` upserts with
  `update: { ...active, label, sortOrder }` from the seed file, and the
  migrate job runs on **every** `docker compose up`. Hand-tuning a task label
  or deactivating a task is silently reverted at next boot.
- **Standalone build built but unused:** `next.config.mjs` sets
  `output: 'standalone'` and the Dockerfile's first comment cites it — then
  the runtime runs `npm run start` (`next start`) with the **full**
  `node_modules` including devDependencies (`Dockerfile:25-36`). The standalone
  server.js that would prune the image is never used.
- **Misleading comment:** `next.config.mjs` claims portraits are "proxied
  through /api" — no such proxy exists. `portraitUrl` (upstream-controlled,
  payload-borne) is rendered as a plain `<img src>` (`page.tsx:63-71`) with no
  host allowlist. Worst realistic case is a broken image or a third-party
  tracking pixel; it is not XSS. An allowlist would still make the trust chain
  explicit.
- **Synchronous first fetch on add:** `POST /api/characters` awaits a full
  5-endpoint refresh with 15s timeouts, retries and limiter delays inside the
  request (`characters/route.ts:76`) — the "Adding…" state can hang for the
  better part of a minute. The row is created before the fetch, so state stays
  consistent on browser timeout; this is a UX wart, not a correctness bug.
- **Version skew:** `eslint-config-next@^16.3.7` against `next@^15.5.0` — lint
  rules tuned for a different Next major than the runtime.
- **Uncommitted working tree:** the pending diff is punctuation churn plus the
  `?version=` redirect guard (`page.tsx:19-21` — correct and worth keeping) and
  a new `not-found.tsx`. Commit-worthy; just not security-relevant.

---

## 4. Testing, CI, and operational gaps

The test suite (`tests/`) is good at what it covers: the week engine's
boundary behavior (reset instant, reset-adjacent minutes), the task engine's
conservative derivation, and the engine↔seed schedule pin. That's ~356 lines
of genuinely meaningful pure-logic tests.

But the coverage map has a hole exactly where both P1 findings live:

| Layer | Tested? | Bugs found there in this review |
|---|---|---|
| `week.ts`, `tasks.ts` | Yes, well | — |
| API routes | No | F-3, F-6, F-8 |
| `board/index.ts` (refresh, merge, history) | No | F-1 (classification), F-5 |
| Adapters (error semantics) | No | F-1 (swallowed `NotFoundError`) |
| Rate limiter | No | F-4 |
| Worker sweeps | No | F-1 (cadence) |
| UI components | No | F-2 |

A single adapter test asserting "a profile 404 surfaces as `NotFoundError` to
`refreshCharacter`" would have caught F-1. A TaskChecklist interaction test
would have caught F-2. Neither requires Blizzard — the mock adapter and the
pure engines make both easy; the mock adapter is currently only wired for
runtime UI mode, not tests.

**No CI exists** (no `.github/`, no hooks). `lint`, `typecheck`, and `test`
scripts are defined and evidently run by hand — nothing enforces them on
commit, and nothing would have flagged the CRLF churn visible in `git diff`
warnings (no `.gitattributes`).

---

## 5. What's holding up well

An adversarial review should also say what an attacker *won't* find:

- **Secrets hygiene is clean.** No hardcoded keys anywhere; `.env` is
  gitignored *and* dockerignored; the token lives server-side in the DB cache,
  never in URLs or client payloads; all Blizzard calls are server-side.
- **The input validation on the add path is genuinely careful:** allowlists
  for region/version, letter-only names, slug regexes, server-side priority
  clamping, and the TOCTOU on duplicate adds handled properly via the unique
  index + `isUniqueViolation` (`characters/route.ts:66-72`).
- **`unknown` as a first-class task state is the best design decision in the
  codebase.** The derivation engine consistently prefers "unknown" over a
  possibly-wrong ✓, degrades classic boards gracefully, and its alignment
  check (`tasks.ts:75-87`) is the safety net that keeps F-10's week-drift
  honest.
- **The `NotFoundError` architecture is right — its wiring is not.** Typed
  error taxonomy, timeout+abort on every fetch, cache-bypass semantics on
  manual refresh: the intent (F-1's comment) is exactly correct; only the
  adapter boundary breaks it.
- **Data modeling shows real care:** the hand-written partial unique index for
  one_time rows is documented in-schema with its rationale
  (`schema.prisma:70-74`), completion rows survive catalog rekeys by design,
  snapshot upserts are transactional with the character update.
- **Compose is mostly disciplined:** loopback binds for web/db, healthchecks,
  `service_completed_successfully` gating, job-run pruning and cache purge in
  the worker, restart policy on the one service that must come back.
- **Read-time derivation** (no scheduled task-state writer) keeps the
  consistency model simple: only user toggles write completions, everything
  else is computed at render time.

---

## 6. Prioritized fix list

1. **F-2** — one line in `TaskChecklist.tsx` to make ✓ clearable. Highest
   user-visible value per character typed.
2. **F-1** — preserve error class across the adapter boundary + backoff for
   transient failures. Stops the silent 10-minute tax.
3. **F-3** — Origin/Host check on mutating routes (~3 lines). Makes the
   README's security claim true against drive-bys, not just remote peers.
4. **F-4** — reserve tokens before sleeping (allow negative balance).
5. **F-5** — `select` scalar columns in `getCharacterHistory`.
6. **F-6** — distinguish P2025 from real errors in PATCH/DELETE.
7. **F-9** — loopback-bind the Redis profile (one line).
8. **F-7 / F-8** — sanitize error bodies at the route boundary; validate
   `weekId` against computed region weeks.
9. **F-13** — delete or read `DEFAULT_REGION`; add `restart: unless-stopped`
   to web; make the seed respect manual catalog edits or stop re-asserting
   them; reconcile the Dockerfile with `output: 'standalone'`; fix the
   comments that describe behavior that doesn't exist.
10. **F-10** — one-time verification of reset constants against live API
    period timestamps; then a test that pins *reality*, not just consistency.

The common thread: the architecture consistently intends the right thing
(documented in comments and README), and most of this review is places where
the wiring doesn't yet honor the intent — the adapter boundary eating a type,
a ternary gate eating a toggle, a bind address eating a security claim. The
fixes are correspondingly small.
