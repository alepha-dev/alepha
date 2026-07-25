# Alepha — Feature Review (2026-07-25)

**Scope:** forward-looking only. Not a bug hunt — `assets/REVIEW.md` (Jul 14) and
`assets/REVIEW_2.md` (Jul 24) already cover defects. This document answers three questions:

1. What **small features** should existing modules gain, and why?
2. What **new modules** are missing, and why?
3. What **overall** changes raise the framework's ceiling?

**Method:** read the public surface of all 31 sub-modules + 5 `@alepha/*` packages
(115K LOC, 78 exports, 364 spec files, v0.24.0), then cross-checked against how `apps/lore`
actually uses them. Every claim below cites a file. Anything already shipped was dropped —
e.g. `$rateLimit`, `useQuery`, `Server-Timing`, cache SWR/L1/single-flight, and redaction all
exist and are *not* listed as gaps, even though earlier reviews asked for some of them.

**Sizing:** `S` ≈ under a day, `M` ≈ a few days, `L` ≈ a week+.

---

## Executive summary

The framework is broad and unusually coherent. The gaps are no longer "missing capability" in the
obvious places — they're in three specific bands:

- **Portability** — the ORM can't express portable SQL, so apps fall back to hand-written
  dialect-branched SQL. This is the single largest measured source of app-side pain.
- **Production visibility** — there is no tracing, no span propagation, no job progress, no
  notification persistence. `AsyncLocalStorage` is already wired; nothing consumes it for telemetry.
- **Authorization depth** — `$secure` handles *who you are*, never *what you own*. Every app
  rebuilds resource-scoped authz by hand, which is exactly where authz bugs live.

Top five by leverage: **portable SQL helpers**, **`alepha/telemetry`**, **resource-scoped
`$secure`**, **migration safety gate**, **React query cache with invalidation**.

---

# Part 1 — Small features for existing modules

## `alepha/orm` — the highest-leverage module to improve

### 1.1 Portable SQL expression helpers `M` ⭐
**Gap:** no dialect-neutral way to express date math, epoch conversion, or JSON extraction.

**Evidence:** `apps/lore` still carries **56 raw `` sql`` `` templates across 6 files** and
**10 dialect-branching lines**. Two controllers are effectively hand-written SQL with manual result
schemas, written twice:
`apps/lore/src/api/controllers/InsightsController.ts`,
`apps/lore/src/api/controllers/CampaignStatsController.ts`.
This was flagged as the #1 gap in `assets/REVIEW.md` and has not moved.

**Proposal:** a small expression namespace resolved per-dialect at build time —
`sqlx.dateTrunc("day", col)`, `sqlx.epoch(col)`, `sqlx.dateDiff(a, b, "days")`,
`sqlx.jsonExtract(col, "$.x")`, `sqlx.concat(...)`, `sqlx.coalesce(...)`.
Backed by the existing `SqliteModelBuilder` / `PostgresModelBuilder` split, so the dispatch
point already exists. Doesn't need to cover all of SQL — covering *date/epoch/JSON* alone
deletes most of Lore's raw templates.

**Why it matters:** this is the one place where the framework's "end-to-end type-safe" promise
visibly breaks. Every analytics feature in every app pays the tax twice.

### ~~1.2 Migration safety gate~~ — **ALREADY SHIPPED (corrected 2026-07-25)**
This was listed as a gap in error. The guard exists and is stricter than what was proposed here:

- `cli/core/commands/db.ts:514` — `assertNoDestructiveMigrations()`, refuses **any** `DROP TABLE`
- `:552` — `findDropTableStatements()`, comment-aware
- `:467` — wired into the generate path
- `cli/core/__tests__/DbCommand.spec.ts:32` — tested

It deliberately leaves the offending file on disk to force a human read.
`apps/lore/migrations/sqlite/0041_petition_reporter_user_id_restore.sql` is the guard working as
designed — a hand-written, rebuild-free migration produced *because* the generator refused the
destructive one. The `apps/lore/CLAUDE.md` grep-gate documentation describes the human half of a
process whose enforcing half is already code; I generalized from the doc without checking the CLI.

### ~~1.3 Carry declared `onDelete` into generated `ALTER TABLE ADD COLUMN` FKs~~ — **UNVERIFIED**
Carried over from `assets/REVIEW.md` (Jul 14) and **not reproducible** in this repo. The single
`ADD COLUMN ... REFERENCES` in Lore's migrations is hand-written and carries its `ON DELETE cascade`
correctly. Do not act on this without first producing a generated migration that drops the clause.

### 1.4 `Repository.exists()` `S`
Not in the public API (`orm/core/services/Repository.ts` exposes 24 methods; `exists` isn't one).
Today it's `count() > 0` or `findOne() !== undefined`, both of which fetch more than needed.
Trivial to add, used constantly.

### 1.5 `Repository.stream()` / async iterator `M`
No cursor iteration exists. Any export, backfill, or migration script has to page manually with
`limit`/`offset` — which is O(n²) on large tables and inconsistent under concurrent writes.
`for await (const row of repo.stream({ where }))` with keyset pagination under the hood.

### 1.6 `findByIds()` with request-scoped batching `M`
No DataLoader-equivalent. List rendering with per-row lookups is N+1 by default. Because
`$scope` / ALS is already in place, a request-scoped batch window is cheap to implement and
would benefit every list endpoint without changing call sites much.

### 1.7 Soft-delete filter propagation into joins `S`
Soft-delete currently scopes the base table only; joined tables leak deleted rows. Carried over
from `assets/REVIEW.md` and still open.

---

## `alepha/security`

### 2.1 Resource-scoped `$secure` `M` ⭐
**Gap:** `guard` is **synchronous and receives only `user`** —
`security/primitives/$secure.ts:29`. It cannot see `params`, `body`, or the request, so it can
never answer "does this user own campaign 42?".

**Evidence:** every owned-resource app rebuilds it. Lore has an `AppSecurityProvider` with
hand-maintained `assertMember` / `assertOwner` over `createdBy` + a join table, plus a
privileged-bypass branch on `!user.ownership`. It also produces the only framework-API `as any`
casts in the app.

**Proposal, in two steps:**
1. `guard?: (ctx: { user, params, query, body, request }) => Async<boolean>` — async, full context.
   Backwards-compatible if the old single-arg form is kept as an overload.
2. On top of that, a declarative `$owns({ entity, param, via })` helper that resolves the row,
   checks ownership or membership, and puts the loaded entity on the request so the handler
   doesn't re-fetch it.

**Why:** authorization is the one area where "every app writes it by hand" is not acceptable.
Step 1 alone unblocks correct code; step 2 makes it declarative.

### 2.2 TOTP MFA + recovery codes `M`
Nothing exists — a repo-wide grep for `totp|mfa|webauthn|passkey` returns one unrelated audit
file. For a framework that ships 7 OAuth providers, credentials auth, sessions, service accounts,
API keys, realms, and an OAuth *server*, no second factor is a conspicuous hole. Scope it small:
`$authTotp` enrollment + verify + single-use recovery codes, stored next to `identities`.

### 2.3 Refresh-token rotation with reuse detection `M`
Carried over from `assets/REVIEW.md`; still the standard hardening step for the session model.

---

## `alepha/server`

### 3.1 `$idempotent()` middleware `S` ⭐
**Gap:** a repo-wide grep for `idempot` hits the cache, lock, topic, and S3 providers — never the
HTTP layer. Any client retry on a POST re-executes it.

**Proposal:** middleware reading `Idempotency-Key`; on first call it takes a `$lock`, runs the
handler, and stores `(status, body)` in `$cache` under `key + route`; on replay it returns the
stored response. Every dependency already exists — this is mostly wiring, and it makes
payments/mutations safe under retry by adding one entry to `use: []`.

### 3.2 Deprecation metadata on `$action` `S`
`deprecated?: string | { since, sunset }` → OpenAPI `deprecated: true` + a `Sunset` response
header + a warn log on first call. `$swagger` already generates the spec; this makes API evolution
observable instead of tribal.

### 3.3 RFC 9457 Problem Details error bodies `S`
Errors are already structured with `requestId` (`server/core/errors/HttpError.ts`). Adding
`type` / `title` / `detail` / `instance` makes them consumable by standard tooling for near-zero
cost, and `$client` can keep its current shape.

### 3.4 Graceful-shutdown budget `S`
`Alepha.stop()` takes no options (`core/Alepha.ts:684`) — a hung `$job` or an open WebSocket can
block SIGTERM indefinitely, which on Cloudflare and in containers means SIGKILL mid-write.
`stop({ timeout })` with a documented drain order (stop accepting → drain in-flight → close
transports → close pools) and a warning naming what didn't finish.

---

## `alepha/react`

### 4.1 Keyed query cache + invalidation `M` ⭐
**Gap:** `useQuery` exists (`react/core/hooks/useQuery.ts`) but its own JSDoc says
*"There is no separate cache layer."* No keys, no cross-component sharing, no invalidation
after a mutation.

**Evidence of the consequence:** `apps/lore` uses `useQuery` **zero times**. It routes everything
through `$page.loader` + `$atom` instead, and hand-manages atom updates after every mutation
(`FolioView.tsx` mutates `userFoliosAtom` and `folioTagsAtom` by hand after a write).

**Proposal:** `key: (…) => unknown[]`, a store-backed cache (the `$atom` store already exists —
no new state library), `invalidate(key)` exposed from `useAction`'s success path, and
`keepPreviousData` for pagination. This is an increment on machinery that's already there,
not a new subsystem.

**Why:** without it, `useQuery` is a wrapper nobody reaches for — and the framework's own
flagship app is the proof.

### 4.2 Deferred / streamed loaders `M`
`ReactPageProvider.ts:405-425` runs each layer's loader in a sequential `for` loop, awaiting
each. SSR already streams (`renderToReadableStream` + early head flush), so the plumbing exists —
but today one slow loader blocks first paint of everything above it. Let a loader return a
promise value that resolves through Suspense after the shell.

### 4.3 `<Link prefetch>` `S`
`Link.tsx` has no `onMouseEnter` / `IntersectionObserver` path — `ReactPreloadProvider` only emits
`Link:` headers for entry assets, not per-route code or loader data. `prefetch="hover" | "viewport"`
that warms the lazy chunk and (with 4.1) the query cache. ~30 lines for a large perceived-speed win.

### 4.4 View Transitions on navigation `S`
`$page.animation` exists; wrapping the commit in `document.startViewTransition` behind
`viewTransition: true` is a small addition that gets native cross-fade and shared-element
transitions free.

### 4.5 Unsaved-changes navigation guard `S`
`react/form` tracks dirty state (`useFormState`) and the router owns navigation — nothing connects
them. `useForm({ blockNavigation: true })` prompting via `useDialog` closes a common data-loss
gap and is pure integration work.

### 4.6 Optimistic mutations in `useAction` `M`
`optimistic: (args) => patch` + automatic rollback on error. Pairs with 4.1; together they remove
the hand-written atom patching that Lore does after every write.

---

## `alepha/api/notifications`

### 5.1 Persist notifications + in-app inbox `M`
**Gap:** the module has **no `entities/` directory** — notifications are fire-and-forget. Channels
are email and SMS only (`NotificationMessage` declares exactly those two).

**Consequence:** no delivery log, no retry visibility, no "what did we send this user", no inbox.
`category` / `critical` / `sensitive` are declared on `$notification` but have no preference system
to act on.

**Proposal:** a `notifications` entity (recipient, category, payload, channel results, `readAt`),
an `inApp` channel, per-user category preferences that `critical: true` bypasses, and a
`useNotifications()` hook with unread count. This is the difference between "sends email" and
"notification system".

### 5.2 Web Push channel `M`
No `VAPID` / `PushSubscription` anywhere in the repo. Natural follow-on once 5.1 lands, and the
service-worker story already exists via the static/deployment stack.

---

## `alepha/bucket`

### 6.1 Presigned upload / download URLs `M` ⭐
`FileStorageProvider` exposes exactly six methods — `upload`, `download`, `exists`, `delete`,
`deleteMany`, `list`. No presigning anywhere in the repo.

**Why it matters more here than in most frameworks:** every byte therefore transits the app
server. On the framework's flagship deployment target (Cloudflare Workers) that means paying
CPU time and hitting request-body limits for something R2 and S3 both do natively. Add
`presignUpload()` / `presignDownload()` to the abstract provider, implement for S3 and R2, and
throw a clear "not supported, stream through the server" for local/memory.

### 6.2 Streaming upload `S`
Pairs with the above for the cases that must transit the server.

---

## `alepha/api/jobs` & `alepha/queue`

### 7.1 Job progress reporting `S`
`JobHandlerArgs` has `payload, attempt, now, signal, executionId` — no progress channel. Add
`progress(fraction, message?)` persisting to the job row. `@alepha/devtools` and the admin UI can
then show live progress, which is the difference between "a job is running" and "a job is stuck".

### 7.2 Visibility timeout, DLQ, and lease renewal `M`
Carried from `assets/REVIEW.md`. Lease renewal in particular kills the long-job double-run.

### 7.3 Jittered backoff strategy `S`
`JobRetryOptions` is `{ retries, when }` — fixed policy. Add `backoff: "exponential" | "linear" | fn`
with jitter. Without jitter, a downstream outage produces a synchronized retry stampede.

---

## `alepha/cache`

### 8.1 Tag-based invalidation `S`
Already strong (SWR, L1 memory tier, negative caching, single-flight, prefix `*` invalidation).
The one missing axis is *cross-primitive* invalidation: "drop everything derived from campaign 42"
spans several `$cache` definitions and can't be expressed as a key prefix.
`tags: (…args) => string[]` + `cacheProvider.invalidateTag(tag)`.

### 8.2 Hit/miss/stale counters into `ServerMetricsProvider` `S`
The metrics provider exists; the cache knows its own hit rate. Wiring them together turns a
guess into a number.

---

## `alepha/core`

### 9.1 Order-independent `.with()` substitution `M` ⭐
**Gap:** `.with()` must run *before* the module that declares the binding, or it "trips the DI guard".
The constraint isn't discoverable from the API — it's discoverable from failures.

**Evidence:** `apps/lore/src/main.server.ts` carries **two multi-line comments** whose only purpose
is to warn future readers about ordering (lines 29-31 for `CaptchaProvider`, 58-61 for
`SigilForwardProvider`). Load-bearing comments are a design smell.

**Proposal:** resolve substitutions at `start()` rather than at registration, so declaration order
stops mattering. If that's too invasive, the fallback is a `S` fix: make the guard error name the
service, the module that already bound it, and the line that must move.

### 9.2 Aggregate env validation at boot `S`
Report *all* missing/invalid env vars in one error rather than failing on the first. Every
onboarding session and every deploy misconfiguration is currently a guess-and-recheck loop.

### 9.3 Deadline propagation `M`
With ALS already in place, an ambient deadline (`runWithDeadline(30s)`) that nested `$client`
calls, DB queries, and `$retry` loops all honour would make timeouts compose instead of stack.
Today a 3-deep call chain with 30s timeouts can take 90s.

---

## `alepha/logger`

### 10.1 Sampling `S`
`sample: 0.1` per logger or per level. High-volume debug logging is currently all-or-nothing.

### 10.2 File destination `S`
Already tracked as quest #190. Destinations are pluggable (`LogDestinationProvider`), so this is
one implementation.

---

## `alepha/cli`

### 11.1 `alepha doctor` `M`
Already tracked as quest #159. Aggregate the checks that exist as tribal knowledge: Node version
vs pin, Docker services reachable on the ports `vitest.config.ts` expects, pending migrations,
env completeness, DI substitution ordering, workspace export drift. The `verify` command already
probes postgres/redis/s3mock ports and explains the failure — `doctor` generalizes that instinct.

---

# Part 2 — New modules

## A. `alepha/telemetry` ⭐ `L` — the biggest production-readiness gap

**Why:** a repo-wide grep for `opentelemetry|traceparent|traceId` returns **nothing**. The framework
actively encourages distributed topology — `$client` links between services, `$remote`, `$proxy`,
queues, jobs, topics — and gives you no way to follow a request across it. `requestId` propagates
over `$client` (`LinkProvider.ts:343`), which shows the intent is there but stops one step short.

**What:** auto-instrument the primitives that already wrap execution — `$action`, `$route`, `$job`,
`$scheduler`, `$repository`, `$client`, `$cache`, `$lock` — into OTel spans; propagate `traceparent`
through `$client` and queue payloads; export via OTLP. `AsyncLocalStorage` is already the context
carrier (`core/providers/AlsProvider.ts`), so span context has a home.

**Why it's a module, not a feature:** every primitive needs a hook, and the exporter is an optional
dependency. It should also be free to opt out of on Workers where OTel's Node deps don't fit.

**Payoff:** `@alepha/devtools` gets a real waterfall view instead of a log list, and the framework
becomes deployable by teams with an existing observability stack — currently a hard blocker.

## B. `alepha/testing` `M` — the pieces exist, the package doesn't

**Why:** `react/testing` exists for the frontend; there is no server equivalent. Every backend test
hand-assembles the same scaffolding, and the project's own `CLAUDE.md` needs ~80 lines to explain
the conventions — which is a sign the conventions want to be code.

**What (all of it composed from existing parts):**
- A typed in-process test client derived from `$client`, so controller tests are as type-safe as
  app code.
- DB-per-test with transaction rollback, over the `$transactional` machinery.
- Fixture factories generated from `$entity` schemas via `alepha/fake` (already a dependency).
- One-line setup that installs every Memory provider at once.
- Time-travel helpers wrapping `DateTimeProvider.travel()` / `pause()`.

**Payoff:** the docs shrink, tests get shorter, and the Memory-provider design — one of the
framework's genuinely good ideas — becomes discoverable instead of documented.

## C. `alepha/flags` `M` — small delta, high product value

**Why:** `alepha/api/parameters` already does typed runtime configuration with persistence, an
audit trail, and an admin UI. Feature flags are that machinery plus *targeting* plus a React hook.
Building it standalone would be a lot; building it on `parameters` is not.

**What:** `$flag({ name, schema, default, rules })` with targeting by user/role/realm/organization/
percentage; server evaluation via `$inject`; client via an atom hydrated at SSR so there's no flash;
admin UI page for free.

**Why now:** the framework's pitch is fast, safe iteration on Cloudflare. Shipping behind a flag is
the missing half of that story — the deploy is 10s, but there's no way to dark-launch.

## D. `alepha/webhooks` `M` — outbound

**Why:** inbound webhooks are handled (`api/payments`). Outbound — letting *your users*' systems
subscribe to *your* events — has no support, and every B2B SaaS needs it. The hard parts are all
already solved elsewhere in the framework.

**What:** endpoint registry entity, HMAC-signed delivery with a timestamped signature, retry with
jittered exponential backoff on `$job`, delivery log with request/response capture, replay from the
admin UI, auto-disable after sustained failure. `$topic` is the natural event source.

**Why it's a module:** it's ~90% composition of `$job` + `$retry` + `$topic` + admin UI, which is
exactly the kind of thing a framework should own once rather than have every app rebuild.

## E. `alepha/search` `M`

**Why:** no full-text support anywhere (`tsvector|to_tsquery|fts5` → zero hits). Lore is a wiki —
folios, tags, campaigns — and search is table stakes; today it would be raw dialect-branched SQL,
i.e. gap 1.1 all over again.

**What:** `$search({ entity, fields, weights })` compiling to Postgres `tsvector` + GIN or SQLite
FTS5, with generated migrations, ranking, highlighting, and a typed `search(query, { where })`
method on the repository.

**Why not Elastic:** the framework's whole posture is "no extra infrastructure" — both target
databases have competent built-in FTS. Owning the portable abstraction is the value.

## F. `alepha/ai` `L` — the strategic one

**Why:** `alepha/mcp` already defines `$tool` / `$prompt` / `$resource` with schema-first
definitions and DI. Those are, structurally, LLM tool definitions — the framework is one small
step from being able to *call* models with the same tools it *serves* to them. Meanwhile the
agent-loop requirements list — schema-validated tool calls, retry with backoff, response caching,
durable long-running execution, cancellation, structured logging — maps almost one-to-one onto
`$retry`, `$cache`, `$job`, `AbortSignal`, and `$logger`, all of which already exist.

**What:** an `$agent({ model, tools, schema })` primitive where `tools` accepts existing `$tool`
definitions unchanged; provider abstraction (`AiProvider`) following the established
`EmailProvider`/`SmsProvider` pattern; streaming responses through the existing `$sse`; a
`MemoryAiProvider` with scripted responses so agent code is testable without a network.

**Why it belongs here rather than as an app concern:** the differentiator isn't the API call, it's
that a tool defined once is simultaneously an HTTP endpoint, an MCP tool, and an LLM tool — with
one schema and one permission model. No other framework can currently offer that, and Alepha is
one primitive away.

**Caveat:** this is the least urgent and most speculative item in the document. Take it only if the
`alepha/mcp` reuse angle is genuinely attractive; skip it if it isn't.

---

# Part 3 — Overall improvements

### O1. Document the async stack ⭐ `M`
`docs/1-guides/` has 39 files covering core, server, persistence, frontend, testing, deployment,
and payments. It has **nothing** on `$job`, `$queue`, `$topic`, `$scheduler`, `$lock`, `$retry`,
`$circuit`, or `$batch`.

That is the framework's most differentiated surface — durable jobs with an outbox, distributed
locks, circuit breakers, and pub/sub, all with memory providers for tests — and a newcomer cannot
discover any of it from the guides. Two guides would fix it: *"Background work"* ($job vs $queue vs
$scheduler, and when each) and *"Resilience"* ($retry, $circuit, $lock, $batch). Security and
observability guides are the next two gaps.

### O2. Close the adoption loop ⭐ `S` (process)
`useQuery` shipped and `apps/lore` uses it **zero times**. `$rateLimit` shipped after Lore
hand-rolled `PetitionRateLimiter`. A feature that the flagship app doesn't adopt isn't finished —
it's a hypothesis.

**Proposal:** make "migrate the Lore call sites" part of the same PR as the framework feature. If
no Lore code wants it, that's the signal to reconsider the API before it's public. Given `CLAUDE.md`
already declares Lore a dogfooding vehicle, this just makes the existing intent enforceable. Concrete
starting point: 4.1 above should land with the `FolioView` atom-patching converted.

### O3. Package-quality gates before 1.0 `S`
No `publint` and no `@arethetypeswrong/cli` anywhere in the repo, on a package that ships **78
export entries** across node/browser/workerd/bun conditions. The blast radius of one wrong
condition is silent and consumer-side. Both are single-line additions to the `verify` pipeline in
`alepha.config.ts`, alongside `sideEffects: false`.

### O4. Give the 78 exports a map `S`
The unified-package design is good, but the discovery story is a flat list. A single
*"Which module do I need?"* decision page — grouped by *transport / persistence / async / frontend
/ platform*, with the "you probably want X, not Y" pairs called out ($job vs $queue, $action vs
$route, $cache vs $memoize) — is cheap and disproportionately helpful.

### O5. Fix the two "load-bearing comment" spots `S`
`main.server.ts` ordering comments (9.1) and the `apps/lore/CLAUDE.md` migration grep gate (1.2)
are both cases where a human procedure substitutes for a framework guarantee. Both are listed above
with fixes; grouping them here because the *pattern* is the thing to watch for. Whenever an app has
to document a rule to stay safe, the framework owes it a check.

---

# Priority shortlist

If only five things get done, do these — each is evidence-backed by app-side pain, and each is
bounded:

| # | Item | Size | Why this one |
|---|------|------|--------------|
| 1 | Portable SQL helpers (1.1) | M | Deletes 56 raw templates + 10 dialect branches; the type-safety promise's biggest visible leak |
| 2 | ~~Migration safety gate (1.2)~~ | — | **Already shipped** — see the correction in 1.2 above |
| 3 | Resource-scoped `$secure` (2.1) | M | Every app hand-writes authz today; that's where authz bugs live |
| 4 | React query cache + invalidation (4.1) | M | `useQuery` has zero adopters without it; builds on `$atom`, not a new subsystem |
| 5 | `alepha/telemetry` (A) | L | Zero tracing on a framework that encourages distributed topology; ALS already in place |

**Correction note:** items 1.2 and 1.3 were asserted from the July 14 review and from
`apps/lore/CLAUDE.md` without checking the CLI source. 1.2 is implemented; 1.3 is unverified.
Every other claim in this document was read from source before being written.

Then the cheap wins: `$idempotent` (3.1), `Repository.exists()` (1.4), job progress (7.1),
`<Link prefetch>` (4.3), aggregate env validation (9.2), publint/attw (O3).

And in parallel, O1 (document the async stack) — because the best-differentiated part of the
framework is currently invisible to anyone who didn't write it.
