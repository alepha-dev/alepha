# Alepha Framework — Global Review #2

> **Date**: 2026-07-24
> **Scope**: `packages/alepha` — all 31 modules, ~1,140 source files, ~200k lines.
> **Method**: 11 parallel deep-review passes, one per module group. Every non-test source file in scope was read. Findings were verified by tracing the actual code path; several were additionally confirmed by executing the code (core state/codec bugs under Node 26, subscription/drizzle behavior against real Postgres). Speculative findings were discarded.
> **Companion**: `assets/REVIEW.md` (Jul 2026 architecture review). This document is code-level: bugs, unfinished work, and actionable recommendations, each with `file:line`.

## Executive summary

**269 findings: 1 P0 · 48 P1 · 129 P2 · 91 P3** (169 bugs, 50 unfinished, 50 recommendations) — 268 from the original passes, plus one P2 found by the eleventh-pass audit (`/api/_batch` 5xx leak).

> **Update 2026-07-25**: 157 findings closed — 146 fixed across twenty-one passes (marked ✅ FIXED), plus 11 retired with the deletion of `alepha/api/subscriptions` (marked 🗑️ REMOVED). An eleventh pass re-verified every closed finding against the tree by reading the actual code path; all hold.
>
> **Remaining: 112 open — 0 P0 · 0 P1 · 32 P2 · 80 P3.** Every P0 and P1 is closed. Counts here are derived from the ✅/🗑️ markers in the body, which are authoritative.

The framework's core abstractions are sound — password hashing, PKCE, SQL-injection defenses, SSR fork isolation, and the job-outbox hardening all checked out clean. The damage concentrates in four places:

1. **Multi-tenancy has real holes.** The single P0: an authenticated user with no organization hits `/subscriptions/mine/*` with `eq: undefined`, which the QueryManager silently drops — **no WHERE clause**, so they read and mutate an arbitrary org's subscription. The same `undefined`-swallowing shows up as `aggregate()` skipping tenant scoping, `upsert()` writing cross-tenant, JWT tenant-claim validation being dead code on the issuer path, and `checkPermission` resolving role names across all realms.

2. **The payments/subscriptions module is not production-ready.** The renewal billing loop creates payment intents but nothing ever charges them (and duplicates pile up hourly); churned orgs can never re-subscribe (unique-index 500, verified); `undefined` patches never clear columns so cancelled/dunning state persists forever (verified); expire-vs-capture and refund TOCTOU races can lose or over-refund money.

3. **Auth surface has classic web bugs.** Open redirect via `/\evil.com` (the correct helper exists but is never imported); OAuth auto-linking treats *missing* `email_verified` as verified (account takeover); API keys survive user disable/deletion; admin session API returns raw refresh tokens; chunked multipart uploads buffer unbounded (DoS).

4. **Runtime-divergence bugs are systemic.** The same call behaves differently across Node/Bun/workerd/Memory providers: sync-SQLite transactions commit before async callbacks finish (no rollback, on both Node and Bun paths); Bun Redis corrupts binary values with any SET option; Redis parameterized `$topic`s subscribe to a dead channel (total message loss); cache `incr` then `get` throws on KV/Redis but works on Memory; `$consumer` middleware is dropped on Cloudflare. The Memory-provider-first test culture hides exactly these: R2, CloudflareKV, Nodemailer, WebSocketClient, SubscriptionJobs, and BuildClientTask have zero test coverage.

## Top priorities

**All 20 are closed** (fixed, or retired with the subscriptions module). The table is kept as the record of what the review found, not as a work list — see the fix-pass sections for where each landed.

| # | Sev | Module | Finding |
|---|-----|--------|---------|
| 1 | P0 | api/subscriptions | Org-less user reads/mutates an arbitrary org's subscription (`eq: undefined` → no WHERE) |
| 2 | P1 | orm | SQLite `Repository.transaction()` + Bun `transactional()` commit before async work — rollback never happens |
| 3 | P1 | server/auth | Open redirect via backslash (`/\evil.com`) in `validateRedirectUri` |
| 4 | P1 | api/users | OAuth auto-link with missing `email_verified` → account takeover |
| 5 | P1 | api/keys | API keys keep authenticating after user disable/deletion |
| 6 | P1 | security | JWT tenant-claim check is dead code on the `$issuer` path; `checkPermission` merges roles across realms |
| 7 | P1 | api/payments | `expireStaleIntents` stomps captured payments; `refund()` TOCTOU over-refunds cash intents |
| 8 | P1 | api/subscriptions | Billing loop half-wired (intents never charged, hourly duplicates); re-subscribe permanently blocked; `undefined` patches never clear state |
| 9 | P1 | bucket | LocalFileStorageProvider path traversal via fileId |
| 10 | P1 | cache | Wildcard invalidation with zero matches wipes the whole container; `undefined` handler return poisons the key |
| 11 | P1 | topic/redis | Parameterized topics SUBSCRIBE a wildcard literal — silent total message loss |
| 12 | P1 | server | Multipart chunked-encoding unbounded buffering (DoS); required query params never validated; falsy handler returns become `"undefined"` |
| 13 | P1 | server | HttpClient GET dedup ignores auth headers — cross-user response sharing; `/api/_links` cache conflates anon with role-less users |
| 14 | P1 | system | `ShellProvider` capture path shell-injectable; signal-killed children report success |
| 15 | P1 | websocket | Node connection-id collisions across instances; client zombie auto-reconnect; `onLeave` throw leaks tick loops (billable DO spin on CF) |
| 16 | P1 | react | `useQuery` `enabled` false→true never fetches (permanent skeleton); query-only navigation skips loaders; cleared date input crashes |
| 17 | P1 | core | Keyless codec silently corrupts unions; fork-scoped `null` state leaks the app-level value |
| 18 | P1 | logger/datetime | Production JSON formatter throws on circular data; `travel()` double-counts elapsed time; `$interval` errors are unhandled rejections |
| 19 | P1 | redis | Bun `set` with options corrupts binary/compressed/non-ASCII values |
| 20 | P1 | cli | Custom `output.dist`/`public` breaks the client build (hardcoded `dist/public`) |

## Cross-cutting themes

These patterns each explain many individual findings — fixing them at the root is higher leverage than patching call sites:

- **`undefined` vs `null` semantics.** Drizzle drops `undefined` from both WHERE (`eq: undefined` → no condition) and SET (`col: undefined` → no-op). The framework never guards either. Root fixes: make QueryManager throw on `eq: undefined`; adopt `null` for column-clearing everywhere (JobProvider already does).
- **Unguarded read-modify-write on status transitions.** Payments (expire/capture/refund/session), jobs (sweep-vs-cancel, cancel-vs-complete), registration rate-limit, `LockPrimitive`. The entities even declare `db.version()` optimistic locking that `updateById` never uses. Root fix: status-guarded `updateOne({ id, status: { eq: … } })` as the standard transition pattern.
- **Options accepted but ignored.** `ValidateOptions`, `$etag` store TTL, rate-limit `keyGenerator`/`skip*`, `FakeProvider.locale`, `pwa.offline`, `$websocket.provider`, `Runner.rm/cp` `root`, `$audit.actions`, notification `sensitive`… Each is a silent lie in the public API. Sweep and either wire or delete.
- **Hooks declared but never emitted / payloads that don't match declarations.** `websocket:*` (4 hooks, zero emits), `subscription:*` (3 never emitted, the rest emitted `as any` with divergent shapes).
- **Provider behavioral divergence.** Same call, different result on Memory vs Redis/KV vs S3/R2/Local vs Node/Bun/workerd. Worth a shared conformance spec suite that every provider implementation must pass (the bucket/cache/topic `shared.ts` test pattern exists — extend it and run it against *all* providers including R2/KV/Bun).
- **Prod-unsafe defaults.** SMS silently uses MemoryProvider in production; mock checkout exposes an unauthenticated "mark as paid" endpoint when the default Memory payment provider is active; rate-limit module throttles everything at 100/15min just by being imported; `/metrics` is unauthenticated.
- **Logging gaps.** No secret redaction anywhere in the logger; production JSON formatter can crash the caller; `.catch(() => {})` swallowing in cache middleware, mkdir, and resolver loops despite the repo's own "never swallow" rule.

## Fixes applied — 2026-07-24 (same session)

20 findings were fixed immediately after the review; they are marked **✅ FIXED** in the body. Verified with `yarn lint`, `tsc --noEmit`, and the full alepha suite (382 files, 4252 tests, all green).

| Sev | Fix | Where |
|-----|-----|-------|
| P0 | `requireOrganization()` guard on every `/subscriptions/mine/*` handler — org-less users now get a 400 instead of an arbitrary org's subscription | `SubscriptionController.ts` |
| P1 | Open redirect: `validateRedirectUri` now rejects backslashes (`/\evil.com`) | `ServerAuthProvider.ts` |
| P1 | OAuth auto-link now requires `email_verified === true` (missing claim refuses the link); spec updated + new refusal test | `SessionService.ts` |
| P1 | Path traversal: `LocalFileStorageProvider.path()` rejects file ids containing `/`, `\`, or `..` | `LocalFileStorageProvider.ts` |
| P1 | Falsy handler returns (`false`/`0`/`""`) now serialize correctly (`result !== undefined`) | `ServerRouterProvider.ts` |
| P1 | `HttpClient` recognizes `application/json; charset=…` (startsWith match) | `HttpClient.ts` |
| P1 | Cache wildcard invalidation with zero matches is a no-op instead of wiping the container | `CacheProvider.ts` |
| P1 | `undefined` handler results are no longer cached (poisoned-key crash) — guard in `CachePrimitive.set` covers both primitive and middleware paths | `$cache.ts` |
| P1 | Signal-killed child processes now reject instead of resolving as success | `NodeShellProvider.ts` |
| P1 | Production JSON log formatter no longer throws on circular/BigInt data | `JsonFormatterProvider.ts` |
| P1 | `travel()` re-baselines `timeout.now` — no more double-counted elapsed time | `DateTimeProvider.ts` |
| P1 | `$interval` handler errors are caught and logged instead of becoming unhandled rejections | `$interval.ts` |
| P1 | Proxy preserves all upstream `Set-Cookie` headers via `getSetCookie()` | `ServerProxyProvider.ts` |
| P1 | WebSocket client: `manuallyClosed` flag stops auto-reconnect after intentional `disconnect()` (reset on `connect()`) | `WebSocketClient.ts` |
| P2 | WebSocket client reconnect uses bare `setTimeout` — no more `window` crash off-browser | `WebSocketClient.ts` |
| P2 | `isFileLike` returns false on near-miss shapes instead of throwing | `FileLike.ts` |
| P2 | `run()` exits 1 (not 0) after an `uncaughtException` | `core/index.ts` |
| P2 | `clearInterval` removes the interval from the registry — fixes the unbounded leak (the `useAction` re-render churn leg of that finding is still open) | `DateTimeProvider.ts` |
| P2 | `db check` hint now names the real command (`migrations create`) | `cli/core/commands/db.ts` |
| P2 | `ask.permission` accepts `N`/`No`/`YES` etc. | `Asker.ts` |
| P1 | Cleared/invalid date, time, and datetime inputs return `undefined` instead of throwing `RangeError` | `FormModel.ts` |

### Second fix pass — 2026-07-24

Three more findings fixed and marked **✅ FIXED** in the body (verified with `yarn v` — full pipeline including e2e green):

| Sev | Fix | Where |
|-----|-----|-------|
| P2 | `upsert()` conflict-UPDATE is now scoped to the caller's tenant + non-deleted rows via `setWhere`; a conflict on a tenant-agnostic unique key fails loudly instead of overwriting/resurrecting another org's row. Only org/soft-delete entities pay for it — plain entities keep the exact original statement. New cross-tenant regression test (both dialects). | `Repository.ts`, `organization-tests.ts` |
| P2 | `/realms/config` (unauthenticated) no longer returns `adminEmails` / `adminUsernames` — the response schema omits them (`publicRealmSettingsSchema`) and the handler strips them. New schema test. | `realmConfigSchema.ts`, `RealmController.ts` |
| P1 | HttpClient GET dedup + server-side ETag cache are now identity-scoped (hash of authorization/cookie), so the shared singleton can't hand one user another user's cached/in-flight response. Anonymous requests scope to "" → browser behaviour unchanged. | `HttpClient.ts` |

Deliberately **not** fixed in these passes (need design decisions or wider changes): the repository-level `eq: undefined` hardening (root cause of the P0 — needs a QueryManager contract decision), the SQLite async-transaction family, the registration rate-limit race (needs TTL support on `incr()` across all cache providers first — today `incr` never expires, so switching would permanently lock IPs out), `checkPermission` realm threading, and everything in the payments/subscriptions billing loop. → All of these except the billing loop were fixed in the third pass below.

### Third fix pass — 2026-07-24 (batches 1 & 2)

25 more findings fixed and marked **✅ FIXED** in the body. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (383 files, 4297 tests), `yarn test:bun` (44), the lore suite (298), and a clean `yarn w alepha build` (no circular deps). TDD throughout — every fix has a test that failed first.

| Area | Fix |
|------|-----|
| orm (root cause) | **QueryManager now throws on `undefined` filters** — both `where: { col: undefined }` and `{ col: { eq: undefined } }` raise `AlephaError` instead of silently dropping the WHERE condition. Kills the P0 class at the root; callers wanting optional filters must omit the key. |
| orm | `aggregate()` applies tenant scoping + soft-delete filter even without a `where` (was the one asymmetric read path). |
| orm | SQLite async-transaction family: `Repository.transaction()` routes sync-SQLite drivers through awaited BEGIN/COMMIT (`usesSyncTransactions`); `BunSqliteProvider` got the awaited `transactional()` override; concurrent `transactional()` blocks are serialized on the shared connection (mutex in `DatabaseProvider.runExclusiveNativeTransaction`). |
| system/cli | `ShellProvider.run` accepts an **argv array** (no shell, no parsing — injection-proof); string-form escaping switched to POSIX single-quotes (kills `;`, backticks, `$()`); `isInstalled` validates the name; `gh`/`git` call sites (GitHubSecretStore, VendorService, changelog `--from/--to`) migrated to argv form. |
| payments | `expireStaleIntents` uses a status-guarded claim (never stomps a captured payment); `createSession` claims `created → processing` before the PSP call (no double sessions / orphaned payments, releases claim on PSP failure); `refund()` reserves via pending-refund row + version-guarded claim in a transaction — concurrent refunds can no longer over-refund (verified by an 8-way concurrent test). |
| jobs | Sweep promotes due rows with a status guard (`promoteScheduled` cannot resurrect a cancelled execution; per-row failure containment); `cancel()` uses a guarded update so it can't stamp `cancelled` over a terminal row. |
| lock | `LockProvider.delIfOwner` (+`get`) — compare-and-delete release in the `$lock` middleware and `LockPrimitive`; a finisher whose lock expired no longer deletes the next holder's lock; `setGracePeriod` only extends a lock still owned; `LockPrimitive.run` uses a per-invocation id (overlapping calls on one instance are now mutually exclusive). |
| api/keys | API keys die with their account: `createResolver({ validateOwner })` re-checks the owner on every validation; `$realm` wires it to the realm user repo — disabled or deleted users' keys stop authenticating immediately. |
| security | JWT tenant-claim anti-replay check extracted to `SecurityProvider.matchesTenantClaim` and wired into the `$issuer` resolver (was dead code on the primary auth path); `checkPermissionInRealm` resolves role names within the caller's realm (used by `$secure`, `createUser`, `createUserFromToken`) — realm-A's `admin` no longer leaks its permission set to realm-B users. |
| server | Multipart bodies stream through a counting limiter that aborts past `limit` — chunked (no content-length) uploads can no longer buffer unbounded RAM; required query parameters are validated (missing required → 400 instead of `undefined` reaching the handler). |
| users/verifications | Registration checks captcha BEFORE availability (no email/username enumeration without solving a captcha); IP rate limit uses atomic `incr()` (concurrent bursts can't sail past the threshold); `incr()` gained fixed-window TTL support across ALL cache providers (Memory, Database, Redis node+bun, KV) with a shared conformance test — counters expire instead of permanently locking IPs out; already-verified verification codes now burn the attempt budget and lock (no infinite guessing). |
| users | Admin session API no longer returns `refreshToken` (schema + `SessionCrudService` projection). |
| prod defaults | SMS resolves `LocalSmsProvider` outside tests (memory = silent message loss in prod); mock-checkout endpoints refuse production unless `mockCheckoutOptions.allowInProduction` is set; `/metrics` supports a `METRICS_TOKEN` bearer guard (+ prod warning when unset); registering the rate-limit module no longer throttles every route at 100/15min — global limiting is opt-in, per-route limits keep sane defaults. |

### Fourth fix pass — 2026-07-24 (batch 3 — provider divergence / silent data loss)

8 more findings fixed and marked **✅ FIXED** in the body. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (385 files, 4308 tests), `yarn test:bun` (46), the lore suite (298), and a clean `yarn w alepha build`.

| Area | Fix |
|------|-----|
| topic/redis | Parameterized `$topic`s now PSUBSCRIBE their wildcard pattern (`RedisSubscriberProvider.pSubscribe`/`pUnsubscribe`; Bun's client lacks PSUBSCRIBE and now fails loudly instead of subscribing a dead literal channel). The subscriber callback also gets the concrete channel with the Redis prefix stripped, so param extraction works. `testTopicParams` is wired into the Redis spec. |
| queue | `WorkerdWorkerProvider` registers `$consumer`s through the pipeline-wrapped handler — `use` middleware ($retry, $lock, ...) now runs on Cloudflare like on Node. |
| redis/bun | `set` with expiration options goes through Bun's typed native API (binary-safe raw bytes); the conditional NX/XX/GET path (raw `send`, UTF-8-encoded args) refuses non-ASCII values loudly instead of silently corrupting them. Binary + UTF-8 round-trip tests added to the Bun spec. |
| orm | `findMany` with offset-and-no-limit no longer truncates at 1000 on SQLite (effectively unbounded limit) and no longer mutates the caller's query object. |
| orm | Non-key `z.bigint()` columns are stored as TEXT on SQLite/D1 — exact round-trip beyond 2^53, matching Postgres (auto-increment bigint PKs stay INTEGER rowids). |
| cache | `getTyped` after `incr` works on every provider — unmarked ASCII-digit payloads (Redis INCRBY / KV) deserialize as numbers instead of throwing `Unknown serialization type`. Conformance test wired into Memory/Database/Redis specs. |
| bucket | S3 `delete()` of a missing id throws `FileNotFoundError` like Memory/Local/R2 (explicit existence check — S3 DELETE is idempotent). The shared `testDeleteNonExistentFile` now actually deletes a non-existent id, on every provider. |
| cache | SWR envelope uses a distinctive marker (`__alepha_swr_envelope__`) so user data can never be mistaken for it, and `Uint8Array` values are base64-wrapped inside the envelope instead of being JSON-mangled. |

### Fifth fix pass — 2026-07-24 (batch 5 — react DX)

6 more findings fixed and marked **✅ FIXED** in the body. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (4319 tests), the lore suite (298), and a clean build.

| Area | Fix |
|------|-----|
| react/core | `useQuery` `enabled` false→true starts the fetch (the `runOnInit` effect now keys on it) — the `enabled: !!userId` gate pattern no longer leaves a permanent skeleton. |
| react/core | `useAction` gained a public `refetch()` with dep-change supersede semantics (aborts the in-flight request); `useQuery.refetch()` uses it — no longer a silent no-op during slow fetches or active polls. |
| react/router | Anchor-click semantics centralized in `ReactRouter.shouldHandleAnchorClick`: `anchor()`, `<Link>`, and `useActive` all let modified/aux clicks and `target="_blank"` fall through to the browser; `<Link>` composes the caller's `onClick` (preventDefault opts out of SPA navigation). |
| react/router | Query-only navigations re-run loaders — the decoded query participates in the layer-reuse signature, matching SSR behavior. |
| react/router | `useQueryParams` subscribes to router state (navigations it did not initiate re-sync it), and `setQueryParams` updates the router store alongside `window.history` so `router.query` never desyncs. |

### Sixth fix pass — 2026-07-24 (batch 6 — websocket / rooms)

5 more findings fixed and marked **✅ FIXED** in the body. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (4324 tests), `yarn test:bun` (46), the lore suite (298), and a clean build.

| Area | Fix |
|------|-----|
| websocket/RoomEngine | A throwing `onLeave` no longer aborts teardown (same try/catch contract as `onEmpty`) — the tick loop stops and `onEmpty` still persists. This was an indefinite billable spin on Cloudflare Durable Objects. |
| websocket/RoomEngine | A rejecting `state` factory no longer latches the room broken: the cached rejection is cleared so the next `join`/`call` retries (a headless coordinator reached via `call()` previously needed a process restart). |
| websocket/node | Connection ids are `ws-<uuid>` instead of a per-process counter — with 2+ instances behind the topic bus, instance B's `ws-1` used to receive messages addressed to instance A's `ws-1`, and `exceptSelf` excluded the wrong sockets everywhere. Matches the Cloudflare path. |
| websocket/node | Room message/close handlers are gated on the `join` promise: a disconnect during an async `state` factory no longer leaves a ghost socket that keeps the room non-empty forever, and frames arriving before join resolves are delivered instead of dropped. |
| websocket/node | A frame-level `roomId` is honored only for rooms the connection actually joined — a client could previously address (and broadcast into) any room per-frame. Cloudflare already refused this (`assertReplyRoom`); the runtimes now agree. |

Note: connection ids changed format (`ws-1` → `ws-<uuid>`). Three integration assertions encoding the old sequential shape were updated.

### Seventh pass — 2026-07-24 (batch 4 — `alepha/api/subscriptions` DELETED)

The billing loop was never fixed: **the module was removed instead** (27 files, ~3,525 lines). Evidence that made this the right call rather than a redesign:

- **Dead in every real consumer.** Lore never imported it. The one app that registers it (`apps/club`) configures zero plans, has zero rows, and calls nothing — its two framework tables have sat empty since creation, while six framework crons ran hourly/daily in every pooled worker against them. The app that actually bills customers (`apps/platform`) never registered the module at all.
- **Its core premise was disproven in production.** The module's own guide claimed "the recurring billing logic stays in Alepha rather than being delegated to the PSP". The real-world app settled on the opposite and shipped it: Stripe owns recurrence (`mode: "subscription"` checkout) and dunning (Smart Retries), and the app is a pure webhook consumer reconciling one status field. No app-driven charging cron exists anywhere in that codebase, and its roadmap points further down the PSP-rails path (SEPA mandates), not back toward local charging.
- **The loop could not be completed without the framework taking on card-holding and retry orchestration** — a responsibility the PSP already owns and does better.
- **It was a leaf**: no other framework module imported it, so removal is contained.

11 findings (1 P0, 4 P1, and the unfinished/reco tail) are closed by deletion — marked **🗑️ REMOVED** in the body. `alepha/api/payments` stays and is unaffected: it is the one-off/intent layer the real apps use heavily (bookings, wallet top-ups, shop sales, courses, split payments, refunds).

The payments guide now states the recurring-billing stance explicitly: let the PSP own it, reconcile status from webhooks.

**Downstream action — DONE (2026-07-24).** `apps/club` no longer registers the module. Its `subscriptions` / `subscription_events` tables are orphans; nothing FKs to them, so dropping them whenever migrations are next regenerated is safe (no D1 cascade hazard).

### Eighth pass — 2026-07-24 (hygiene)

5 more findings fixed. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (4314 tests), `yarn test:bun` (46), the lore suite (298), and a clean build.

| Area | Fix |
|------|-----|
| logger | **Secret redaction.** `Logger.log` now masks credential-bearing keys (`authorization`, `cookie`, `password`, `token`, `apikey`, `secret`, `credential`, …) anywhere in `entry.data` — nested, inside arrays, matched case-insensitively ignoring `-`/`_` — before any formatter, destination, or the devtools log viewer sees it. One `log.debug("req", { headers })` used to ship bearer tokens to stdout and the aggregator. Errors pass through untouched (formatters depend on the instance), cycles are handled, and redaction can never throw. |
| fake | `FakeProvider.locale` is wired: `configure({ locale })` swaps the faker instance (falling back to `en` for keys a locale doesn't define) instead of being silently ignored. An unknown locale now throws rather than pretending to work. |
| api/audits | `$audit` enforces its `actions` allow-list in `log()`. A typo'd action used to be recorded silently and was then unfilterable — the admin filter options are built from that same list. |
| api/notifications | The `sensitive` flag does something: admin detail responses withhold the rendered `variables` (reset links, codes, personal data) for templates marked sensitive. The option is also documented now — it had no JSDoc at all. |
| api/payments | **CI follow-up:** `refund()`'s reservation no longer runs inside `transactional()`. Several refunds issued in the same async context joined one ambient transaction, so a loser's rollback erased the winner's reservation — one refund reported success while the intent stayed `captured` (flaky, ~1 run in 6; caught by CI on the removal commit). The version-guarded UPDATE is itself atomic and is all the mutual exclusion this needs. |
| websocket | The four declared `websocket:*` hooks (`connect`, `disconnect`, `message`, `error`) are emitted by the Node provider. They were documented "Fires when …" and never fired. Emission is fire-and-forget so a subscriber cannot break the connection it observes. |

### Ninth pass — 2026-07-24 (security-adjacent P2s)

8 findings fixed. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (4318 tests), `yarn test:bun` (46) and the lore suite (298).

| Area | Fix |
|------|-----|
| cli | Deploy secrets no longer land in a guessable `/tmp/alepha-secret-<KEY>-<ts>` path any local user could read (or pre-create and have us write into). They go to a per-invocation, randomly-named directory created mode `0700` under `node_modules/.alepha/secrets/`, removed in `finally`. |
| cli | `ALEPHA_SECRETS_HASH` is no longer a bare sha256 of `KEY=VALUE` lines in a *readable* binding — an offline brute-force oracle for low-entropy secrets, defeating the point of Cloudflare's write-only secrets. Now `v2:<salt>:<scrypt digest>`: the salt kills precomputation, the KDF cost makes guessing expensive, and the skip-if-unchanged cache still works (the salt is stored alongside and reused for comparison). v1 values are treated as a miss and upgraded in place. |
| server | `HttpError.toJSON` no longer ships the internal `cause` (and `details`) to clients for 5xx in production — the same rule the non-HttpError branches already applied to `message`. 4xx causes are deliberate, client-facing context and are kept. |
| server/auth | OIDC discovery only relaxes TLS for genuinely local issuers (`http://localhost` and friends) or outside production. It was applying `allowInsecureRequests` unconditionally, disabling HTTPS enforcement on discovery and token exchange for every deployment. |
| security | `jwtVerify` pins an `algorithms` allowlist wherever the algorithm is known — `HS256` for symmetric secrets, the configured `alg` for signing keys. External JWKS URLs stay unpinned, since the IdP owns and may rotate its algorithm. |
| crypto | `BrowserCryptoProvider.randomCode` no longer hangs for length ≥ 10. `10 ** length` overflowed the Uint32 range, flooring the rejection-sampling limit to 0 so the loop could never exit. Digits are now drawn independently (bias-free, no length ceiling), matching the Node provider. |
| api/keys | API keys can no longer outlive a demotion: the owner hook resolves the owner's *current* roles and the key's stored snapshot is intersected with them. A key minted while its owner was an admin stops granting admin the moment they are demoted, while a deliberately narrow key never widens on promotion. |
| security | Token-only refresh (no `onRefreshSession`) documented where the choice is made: the option now spells out that omitting it re-issues whatever roles the expired token carried, so a revoked user keeps privileges until the refresh token expires (30 days by default), and that idle invalidation is unavailable. |

### Tenth pass — 2026-07-24 (jobs + parameters)

5 findings fixed. Verified with `yarn lint`, `tsc --noEmit`, the full alepha suite (4322 tests), `yarn test:bun` (46) and the lore suite (298).

| Area | Fix |
|------|-----|
| api/jobs | The lease heartbeat no longer stops on *any* error — only when the row is gone or no longer `running` (`shouldStopHeartbeat`). A transient DB blip used to kill it while the handler kept running; once `crashThresholdMs` elapsed another instance's sweep declared the lease crashed and re-dispatched, producing a **duplicate concurrent execution**. Transient failures now log and retry on the next tick. |
| api/jobs | The sweep's three phases are contained independently (`sweepDue` / `sweepStale` / `sweepCrashed`, each wrapped by `sweepPhase`), with per-row containment inside the crash-recovery phase. One bad row — or one failing `findMany` — used to abort the whole tick, stranding every remaining due/stale/crashed row for 15 minutes. |
| api/jobs | Per-job `keep.ok` is honoured on the success path. The two zeros mean opposite things *by documented design* — per-job `{ ok: 0 }` is "keep forever, never trim", global `keepLastSuccess: 0` is "delete on success" — and the success path only ever read the global. Any explicit per-job value now retains the row; the global's delete-on-success applies only when the job is silent. This was destroying the audit trail of `alepha/api/notifications`, whose job declares `record: "all", keep: { ok: 0 }` and describes itself as keeping every execution for audit. |
| api/parameters | A failed load no longer poisons the parameter forever. The in-flight promise is cleared in `finally`, so a rejected load isn't re-awaited by every subsequent `get()` until the process restarts. |
| api/payments | **CI follow-up (second):** the refund reservation is inserted BEFORE the version claim again. Removing the transaction in the previous pass also inverted that ordering, opening a window where a competitor observes the bumped version but not yet the new refund row — three concurrent 500s all passed a "1000 remaining" check and over-refunded a 1000 payment. Callers read version→refunds, so insert-before-claim guarantees anyone seeing version N+1 also sees the reservation. The spec now asserts the money invariant (total refunded ≤ captured) directly at 12-way concurrency. |
| api/parameters | `delete()` / `deleteMany()` publish on the sync topic like `save()` already did. Without it other instances served the deleted value indefinitely — the Node default TTL is 0, so nothing revalidates. |

Still deliberately open: the rate-limit `"unknown"`-IP shared bucket (only reachable when a global limit is explicitly configured).

### Eleventh pass — 2026-07-24 (audit of the closed findings)

Every finding marked ✅ FIXED / 🗑️ REMOVED above was re-verified against the tree by reading the actual code path. All 96 closed at that point hold. The audit surfaced one **new** finding and two corrections:

| Area | Item |
|------|------|
| server/links | **NEW P2 — `/api/_batch` leaked raw 5xx messages in production.** The batch handler returned `reason.message` verbatim for every failed sub-action, with none of the sanitization `sendError` applies on the single-request path — so a 500 shipped DB connection strings and credentials to the client. This is the path the React client uses by default (`BatchCollector`), making it the *more* likely leak of the two. Now mirrors `sendError`: 5xx in production → `"Internal Server Error"`, 4xx messages kept. Test-first (`BatchEndpoint.spec.ts`, failing → green); documented in `docs/1-guides/4-server/5-error-handling.md` under "Production Sanitization". |
| server | **Correction.** The ninth-pass table credits the 5xx-cause fix to `HttpError.toJSON`. The guard actually lives in `ServerRouterProvider.sendError` (:416-421) — `toJSON` still emits `cause` unconditionally. Behaviorally correct (the router is the only non-test caller), but the fix is a *call-site* guard, not a serializer guard: anything that serializes an `HttpError` itself must apply the rule too. Exactly what the batch endpoint failed to do. |
| server | **Hygiene.** `HttpClient.identityScope` built its cache-key separator from **literal** `\x00` / `\x01` bytes in the source. That made the whole file binary to `grep`, `git diff`, and code search — all of which silently return nothing rather than erroring. Replaced with `\u0000` / `\u0001` escapes: identical runtime value, file is text again. |

### Twelfth pass — 2026-07-24 (the remaining P1s)

All 11 P1s that were still open are fixed — **no P1 or P0 remains**. TDD throughout: every fix has a test that failed first. Verified with `yarn lint`, `tsc --noEmit`, a clean `yarn w alepha build` (no circular deps), and the full suite (757 files, 8468 tests).

| Area | Fix |
|------|-----|
| server/links | `/api/_links` is cached per identity, not per role string. `roles: []` on an authenticated user produced the same `""` key as an anonymous visitor, so whichever request landed first poisoned the other — either leaking secured actions to anonymous callers or hiding them from logged-in ones until restart. The key now carries authentication itself and the realm (`$secure({ issuers })` filters on it, and realm A's role names are not realm B's). |
| server/cors | `OPTIONS` twins are created for **every** path, GET included — a cross-origin GET carrying `Authorization` is preflighted, and that preflight used to 404 with no CORS headers, so the browser blocked the real request. Twins are deduped per path (a path with POST *and* PUT used to register two). Responses now carry `Vary: Origin` (the allowed origin is reflected, so a shared cache could hand origin A's response to origin B) — and `ServerCompressProvider` appends to `Vary` instead of overwriting it. `origin: "*"` + `credentials: true` is refused with a startup warning: reflecting an arbitrary origin *with* credentials is exactly what the browser's own wildcard-plus-credentials ban prevents. |
| server/core | Streamed response bodies go through `stream.pipeline`. **Correction to the original finding:** on Node 26 a failing `Readable` does not crash the process — `pipe` unpipes and leaves the response open, so the client hangs forever and the socket leaks (verified: the request never settled within 3s). `pipeline` tears both ends down, so the client sees a truncated response and the connection is released. Same for the compressor pipe. |
| server/core | `$sse` handlers learn about disconnects: the stream implements `cancel()`, the handler context gained `signal: AbortSignal`, and `emit()` returns `false` once the stream is over. `ServerProvider` races the reader against the response's `close` event and cancels it when the client goes away — nothing used to notice, so one disconnected client meant one handler looping forever. |
| server/etag | `store`'s TTL reaches `cache.set` on all three write paths (action, response, streamed). **Correction:** responses were not cached *forever* — the configured TTL was dropped and the cache's own 300s default silently applied instead, so `store: { ttl: [1, "hour"] }` got five minutes. Separately, stored entries are namespaced by caller identity: `$etag(true)` on an authenticated action served the first caller's body to everyone else. `invalidate()` clears the whole route (wildcard) so it still reaches every caller's entry. |
| react/core | `runEvery` polling survives re-renders. The effect keyed on `runAction`, whose identity changes every render because of `useQuery`'s inline `onSuccess`, and on the `runEvery` tuple, which is a fresh array each render — so a component re-rendering faster than the period never polled once (verified: 0 calls over 300ms at a 60ms period). It now keys on the period's millisecond value and calls through a ref. |
| react/form | `useFormQuerySync`'s form→URL direction fires: the listener compared `form:change`'s slash-prefixed path (`/status`) against bare key names, so the whole direction was dead code. Both write paths use `setQueryParams`' updater form, so query params the form doesn't own survive. First test coverage for this hook. |
| core/state | A fork that writes `null` or `undefined` shadows the app-level value. `get()` coalesced the ALS result into the app store, so a request-scoped nullable atom set to "logged out" read another layer's value back. `AlsProvider.has()` gained scope awareness so presence is distinguishable from a present-null. |
| core/codec | The keyless codec refuses what it cannot represent instead of corrupting it: unions (it resolved one by taking the first non-null variant, encoding variant B with A's layout) and a top-level optional/nullable object (encodes flat, decodes one slot). Field-level `optional`/`nullable` are unaffected. Nothing in-tree opts into `encoder: "keyless"` yet, so this closes the trap before anyone falls in. |
| cli | `postBuildCleanUpForIndexHtml` receives the directory Vite actually built into. It defaulted to a hardcoded `dist/public`, so any customised `output.dist`/`output.public` failed the build on a manifest that wasn't there. The parameter is now required so the default cannot drift back. |
| websocket | The server stamps the room on outbound frames (`__alephaRoom`, stripped before validation and before the handler sees it) and the client dispatches to that room's handler only. One socket serves every room a client subscribed to, so room A's messages were delivered to room B's handler — the acknowledged TODO. Unlabelled frames (channel-wide emit) still reach every subscriber. Both the Node provider and the Durable Object path stamp it, so the runtimes agree. |

### Thirteenth pass — 2026-07-25 (routing)

The four routing findings, taken together because they share one root: path segments were matched greedily and carried around raw.

| Area | Fix |
|------|-----|
| router | `createRouteMatch` is a depth-first search with backtracking instead of a greedy walk. With `/a/{x}` and `/a/b/c` registered, `/a/b` descended into the static `b`, found no route and gave up — **404 on a route the caller declared**. A failed subtree now returns `undefined` and the caller tries the next alternative at its own level (static, then param, then wildcard). |
| router | The wildcard fallback carries its capture. Unwinding from a dead-end to `/users/*` produced `params` with **no `*` entry at all** (static file serving and catch-alls read `undefined`), plus whatever params had been captured on the abandoned branch. Params are now attached while unwinding a *successful* branch only, so a stale capture cannot leak. A wildcard matching its own prefix (`/useRs/:name/x/*` on `/users/JACK/x`) reports `"*": ""` — an empty capture rather than a missing one, matching what the root wildcard already did. |
| router | Path params and wildcard captures are percent-decoded, per segment. Query values already were, so `?q=john%20doe` arrived decoded while `/:id` arrived literal. A malformed escape (`100%`) is kept verbatim instead of throwing — a bad escape in a URL is a 404 at worst, never a 500. Both server adapters go through `router.match`, so this lands on the Node and web paths at once. |
| server/react | Every path-building site got the same three fixes: values are percent-encoded, the token is matched whole (`/a/:idType/:id` used to compile to `/a/1Type/:id` because `:id` ate the prefix of `:idType`), and a replace *function* keeps `$&` / `$'` in a value literal instead of expanding them as substitution patterns. `HttpClient.pathVariables` and `$sse.buildFetchUrl` were named in the finding; `ReactPageProvider.compile` (what `router.push(name, params)` and `<Link>` put in the address bar) and `$sitemap.buildPathFromParams` have the identical defect and are fixed with it — with the server now decoding, an unencoded client is no longer symmetric-but-wrong, it is simply wrong. |

Note: three assertions in `RouterProvider.spec.ts` encoded the old behaviour — a leaked `name` on a wildcard fallback and two missing `*` captures. They were updated, with a comment saying why.

### Fourteenth pass — 2026-07-25 (orm — silent data correctness)

Five findings whose common shape is a write or a schema that goes wrong without saying so.

| Area | Fix |
|------|-----|
| orm/ModelBuilder | A column named by `indexes` / `foreignKeys` / `constraints` that does not exist is now an error naming the entity, the column and the known columns. Every one of those paths used to guard with a truthiness check and *skip* the config: a typo produced no index, no foreign key, no constraint, and no error — migration generation then emitted a schema quietly missing it. The check runs **eagerly** at build time, because drizzle stores the extra-config closure and only invokes it later during migration generation, which is far too late to be useful. TypeScript already rejects the typo at the call site; this covers `as any`, dynamically built entities and JS consumers. |
| orm/postgres | `z.any()` (and `z.array(z.any())`) map to `jsonb`, matching the sqlite JSON mapping. The postgres builder had no `isAny` branch and threw `Unsupported schema type` at startup, so an entity developed against the sqlite dev driver broke on a postgres deploy. |
| orm/postgres | **Correction — the finding was backwards.** `format: "binary"` is broken on **postgres**, not sqlite. `z.binary()` is a *string* carrying `format: "binary"`, and sqlite round-trips it correctly through its JSON text column. Postgres declared the `bytea` column as `data: Buffer`, so the row returned by an insert carried a Buffer, failed schema validation in `Repository.clean()`, and a `z.binary()` column could not be written at all (verified: `expected string, received Buffer at /payload`). The `byte` type now exchanges base64 while still storing real bytes. First test coverage for binary columns, on both dialects. |
| orm/Repository | The `upsert()` ON CONFLICT `set` payload goes through the same validation and codec encoding as every other write path — the `cast()` call had been commented out. This is not cosmetic: sqlite is dynamically typed, so an invalid value was **written**, and the row could only be read back as a validation error afterwards (verified). `cast` lifts raw SQL expressions out before validating and re-attaches them, so `set: { hits: sql\`hits + 1\` }` still works. |
| orm/Repository | A missing column is reported as `DbColumnNotFoundError`, not `DbTableNotFoundError`. On a write, postgres says `column "x" of relation "y" does not exist` — containing both "does not exist" and "relation", so it matched the table branch first: the one message that names the column was the one that hid it. The existing test only covered the `SELECT` form, whose message omits "relation" and so happened to classify correctly. |

### Fifteenth pass — 2026-07-25 (auth + cookies)

| Area | Fix |
|------|-----|
| security/JwtProvider | Token-validity failures throw `InvalidTokenError` (401) instead of `SecurityError` (403). **Scope correction:** the finding says this "can break refresh flows"; at the HTTP boundary it does not, because `$secure` catches the error and answers its own 401 (verified: both a malformed and an expired token already returned `401 UnauthorizedError`). The 403 is real for every *direct* `jwt.parse` caller — issuer refresh, OAuth code exchange — which propagate it as-is. Tested there, where it is observable. `SecurityError` keeps its 403 for genuine authorization denials, and a valid token from the wrong realm still answers 403. |
| server/cookies | A cookie is deleted with the `Path` and `Domain` it was declared with. The deletion emitted a bare `name=; Path=/; Max-Age=0`, and a browser only drops a cookie when the deletion matches its scope — so `$cookie({ path: "/admin" })` or any domain-scoped cookie could never be deleted. `deleteCookie` takes the scope, `$cookie.del()` forwards its own options, and the serializer no longer discards an explicit `Max-Age=0` deletion for having an empty value. |
| server/auth | `Referer` is parsed defensively. `new URL(referer)` threw on the non-URL values browsers legitimately send from sandboxed origins, so `GET /oauth/login` answered **500** (verified). |
| server/auth | The token cookie lives as long as the *refresh* token. `expires_in` was used as a fallback Max-Age, and Google reports only `expires_in` (3600) alongside a long-lived refresh token — so the session cookie died after an hour. With no refresh expiry reported the `$cookie` default (30 days) now applies; `expires_in` is still used when there is no refresh token at all, where the session really does end with the access token. |
| server/auth | The `fallback` object form works. `AccessToken` admits `{ token: () => Async<string> }` — the form the JSDoc example uses, passing a `$serviceAccount` — but the value was interpolated straight into the header, producing `Bearer [object Object]` (verified). |

### Sixteenth pass — 2026-07-25 (cli)

Nine of the ten open CLI findings. The tenth (`platform build`/`deploy` emitting configs with missing bindings) is left open deliberately: fixing it means resolving existing D1/KV ids from the Cloudflare API inside `build()`, which is a design change, not a patch, and cannot be tested without a mocked CF API.

| Area | Fix |
|------|-----|
| cli/verify | `alepha verify` runs the tests of a project that uses the framework's own co-located convention. Gating on a `test/` directory alone meant `src/**/*.spec.ts` projects got a **green verify having executed zero tests** — worse than no verification, because it reports success. |
| cli/gen | `gen env` and `gen openapi` exit non-zero on failure. Both caught everything, logged, and returned — and the CLI only exits non-zero when the handler throws, so a failed generation reported success to CI while writing nothing. |
| cli/gen | `gen openapi` looks the swagger provider up **by name**. The user's container comes from Vite's SSR module graph, so a class imported in the CLI is a different object for the same source: `inject(class)` missed, silently built a *duplicate* CLI-graph provider, and the "Service not found" branch was unreachable. |
| cli/build | `--image=1.3.4` names the image `<configured-tag>:1.3.4`, as the flag documents ("`-i=<version>` for specific version"). A bare value was taken as the image *name*, so it silently built `1.3.4:latest`. The explicit `:version` and full `name:tag` forms are unchanged. |
| cli/build | `--prebuilt` with the `static` or `vercel` target fails with an explanation instead of a `TypeError`. `ctx.alepha` is null in manifest mode and neither task checked. |
| cli/pack | The artifact name is slugified: `@acme/app` produced `@acme/app-latest.tar.gz`, whose path separator pointed tar at a directory that does not exist. |
| cli/dev | Multi-app `dev` spawns the detected package manager (npm/pnpm/bun workspaces failed outright on the hardcoded `yarn`) and uses a shell on Windows, where the managers are `.cmd` shims. Ports are numbered over the **full** app list, so `--only api` no longer moves `api` from 5174 to 5173 — OAuth redirect URIs and client configs are pinned to those ports. |
| cli/AppEntryProvider | A missing `src/` yields no candidates instead of a raw ENOENT. The conventional-locations scan ran even when the project configured its entries explicitly. |
| cli/db + platform | Interpolated paths are quoted in the drizzle-kit and `wrangler d1 export` shell-outs. *No test:* both need a booted app with real providers to reach; the change is two characters and the neighbouring `sqlite3` line already quoted correctly. |

Two `MemoryFileSystemProvider` divergences surfaced while writing these tests and are fixed with them — the memory provider was **more forgiving than the node one**, so a test could pass while production crashed:

- `mkdir(path, { recursive: true })` rebuilt parents without the leading slash, registering `/app/src` as `app/src`, so `exists("/app/src")` said no. The existing recursive test used a *relative* path, which is why it never caught this.
- `ls()` returned `[]` for a directory that does not exist, where the node provider (a raw readdir) throws ENOENT. This is exactly what hid the `AppEntryProvider` bug from its own test. Making it faithful broke nothing across 3,926 tests.

### Seventeenth pass — 2026-07-25 (CI race, not from the review)

CI had been intermittently red for days, hitting a *different* concurrency test each run (`PaymentService` over-refund ×2, `$job` cancel race, `$job` direct mode, `ApiKeyService` revocation). Two of those were chased down here; neither came from a REVIEW_2 finding.

| Area | Fix |
|------|-----|
| api/keys | **A revoked API key kept authenticating for up to 15 minutes.** `revoke()` invalidated the validation cache and *then* wrote the row, so a validation already in flight — one that had read the pre-revocation row — wrote it straight back afterwards. `invalidate()` cannot prevent that: it runs before the racing `set`. The service now bumps a `revocationEpoch` on both sides of every revoking write (`revoke`, `revokeByAdmin`, `revokeManyByAdmin`), and `validate()` snapshots it before its read and declines to cache a result whose read spanned a revocation. Reproduced deterministically first — same assertion CI produced (`expected { …(2) } to be null`) — via a `findByTokenHash` seam that holds the read open. |
| api/jobs (test) | `push without a queue dispatcher processes the row in-process` waited for the handler to run and then immediately asserted the execution row was gone. The delete happens *after* the handler returns, so on a loaded runner the assertion read the row mid-flight. The test now polls for the cleanup instead of the handler. A test bug, not a code bug. |

**Correction.** An earlier draft of this section listed `PaymentService` over-refund and `$job` cancel race as still-outstanding flakes. They are not: each was fixed by the commit immediately after the run that caught it — `fe563ef65` and `91c7f1dd6` for the two payments failures (the eighth and tenth passes, labelled "CI follow-up" above), and `1352f016a` for the cancel race. Re-verified here under contention: the payments spec ran 22× (10 sequential + 12 at 4-way parallelism, 550 test executions) and the jobs spec 8× at 4-way parallelism, all clean.

That is the standing pattern in this repo: CI catches a concurrency bug that local runs cannot, and the next commit fixes it. Every historical race failure listed above has been resolved. There is no known outstanding flake.

### Eighteenth pass — 2026-07-25 (queue, topic, retry, batch)

Seven findings whose shared shape is *silently stops working* — nothing throws where anyone can see it.

| Area | Fix |
|------|-----|
| queue/WorkerProvider | **A single `pop()` failure killed background processing for good.** `getNextMessage` was unguarded, so one transient backend error (a Redis blip) escaped the worker loop into the `.catch` that logs "crashed" and decrements `workersRunning` — at the default concurrency of 1 the queue stopped being polled entirely, with nothing to restart it but a local `push()`. The fetch is now guarded and backs off on the existing interval schedule. |
| topic/TopicProvider | `waitForMessage` no longer hangs forever. The subscribe call sat in an un-awaited async IIFE with no catch, so a rejection was swallowed and neither `resolve` nor `reject` ever ran — and the timeout was armed only *after* subscribe resolved, so there was no deadline to rescue the caller (verified: the test hit vitest's 10s limit). The timeout is armed first, subscribe failures reject, and a retained message delivered synchronously from inside `subscribe` no longer leaks its subscription. |
| retry/RetryProvider | **A success that lands late is a success.** After the handler returned, elapsed time was re-checked and `RetryTimeoutError` thrown — discarding a result whose side effects were already committed, so an outer layer (`$job`) re-ran work that had already completed. `maxDuration` bounds *retrying*; it no longer turns slowness into duplicate execution. A failing handler that exceeds it still times out. |
| retry/$retry | The app-level `AbortController` is cleared on stop, not merely aborted. `??=` kept reusing the aborted one, so after a stop→start cycle every retry threw `RetryCancelError` immediately for the rest of the process. Both the middleware and the primitive had it. |
| batch/BatchProvider | `maxQueueSize` rejection no longer leaks. The item state was registered before the check threw, so the entry stayed `pending` forever with no id the caller could use — the map grew on every rejected push, i.e. sustained backpressure leaked memory. Verified: 5 rejected pushes left 5 orphans. |
| queue/$queue | `push` encodes and the worker decodes, the pairing `$topic.publishMessage` already uses. It used to `decode` an already-runtime payload, so nothing ever encoded. **No observable change today** — probed `encode` vs `decode` across dates, defaults, optionals and nested objects and they are byte-identical with the current codec — so this closes a latent trap rather than a live bug. |
| queue (docs) | The module JSDoc and `$consumer` advertised "retry mechanisms with exponential backoff", "dead letter queues" and built-in retry. None exists at this layer, and `$queue.ts` itself correctly documents at-most-once. All three sources now say so and point at `$job`; the workerd variant additionally notes that Cloudflare Queues' own broker-level retry/DLQ is configured on the binding, not by this module. |

Still open in this cluster (websocket/room, a separate concern): room connections invisible to graceful stop, headless `$room` engines never evicted, no liveness heartbeat, client `subscribe` map overwriting handlers.

### Nineteenth pass — 2026-07-25 (core lifecycle)

| Area | Fix |
|------|-----|
| core/Alepha | `stop()` awaits a boot in flight instead of returning early. `started` is only set near the END of `boot()`, so stopping during startup did nothing and the boot then completed — leaving the app **running after the caller had awaited `stop()`**. Reachable from `run()`'s SIGTERM trap and from test teardown racing a slow start. The wait is guarded on `started`: a `ready` hook may stop the app from *inside* the boot (`$mode` does), where the boot promise is the call's own ancestor and awaiting it deadlocks — which is exactly what the first attempt did, caught by two `$mode` tests hanging. |
| core/Alepha | A failed boot unwinds what already started. A `start` hook throwing after earlier services connected left them running: `resetStartup()` clears `started`, so a later `stop()` short-circuited and never emitted `stop` — DB connections and listening sockets leaked with no way to close them. `stop` is emitted with `catch: true` so a failing teardown cannot mask the original error. |
| core/Alepha | `destroy()` and the `$mode` target reset re-seed the registry with the constructor-owned singletons. Replacing the registry while keeping `this.store`/`this.events`/`this.context`/`this.codec` desynchronised the two, so a later `inject(StateManager)` built a fresh, **empty** instance — env gone, atom and codec registrations gone, no error anywhere. |
| core/Alepha | `boot()` no longer flips `ready` when a `ready` hook stopped the app. It claimed a stopped container was ready, and a later `start()` would short-circuit on that flag and report the stopped app as running. |
| core/SchemaValidator | `ValidateOptions` is gone rather than implemented. Its `trim` / `nullToUndefined` / `deleteUndefined` were typebox-era leftovers — the class docstring already states that trimming, defaults and unknown-key stripping live in the zod schema now — and all 38 call sites passed them as `false`, explicitly disabling things that did nothing. `CodecManager`'s `validation` is now the boolean switch it always was (`false` to skip). |

### Twentieth pass — 2026-07-25 (server)

Nine of the eleven open server findings.

| Area | Fix |
|------|-----|
| server/core | `request.requestId` is memoised per request. The getter minted a fresh `randomUUID` on **every access**, so the id in the log line, the id in the error body and the ids read by middleware were all different — nothing could be correlated. (A test must read it twice *through the request object*; destructuring evaluates the getter once and hides it.) |
| server/core | HSTS reads `x-forwarded-proto` off the **request**. Testing it on the response — which never carries it — collapsed the check to `isProduction()`, so HSTS went out over plain HTTP in production and never went out over HTTPS anywhere else. |
| server/static | Precompressed variants advertise `Vary: Accept-Encoding` and carry a **per-encoding ETag**. Serving `.br`/`.gz` under one shared ETag with no `Vary` let a shared cache hand a brotli body to a client that never asked for it, and made 304 revalidation unable to tell the variants apart. (The `Vary`-clobbering half of this finding was fixed earlier, in the CORS pass.) |
| server/core | The flushing compress stream has backpressure and survives cancellation. It enqueued in flowing mode regardless of `desiredSize` — a slow client plus a large SSR stream buffered without bound — and on cancel `enqueue` threw from inside a `'data'` listener where nothing could catch it. Now gated on a `settled` flag, pauses the source when the consumer falls behind, resumes in `pull`, and tears down in `cancel`. |
| server/proxy | `target` is resolved **per request**. The function form is documented as runtime resolution but was called exactly once during `configure`, so every request used a frozen string. |
| server/core | `FileLike.stream()` returns `response.body` instead of throwing "Not implemented" — it broke every consumer piping a downloaded file into a bucket. Guarded with clear errors for an already-consumed or absent body, since a body can only be read once. |
| server/core | The Node query parser keeps a valueless key as `""`. `?flag` was dropped entirely on Node while `URLSearchParams` on Bun/workerd yields `{ flag: "" }` — the same request reached different handlers on different runtimes. |
| server/static | A file deleted after boot answers **404** instead of a raw 500. Metadata is captured once at startup, so the stream error was surfacing as an internal error. |
| server/links | `remote.schema()` is removed. It fetched `GET /api/_links/:name/schema`, a route that does not exist (the real one is `POST /api/_links/schemas`), had a TODO inside, and had zero callers — dead *and* broken. |

Left open deliberately: rate-limit's `keyGenerator` / `skipFailedRequests` / `skipSuccessfulRequests` (implement-or-remove is a design call, and the two skip options need a response hook that does not exist), and Apple `form_post` on the Node adapter (needs a Node→web `Request` bridge and cannot be verified end to end here).

### Twenty-first pass — 2026-07-25 (orm)

Five of the seven open ORM findings.

| Area | Fix |
|------|-----|
| orm/Repository | `paginate`'s count uses the same db resolution as `count()`. It went through `this.db` directly, so `paginate(..., { count: true, tx })` ran its count **outside the transaction** — reading rows the transaction had not committed, or missing rows it had written. |
| orm/QueryManager | `arrayContains` / `arrayContained` / `arrayOverlaps` throw on sqlite/D1 instead of emitting postgres array SQL against a JSON-text column. The `ilike` family got a sqlite fallback long ago; this one never did, so the query was invalid or silently meant something else. |
| orm/QueryManager | A filter object whose key is a near-miss for a real operator (`{ in: [...] }` for `inArray`, `notIn`, `neq`, …) is rejected with the correct name. It had no recognised key, so it fell through to the direct-value branch and produced `eq(column, <object>)` — a query matching nothing. Deliberately narrow: only known aliases are rejected, because a plain object is a legitimate equality value for a JSON column. |
| orm/DrizzleKitProvider | `push` surfaces drizzle-kit's own `warnings` and `hasDataLoss` before running the statements. They were computed and then dropped (only `dryRunPush` read them), so a dev-mode `synchronize()` could drop and recreate a column — wiping local data — without a line of output. |
| orm/DatabaseTypeProvider | `db.primaryKey(z.text())` works. The overload accepted any string schema but handled only `format: "uuid"` and threw for the rest, so a slug PK type-checked and crashed at startup. **The obvious fix breaks bigint**: `z.bigint()` is a `ZodString` carrying `format: "bigint"`, so a generic string branch placed before the numeric ones swallows it and strips its identity default — caught by an existing test inserting a bigint PK. The text case is a fallback after the numeric branches, and carries no generated default since there is nothing to generate. |

Left open, with reasons rather than silence:

- **`CloudflareHyperdriveProvider.db` creating a client per access.** This is deliberate and documented — its JSDoc states it avoids Workers' "Cannot perform I/O on behalf of a different request". Caching per request context is a real improvement, but it changes connection lifecycle on the one runtime that cannot be exercised here (no workerd, no Hyperdrive binding).
- **`SET search_path` before pg migrations on a pooled connection.** Pinning the SET and `migrate()` to one connection needs a reserved connection (or libpq `options=-csearch_path=…` on the URL), and the failure mode — migrate checking out a *different* pooled connection — cannot be reproduced deterministically in this suite. Touching the migration path blind is the wrong trade.

Per-module detail follows. Line numbers reference the tree as it stood when each finding was written (`main` @ 6c7ec9400 for the original passes); the fix passes have since moved code, so treat every line number as a starting hint, not an address — locate by symbol name.

---

## core

### ✅ FIXED — [BUG] KeylessJsonSchemaCodec silently corrupts data for union and top-level-optional schemas
- **Severity**: P1 (silent data corruption)
- **File**: packages/alepha/src/core/providers/KeylessJsonSchemaCodec.ts:407-414, 492-499, 598-616
- **Detail**: `unwrap()` resolves a union by picking the *first non-null variant* (line 605-615), so a `z.union([A, B])` value of shape B is encoded/decoded using A's field order. Verified: `{kind:"b", y:"hello", z2:"w"}` round-trips to `{"kind":"b","x":"b"}` — wrong keys, dropped fields, no error. Independently, a **top-level** `.optional()` object schema encodes flat (`[1,"x"]`) but the decoder (`genDec` optional branch, line 492-499, and `interpretDecode` line 293-306) consumes only one slot and regex-rewrites `a[i++]` into a single temp var; verified round-trip of `{a:1,b:"x"}` yields `{"a":1,"b":1}`. Field-level optionals are fine — only wrapper-at-root and unions are broken. The codec is registered by default in `CodecManager` and publicly exported; nothing in-tree uses `encoder: "keyless"` yet, so blast radius is latent — but it will corrupt the first schema with a union that opts in. Fix: reject unsupported schemas loudly (throw at `getCodec` time for unions / top-level wrappers) or implement a tagged-variant encoding.

### ✅ FIXED — [BUG] Setting a fork-scoped state key to `null` does not shadow the app-level value
- **Severity**: P1 (incorrect behavior; cross-layer state leak on the server)
- **File**: packages/alepha/src/core/providers/StateManager.ts:413-415
- **Detail**: `get()` resolves ALS values with `this.als.get(key, scope) ?? (scope ? undefined : store[key])`. `AlsProvider.get` returns the stored value, so a legitimate `null` (or `undefined` via `store.del()`) written inside a request fork is nullish-coalesced away and the **app-level** value is returned instead. Verified: app store `k = "app-value"`, then inside `fork()` `set("k", null)` → `get("k")` returns `"app-value"`. `false`/`0` work correctly, only nullish values leak. For request-scoped session/user atoms with nullable schemas ("set to null = logged out") this reads another layer's value. Fix: use `als.has(key)`/`getLayer(key)` to distinguish "absent" from "present = null" before falling back.

### ✅ FIXED — [BUG] `destroy()` and the `alepha.target` boot-reset orphan the core provider singletons
- **Severity**: P2 (incorrect behavior in HMR and `$mode` paths)
- **File**: packages/alepha/src/core/Alepha.ts:592-605, 682-697
- **Detail**: The constructor registers `StateManager`/`EventManager`/`AlsProvider`/`CodecManager` in `this.registry`, but `destroy()` and the target-mode branch of `boot()` do `this.registry = new Map()` while `this.store`/`this.events`/... keep the old instances. Any later `inject(StateManager)` (or `$inject` in a re-registered service) constructs a **fresh, empty** instance: verified `alepha.inject(StateManager) !== alepha.store` after `destroy()`, and the new instance's `get("env")` is `undefined`. Same holds inside a `$mode` target's dependency tree. Codec registrations (`alepha.codec.register`) and atom registries diverge the same way. Fix: re-seed the registry with the constructor-owned instances after clearing it (`registry.set(StateManager, { instance: this.store, ... })`, etc.).

### ✅ FIXED — [BUG] Failed boot never emits `stop` — services started before the failure leak resources, and a stale-retry re-runs `configure` on all of them
- **Severity**: P2
- **File**: packages/alepha/src/core/Alepha.ts:625-628, 660-662
- **Detail**: If a `start` hook throws after earlier services' `start` hooks succeeded (DB connected, server listening), `boot()`'s catch calls `resetStartup()` which sets `started = false`; a subsequent `stop()` then hits the `if (!this.started) return;` guard and **never emits `stop`**. Verified: svc1's start hook ran, svc1's stop hook did not after `stop()`. Worse, in the serverless stale-promise path a retrying `start()` re-emits `configure`/`start` to all hooks — including services already partially started (hooks are not cleared by `resetStartup`), so providers must be idempotent but nothing enforces or documents that. Fix: on boot failure, emit `stop` (with `catch: true`) for the phases that completed before rethrowing.

### ✅ FIXED — [BUG] `stop()` during an in-flight `start()` is silently ignored — app keeps running after `stop()` resolves
- **Severity**: P2 (race condition)
- **File**: packages/alepha/src/core/Alepha.ts:659-672
- **Detail**: `stop()` only checks `this.started`, which is set near the *end* of `boot()`. Calling `stop()` while `startPromise` is pending returns immediately without stopping; the boot then completes and the app ends up `isStarted() === true` after `stop()` resolved. Verified with a 50 ms async start hook. This is reachable via `run()`'s signal traps (SIGTERM during startup → handler "stops", exits 0, but nothing was actually stopped — moot only because the process exits) and via test teardown racing a slow start. Fix: `stop()` should `await this.startPromise` (or cancel it) before deciding there is nothing to stop.

### ✅ FIXED — [BUG] `run()` exits with code 0 after an uncaughtException
- **Severity**: P2 (masks crashes from orchestrators/CI)
- **File**: packages/alepha/src/core/index.ts:121-137
- **Detail**: The trap array includes `"uncaughtException"` and the shared handler ends with `process.exit(0)` after `alepha.stop()`. A crash therefore reports success — systemd/k8s/CI treat the process as cleanly finished and restart-on-failure policies don't trigger. Fix: `process.exit(trap === "uncaughtException" ? 1 : 0)`. (Also note: `process.once` means a second SIGINT while `stop()` hangs cannot force-quit.)

### ✅ FIXED — [BUG] `isFileLike` throws TypeError instead of returning false
- **Severity**: P2
- **File**: packages/alepha/src/core/helpers/FileLike.ts:88-97
- **Detail**: The guard ends with `typeof value.stream.bind(value) === "function"` — when `value.stream` is `undefined` (any plain metadata object `{name, type, size}`), `.bind` dereferences `undefined` and throws `TypeError`. Verified. A type guard must never throw on a near-miss shape. Fix: `typeof value.stream === "function"` (the `.bind` adds nothing).

### ✅ FIXED — [BUG] `$mode` leaves the container in `ready=true, started=false` after its auto-stop
- **Severity**: P2 (inconsistent lifecycle state)
- **File**: packages/alepha/src/core/primitives/$mode.ts:70-80, packages/alepha/src/core/Alepha.ts:617-624
- **Detail**: `$mode`'s `ready` hook calls `await alepha.stop()` *inside* the `ready` emit; `stop()` sets `started=false, ready=false`, but `boot()` then continues and sets `this.ready = true` and logs "App is now ready" — after the app already stopped. Verified: `isReady() === true`, `isStarted() === false`. A subsequent `start()` would short-circuit on `this.ready` and claim the stopped app is running. Harmless when the process exits right after, but wrong for embedded/test use. Fix: `boot()` should not flip `ready` if `stop()` ran during the ready emit (e.g. guard on `this.started`).

### ✅ FIXED — [UNFINISHED] `SchemaValidator.validate` accepts `ValidateOptions` but ignores them entirely
- **Severity**: P2
- **File**: packages/alepha/src/core/providers/SchemaValidator.ts:18-22, 61-67
- **Detail**: `validate(schema, value, _options)` discards `trim` / `nullToUndefined` / `deleteUndefined`, yet `CodecManager.encode/decode/validate` still plumb `options.validation` through as if they worked, and the public `EncodeOptions.validation`/`DecodeOptions.validation` types advertise them. `beforeParse` is an explicit no-op stub. Callers passing `{ nullToUndefined: true }` silently get strict behavior. Either delete `ValidateOptions`' dead fields or implement them.

### [BUG] Keyless codec's bigint branches are unreachable dead code
- **Severity**: P3
- **File**: packages/alepha/src/core/providers/KeylessJsonSchemaCodec.ts:198-200, 253-255, 373-375, 430-432
- **Detail**: `z.bigint()` is a `ZodString` with `format: "bigint"` (ZodProvider.ts:311), and `isLeaf()` checks `isScalar` before any `isBigInt` check — so the `"...n"` suffix encode and `BigInt(v.slice(0,-1))` decode paths never execute. Verified: `{big:"123"}` encodes to `["123"]` (no suffix) and decodes to a string. Round-trip works by accident. Delete them (typebox-era leftovers), plus the `isEnum` helper at line 569-575 which can never match a `ZodEnum`.

### [UNFINISHED] `$memoize` imports from the `"alepha"` package barrel inside core
- **Severity**: P3 (build fragility)
- **File**: packages/alepha/src/core/primitives/$memoize.ts:1
- **Detail**: `import { createMiddleware, type Middleware } from "alepha";` is the only real (non-JSDoc) barrel self-import in core. `index.shared.ts` re-exports `$memoize.ts`, creating a cycle through the package entry. Works today because `createMiddleware` is only called at runtime, but this is exactly the pattern the build's circular-dep analysis exists to flag. Change to `from "./$pipeline.ts"`.

### [UNFINISHED] `TypeProvider.prototype.page` augments a class that is never instantiated
- **Severity**: P3 (dead code)
- **File**: packages/alepha/src/core/schemas/pageSchema.ts:145
- **Detail**: `TypeProvider` (TypeProvider.ts:77) is a static-only legacy config holder; no code constructs it, so the prototype assignment and interface merge are vestiges of the typebox `t` provider. `z.page` (ZodProvider.ts:338) is the live implementation. Delete the block. Related legacy no-op stubs: `TypeProvider.translateError` / `setLocale`.

### [BUG] `AlephaDumpEnvVariable.description` is typed `string` but can be `undefined`
- **Severity**: P3
- **File**: packages/alepha/src/core/Alepha.ts:1170, 1301-1306
- **Detail**: `dump()` assigns `description: inner?.description ?? prop?.description`, which is `undefined` for env fields without a description, while the interface declares `description: string` (the only non-optional field). Consumers (devtools env table) typed against this will NPE. Make it `description?: string`.

### [RECO] Keyless codec: `null` in an optional+nullable field is lossy (decodes to "absent")
- **Severity**: P3
- **File**: packages/alepha/src/core/providers/KeylessJsonSchemaCodec.ts:219-227, 278-287, 550-566
- **Detail**: `getObjectFields` sets `isOpt` whenever the field is optional, and the `isOpt` branch wins over `isNullable` — so `null` is the shared sentinel for both "undefined" and "null". Verified: `{a: null}` with `a: z.integer().nullable().optional()` round-trips to `{}` (key gone). If callers distinguish "explicitly cleared" from "not sent" (PATCH semantics), this silently changes meaning.

### [RECO] `parseEnv` `$KEY` templating has no escape and substitutes into undeclared-key lookalikes
- **Severity**: P3
- **File**: packages/alepha/src/core/Alepha.ts:1044-1065
- **Detail**: No way to include a literal `$` in an env value (a password containing `$PORT` gets rewritten), and longest-first sorting only protects among declared keys — a value referencing undeclared `$PORTX` while `PORT` is declared becomes `<port>X`. Consider `$$` escaping and word-boundary matching (`/\$KEY(?![A-Z0-9_])/`).

### [RECO] EventManager: cross-tier `before`/`after` constraints silently ignored; compiled executors snapshot a stale logger
- **Severity**: P3
- **File**: packages/alepha/src/core/providers/EventManager.ts:108-123, 242-245
- **Detail**: `topoSort` runs per priority tier, so a hook with `priority: "first"` and `after: [ServiceInNormalTier]` gets no ordering and no warning. Separately, `compile()` captures `const log = this.log` but `state:register`/`state:mutate` are emitted during service registration, before the logger module replaces `alepha.logger` — errors in those hooks keep reporting through the pre-boot console logger until the cache is invalidated.

### [RECO] `createPagination` detects "has next page" with exact equality
- **Severity**: P3
- **File**: packages/alepha/src/core/helpers/createPagination.ts:63
- **Detail**: `hasNext = entities.length === limit + 1` — a caller that passes an unsliced array (length > limit + 1) gets `isLast: true` on a page that clearly has more data. `entities.length > limit` is strictly safer.

### [RECO] `AlephaCore` module exists only in the node and workerd entrypoints
- **Severity**: P3
- **File**: packages/alepha/src/core/index.browser.ts, index.native.ts (vs index.ts:40, index.workerd.ts:23)
- **Detail**: `index.ts` and `index.workerd.ts` both define `AlephaCore` (duplicated, drift risk) while browser/native barrels don't — shared isomorphic code importing `{ AlephaCore }` compiles server-side and breaks in the browser bundle; core services also lose their module tag there. Hoist into a shared file, re-export from all four entrypoints.

### [UNFINISHED] Acknowledged TODOs in core
- **Severity**: P3
- **File**: packages/alepha/src/core/Alepha.ts:882-891, helpers/ref.ts:60-77, helpers/FileLike.ts:96
- **Detail**: (1) scoped-lifetime inject silently falls back to the global singleton registry when no ALS context exists — planned warn-once not implemented, so "per-request isolation" quietly becomes a cross-request singleton; (2) `__alephaRef` cursor not restored on mid-instantiation throw (stale ghost state); (3) `StreamLike` slated for replacement with web streams.

### Coverage notes
- Read in full: all non-test sources in core/ (Alepha.ts, 13 primitives, 11 providers, 6 helpers, 7 errors, 5 interfaces, schemas, constants, 5 platform entrypoints). All P1/P2 bugs verified by executing the source under Node 26.
- Test gaps: KeylessJsonSchemaCodec.spec.ts has zero union tests and no top-level-optional test (exactly where both P1 corruptions live); no test for stop() racing start(), stop() after partially-failed boot, inject() after destroy(); no fork-scoped-null test; serverless stale-startPromise path untested; loadEnv()/getEnvSchemas() no dedicated specs.

---

## security + crypto + captcha

### ✅ FIXED — [BUG] JWT tenant-claim replay protection is dead code on the primary auth path
- **Severity**: P1
- **File**: packages/alepha/src/security/primitives/$issuer.ts:200-226 (and packages/alepha/src/security/providers/SecurityProvider.ts:97-137)
- **Detail**: `$issuer.createToken` writes a `tenant` claim into every access token (`$issuer.ts:340,372`) and the code/comments assert the resolver "compares this claim against `currentTenantAtom` on every request" to stop cross-tenant token replay. But that comparison lives only in `SecurityProvider.createDefaultJwtResolver` (SecurityProvider.ts:121-131), which is registered **only** when `realm.resolvers.length === 0` (SecurityProvider.ts:84). `$issuer.onInit` always registers its own `createJwtResolver()` (`$issuer.ts:194`), which has **no tenant check**, so `realm.resolvers` is never empty for issuer/`$realm`-based realms — the exact multi-tenant path in `api/users`. Result: bearer JWTs minted on tenant A are accepted on tenant B; the documented anti-replay guard never runs. Fix: move the tenant-claim check into `$issuer.createJwtResolver` (or a shared resolver helper).

### ✅ FIXED — [BUG] `checkPermission` resolves role names across ALL realms, ignoring the user's realm
- **Severity**: P1
- **File**: packages/alepha/src/security/providers/SecurityProvider.ts:500-506
- **Detail**: `checkPermission(permission, ...roleNames)` maps each role name via `this.getRoles()` with **no realm argument**, which concatenates roles from every realm (SecurityProvider.ts:745-751) and returns the first name match. `$secure` calls it with just `...user.roles` and no realm (`$secure.ts:147-150`). Every `$realm` defines default roles literally named `"admin"` and `"user"` ($realm.ts:142-176), so in any multi-realm app these names collide. A user authenticated in realm A with role `"admin"` will be authorized against whichever realm's `"admin"` role appears first in the `realms` array — potentially a broader permission set than their own realm grants. Breaks realm/tenant authorization isolation. Fix: thread the user's `realm` into `checkPermission` and resolve with `getRoles(realm)`.

### ✅ FIXED — [BUG] Browser `randomCode` infinite-loops for length ≥ 10; diverges from Node impl
- **Severity**: P2
- **File**: packages/alepha/src/crypto/providers/BrowserCryptoProvider.ts:117-129
- **Detail**: `randomCode` computes `max = 10 ** length` and rejection-samples a `Uint32` against `limit = Math.floor(0x100000000 / max) * max`. For `length >= 10`, `max` (1e10) exceeds 2^32, so `limit === 0`; the loop condition `value >= limit` is always true → **infinite loop / hung tab**. The Node `CryptoProvider.randomCode` (CryptoProvider.ts:152-156) uses `randomInt` and works up to ~15 digits, so the two providers silently disagree at the boundary. Fix: draw enough random bytes (BigInt/multi-word) or cap/validate `length`.

### ✅ FIXED — [RECO] `JwtProvider` does not pin an `algorithms` allowlist on verify
- **Severity**: P2
- **File**: packages/alepha/src/security/providers/JwtProvider.ts:150-157
- **Detail**: `jwtVerify` is called without the `algorithms` option, so the accepted algorithm is inferred solely from the resolved key type. jose does reject `alg: none` and won't let a symmetric secret verify an asymmetric signature, so this is not exploitable today. But every realm knows exactly one expected alg; pass an explicit allowlist (`algorithms: ["HS256"]` / `[signer.alg]`) so a future key-loader change can't widen the accepted set.

### ✅ FIXED — [RECO] Auth failures surface as HTTP 403 instead of 401
- **Severity**: P2
- **File**: packages/alepha/src/security/errors/SecurityError.ts:1-4 (raised at JwtProvider.ts:168,172,183)
- **Detail**: `SecurityError` hardcodes `status = 403`, and `JwtProvider.parse` throws it for "Token expired", "Token claim validation failed", and "Invalid token". These are authentication failures and should be `401`; 401 is what signals a client to refresh/re-authenticate. Returning 403 for an expired token can break refresh flows. Fix: use a 401-status error (like `InvalidTokenError`) for token validity failures, reserving 403 for authorization denials.

### ✅ FIXED — [UNFINISHED] Token-based refresh reuses roles from the expired access token without re-validation
- **Severity**: P2
- **File**: packages/alepha/src/security/primitives/$issuer.ts:420-431
- **Detail**: The token-only refresh path (no `onRefreshSession`) rebuilds the user from the *expired* access token with `currentDate: new Date(0)` to skip expiry, then re-mints a new access token carrying the same roles. Documented in a WARNING comment. With a 30-day default refresh window, a revoked/downgraded user keeps elevated roles for up to 30 days on token-only realms. Known limitation, but a real authz-staleness gap; consider docs + shorter default refresh lifetime for token-only mode.

### [UNFINISHED] Dead exported types `CreateTokenOptions` and `ServiceAccountStore`
- **Severity**: P3
- **File**: packages/alepha/src/security/primitives/$issuer.ts:462-466 and $serviceAccount.ts:186-188
- **Detail**: Both exported but referenced nowhere (verified by grep). `ServiceAccountStore.response` doesn't even match the actual `store.cache` field used at `$serviceAccount.ts:38-49`. Remove.

### [RECO] `SecurityProvider` catch-all in resolver loop hides genuine token errors
- **Severity**: P3
- **File**: packages/alepha/src/security/providers/SecurityProvider.ts:457-465
- **Detail**: `resolveUserFromServerRequest` wraps each `resolver.onRequest` in `try { } catch { continue; }`, swallowing every error (including tenant-mismatch or malformed bearer token) and silently trying the next resolver, ultimately returning `undefined` ("unauthenticated") with no diagnostic. Deliberate for multi-realm fallthrough, but consider logging at debug inside the catch.

### Coverage notes
- Read in full: all of security/ (providers, primitives, interfaces, schemas, atoms, errors, indexes); all of crypto/; all of captcha/. Cross-referenced $realm.ts, SessionService, Alepha.processPrimitive to confirm resolver-registration ordering.
- Positives: scrypt N=16384 + per-hash salt + timingSafeEqual; AES-256-GCM random 12-byte IV + auth tag; $basicAuth constant-time compare; PBKDF2 600k; SecretProvider fail-closed on default APP_SECRET in production; jose not vulnerable to alg-confusion/none here.
- Test gaps: (1) no test exercises tenant-claim rejection through an actual $issuer/$realm resolver; (2) no cross-realm role-name collision test for checkPermission; (3) $issuer.refreshToken token-based path not directly tested; (4) randomCode only tested for small lengths; (5) TurnstileCaptchaProvider.verify has no spec.

---

## server

### ✅ FIXED — [BUG] Open redirect via backslash bypass in `validateRedirectUri`
- **Severity**: P1
- **File**: packages/alepha/src/server/auth/providers/ServerAuthProvider.ts:52-69
- **Detail**: Accepts any string starting with `/` that doesn't start with `//` — so `/\evil.com` passes and becomes `Location: /\evil.com`, which browsers normalize to `//evil.com` (open redirect after OAuth login/logout via `?redirect_uri=`). The repo already contains the correct check — `auth/helpers/safeRedirectPath.ts` explicitly rejects backslash tricks — but it is **never imported anywhere** (dead code). Spec tests `//` and absolute URLs but not backslashes. Fix: reject `\` (or reuse safeRedirectPath).

### ✅ FIXED — [BUG] Multipart uploads with chunked transfer-encoding buffer unbounded (DoS)
- **Severity**: P1
- **File**: packages/alepha/src/server/core/providers/ServerMultipartProvider.ts:113-126,150
- **Detail**: The only pre-parse size guard is the content-length header check; `Transfer-Encoding: chunked` (no content-length) skips it, and `request.formData()` buffers the entire body into RAM with no limit. ServerBodyParserProvider explicitly skips its streaming size check for multipart. Per-file/total checks run only *after* the body is in memory. Fix: counting TransformStream that aborts past `options.limit` before formData().

### ✅ FIXED — [BUG] Required query parameters are never validated
- **Severity**: P1
- **File**: packages/alepha/src/server/core/providers/ServerRouterProvider.ts:489-509
- **Detail**: The `schema.query` branch decodes only *present* keys and assigns `request.query = query` — unlike the headers branch (533) it never calls `codec.validate`, so a missing required query param produces `{}` instead of a 400; handler runs with `query.limit === undefined`. Spec only tests an invalid present value. Fix: validate the decoded subset against the full schema.

### ✅ FIXED — [BUG] Falsy handler return values (`false`, `0`, `""`) become the string `"undefined"`
- **Severity**: P1
- **File**: packages/alepha/src/server/core/providers/ServerRouterProvider.ts:261-264 (with 314-322)
- **Detail**: `const result = await route.handler.run(request); if (result) { reply.body = result; }` drops falsy results. For `response: z.boolean()` (text kind), `serializeResponse` does `String(undefined)` → 200 with body `"undefined"`; JSON kinds encode undefined → 500. Fix: `if (result !== undefined)`.

### ✅ FIXED — [BUG] HttpClient GET dedup keyed by URL only — cross-user response sharing on the server
- **Severity**: P1
- **File**: packages/alepha/src/server/core/services/HttpClient.ts:121-137; links/providers/LinkProvider.ts:336-339
- **Detail**: In-flight GETs dedup with `key = JSON.stringify({url, method})` — headers ignored — on the singleton HttpClient. `LinkProvider.followRemote` forwards the current request's `authorization` header, so two concurrent server-side calls to the same remote-action URL for different users coalesce: user B receives user A's response. Same key issue affects the server-side etag cache (line 95). Fix: include auth-relevant headers (or ALS context id) in the key, or disable dedup when authorization is present server-side.

### ✅ FIXED — [BUG] `/api/_links` registry cache conflates anonymous users with role-less authenticated users
- **Severity**: P1
- **File**: packages/alepha/src/server/links/providers/ServerLinksProvider.ts:115
- **Detail**: `roleKey = user?.roles?.slice().sort().join(",") ?? ""` — an authenticated user with `roles: []` (or undefined roles) produces the same `""` key as an unauthenticated request; `isLinkAccessible` returns different sets for those. Whichever hits first poisons the cache: anonymous visitors can receive a registry listing secured actions, or logged-in users lose secured links until restart (cache never invalidated). Fix: incorporate `!!user` into the key.

### ✅ FIXED — [BUG] Proxy drops multiple upstream `Set-Cookie` headers
- **Severity**: P1
- **File**: packages/alepha/src/server/proxy/providers/ServerProxyProvider.ts:97
- **Detail**: `Object.fromEntries(response.headers.entries())` keeps only the last `set-cookie` (undici/workerd yield each as a separate entry). `ServerProvider.toWebHeaders` correctly special-cases `set-cookie: string[]`, but the proxy never produces the array form. Proxying auth endpoints silently loses sessions. Fix: `response.headers.getSetCookie()` → string[].

### ✅ FIXED — [BUG] CORS preflight fails for GET routes (no OPTIONS route created)
- **Severity**: P1
- **File**: packages/alepha/src/server/cors/providers/ServerCorsProvider.ts:149-171
- **Detail**: The configure hook creates an OPTIONS twin for every route *except* GET. A cross-origin GET carrying `Authorization` (in the module's default headers allowlist) triggers a preflight; that OPTIONS 404s with no CORS headers → browser blocks. Also: reflecting reqOrigin without `Vary: Origin` breaks shared caches; `origin: "*"` + credentials reflects any origin with credentials. Fix: OPTIONS for GET too, add Vary, refuse/warn wildcard+credentials.

### ✅ FIXED — [BUG] Node streaming responses: a failing piped stream leaves the response open forever
- **Severity**: P1
- **File**: packages/alepha/src/server/core/providers/ServerProvider.ts:235-238; ServerCompressProvider.ts:160-163
- **Detail**: `response.body.pipe(res)` attaches no error listener to the source — pipe doesn't forward errors, so a mid-stream read error (deleted static file, fs fault) emits unhandled 'error' → uncaughtException → crash. Same for the compress pipe. Client disconnect mid-stream destroys neither source (fd leak). Fix: `stream.pipeline(body, res, cb)` in both.

### ✅ FIXED — [BUG] SSE endpoints never learn about client disconnects — handlers run forever
- **Severity**: P1
- **File**: packages/alepha/src/server/core/primitives/$sse.ts:586-630
- **Detail**: The ReadableStream implements `start` but no `cancel`. On disconnect the runtime cancels the stream; `emit()` swallows the enqueue TypeError in its empty catch and the handler keeps looping indefinitely — permanent leak per disconnected client. No AbortSignal exposed. Fix: implement `cancel(reason)`, expose `signal` in SseHandlerContext, make emit return false once closed.

### ✅ FIXED — [BUG] `HttpClient` doesn't recognize `application/json; charset=utf-8`
- **Severity**: P1
- **File**: packages/alepha/src/server/core/services/HttpClient.ts:285
- **Detail**: Exact match `=== "application/json"`. Any server appending `; charset=utf-8` falls through: 2xx returns the raw Response as data; errors throw generic non-JSON HttpError. `text/*` uses startsWith two lines above. Fix: startsWith (or parse media type).

### ✅ FIXED — [UNFINISHED] `$etag` store TTL / cache options accepted but ignored
- **Severity**: P1
- **File**: packages/alepha/src/server/etag/providers/ServerEtagProvider.ts:153,300,452 (options: primitives/$etag.ts:112)
- **Detail**: `store?: true | DurationLike | CachePrimitiveOptions` is documented (JSDoc example with ttl), but `options.store` is only truth-tested; every `cache.set(key, entry)` passes no TTL. Stored responses live until restart or manual invalidate — stale data + unbounded growth for param/query-keyed routes. Also `createCacheKey` (407) includes no user identity: `$etag(true)` on an authenticated action serves one user's cached body to all others — needs a loud doc warning or vary-by option.

### ✅ FIXED — [BUG] `request.requestId` returns a different UUID on every access
- **Severity**: P2
- **File**: packages/alepha/src/server/core/services/ServerRequestParser.ts:60-62,90-92
- **Detail**: The getter calls `getRequestId()` unmemoized; without an x-request-id header each access generates a fresh randomUUID — the id logged, the id in the error body, and ids read by middleware all differ; none match the ALS context id. Fix: lazy memo per request; reuse as context id.

### ✅ FIXED — [BUG] `HttpError.toJSON` leaks internal cause to clients in production
- **Severity**: P2
- **File**: packages/alepha/src/server/core/errors/HttpError.ts:41; ServerRouterProvider.ts:410-417
- **Detail**: The HttpError branch serializes `toJSON` unconditionally, which includes `reason` (cause name+message) as `cause`. Any 5xx HttpError with a cause ships the internal message to clients in production — sanitization only covers the non-HttpError path. Fix: strip cause/details for status ≥ 500 in production.
- **Fix location (eleventh-pass correction)**: the guard is in `ServerRouterProvider.sendError` (:416-421), not in `toJSON` — `toJSON` still emits `cause` unconditionally. Behaviorally complete (the router is its only non-test caller), but it is a *call-site* guard, so any other code that serializes an `HttpError` must repeat the rule. `/api/_batch` did not — see below.

### ✅ FIXED — [BUG] `/api/_batch` returns raw 5xx messages in production, bypassing the error sanitizer
- **Severity**: P2 (information disclosure)
- **File**: packages/alepha/src/server/links/providers/ServerLinksProvider.ts:236-254
- **Detail**: Found by the eleventh-pass audit, not the original review. The batch handler mapped every rejected sub-action to `{ action, status, error: reason.message }` with no sanitization, while the single-request path strips 5xx messages in production (`sendError`, :416-421). A sub-action throwing `connect ECONNREFUSED db.internal:5432 (user=admin password=hunter2)` shipped that string to the client verbatim — verified with a failing test before the fix. This is the *more* exposed of the two paths: `BatchCollector` batches client `$action` calls into `/api/_batch` by default, so most React-app traffic takes it. Fixed by mirroring `sendError`: status ≥ 500 in production → `"Internal Server Error"`, 4xx messages kept (deliberate, client-facing). Documented in `docs/1-guides/4-server/5-error-handling.md`.

### ✅ FIXED — [BUG] Helmet HSTS "isSecure" check reads response headers instead of request headers
- **Severity**: P2
- **File**: packages/alepha/src/server/core/providers/ServerHelmetProvider.ts:202-205
- **Detail**: `response.headers["x-forwarded-proto"] === "https"` — that's a request header; responses never have it, so HSTS keys off isProduction() alone (emitted on plain-HTTP prod; never on HTTPS non-prod). Fix: read the request. Related (P3): default-CSP branch tests `Object.keys(csp).length === 0` but csp always has `directives` — `defaultCspDirectives()` unreachable; `{directives:{}}` emits an empty CSP header.

### ✅ FIXED — [BUG] Compression clobbers existing `Vary`; static precompressed files send no `Vary` at all
- **Severity**: P2
- **File**: packages/alepha/src/server/core/providers/ServerCompressProvider.ts:257; static/providers/ServerStaticProvider.ts:155-164
- **Detail**: `response.headers.vary = "accept-encoding"` overwrites route-set Vary (cache poisoning). Static serves `.br`/`.gz` with long cache-control, **no Vary: Accept-Encoding**, and the same ETag for all encodings — shared caches can hand brotli to non-brotli clients; 304 revalidation can't distinguish. Fix: append to Vary; per-encoding ETags in static.

### ✅ FIXED — [BUG] Compress streaming path has no backpressure and crashes on client cancel
- **Severity**: P2
- **File**: packages/alepha/src/server/core/providers/ServerCompressProvider.ts:197-233
- **Detail**: `createFlushingCompressStream` uses flowing-mode `reader.on("data")` + `controller.enqueue` regardless of desiredSize — slow client + large SSR stream buffers unbounded. If the output is cancelled, enqueue throws inside the 'data' handler with no try/catch → uncaught. Fix: pull/cancel, respect desiredSize, guard enqueue.

### ✅ FIXED — [BUG] Client `pathVariables` neither URL-encodes nor escapes replacement patterns; server never percent-decodes params
- **Severity**: P2
- **File**: packages/alepha/src/server/core/services/HttpClient.ts:376-379; router matcher (params raw)
- **Detail**: (1) `url.replace(":key", value)` interpolates raw values — `/`, `?`, `#`, spaces break/inject URLs; (2) `$&`/`$'` in the value are substitution patterns, corrupting the URL; (3) `:id` replaces the prefix of `:idType`. Server side assigns `params[name] = parts[i]` without decodeURIComponent, so a compliant client sending `/users/John%20Doe` gives the handler the literal `John%20Doe`. Round-trips only "work" because both sides skip encoding. Same bug in `$sse.buildFetchUrl` (:646-648). Fix: encodeURIComponent client-side (replace-function), decode on extraction.

### ✅ FIXED — [BUG] Cookie deletion hardcodes `Path=/` and omits `Domain`
- **Severity**: P2
- **File**: packages/alepha/src/server/cookies/services/CookieParser.ts:34-36
- **Detail**: Null-cookie branch emits `name=; Path=/; Max-Age=0` regardless of the cookie's declared path/domain — a `$cookie({ path: "/admin" })` or domain-scoped cookie can never be deleted. ServerCookiesProvider.deleteCookie (207) doesn't receive the options to forward. Fix: pass path/domain through deletion.

### ✅ FIXED — [BUG] Rate-limit module: importing it rate-limits every route at 100 req/15 min; unproxied clients share one bucket
- **Severity**: P2
- **File**: packages/alepha/src/server/rate-limit/providers/ServerRateLimitProvider.ts:114-135,252-255
- **Detail**: The global server:onRequest hook falls back to atom *defaults* `max: 100, windowMs: 15min`; the "skip if not configured" guard (`!max && !windowMs`) can never fire. Merely registering the module throttles every route (incl. static assets and OPTIONS). When `req.ip` is undefined the key is the shared literal `"unknown"` — all clients exhaust one bucket. Fix: opt-in global hook (no default limit); fall back to connection IP.

### ✅ FIXED — [BUG] `$auth` `fallback` token object form produces `Bearer [object Object]`
- **Severity**: P2
- **File**: packages/alepha/src/server/auth/providers/ServerAuthProvider.ts:132-141; primitives/$auth.ts:514
- **Detail**: `AccessToken = string | { token: () => Async<string> }` (JSDoc example passes a `$serviceAccount`), but the consumer does `Bearer ${token}` without calling `.token()` — the documented object form interpolates as `[object Object]`. Fix: call `.token()` for the object form.

### ✅ FIXED — [BUG] Login route 500s on malformed `Referer`
- **Severity**: P2
- **File**: packages/alepha/src/server/auth/providers/ServerAuthProvider.ts:318-320
- **Detail**: `new URL(headers.referer)` throws on non-URL referers (browsers legitimately send `Referer: null` from sandboxed origins) → GET /oauth/login 500s. Wrap in try/catch → undefined.

### ✅ FIXED — [BUG] Token cookie TTL truncated to access-token lifetime when provider reports no refresh expiry
- **Severity**: P2
- **File**: packages/alepha/src/server/auth/providers/ServerAuthProvider.ts:790-804
- **Detail**: `setTokens` uses `refresh_token_expires_in || refresh_expires_in || expires_in` as cookie Max-Age. Google returns only `expires_in` (3600) with a long-lived refresh token → the session cookie (incl. refresh token) expires after 1 hour. Fix: fall back to the $cookie default (30 days) when no refresh expiry reported.

### [BUG] Apple `form_post` callback only works on web-request runtimes
- **Severity**: P2
- **File**: packages/alepha/src/server/auth/providers/ServerAuthProvider.ts:501-505
- **Detail**: `handleCallback` only switches to POST-body parsing when `raw?.web?.req` exists; on the Node adapter `currentUrl` stays the query URL (no code for form_post) → Apple Sign In breaks on plain Node. Fix: build a web Request from raw.node.req (as ServerMultipartProvider does).

### ✅ FIXED — [BUG] OIDC discovery always runs with `allowInsecureRequests`
- **Severity**: P2
- **File**: packages/alepha/src/server/auth/primitives/$auth.ts:464-478
- **Detail**: `execute.push(allowInsecureRequests)` unconditional, disabling openid-client's HTTPS-only enforcement in production — a misconfigured `http://` issuer silently sends client secrets/auth codes cleartext. Fix: only when `!alepha.isProduction()`.

### ✅ FIXED — [UNFINISHED] `$proxy` "dynamic target" is evaluated once at startup
- **Severity**: P2
- **File**: packages/alepha/src/server/proxy/providers/ServerProxyProvider.ts:32-33
- **Detail**: `target: () => ...` documented as runtime resolution, but `createProxy` calls it exactly once in configure; every request uses the frozen string. Also `// TODO: Add retry functionality` in $proxy.ts:218. Related P2: proxy forwards all inbound headers verbatim including `host` and hop-by-hop headers (`connection`, upstream `content-length`) — classic proxies strip these.

### [UNFINISHED] Rate-limit options `keyGenerator`, `skipFailedRequests`, `skipSuccessfulRequests` accepted but never used
- **Severity**: P2
- **File**: packages/alepha/src/server/rate-limit/providers/ServerRateLimitProvider.ts:164-177,201-255
- **Detail**: All three declared in RateLimitOptions and carried through, but checkLimit only calls the built-in IP generateKey and nothing decrements based on response status (no onResponse hook). Silent no-ops. Implement or remove.

### ✅ FIXED — [UNFINISHED] `remote.schema()` targets a route that doesn't exist
- **Severity**: P2
- **File**: packages/alepha/src/server/links/providers/RemotePrimitiveProvider.ts:90-101
- **Detail**: Fetches `GET {url}/api/_links/${name}/schema`, but the only schema route is `POST /api/_links/schemas`. Nothing calls remote.schema — dead *and* broken, with a TODO inside. Remove or repoint.

### ✅ FIXED — [UNFINISHED] `FileLike.stream()` from HttpClient throws "Not implemented"
- **Severity**: P2
- **File**: packages/alepha/src/server/core/services/HttpClient.ts:350-353
- **Detail**: File-typed responses return a FileLike whose `stream()` throws AlephaError("Not implemented") even though `response.body` is right there. Any consumer piping a downloaded file to a bucket breaks. Implement as `() => response.body` with a consumed guard.

### ✅ FIXED — [BUG] Node query parser drops valueless keys — diverges from the web adapter
- **Severity**: P2
- **File**: packages/alepha/src/server/core/providers/ServerProvider.ts:104-121
- **Detail**: Hand-rolled parser only records a pair when `eqIdx > start`, so `?flag` is dropped on Node while URLSearchParams yields `{flag: ""}` on Bun/workerd. Fix: bare key → `""`. (Related P3: repeated keys last-win on both adapters — `z.array` query schemas unreachable via standard encoding.)

### ✅ FIXED — [BUG] Static file metadata frozen at boot — stale ETag/Last-Modified after file changes
- **Severity**: P2
- **File**: packages/alepha/src/server/static/providers/ServerStaticProvider.ts:135-137,178-185
- **Detail**: stat/etag/lastModified/.gz-.br existence computed once at startup. Changed files serve 304s indefinitely; deleted files → raw 500s (stream error) instead of 404; files added after boot 404. Acceptable for immutable dist, but unenforced/undocumented. At minimum map ENOENT → 404.

### [RECO] Registry/`/api/_batch` misc hardening
- **Severity**: P3
- **File**: packages/alepha/src/server/links/providers/ServerLinksProvider.ts:219; services/BatchCollector.ts:99
- **Detail**: MAX_BATCH_SIZE violation throws bare AlephaError → 500 instead of 400. `LinkProvider.getLinkByName` emits `client:onError` with `route: undefined` and reports not-found as UnauthorizedError (401). BatchCollector assumes exactly one result per entry — a short response rejects everything with a TypeError.

### [RECO] Small correctness/DX items
- **Severity**: P3
- **File**: various
- **Detail**:
  - `ServerRequest.host` documented but never populated — always undefined.
  - ServerReply.ts:5,22 TODOs; core/index.ts:74 TODO questions `server:onSend`.
  - HTML detection matches only exact-case `<!DOCTYPE html>`; lowercase served as text/plain (ServerRouterProvider.ts:317).
  - NodeHttpServerProvider: doc says shutdown timeout 30000, value 10000; `listen()` error listener stays attached, re-"rejecting" a settled promise.
  - `$serve.ignoreDotEnvFiles` doc inverted relative to behavior.
  - `$authCredentials` precedence: realm.login wins over explicit options.account — opposite of every other provider.
  - `$authGithub` accepts Partial<OidcOptions> spread into oauth config; `res.id.toString()` TypeErrors on a GitHub error payload.
  - `SseStream`: subscribe-only consumers → unbounded queue; two concurrent iterators clobber the single resolve slot.
  - `/metrics` registered unauthenticated with no opt-out.
  - compress accept-encoding matching is substring-based (`"gzip;q=0"` still selects gzip).
  - Swagger asset-path resolution: `// TODO: this is shitty`, 4 hardcoded join probes; titled schemas collide silently in components/schemas.
  - ServerTimingProvider mixed-case header key; trailing `", "` in value.

### Coverage notes
- Read in full: all of core/ (providers, services, primitives, helpers, interfaces, errors, index), static/, proxy/, etag/, cors/, health/, metrics/, rate-limit/, swagger/, links/, cookies/, auth/ (provider, $auth, all $auth* presets, helpers, constants). Cross-checked router matcher and PipelineHandler.
- Test gaps: missing required query params; falsy handler returns; backslash redirect payloads; chunked multipart; multiple Set-Cookie through $proxy; SSE disconnect/cancel; compress backpressure; CORS GET-with-custom-header preflight; no Vary assertions anywhere; shutdown timeout paths; rate-limit default-path throttling.

---

## orm

### ✅ FIXED — [BUG] `aggregate()` skips tenant scoping and soft-delete filter when `where` is omitted
- **Severity**: P1
- **File**: packages/alepha/src/orm/core/services/Repository.ts:1258
- **Detail**: In `aggregate()`, `withOrganization(withDeletedAt(...))` is only applied inside `if (query.where)`. An aggregate with no `where` therefore includes soft-deleted rows AND other tenants' rows on `PG_ORGANIZATION`-scoped entities — including `strict` tenancy tables, whose fail-closed guard never runs. `findMany`, `count`, `updateMany`, `deleteMany` all apply scoping unconditionally; `aggregate` is the one asymmetric path. Fix: hoist the scoping call out of the `if`. No test covers aggregate + organization/deletedAt.

### ✅ FIXED — [BUG] `Repository.transaction()` commits before async work completes on SQLite drivers
- **Severity**: P1
- **File**: packages/alepha/src/orm/core/services/Repository.ts:271
- **Detail**: `transaction()` calls `this.db.transaction(cb)`; on node:sqlite/bun:sqlite this reaches drizzle's sync session and the shimmed `db.transaction` (NodeSqliteProvider.ts:201-217) runs `BEGIN; result = fn(...); COMMIT` synchronously — an async callback returns a pending Promise and COMMIT executes immediately, so every statement in the callback runs **outside** the transaction and can never roll back. The `transactional` override's own comment admits this but only `transactional` was fixed; public `Repository.transaction()` still routes through the broken path. Fix: delegate to `provider.transactional` on sync-sqlite drivers, or reject async callbacks there.

### ✅ FIXED — [BUG] `BunSqliteProvider` inherits the base `transactional()` — same premature-commit hole
- **Severity**: P1
- **File**: packages/alepha/src/orm/core/providers/drivers/BunSqliteProvider.ts:74
- **Detail**: NodeSqliteProvider overrides `transactional()` with explicit awaited BEGIN/COMMIT/ROLLBACK precisely because drizzle's sync sqlite driver can't wrap async callbacks; BunSqliteProvider has no such override, so `$transactional`/`$seed` on Bun+SQLite commit while the async body is still pending. Rollback-on-error silently doesn't happen. Bun spec has zero transaction coverage. Fix: port the override.

### ✅ FIXED — [BUG] Concurrent `transactional()` blocks on NodeSqlite collide on the shared connection
- **Severity**: P1
- **File**: packages/alepha/src/orm/core/providers/drivers/NodeSqliteProvider.ts:134
- **Detail**: The tx marker is ALS-scoped per request, but BEGIN executes on the single shared `DatabaseSync` connection. While request A awaits inside its `transactional()` body, request B issues its own BEGIN → "cannot start a transaction within a transaction"; worse, B's COMMIT/ROLLBACK can end A's half-finished transaction. Any server under concurrent load using the default sqlite driver with `$transactional` can hit this. Fix: per-connection mutex/queue. Same hazard in the base class when `transactional()` runs outside ALS context (marker goes to the global store).

### ✅ FIXED — [BUG] `upsert()` conflict-update path is not organization-scoped (cross-tenant write) and ignores soft-delete
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/Repository.ts:829
- **Detail**: `upsert` stamps the org on insert values, but `onConflictDoUpdate({ target, set })` has no `where` — if the conflict target is a tenant-agnostic unique key (e.g. email), a tenant's upsert overwrites another tenant's row. Also updates soft-deleted rows, silently "resurrecting" data. Fix: pass `setWhere`/`targetWhere` built from `withOrganization(withDeletedAt({}))`.

### ✅ FIXED — [BUG] `findMany` silently caps results at 1000 and mutates the caller's query (SQLite offset-without-limit)
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/Repository.ts:392
- **Detail**: `if (dialect === "sqlite" && !query.limit) { query.limit = 1000; }` — offset with no limit on sqlite/D1 silently truncates to 1000 (pg returns everything: dialect-divergent), and the caller's query object is mutated (carries `limit: 1000` on pg too on reuse). Fix: `LIMIT -1` and a local variable.

### ✅ FIXED — [BUG] `bigint` columns lose precision on SQLite/D1 (mapped to JS-number integer)
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/SqliteModelBuilder.ts:193
- **Detail**: `z.bigint()` maps on PG to `mode: "bigint"` (exact), but on SQLite to `integer(key, { mode: "number" })`. Values beyond 2^53 (snowflake/external 64-bit IDs) silently corrupt on sqlite/D1 while working on pg. Fix: customType with safeIntegers/text storage or BigInt round-trip.

### ✅ FIXED — [BUG] `format: "binary"` columns are broken on SQLite
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/SqliteModelBuilder.ts:283
- **Detail**: On PG binary → bytea customType (Buffer); on SQLite → `sqliteJson` — `JSON.stringify(buffer)` writes `{"type":"Buffer","data":[...]}` and parse returns that plain object, never a Buffer. Different type per dialect; zero test coverage. Fix: blob customType or reject binary on sqlite with a clear error.

### ✅ FIXED — [BUG] `z.any()` columns supported on SQLite but crash the Postgres model builder
- **Severity**: P2
- **File**: packages/alepha/src/orm/postgres/services/PostgresModelBuilder.ts:388
- **Detail**: SqliteModelBuilder handles `isAny` (→ JSON text); PostgresModelBuilder has no `isAny` branch and throws `Unsupported schema type` at startup. An entity developed on sqlite dev driver breaks on pg deploy. Fix: map isAny to jsonb.

### ✅ FIXED — [BUG] Missing-column errors misclassified as `DbTableNotFoundError`
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/Repository.ts:1434
- **Detail**: PG's `column "x" of relation "y" does not exist` contains both "does not exist" and "relation", so it matches the table branch before the column branch. Fix: check column pattern first, or require message to start with relation/table.

### ✅ FIXED — [BUG] `ModelBuilder` silently drops indexes, foreign keys, and constraints on column-name typos
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/ModelBuilder.ts:102
- **Detail**: Builder paths guard with `if ((self as any)[indexDef])` / length checks and *skip* the config when a column lookup fails — a typo'd column in `indexes`/`foreignKeys`/`constraints` produces no constraint and no error; migration generation emits a schema missing it. Silent data-integrity hazard. Fix: throw AlephaError naming entity and bad column.

### [BUG] `CloudflareHyperdriveProvider.db` creates a new postgres client on every access and never closes it
- **Severity**: P2
- **File**: packages/alepha/src/orm/postgres/providers/CloudflareHyperdriveProvider.ts:56
- **Detail**: The `db` getter runs `postgresFn(connectionString, pgOptions)` on **every access** — at least once per repository operation — and nothing calls `client.end()`. N pools per request, defeats statement caching. Fix: cache per request context (ALS key) and close on request end.

### ✅ FIXED — [BUG] `paginate` count query escapes an explicit `opts.tx`
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/Repository.ts:567
- **Detail**: `paginate`'s count uses `this.db.$count(...)` directly, ignoring `opts.tx` (both explicit-tx and `tx: null` bypass that `count()` at 1196 honors). A `paginate(..., { count: true, tx })` runs its count outside the transaction. Fix: reuse the same db-resolution expression.

### ✅ FIXED — [BUG] SQLite/D1 silently accept PG-only array operators
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/QueryManager.ts:458
- **Detail**: `arrayContains`/`arrayContained`/`arrayOverlaps` map to drizzle's PG array functions unconditionally, but sqlite stores string arrays as JSON text — invalid SQL / wrong semantics at runtime. `ilike` family got sqlite fallbacks; array family didn't. Fix: throw "not supported on sqlite" or implement via json_each.

### ✅ FIXED — [UNFINISHED] `upsert()` SET values bypass codec encoding — dead commented-out cast
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/Repository.ts:826
- **Detail**: `//setData = this.cast(setData, false) as any;` commented out, so the ON CONFLICT set payload skips validation and codec encoding that every other write path applies. `cast()` already extracts SQL wrappers safely, so it can be re-enabled.

### ✅ FIXED — [UNFINISHED] `db.primaryKey(type)` discards the given type/options; text PK overload throws at runtime
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/providers/DatabaseTypeProvider.ts:88
- **Detail**: The overload accepts any string schema but only handles `format === "uuid"`, otherwise throws `Unsupported type for primary key` — a plain-text/slug PK compiles but crashes at startup. All branches construct fresh schemas, discarding the caller's constraints; `_options` never used. Fix: honor the passed schema and support text PKs, or remove the overloads.

### ✅ FIXED — [BUG] Drizzle-kit push executes statements ignoring `hasDataLoss` / warnings
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/providers/DrizzleKitProvider.ts:256
- **Detail**: `pushSqlite`/`pushPostgres` destructure only `statementsToExecute` and run everything; `warnings` and `hasDataLoss` are consulted only in `dryRunPush`. Dev-mode `synchronize()` will drop/recreate a column and wipe local data with no log line. Also `generateMigration()` has no scan for DROP TABLE on cascade parents — the documented D1 wipe hazard has no safeguard in this layer.

### [BUG] `SET search_path` before pg migrations runs on one pooled connection
- **Severity**: P2
- **File**: packages/alepha/src/orm/postgres/providers/NodePostgresProvider.ts:37
- **Detail**: `db.execute(SET search_path …)` then `migrate(...)` — with postgres.js pooling the SET applies to one pooled connection; migrate() may check out a different one and create tables in `public`. Same pattern in BunPostgresProvider and Hyperdrive (pooled, same race); Pglite safe (single conn). Fix: reserved connection/transaction or SET LOCAL. Also BunPostgresProvider.ts:74 appends `search_path=…` as a plain URL query param — not a libpq keyword, likely ignored (should be `options=-csearch_path=…`).

### ✅ FIXED — [RECO] Unknown filter operators silently become `eq(column, object)`
- **Severity**: P2
- **File**: packages/alepha/src/orm/core/services/QueryManager.ts:282
- **Detail**: An object value without any known operator key (`{ in: [...] }` instead of `{ inArray: [...] }`, or typos) falls into the direct-value branch and produces `eq(column, <object>)` — at best a serialization error, at worst a query matching nothing, no hint. Fix: throw on object literals with no recognized operator when the column isn't a JSON column. Also `{ column: null }` in a where is silently dropped (reads like IS NULL but returns unfiltered rows) — worth an explicit error or IS NULL semantics.

### [BUG] `distinct` + `with` (joins) combination silently returns garbage
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:367
- **Detail**: `rawSelectDistinct` selects a flat field map but join post-processing assumes drizzle's nested per-table row shape; with both set, `row[this.tableName]` is undefined and mapping breaks. Fix: throw "distinct cannot be combined with with".

### [RECO] `columns` doesn't restrict the SQL projection
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:367
- **Detail**: `query.columns` only narrows the schema used by `clean()`; SQL still SELECT *s. Wide tables pay full I/O. Fix: pass the picked field map to `db.select(fields)`.

### [BUG] Callers' objects are mutated by update/save paths
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:877
- **Detail**: `updateOne` (878) and `updateMany` (1041) write `updatedAt` into the caller's data object; `findMany` writes `limit` into the caller's query (394); `destroy` writes `deletedAt` into the caller's entity. Reused objects carry stale injected fields. Fix: shallow-copy.

### [RECO] Per-repository `DbCacheProvider` is `new`'d, unbounded, and key generation can blow up
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:101
- **Detail**: `dbCache = new DbCacheProvider()` bypasses DI (not substitutable); entries without ttl never expire, Map unbounded; `buildCacheKey` does `JSON.stringify(query)` — a query containing `with` produces enormous or circular-failing keys. Raw `query()` writes never invalidate. Fix: inject, cap, stable serializer.

### [BUG] `upsert` with no `updatedAt` field can emit an empty SET clause
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:801
- **Detail**: Default setData removes conflict-target keys and PK; for entities without PG_UPDATED_AT (e.g. `upsert({ email }, { target: ["email"] })`), `onConflictDoUpdate` receives `{}` → drizzle throws/invalid SQL. Fix: fall back to onConflictDoNothing + re-select, or SET target to itself.

### [RECO] `createMany` batches are not atomic
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/services/Repository.ts:731
- **Detail**: Batches of 1000 run as independent INSERTs; failure in batch N leaves 1..N-1 committed (outside ambient $transactional). Undocumented. Wrap in provider.transactional when supported, or document.

### [BUG] node:sqlite prepare shim renames columns of raw JOIN queries
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/providers/drivers/NodeSqliteProvider.ts:232
- **Detail**: The `db.prepare` shim rewrites any SELECT-with-JOIN with duplicate trailing column names to positional aliases `__c0, __c1, …` — unconditionally, including user raw SQL via `repository.query()`. Such queries come back keyed `__c0…`. Fix: apply the rewrite only inside the `stmt.raw()` path.

### [UNFINISHED] FK error message assumes DELETE
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/errors/DbForeignKeyError.ts:50
- **Detail**: `fromDatabaseError` always renders "Cannot delete {table}: it is referenced by …", but FK violations equally arise from INSERT/UPDATE with a dangling reference. Branch on "is not present in table" vs "is still referenced".

### [UNFINISHED] `index.browser.ts` registers a module as a service
- **Severity**: P3
- **File**: packages/alepha/src/orm/core/index.browser.ts:9
- **Detail**: `services: [AlephaDateTime]` lists a module in `services` (every other index uses `imports:`). Harmless today; copy-paste slip.

### Coverage notes
- Read in full: all 59 non-test source files under orm/ (core services/providers/drivers/primitives/interfaces/schemas/constants/helpers/errors/modes, all index variants, full postgres/ tree). Cross-checked AlsProvider/StateManager for tx-marker scoping and drizzle-orm sqlite session sources in node_modules to verify the sync-transaction findings.
- Test gaps: aggregate + org scoping / soft delete; Bun transaction/rollback (zero coverage); Repository.transaction async on sqlite; transactional concurrency; binary columns (zero tests); distinct+with, columns+joins, cache with `with`; array operators on sqlite; upsert on org-scoped entities / vs soft-deleted rows; non-public POSTGRES_SCHEMA on Bun/Hyperdrive.

---

## cache + redis + bucket + email + sms

### ✅ FIXED — [BUG] Wildcard invalidation with zero matches wipes the entire cache container
- **Severity**: P1
- **File**: packages/alepha/src/cache/core/providers/CacheProvider.ts:124
- **Detail**: `invalidateKeys` expands `"prefix*"` via `this.keys(name, prefix)`; when nothing matches, `keysToDelete` is empty and it falls through to `await this.del(name, ...[])` — and every provider treats zero-key `del(name)` as "delete ALL keys in this container" (MemoryCacheProvider.ts:221, CloudflareKVProvider.ts:169, RedisCacheProvider.ts:86, DatabaseCacheProvider.ts:174). So `cache.invalidate("user:123:*")` on a cold/empty prefix silently flushes the whole cache (and deletes all rows of the container in the DB provider), inviting a stampede. The L1 side of `CachePrimitive.invalidate` (`$cache.ts:365-374`) correctly deletes only matching keys, confirming the remote wipe is unintended. Fix: return early when the original `keys` array was non-empty but `keysToDelete` is empty. Tests only cover wildcard-with-matches.

### ✅ FIXED — [BUG] Handler returning `undefined` poisons the cache key — subsequent reads throw
- **Severity**: P1
- **File**: packages/alepha/src/cache/core/providers/CacheProvider.ts:150 (with $cache.ts:343-346)
- **Detail**: `serialize(undefined)` does `JSON.stringify(undefined)` → `undefined`, and `TextEncoder.encode(undefined)` yields an **empty** payload (verified in Node), so the stored value is a lone `JSON` marker byte. On next read `deserialize` → `JSON.parse("")` throws `SyntaxError`, which propagates uncaught out of `CachePrimitive.read()` — every call for that key now crashes until TTL expiry instead of re-running the handler. Fix: skip `set()` when the value is `undefined` (mirroring the existing `read.value !== undefined` miss semantics). Falsy-values test covers `0/""/false/null` but not `undefined`.

### ✅ FIXED — [BUG] BunRedisProvider.set corrupts binary values whenever any SET option is used
- **Severity**: P1
- **File**: packages/alepha/src/redis/providers/BunRedisProvider.ts:158
- **Detail**: The options path builds `args = [key, buf.toString("binary")]` and sends via `publisher.send("SET", args)`. `toString("binary")` is latin1; Bun's RESP writer encodes string args as UTF-8, so every byte ≥ 0x80 gets double-encoded (verified: 6-byte buffer round-trips to 10 bytes). `RedisCacheProvider.set` always passes `expiration: {type:"PX"}` for TTL'd caches, so on Bun any compressed, `Uint8Array`, or non-ASCII cache value is stored corrupted. Only the no-options fast path is safe. Bun spec's "set with EX option" test uses ASCII only. Fix: use Bun.RedisClient's native set-with-options API or pass raw bytes.

### ✅ FIXED — [BUG] LocalFileStorageProvider allows path traversal via fileId
- **Severity**: P1
- **File**: packages/alepha/src/bucket/providers/LocalFileStorageProvider.ts:204
- **Detail**: `path()` does `join(this.storagePath, bucket, fileId)` with no sanitization, so `download(bucket, "../../../../etc/passwd")`, `delete`, `exists`, and `upload` with a caller-supplied fileId escape the storage root — `$bucket.download(fileId)` is the natural place to feed a request param straight in. S3/R2/Memory treat the id as opaque, so only the Local provider (the non-test default on Node without `S3_ENDPOINT`, bucket/index.ts:79-90) is exploitable — a provider-swap silently changes security posture. Fix: reject fileIds containing `/`, `\` or `..` (or verify resolved path stays under `storagePath`).

### ✅ FIXED — [BUG] `get()` after `incr()` throws on KV/Redis but works on Memory/Database
- **Severity**: P2
- **File**: packages/alepha/src/cache/core/providers/CloudflareKVProvider.ts:225 (and redis/providers/NodeRedisProvider.ts:241)
- **Detail**: `MemoryCacheProvider.incr` stores `this.serialize(newValue)` and DB provider re-serializes `row.count`, but KV `incr` does `kv.put(kvKey, String(newValue))` and Redis `INCRBY` stores raw ASCII digits — `getTyped` then sees first byte 0x30-0x39 and throws `CacheError("Unknown serialization type")`. Same app code passes tests on Memory and crashes on KV/Redis. Fix: fall back to `Number.parseInt` for unmarked numeric payloads, or store the typed marker.

### [BUG] CloudflareKV silently clamps TTL to a 60-second minimum
- **Severity**: P2
- **File**: packages/alepha/src/cache/core/providers/CloudflareKVProvider.ts:152
- **Detail**: `options.expirationTtl = Math.max(60, Math.ceil(ttl / 1000))` — a 5s TTL entry lives up to 60s on Workers, with no log or freshness check on read. KV genuinely requires ≥60s, but the divergence is invisible. Fix: wrap clamped values in the SWR-style envelope (or `freshUntil`) so `read()` honors the real TTL, or log a warning.

### ✅ FIXED — [BUG] DatabaseCacheProvider.incr never clears a stale `expiresAt`, hiding a live counter
- **Severity**: P2
- **File**: packages/alepha/src/cache/database/providers/DatabaseCacheProvider.ts:229
- **Detail**: The upsert's conflict `set` updates `count`/`value` but not `expiresAt`. If a key expired but wasn't swept, `incr()` keeps counting on the row while `get()`/`has()` filter it via `unexpiredWhere` — key reports absent while `incr()` returns growing values. Fix: add `expiresAt: null` (or fresh TTL) to the conflict set. Note `incr` on a live `set()` row also silently nulls the cached `value`.

### ✅ FIXED — [BUG] S3 delete of a missing file silently succeeds; Memory/Local/R2 throw FileNotFoundError
- **Severity**: P2
- **File**: packages/alepha/src/bucket/providers/S3FileStorageProvider.ts:228
- **Detail**: s3mini's `deleteObject` returns a boolean and the provider ignores it, while R2 does an explicit `exists` check "for consistency with other providers" and Memory/Local throw. Same `bucket.delete(id)` diverges per backend. The S3 spec's `testDeleteNonExistentFile` never actually deletes a non-existent id. Fix: check the return and throw `FileNotFoundError` on `false` (or drop the throw everywhere; pick one contract).

### ✅ FIXED — [BUG] SMS defaults to MemorySmsProvider in every environment, including production
- **Severity**: P2
- **File**: packages/alepha/src/sms/index.ts:50
- **Detail**: `register` binds `SmsProvider → MemorySmsProvider` unconditionally (unlike email, which switches on `isTest()`). In production, `$sms.send()` "succeeds" by pushing into an in-process array — silent message loss with a success hook emitted. `LocalSmsProvider` exists but is never selected; no real provider in tree. Fix: mirror email's env-switch; warn-log on first prod send through Memory.

### [UNFINISHED] R2 / CloudflareKV / Nodemailer providers have zero test coverage
- **Severity**: P2
- **File**: packages/alepha/src/bucket/providers/R2FileStorageProvider.ts:1
- **Detail**: No spec for `R2FileStorageProvider` (production default on Workers), `CloudflareKVProvider` (production default cache on Workers), or `NodemailerEmailProvider`. R2 download returns a hand-rolled `FileLike` whose `stream`/`arrayBuffer`/`text` all share the single-use `object.body` — calling more than one accessor drains the body; `httpMetadata?.contentType ?? "application/octet-stream"` doesn't catch empty-string content type; neither pinned by tests.

### [BUG] Fire-and-forget vs awaited cache writes — middleware and primitive mode fail differently
- **Severity**: P2
- **File**: packages/alepha/src/cache/core/primitives/$cache.ts:82 (vs :345)
- **Detail**: Middleware mode does `instance.set(key, result).catch(() => {})` — provider outages swallowed with no logging — while primitive-mode `run()` does `await this.set(key, result)`, so a Redis/KV write failure fails the request even though the handler produced a valid result. Fix: make `run()` non-fatal on set-failure (log + return result), and log in the middleware catch.

### [RECO] Redis wildcard invalidation and clear() use blocking `KEYS`
- **Severity**: P2
- **File**: packages/alepha/src/redis/providers/NodeRedisProvider.ts:196 (used by RedisCacheProvider.ts:87,106-120)
- **Detail**: Container flush, wildcard `invalidate("x*")`, and `clear()` all run the O(N) blocking `KEYS` command — a production hazard on shared/large Redis. Replace with cursor-based `SCAN`/`UNLINK`.

### [UNFINISHED] R2 file id embeds an unsanitized user filename extension; diverges from S3/Local id scheme
- **Severity**: P3
- **File**: packages/alepha/src/bucket/providers/R2FileStorageProvider.ts:265
- **Detail**: R2's `createId(filename)` takes everything after the last `.` of the user-controlled filename (`"x.png/../y"` → ext `"png/../y"`, nested/odd keys, contained within bucket prefix but attacker-shaped), while S3/Local derive extension from MIME type via `FileDetector`. Fix: use MIME-derived extension on R2 too, or sanitize.

### [UNFINISHED] Bucket module docs advertise features that don't exist
- **Severity**: P3
- **File**: packages/alepha/src/bucket/index.ts:66
- **Detail**: Module JSDoc lists "TTL-based file expiration" and "Azure Blob Storage, Vercel Blob" providers — none exist (Memory/Local/S3/R2 only, no TTL). Cache core's doc says "Providers: Memory (default), Redis" omitting KV/Database. Stale docs feed the auto-generated reference.

### [UNFINISHED] `email:sending`/`sms:sending` hooks always emit `variables: {}`
- **Severity**: P3
- **File**: packages/alepha/src/email/core/primitives/$email.ts:62 (and sms/primitives/$sms.ts:57)
- **Detail**: Hook payload carries `template` (actually channel name) and hardcoded `variables: {}` — vestiges of removed template-rendering design. Drop `variables` from Hooks declarations or pass real data.

### [UNFINISHED] `BucketFileOptions` is declared twice in the same file
- **Severity**: P3
- **File**: packages/alepha/src/bucket/primitives/$bucket.ts:123 and :365
- **Detail**: Interface fully documented at 123-203 and re-declared (older docs) at 365-382; TS silently merges. Delete the trailing duplicate.

### [BUG] `incr()` bypasses `disabled` / `enabled` / lifecycle guards
- **Severity**: P3
- **File**: packages/alepha/src/cache/core/primitives/$cache.ts:353
- **Detail**: `read()`/`set()` no-op when `!isStarted() || options.disabled || !settings.enabled`, but `incr()` calls the provider unconditionally — a disabled cache still mutates the store (and on KV throws before binding init). Add the same guard.

### ✅ FIXED — [BUG] SWR envelope collides with user data / breaks binary values
- **Severity**: P3
- **File**: packages/alepha/src/cache/core/primitives/$cache.ts:594 and :409
- **Detail**: `isSwrEnvelope` matches any cached object with `{__swr: 1, v, f}` keys (user data unwrapped incorrectly); with `stale` configured, a `Uint8Array` gets JSON-stringified inside the envelope instead of BINARY marker, deserializing as a plain object. Use a more distinctive marker; document "SWR requires JSON-serializable values".

### [BUG] Provider divergence in downloaded file metadata
- **Severity**: P3
- **File**: packages/alepha/src/bucket/providers/LocalFileStorageProvider.ts:126
- **Detail**: Local `download` returns `name: fileId` + extension-guessed type (original name/type never persisted); Memory preserves both; S3 via `x-amz-meta-name` (its `decodeURIComponent` at S3FileStorageProvider.ts:195 can throw `URIError` on foreign objects with literal `%`); R2 raw name in `customMetadata`. Same call, different `file.name`/`file.type` per backend.

### [RECO] CloudflareKV `incr` is non-atomic and counters never expire
- **Severity**: P3
- **File**: packages/alepha/src/cache/core/providers/CloudflareKVProvider.ts:209
- **Detail**: `incr` is read-then-put (lost updates across isolates) and `put` carries no `expirationTtl`, so counters accumulate forever. Document non-atomicity or route through a Durable Object; consider optional TTL on the incr contract (no provider expires counters today).

### Coverage notes
- Read in full: all 25 non-test source files across cache/ (core, database, redis), redis/, bucket/, email/ (core, brevo, cloudflare, smtp), sms/.
- Test gaps: no spec for R2FileStorageProvider, CloudflareKVProvider, NodemailerEmailProvider, NodeRedisSubscriberProvider; Bun redis spec never round-trips binary with SET options; wildcard invalidation only tested with matches; `undefined` handler return untested; `testDeleteNonExistentFile` misnamed; no `compress:true` through Redis-on-Bun test. Also: `MemoryFileStorageProvider.upload` records `size: file.size` (0 for direct stream uploads) rather than `buffer.length` — only unreachable via `$bucket` because the primitive materializes streams first.

---

## websocket + topic + queue + batch + background + scheduler + lock + retry

### ✅ FIXED — [BUG] Redis pub/sub: parameterized topics silently never deliver (wildcard SUBSCRIBE without PSUBSCRIBE)
- **Severity**: P1 (silent total message loss)
- **File**: packages/alepha/src/topic/redis/providers/RedisTopicProvider.ts:61 (with topic/core/providers/TopicProvider.ts:97-126 and redis/providers/NodeRedisSubscriberProvider.ts:70-75)
- **Detail**: `TopicProvider.subscribeHandler` wildcardizes parameterized topic names (`devices/{deviceId}/sensor` → `devices/*/sensor`), then calls `subscribe()` with that pattern. `NodeRedisSubscriberProvider.subscribe` uses plain SUBSCRIBE, never PSUBSCRIBE, so the pattern is treated as a literal channel name and never matches the interpolated channels publishers write to. Every `$topic` with `params` on Redis subscribes to a dead channel — publishes vanish. Telling: `testTopicParams` exists in shared tests and runs against Memory, but is absent from RedisTopicProvider.spec.ts. Fix: pSubscribe/pUnsubscribe when the channel contains the wildcard char (or reject params topics on Redis loudly).

### ✅ FIXED — [BUG] Node WebSocket connection ids collide across instances (`ws-1`, `ws-2`, …)
- **Severity**: P1 (misdelivery/loss in multi-instance setups)
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts:293,425
- **Detail**: `ws-${this.nextConnectionId++}` is per-process. `emit()` distributes `connectionIds`/`exceptConnectionIds` to all instances via the topic bus, and `sendToLocalConnections` matches ids against local connections. With 2+ instances behind Redis, instance B's `ws-1` receives messages targeted at instance A's `ws-1`; `exceptSelf` wrongly excludes same-numbered connections on every other instance. The Cloudflare path already uses `crypto.randomUUID()`. Fix: UUID (or instance-prefixed id) on Node too.

### ✅ FIXED — [BUG] WebSocketClient: intentional disconnect triggers auto-reconnect → leaked zombie connection
- **Severity**: P1
- **File**: packages/alepha/src/websocket/services/WebSocketClient.ts:254-274, 438-459
- **Detail**: `disconnect()` calls `ws.close()` but sets no intentional-close flag; `onclose` runs `scheduleReconnect()` ~3s later. In the unsubscribe-last-room path, cleanup deletes the connection from the map *and* calls `disconnect()` — the orphaned connection reconnects with zero subscriptions and no owner, forever (reconnectAttempts resets on every successful open). Fix: `manuallyClosed` flag.

### ✅ FIXED — [BUG] RoomEngine: `onLeave` throw on last leave skips teardown → tick-loop timer leak and `onEmpty` (persistence) never runs
- **Severity**: P1
- **File**: packages/alepha/src/websocket/providers/RoomEngine.ts:108-114
- **Detail**: `leave()` runs `await this.options.onLeave?.(...)` *before* the `size === 0 → teardown()` check; a throwing onLeave propagates and teardown never runs. On Node the close handler only logs and skips `roomEngines.delete(key)` — the setInterval loop fires on an empty room forever. On Cloudflare the error escapes `webSocketClose` and cleanup is skipped, keeping the DO ticking (billable) indefinitely. Fix: wrap onLeave in try/catch (like onEmpty) so teardown always runs.

### ✅ FIXED — [BUG] $lock release can delete another holder's lock after own expiry
- **Severity**: P2 (mutual-exclusion break under slow handlers)
- **File**: packages/alepha/src/lock/core/primitives/$lock.ts:127-137 (middleware), 504-525 (LockPrimitive.setGracePeriod)
- **Detail**: Release is `finally { await lockProvider.del(name) }` — unconditional. If the handler outlives `maxDuration` (default 5 min), the key expires, another instance acquires, then the first finisher deletes the second holder's lock (classic unsafe-release). `setGracePeriod` is worse: non-NX set overwriting the current holder. Fix: compare-and-delete (Lua GET==myId then DEL) and compare-and-set for grace.

### ✅ FIXED — [BUG] LockPrimitive: shared per-instance id defeats in-process mutual exclusion
- **Severity**: P2
- **File**: packages/alepha/src/lock/core/primitives/$lock.ts:421-427, 443-473
- **Detail**: One lazily-created `this.id` per primitive instance — two overlapping `run()` calls both SET NX GET, both read back `id === this.id`, both enter the critical section (the exact failure the middleware fixes with a per-invocation id). LockPrimitive is exported public API but only instantiated by its own tests; its topic-based `wait()` is dead code. Fix: per-invocation UUID, or retire the class.

### ✅ FIXED — [BUG] Node room path: close/message racing an async `join` → ghost socket, room never empties
- **Severity**: P2
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts:336-382
- **Detail**: `engine.join(roomSocket)` awaited nowhere. If the `state` factory is async and the client disconnects during it, the close handler's `leave()` early-returns (socket not yet in engine.sockets), then join completes and adds the socket — a closed ghost held forever (tick loop indefinite, onEmpty never persists). Same window drops client frames arriving before join resolves. Fix: gate message/close on the join promise; leave cancels pending join.

### ✅ FIXED — [BUG] RoomEngine: failed `state` factory latches the room broken
- **Severity**: P2
- **File**: packages/alepha/src/websocket/providers/RoomEngine.ts:157-166
- **Detail**: `ensureAlive` caches `this.starting`; if the factory rejects, every subsequent join/call re-awaits the same rejection; engine only resets in teardown(), unreachable because no socket ever joined. A headless coordinator reached via `call()` is wedged until restart. Fix: clear `this.starting` on rejection.

### ✅ FIXED — [BUG] WorkerdWorkerProvider drops `$consumer` pipeline middleware
- **Severity**: P2
- **File**: packages/alepha/src/queue/core/providers/WorkerdWorkerProvider.ts:37
- **Detail**: Base registers `handler: (msg) => consumer.handler.run(msg)` (pipeline-wrapped); workerd override pushes `consumer.options` whose handler is the raw options handler. Middleware (`$retry`/`$lock` in `use`) runs on Node but not Cloudflare. Fix: mirror the base wrapping.

### ✅ FIXED — [BUG] Worker polling loop dies permanently on a `pop()` error
- **Severity**: P2
- **File**: packages/alepha/src/queue/core/providers/WorkerProvider.ts:131-156, 200-212
- **Detail**: `processMessage` catches handler errors, but `getNextMessage` does not — a throw from `provider.pop()` (Redis blip) escapes the while loop into the .catch that logs "Worker crashed" and decrements workersRunning. With default concurrency 1, polling stops entirely; recovery only when local code calls `push()` (wakeUp). Fix: try/catch around getNextMessage with backoff.

### ✅ FIXED — [BUG] Node stateless channel: client-controlled `roomId` spoofing in message frames
- **Severity**: P2 (clients can broadcast into rooms they never joined)
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts:803, 823-843
- **Detail**: `handleMessage` takes `roomId = parsed.roomId || this.roomIds[0]` from the client frame with no `isInRoom` check, and `reply()` fans out to `options.roomId || roomId` via the cross-instance bus. A client in room A can address any room B per-frame. Cloudflare explicitly forbids cross-room reply (assertReplyRoom throws) — security hole and Node/CF divergence. Fix: validate frame roomId against joined rooms (or drop frame-level roomId like CF).

### ✅ FIXED — [BUG] BatchProvider: `maxQueueSize` rejection leaks the item state
- **Severity**: P2
- **File**: packages/alepha/src/batch/providers/BatchProvider.ts:245-264
- **Detail**: `push()` does `itemStates.set(id, itemState)` before the maxQueueSize check throws; the caller never gets the id, the item joins no partition, stays "pending" forever — map grows on every rejected push under backpressure. Fix: check before set, or delete before throwing.

### ✅ FIXED — [BUG] TopicProvider.waitForMessage: subscribe failure hangs the caller forever
- **Severity**: P2
- **File**: packages/alepha/src/topic/core/providers/TopicProvider.ts:131-170
- **Detail**: Un-awaited async IIFE inside `new Promise`; if `subscribe` rejects, the rejection is swallowed and neither resolve nor reject is called — caller awaits forever, no timeout armed (created after subscribe). Secondary: retained message delivered synchronously resolves before `ref.clear` is assigned, leaking the subscription. Fix: try/catch → reject; arm timeout first.

### [BUG] Node graceful stop / management APIs are blind to `$room` connections
- **Severity**: P2
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts:286-383, 712-741
- **Detail**: `handleRoomConnection` never registers in `this.connections`, so `getConnections()`, `getUserConnections()`, `closeConnection()` don't see room sockets, and the stop hook's close-all loop skips them — abrupt TCP teardown instead of `1001` close (`wss.close()` with noServer doesn't close established sockets). Fix: track room sockets in connections or close explicitly on stop.

### ✅ FIXED — [BUG] WebSocketClient reconnect timer uses `window.setTimeout` — crashes off-browser
- **Severity**: P2
- **File**: packages/alepha/src/websocket/services/WebSocketClient.ts:424
- **Detail**: `buildUrl()` supports non-browser use (WEBSOCKET_URL env fallback), but `scheduleReconnect` calls `window.setTimeout` — ReferenceError in Node/workers on first disconnect. Fix: bare `setTimeout` + `ReturnType<typeof setTimeout>`.

### [BUG] Second `subscribe` to the same room silently replaces the first handler
- **Severity**: P2
- **File**: packages/alepha/src/websocket/services/WebSocketClient.ts:143, 165-179
- **Detail**: `subscriptions` is `Map<roomId, handler>` — second subscriber overwrites the first, and either party's unsubscribe deletes the survivor (two components on one room is the normal UI case). Also every new-room subscribe on an OPEN connection calls `reconnect()`, tearing down the live socket. Fix: `Map<roomId, Set<handler>>` and additive join messages (needs server support).

### ✅ FIXED — [UNFINISHED] Client message dispatch fans every message to every room's handler (acknowledged TODO)
- **Severity**: P1 for multi-room clients, P3 single-room
- **File**: packages/alepha/src/websocket/services/WebSocketClient.ts:330-335
- **Detail**: `// TODO: Server should include roomId in response` — `handleMessage` loops all subscription handlers, so a client on rooms A and B delivers A's messages to B's handler too. Server never stamps roomId on outbound frames, so the client cannot filter. Makes the documented multi-room client model incorrect. Fix: include roomId in the server envelope.

### ✅ FIXED — [UNFINISHED] `websocket:*` hooks declared but never emitted
- **Severity**: P3
- **File**: packages/alepha/src/websocket/index.shared.ts:16-53
- **Detail**: `websocket:connect/disconnect/message/error` declared in Hooks augmentation with full JSDoc; repo-wide grep shows no emit for any. Emit them or delete the declarations.

### [UNFINISHED] `$websocket` option `provider?: any` accepted and ignored
- **Severity**: P3
- **File**: packages/alepha/src/websocket/interfaces/WebSocketInterfaces.ts:116-119
- **Detail**: No code reads `options.provider`; always registers with the injected WebSocketServerProvider. Remove or wire up.

### ✅ FIXED — [UNFINISHED] `alepha/queue` module docs promise features `$queue` explicitly does not have
- **Severity**: P3
- **File**: packages/alepha/src/queue/core/index.ts:24-28 (and index.workerd.ts:45-49; $consumer.ts:22-23, 83)
- **Detail**: Module JSDoc lists "Retry mechanisms with exponential backoff", "Dead letter queues", "Batch processing"; `$consumer` claims built-in retry/DLQ. None exists at this layer — `$queue.ts` correctly says at-most-once, use `$job`. Correct these generated-reference sources.

### [UNFINISHED] `(this.options as any).mqtt` escape hatch in `$topic`
- **Severity**: P3
- **File**: packages/alepha/src/topic/core/primitives/$topic.ts:281, 292
- **Detail**: `mqtt: (this.options as any).mqtt` in publish and subscribe — not in TopicPrimitiveOptions, no augmentation in-tree. Declare or drop.

### ✅ FIXED — [BUG] `$queue.push` runs `codec.decode` on an already-runtime payload (double decode)
- **Severity**: P3
- **File**: packages/alepha/src/queue/core/primitives/$queue.ts:251-266 vs providers/WorkerProvider.ts:224-229
- **Detail**: `push` serializes `payload: codec.decode(schema, payload)` and processMessage decodes again. `$topic.publishMessage` correctly encodes at publish / decodes at receive. Asymmetric wire formats (dates, binary) only round-trip by luck of JSON.stringify. Fix: encode at push.

### ✅ FIXED — [RECO] RetryProvider: success after `maxDuration` is reported as failure
- **Severity**: P2
- **File**: packages/alepha/src/retry/providers/RetryProvider.ts:148-155
- **Detail**: After the handler *succeeds*, elapsed-time is checked and RetryTimeoutError thrown, discarding the successful result though side effects are committed — outer layers ($job) will re-run an operation that already completed; converts slowness into duplicate execution. Return the result once succeeded (maxDuration should bound *retrying*), or flag the tradeoff in docs.

### ✅ FIXED — [RECO] `$retry` aborted controller persists across app restart
- **Severity**: P3
- **File**: packages/alepha/src/retry/primitives/$retry.ts:29-49, 150-171
- **Detail**: `appAbortController ??= new AbortController()` + stop listener aborts it; after stop→start cycle the controller is still aborted (`??=` won't replace), so every retry throws RetryCancelError immediately. Reset on start (or null on stop).

### [RECO] Node headless `$room` engines are never evicted
- **Severity**: P2
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts:183-235
- **Detail**: `callRoom` lazily creates a RoomEngine per `channelPath:roomId`; engines only deleted in the socket-close path. Headless coordinator rooms have no sockets, so every distinct roomId ever call()ed accumulates forever — unbounded memory for id-per-user patterns the docs advertise. Document or add idle TTL eviction.

### [RECO] No liveness/heartbeat on the Node WebSocket server
- **Severity**: P2
- **File**: packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts (server path)
- **Detail**: No ping/pong, no idle timeout. Half-open TCP connections linger — inflating connections/userConnections (maxConnectionsPerUser counts dead sockets, can lock users out), keeping room tick loops alive for ghosts. Standard fix: periodic ping + isAlive flag + terminate on missed pong.

### [RECO] RoomEngine: no tick reentrancy guard for async `onTick`
- **Severity**: P3
- **File**: packages/alepha/src/websocket/providers/RoomEngine.ts:197-219
- **Detail**: An async onTick slower than `1000/tickHz` overlaps its own next invocation. For authoritative simulation, overlapping `state.step(dt)` corrupts the world. Add a `ticking` skip-and-log guard, mirroring CronProvider's `executing`.

### [RECO] Minor correctness nits
- **Severity**: P3
- **File**: several
- **Detail**: (1) RoomEngine.call throws bare `new Error` (RoomEngine.ts:124). (2) CF `webSocketMessage` doesn't null-check `deserializeAttachment()` while webSocketClose does (WebSocketRoom.ts:214) — null attachment crashes the frame with 1011. (3) Node `reply()` mutates caller's `exceptConnectionIds` via push (:831-834). (4) `calculateBackoff` jitter multiplies after the max clamp — delays can exceed backoff.max by 50% (RetryProvider.ts:226-231). (5) WorkerProvider re-pushes consumers on every start without clearing on stop — duplicates after restart (WorkerProvider.ts:87-101). (6) CF `closeConnection()` is a silent no-op.

### Coverage notes
- Read in full: every non-test source in websocket/, topic/, queue/, batch/, background/, scheduler/, lock/, retry/ (63 files) + supporting reads of redis providers and DateTimeProvider to verify claims.
- Verified-safe: RoomManager; BackgroundTaskProvider; CronProvider overlap guard and abort; BatchProvider concurrency gate; Redis SET NX GET nil-handling ($lock id comparison correct); WorkerProvider wakeUp sequencing.
- Test gaps: WebSocketClient has NO spec at all (reconnection logic untested); RedisTopicProvider.spec omits shared testTopicParams (exactly the P1 scenario); no throwing-onLeave or rejecting-state-factory tests; no Node join/disconnect race tests; WorkerProvider pop()-throw path untested; WorkerdWorkerProvider wiring untested; lock specs don't cover expiry-then-foreign-delete, grace overwrite, or concurrent LockPrimitive.run(); maxQueueSize rejection untested.

---

## react

### ✅ FIXED — [BUG] `runEvery` polling: interval reset on every render + unbounded interval registry leak
- **Severity**: P1
- **File**: packages/alepha/src/react/core/hooks/useAction.ts:288,358-377 and datetime/providers/DateTimeProvider.ts:477-481
- **Detail**: (1) `executeAction`'s dep list includes `options.onSuccess`; `useQuery` always passes a fresh inline `onSuccess` (useQuery.ts:65), so `executeAction`→`runAction` are recreated every render, and the `runEvery` effect tears down/recreates the interval each render. The documented tuple form `runEvery: [5, "seconds"]` also has fresh identity each render. A component re-rendering faster than the polling period never fires a single poll. (2) `DateTimeProvider.createInterval` pushes into the singleton `this.intervals` array, but `clearInterval` never splices the entry out (unlike clearTimeout) — every churned interval permanently retains its closure chain in a process-global array; unbounded leak in SPA sessions and servers. Fix: splice in clearInterval, stabilize callbacks via refs, key the effect on `duration.asMilliseconds()`.

### ✅ FIXED — [BUG] Query-only navigation reuses the cached layer and skips the loader
- **Severity**: P1
- **File**: packages/alepha/src/react/router/providers/ReactPageProvider.ts:352-379
- **Detail**: The layer-reuse check compares only `part` + `params`; `config.query` is decoded and passed to loaders but never participates. Client-side `router.push("/search?q=bar")` from `/search?q=foo` reuses the previous layer and never re-runs a loader that reads `query` — old data stays on screen, while SSR reload of the same URL shows fresh data (SSR/browser divergence). `$page` documents `loader: async ({ params, query })`. Fix: include the decoded query in the reuse signature.

### ✅ FIXED — [BUG] Back/forward across query-only changes leaves `useQueryParams` components stale
- **Severity**: P1
- **File**: packages/alepha/src/react/router/hooks/useQueryParams.ts:38-58, NestedView.tsx:103-104, ReactRouter.ts:240-261
- **Detail**: `useQueryParams` never subscribes to anything — evaluated during render, sync effect fires only if the component re-renders for another reason. On popstate between `?q=a` and `?q=b` (same path), the layer is reused, NestedView doesn't swap the element, the subtree never re-renders — the hook shows old params. Also `setQueryParams` writes `window.history` directly without touching router state, so two components using the same key desync. Fix: subscribe to router state (`useStore`), and have setQueryParams update the store URL.

### ✅ FIXED — [BUG] `useFormQuerySync` form→URL direction never fires (path format mismatch) and clobbers unrelated query params
- **Severity**: P1
- **File**: packages/alepha/src/react/form/hooks/useFormQuerySync.ts:119,108,130
- **Detail**: `form:change` events carry `path: "/status"` (FormModel always slash-prefixes), but the listener filters with `keys.includes(e.path)` where keys are bare names — never matches; "Direction 2 — form → URL" is dead code. Both write paths call `router.setQueryParams(record)` which replaces the whole query string, clobbering unrelated params — contradicting the comment at line 96. No test file, no app usage. Fix: compare against `/${key}`; use updater-function merge form.

### ✅ FIXED — [BUG] Clearing a date/time/datetime field crashes (`new Date("").toISOString()` throws)
- **Severity**: P1
- **File**: packages/alepha/src/react/form/services/FormModel.ts:551-560
- **Detail**: `getValueFromInput` guards null/undefined but not `""`. A native date input cleared by the user emits `value: ""`; the format:"date" branch runs `new Date("").toISOString()` → RangeError thrown synchronously in the change handler, crashing into the error boundary. Live path: `@alepha/ui` control-date.tsx:88 does `setValue(e.target.value)`. Same for time/date-time. Fix: treat `""`/NaN dates as unset → undefined.

### ✅ FIXED — [BUG] `useQuery` `enabled` flip false→true never fetches and locks `loading: true` forever
- **Severity**: P1
- **File**: packages/alepha/src/react/core/hooks/useQuery.ts:50,61,83-88 and useAction.ts:351-355
- **Detail**: `enabled` maps to `runOnInit`, whose effect is keyed on user `deps` only — flipping enabled false→true re-renders but never re-runs the effect; no fetch starts. Derived `loading` becomes true and stays true forever — permanent skeleton, no request. The common gate pattern (`enabled: !!userId`) hits this unless the gate value happens to be in deps. Spec only covers statically-false enabled. Fix: include `enabled` in the runOnInit effect deps.

### ✅ FIXED — [BUG] `<Link>` / `router.anchor()` / `useActive` break cmd/ctrl/middle-click and swallow user `onClick`
- **Severity**: P2
- **File**: packages/alepha/src/react/router/services/ReactRouter.ts:211-219, Link.tsx:16-20, useActive.ts:29-43
- **Detail**: `anchor()`'s onClick unconditionally preventDefaults and SPA-navigates — no metaKey/ctrlKey/shiftKey/altKey, button, or `target="_blank"` check, so "open in new tab" navigates the current tab. The global anchor interceptor (ReactBrowserProvider.ts:420-424) gets this right, but Link's own handler runs regardless. Link also spreads `{...props, ...router.anchor(...)}`, discarding a caller onClick. Fix: bail on modified/aux clicks; compose user onClick.

### [BUG] `FormModel.submit` double-submit guard has an async hole
- **Severity**: P2
- **File**: packages/alepha/src/react/form/services/FormModel.ts:189-214
- **Detail**: `submitInProgress` checked at entry but set true only *after* two awaited `events.emit` calls. A second submit during those emits passes the guard; handler runs twice. Fix: set the flag synchronously before the first await.

### ✅ FIXED — [BUG] `useQuery.refetch()` is silently dropped while a request is in flight
- **Severity**: P2
- **File**: packages/alepha/src/react/core/hooks/useQuery.ts:76,167 and useAction.ts:182-186
- **Detail**: Docs say "previous in-flight request is aborted", but refetch → `action.run()` with no supersede hits `if (isExecutingRef.current && !supersede) return;` — no-op during slow fetches or active polls. Fix: refetch passes `{ supersede: true }`.

### [BUG] Exit-animation race in NestedView can commit a stale view
- **Severity**: P2
- **File**: packages/alepha/src/react/router/components/NestedView.tsx:88-120
- **Detail**: The `react:transition:end` handler sleeps `duration - diff` via raw setTimeout then `setView(layer.element)` with the payload captured at emit time; no supersession check — a second navigation's end committing during the sleep gets overwritten by the older page on wake. Also raw Date.now()/setTimeout (rule: DateTimeProvider). Fix: generation counter; drop stale writes.

### [BUG] Stale per-page meta/link persist across client-side navigation
- **Severity**: P2
- **File**: packages/alepha/src/react/head/providers/BrowserHeadProvider.ts:91-158
- **Detail**: `renderHead` only adds/updates tags, never removes ones the new page doesn't declare. Navigate A (description, og:image, canonical) → B (none) leaves A's tags in the DOM; links are add-only (dedupe on rel+href) so old canonicals accumulate. SSR is correct → client/hard-load divergence. Fix: `data-alepha-head` marker + reconcile removals.

### [BUG] i18n: re-notify after async dictionary load is a no-op (StateManager equality short-circuit)
- **Severity**: P2
- **File**: packages/alepha/src/react/i18n/providers/I18nProvider.ts:276-293
- **Detail**: The `state:mutate` hook re-sets the same lang value to force re-render after async dictionary load, but `StateManager.set` short-circuits on equality — the emit never happens; components keep raw keys until something else re-renders. Main `setLang` path is safe; direct `store.set("alepha.react.i18n.lang", …)` hits this. Fix: revision atom or track translations in a store value.

### [BUG] Unmatched-route synthetic layer crashes `onEnter`/`onLeave` bookkeeping
- **Severity**: P3
- **File**: packages/alepha/src/react/router/providers/ReactBrowserRouterProvider.ts:127-134,186-202
- **Detail**: Synthetic layer `{ name: "not-found" }` → loops call `this.pageApi.page(layer.name)?.onLeave?.()` — but `page()` *throws* for unknown names (the `?.` guards nothing). Reachable when the auto `/*` catch-all is absent; `"error"` is excluded but `"not-found"` is not. Fix: use non-throwing `findRoute()`.

### [BUG] Redirected `push` with `replace: true` still pushes a new history entry
- **Severity**: P3
- **File**: packages/alepha/src/react/router/providers/ReactBrowserProvider.ts:214-222
- **Detail**: When the transition commits a different URL (loader redirect), `pushState(committed)` doesn't forward `options.replace` — history grows; back lands on an entry that immediately redirects again. Fix: forward replace.

### [BUG] i18n placeholder substitution corrupts `$10+` and repeated placeholders
- **Severity**: P3
- **File**: packages/alepha/src/react/i18n/providers/I18nProvider.ts:412-418
- **Detail**: `result.replace("$"+(i+1), args[i])` ascending: `$1` replaced before `$10` considered → `$10` becomes args[0]+"0"; string-pattern replace hits only first occurrence. Fix: single regex pass (`/\$(\d+)/g`).

### [BUG] `compile()` param substitution collides on prefixed names
- **Severity**: P3
- **File**: packages/alepha/src/react/router/providers/ReactPageProvider.ts:697-702
- **Detail**: `path.replace(":"+key, value)` not boundary-aware: with `{ id, idx }` on `/x/:idx/:id`, replacing `:id` first corrupts `:idx`. Fix: boundary-aware regex, longest-key-first.

### [BUG] Debounced `useAction.run()` promise never settles after cancel/unmount
- **Severity**: P3
- **File**: packages/alepha/src/react/core/hooks/useAction.ts:296-312,328-346
- **Detail**: Debounce path returns a Promise resolved only in the timeout callback; `cancel()` and unmount cleanup clear the timeout without resolving — `await action.run(...)` hangs forever. Fix: resolve undefined on clear.

### [BUG] Dev error page and demo slide render wall-clock time — SSR hydration mismatch
- **Severity**: P3
- **File**: packages/alepha/src/react/router/components/ErrorViewer.tsx:70; intro/components/GettingStarted.tsx:51-62
- **Detail**: `{new Date().toLocaleTimeString()}` renders differently server vs client → hydration warnings. Dev/demo-only. Wrap in ClientOnly or format deterministically.

### [UNFINISHED] Explicit TODOs and `as any` escape hatches in the router
- **Severity**: P3
- **File**: ReactBrowserProvider.ts:31; ReactServerProvider.ts:372; ReactRouter.ts:74
- **Detail**: (1) `scrollRestoration // TODO: must be per page?`; (2) `user: (serverRequest as any).user // TODO: fix type`; (3) `node()` returns any with TODO "improve typing or remove". Also `applyHydration` trusts the SSR payload's props/config as-is (validation documented as future work).

### [UNFINISHED] `FormValidationError` is exported but used nowhere
- **Severity**: P3
- **File**: packages/alepha/src/react/form/errors/FormValidationError.ts
- **Detail**: Exported from the barrel, zero references in packages/ or apps/. Wire into FormModel.submit's validation path or remove.

### [UNFINISHED] Form field `props` are not self-wiring; the `useForm` JSDoc example silently loses input
- **Severity**: P2
- **File**: packages/alepha/src/react/form/hooks/useForm.ts:25-31; FormModel.ts:602-614
- **Detail**: The canonical JSDoc example — `<input {...form.input.username.props} />` then submit — does not work: `InputHTMLAttributesLike` has no value/onChange, and `submit()` reads only `this.values` populated via `input.set()`. Typed text never reaches the handler; form submits empty. Every real consumer uses `useFieldValue`. Include onChange/defaultValue in props or fix the example — the front-door API documents a broken pattern.

### [UNFINISHED] `ArrayInputField.items` and dead nested-proxy code in FormModel
- **Severity**: P3
- **File**: packages/alepha/src/react/form/services/FormModel.ts:344-356,489-499
- **Detail**: Array fields return `items: []` "populated dynamically in the UI" — permanently empty typed surface; UI builds its own. ~12-line commented-out nested-proxy block above is dead. `UseActionOptions.name` (useAction.ts:437) accepted but never read.

### ✅ FIXED — [RECO] Centralize anchor-click semantics
- **Severity**: P2
- **File**: packages/alepha/src/react/router/services/ReactRouter.ts:193-220
- **Detail**: The correct click policy (modifiers, buttons, target, download, data-no-router, external origins) exists in `attachAnchorInterceptor`; `anchor()`/`useActive` reimplement a naive preventDefault. Link could drop its onClick entirely and rely on delegation — one behavior, one place.

### [RECO] Stabilize `useQuery` callbacks and duration deps
- **Severity**: P2
- **File**: useAction.ts:288; useQuery.ts:57-74
- **Detail**: Keep onSuccess/onError/handler in refs (pattern already used in useSelector/useRoom), drop from executeAction deps; normalize runEvery to ms before using as an effect dep. Fixes the churn family at the source.

### [RECO] `useInject` ignores its argument in the memo deps
- **Severity**: P3
- **File**: packages/alepha/src/react/core/hooks/useInject.ts:9-12
- **Detail**: `useMemo(() => alepha.inject(service), [])` — a different service class between renders silently keeps the first instance. `[service]` removes the trap.

### [RECO] Streaming "backpressure" is a no-op
- **Severity**: P3
- **File**: packages/alepha/src/react/router/providers/ReactServerTemplateProvider.ts:223-228
- **Detail**: `if (controller.desiredSize <= 0) await queueMicrotask-promise` waits one microtask then enqueues anyway (if, not loop; microtask can't let the consumer pull). Implement real backpressure or delete the misleading check.

### [RECO] `isActive({ startWith })` matches across segment boundaries
- **Severity**: P3
- **File**: packages/alepha/src/react/router/services/ReactRouter.ts:56-64
- **Detail**: `current.startsWith(href)` makes `/foo` active on `/foobar`. Use `startsWith(href + "/") || current === href`. Drives nav highlighting in every sidebar.

### Coverage notes
- Read in full: core/, router/ (all providers/services/components/hooks/primitives/atoms/errors/contexts/indexes), form/, head/, i18n/, auth/, ui/, websocket/useRoom, sitemap/, intro/, testing/. Cross-verified DateTimeProvider (interval lifecycle), StateManager (SSR fork isolation is correct — NOT a bug; set() equality short-circuit), @alepha/ui control-date.
- Spec gaps: zero specs for useQueryParams, useActive, Link, useEvents, useClient, useRoom (whole websocket module untested), useFormQuerySync, entire ui/ module, intro/, NestedView animations. useQuery.spec covers static enabled:false but not false→true, runEvery, or refetch-in-flight. No query-only-navigation test; no modifier-click test.

---

## api auth modules (users, oauth, verifications, keys)

### ✅ FIXED — [BUG] OAuth account auto-linking treats missing `email_verified` as verified (pre-account takeover)
- **Severity**: P1
- **File**: packages/alepha/src/api/users/services/SessionService.ts:694
- **Detail**: In `link()`, when an OAuth profile's email matches an existing local user, auto-linking is refused only when the provider explicitly returns `email_verified === false`: `if (profile.email_verified === false)`. Many IdPs (and several of the `$auth*` providers) omit `email_verified` entirely, in which case it is `undefined` and the code links the OAuth identity into the pre-existing account. An attacker who controls an OAuth account carrying a victim's email at a provider that doesn't assert verification can thereby take over the victim's local (credentials) account. Fix: require positive proof — `if (profile.email_verified !== true) throw ...` for the auto-link-by-email branch.

### ✅ FIXED — [BUG] API keys survive user disable/deletion and are never re-checked against `enabled`
- **Severity**: P1 (arguably P0 — auth persists after account removal)
- **File**: packages/alepha/src/api/keys/services/ApiKeyService.ts:258-306; packages/alepha/src/api/users/services/UserService.ts:485-513
- **Detail**: `validate()` resolves a token to `{ id: apiKey.userId, roles: apiKey.roles }` purely from the `api_keys` row — it never loads the user, so it never checks `user.enabled`. Meanwhile `UserService.deleteUser` cleans up sessions and identities but not API keys (cross-module by design), and `updateUser({enabled:false})` revokes nothing. Result: a disabled — or fully deleted — user keeps authenticating (with their original roles, incl. `admin`) via any outstanding API key until the key's own `expiresAt`. `SessionService.refreshSession` correctly rejects disabled users (line 573); the API-key path has no equivalent guard. Fix: revoke a user's API keys on disable/delete (e.g. a `UserJobs`/audit hook), and/or have `validate()` verify the owner is still enabled.

### ✅ FIXED — [BUG] Public realm-config endpoint leaks `adminEmails` / `adminUsernames`
- **Severity**: P2
- **File**: packages/alepha/src/api/users/controllers/RealmController.ts:24-54; packages/alepha/src/api/users/schemas/realmConfigSchema.ts:5-15
- **Detail**: `getRealmConfig` is unauthenticated (no `$secure`) and returns `settings: realmAuthSettingsAtom.schema` verbatim. That schema includes `adminEmails` and `adminUsernames` (the exact list of accounts auto-promoted to admin), plus the full password policy. Any anonymous caller can `GET /realms/config` and harvest the privileged-account list to target. Fix: return a public-safe projection (drop `adminEmails`, `adminUsernames`, and anything else not needed to render the login/registration UI).

### ✅ FIXED — [BUG] Registration enumerates existing email/username/phone before captcha is checked
- **Severity**: P2
- **File**: packages/alepha/src/api/users/services/RegistrationService.ts:230 vs 240-248
- **Detail**: `createRegistrationIntent` calls `checkUserAvailability` (which throws `ConflictError("User with this email already exists")`, etc.) at line 230, but captcha is validated afterward at line 240. So an attacker can enumerate which emails/usernames/phone numbers are registered without ever solving a captcha, throttled only by `registrationIpMaxAttempts` (default 10 / 15 min). Fix: run the captcha check before the availability check (and consider a generic conflict message).

### ✅ FIXED — [BUG] Registration IP rate-limit is a racy get-then-set, contradicting its own "atomic incr" comment
- **Severity**: P2
- **File**: packages/alepha/src/api/users/services/RegistrationService.ts:72-80, 127-134
- **Detail**: The `rateLimitCache` comment claims the SQL-backed provider is used "so `incr()` is atomic (`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`)", but the code does `const count = (await this.rateLimitCache.get(ipKey)) ?? 0; ... await this.rateLimitCache.set(ipKey, count + 1)`. That read-modify-write is a TOCTOU race: concurrent requests all read the same `count` and all write `count+1`, so a burst sails past the threshold — exactly the coalescing failure the comment says it avoids. Fix: use the cache's atomic `incr` (as documented) instead of get+set.

### ✅ FIXED — [RECO] Admin session listing exposes raw `refreshToken` for every session
- **Severity**: P2
- **File**: packages/alepha/src/api/users/schemas/sessionResourceSchema.ts:23; packages/alepha/src/api/users/controllers/AdminSessionController.ts:17-59
- **Detail**: `sessionResourceSchema` includes `refreshToken: z.uuid()`, and `AdminSessionController.findSessions/getSession` return it to anyone with `admin:session:read`. A refresh token is a long-lived bearer credential: this hands an admin (or anyone who compromises the admin API/UI/logs) the ability to mint access tokens for any user — full impersonation. `MySessionController` deliberately omits it (see its doc comment) precisely for this reason; the admin view should too. Fix: drop `refreshToken` from the admin projection.

### ✅ FIXED — [RECO] API-key roles are a frozen snapshot taken at creation
- **Severity**: P2
- **File**: packages/alepha/src/api/keys/services/ApiKeyService.ts:90-122; packages/alepha/src/api/keys/controllers/ApiKeyController.ts:39
- **Detail**: `create()` persists `roles` from `request.user.roles` at creation time, and `validate()` returns those stored roles. If a user is later demoted (e.g. `admin` removed), any API key minted while they were admin keeps granting admin. This is a real privilege-persistence gap, not just style. At minimum document it loudly; better, resolve roles against the live user at validate time (or cap key roles to the current user's roles).

### [BUG] Credentials login looks up the username with `ilike` on raw input (LIKE-wildcard matching)
- **Severity**: P3
- **File**: packages/alepha/src/api/users/services/SessionService.ts:270
- **Detail**: `where.username = { ilike: username }` passes the user-supplied identifier straight into a LIKE match. `_` (allowed by the default `usernameRegExp` `^[a-zA-Z0-9_-]{3,30}$`) is a single-char wildcard and `%` a multi-char wildcard in SQL LIKE, so `admi_` matches `admin`, `admix`, etc.; `findOne` then picks one arbitrarily. A password is still required, so this isn't a direct bypass, but it's incorrect matching semantics on the auth hot path and a latent way to target/land on an unintended account. Fix: match case-insensitively via `LOWER(username) = LOWER(:input)` (mirroring the unique index) rather than `ilike` on unescaped input. `RegistrationService.checkUserAvailability` and `UserService` have the same `ilike` pattern.

### [BUG] `checkUsernameAvailability` is case-sensitive and not realm-scoped
- **Severity**: P3
- **File**: packages/alepha/src/api/users/controllers/RealmController.ts:56-82
- **Detail**: The public availability check queries `where: { username: { eq: body.username } }` — case-sensitive `eq`, and with no `realm` filter. Because uniqueness is enforced on `(realm, LOWER(username))`, this reports `available: true` for `Admin` when `admin` is taken (then the actual registration 409s), and in a multi-realm deployment it checks across all realms instead of the target realm. Fix: scope by `realm.name` and compare case-insensitively.

### ✅ FIXED — [BUG] Already-verified verification codes allow unlimited guessing (no attempt increment)
- **Severity**: P3
- **File**: packages/alepha/src/api/verifications/services/VerificationService.ts:172-192
- **Detail**: Once `verifiedAt` is set, the "already verified" branch compares the submitted code and throws on mismatch without incrementing `attempts` or ever re-locking. So after a code is consumed, an attacker gets unlimited guesses against that record via the public `validateVerificationCode` endpoint. Impact is low because every in-tree consumer (`completePasswordReset`, `verifyEmailCode`) explicitly rejects `alreadyVerified`, but any future flow that treats `alreadyVerified` as success would be brute-forceable. Worth an attempt-counter on this branch too.

### [RECO] Password-reset intent creation has no IP throttle (email-bombing)
- **Severity**: P3
- **File**: packages/alepha/src/api/users/services/CredentialService.ts:133-224
- **Detail**: `createPasswordResetIntent` relies solely on the per-target verification cooldown (90s) and daily limit (10). Because those are scoped to `(type, target, purpose)`, a single IP can request resets for thousands of *distinct* real emails with no aggregate limit, driving a large volume of "reset your password" emails. Registration has `registrationIpMaxAttempts`; the reset flow has no analogous per-IP cap. Consider adding one.

### Coverage notes
- Read in full: all services, controllers, `$realm` primitive, `RealmProvider`, `realmAuthSettingsAtom`, `VerificationParameters`, all entities, `UserNotifications`, `UserJobs`, `VerificationJobs`, `consentPage`, and relevant schemas.
- Verified positives (not flagged): PKCE `consumeAuthorizationCode` checks jti-replay + client_id + redirect_uri + S256; `verifyCode` still compares code on already-verified path; consent page HTML-escapes; login uses `randomDelay()` + generic errors; refresh tokens are `randomUUID`; `MySessionController` omits refreshToken.
- Test gaps: (1) no test for API-key validity after owner disabled/deleted; (2) no test for OAuth `link()` with `email_verified` undefined vs false; (3) no test asserting `getRealmConfig` field exposure; (4) IP rate-limit race untested for concurrent bursts; (5) no LIKE-wildcard username login test.

---

## api feature modules (audits, files, jobs, notifications, organizations, parameters, payments, subscriptions)

### 🗑️ REMOVED (module deleted) — [BUG] Org-less authenticated user on `/subscriptions/mine/*` reads and mutates an arbitrary organization's subscription
- **Severity**: P0 (security)
- **File**: packages/alepha/src/api/subscriptions/controllers/SubscriptionController.ts:59,101,125,149,169,188 (+ services/SubscriptionService.ts:104-111, orm/core/services/QueryManager.ts:236,292)
- **Detail**: Every handler calls `this.service.getByOrganization(user.organization!)`. For a user with no `organization` (docs call this "god mode"; fresh users pre-onboarding commonly have none), the value is `undefined`, producing `where: { organizationId: { eq: undefined } }`. Traced through QueryManager: the `eq` key selects the operator branch, but `operator?.eq != null` is false → zero conditions → **no WHERE clause at all**. `findOne` returns the first subscription row in the table. `getMySubscription` leaks another org's subscription; `POST /subscriptions/mine/cancel|change-plan|resume` **mutates a random org's subscription**. Fix: throw 400/403 when `user.organization` is absent (PaymentController.addPaymentMethod:50-54 already does this), and make the repository reject `eq: undefined` instead of silently dropping it.

### 🗑️ REMOVED (module deleted) — [BUG] `undefined` in update patches never clears columns — resume/plan-change/dunning state persists forever (verified by test)
- **Severity**: P1 (billing impact)
- **File**: packages/alepha/src/api/subscriptions/services/SubscriptionService.ts:406-411,507-516,569-577; services/BillingService.ts:179-184,240-247,284-294,368-372; jobs/SubscriptionJobs.ts:162-166
- **Detail**: Drizzle's `mapUpdateSet` filters `value !== undefined`, so `updateById(id, { cancelledAt: undefined })` is a no-op. Verified against real Postgres: after cancel()+resume(), `cancelledAt`/`cancelReason` remain set; after a scheduled change followed by an immediate changePlan(), `pendingPlanId` remains. Consequences: (a) `BillingService.renew` re-applies the stale `pendingPlanId` at next renewal, **silently reverting a later plan change**; (b) the dunning "stop retrying" branches never clear the retry timestamp, so the hourly dunning job **keeps creating a payment intent every hour forever**; (c) reactivate/recoverFromDunning leave stale dunning timestamps. Fix: pass `null` (the codebase's own convention — JobProvider clears with `key: null`). Existing test passes only vacuously.

### 🗑️ REMOVED (module deleted) — [BUG] An organization can never re-subscribe after cancellation/expiry (verified by test)
- **Severity**: P1 (blocks revenue path)
- **File**: packages/alepha/src/api/subscriptions/entities/subscriptions.ts:59; services/SubscriptionService.ts:190-296
- **Detail**: `subscribe()` checks for an existing sub only in `["trialing","active","past_due"]`, then always `create()`s — but the unique index on `organizationId` covers ALL statuses. Confirmed empirically: subscribe → cancel immediate → subscribe again throws duplicate-key (surfaces as 500). Every churned customer is permanently locked out. Fix: reuse/reset the terminal row, or partial unique index on active statuses.

### 🗑️ REMOVED (module deleted) — [BUG] Billing loop is half-wired: intents are created but never charged, and duplicates pile up hourly
- **Severity**: P1
- **File**: packages/alepha/src/api/subscriptions/jobs/SubscriptionJobs.ts:69-114 (billingCycle), 198-244 (trialExpiry); services/BillingService.ts:97-104
- **Detail**: `billingCycle`/`trialExpiry` create a PaymentIntent (status `created`) and store `lastPaymentIntentId` — nothing then creates a checkout session, charges a saved method, or emits an event a host app could react to. Since `nextBillingAt`/status only advance on `payments:captured`, the same subscription matches again every hour, creating a new orphan intent each run. Each run overwrites `lastPaymentIntentId` and `findByPaymentIntent` matches only that column — if the user pays hour-1's intent after hour-2's run, the **paid renewal is never applied**. Also `trialExpiry` never transitions `trialing` → anything, so unpaid trials retain access indefinitely. Fix: emit `subscription:payment_due` (or charge the default method), mark pending-payment, match intents by `metadata.subscriptionId`.

### ✅ FIXED — [BUG] `expireStaleIntents` can overwrite a captured payment with `expired`
- **Severity**: P1 (payment recorded lost)
- **File**: packages/alepha/src/api/payments/services/PaymentService.ts:30-55
- **Detail**: The cron reads `processing` intents older than 30 min, awaits `provider.expireSession()`, then does an **unguarded** `updateById(intent.id, { status: "expired" })`. A webhook landing between read and write flips the intent to `captured`, which the job stomps to `expired`: money taken, intent expired, `payments:captured` already emitted against a now-expired row. Fix: `updateOne({ id, status: { eq: "processing" } }, { status: "expired" })`. Secondary: the 30-min window keys on intent createdAt, not session creation.

### ✅ FIXED — [BUG] `refund()` TOCTOU allows over-refund
- **Severity**: P1
- **File**: packages/alepha/src/api/payments/services/PaymentService.ts:304-379
- **Detail**: The remaining-refundable check has no lock/transaction/guard; two concurrent refunds both read the same totalRefunded and both pass. Stripe may reject the excess for PSP-backed intents, but **cash intents (`recordCashPayment`) have no providerRef** so the PSP branch is skipped and the DB records refunds exceeding the captured amount. Fix: serialize per intent (lock, guarded UPDATE with running total, or the entity's existing `db.version()` which `updateById` never uses).

### ✅ FIXED — [BUG] Concurrent `createSession` for one intent creates two PSP sessions; first one's payment is dropped
- **Severity**: P2
- **File**: packages/alepha/src/api/payments/services/PaymentService.ts:80-124
- **Detail**: Two concurrent calls both pass `assertStatus(intent, "created")`, both create PSP sessions, `providerRef` overwritten by last writer. If the user pays the first session, `handleParsedWebhook` finds no intent for that ref and the captured payment is never applied. Fix: claim the intent with a guarded `updateOne({ id, status: { eq: "created" } }, { status: "processing" })` before the PSP call, or store all issued refs.

### ✅ FIXED — [BUG] Job sweep can resurrect a cancelled execution
- **Severity**: P2 (race)
- **File**: packages/alepha/src/api/jobs/providers/JobProvider.ts:1237-1244
- **Detail**: Sweep phase 1 promotes due `scheduled` rows with an unguarded `updateById(exec.id, { status: "pending" })`; a concurrent `cancel()` is overwritten and the job runs anyway. `dispatchScheduled` (1322) already does this correctly with a guarded updateOne — the sweep should too. Similarly `cancel()` (948) uses unguarded updateById and can stamp `cancelled` over a completed row.

### ✅ FIXED — [BUG] Lease heartbeat dies on first transient DB error → false crash detection → duplicate execution
- **Severity**: P2
- **File**: packages/alepha/src/api/jobs/providers/JobProvider.ts:690-711
- **Detail**: The heartbeat's catch does `clearInterval(timer)` on **any** error. Correct for DbEntityNotFoundError, but a transient DB failure also kills the heartbeat while the handler keeps running; once crashThresholdMs passes, another instance's sweep (which only skips executions in the *local* abortControllers map) marks it crashed and schedules a retry — duplicate concurrent execution. Fix: only stop on DbEntityNotFoundError.

### ✅ FIXED — [BUG] One bad row aborts the whole job sweep tick
- **Severity**: P2
- **File**: packages/alepha/src/api/jobs/providers/JobProvider.ts:1232-1295
- **Detail**: All three sweep phases share one try/catch. `updateById` in phase 1 throws DbEntityNotFoundError if the row vanished between findMany and write — the catch logs "Sweep failed" and remaining due/stale/crashed rows are skipped until the next tick (default 15 min). Per-row try/catch would contain the blast radius.

### ✅ FIXED — [BUG] Parameter load failure poisons the cache permanently
- **Severity**: P2
- **File**: packages/alepha/src/api/parameters/services/ParameterProvider.ts:228-235,766-848
- **Detail**: `get()` stores `doLoad(name)`'s promise in `loadPromises`; doLoad deletes the entry only on success paths. If `loadCurrentAndNext` throws, the rejected promise stays in the map and every subsequent `get()` re-awaits the same rejection forever until restart. Fix: cleanup in `finally`.

### ✅ FIXED — [BUG] Parameter delete is not propagated cross-instance
- **Severity**: P2
- **File**: packages/alepha/src/api/parameters/services/ParameterProvider.ts:584-601
- **Detail**: `save()` publishes on syncTopic, but `delete()`/`deleteMany()` only evict local caches — other instances serve the deleted value indefinitely (Node default TTL 0, no revalidation). Fix: publishChange(name) after delete.

### ✅ FIXED — [BUG] Per-job `keep: { ok: 0 }` ("keep forever") is ignored by the success-path delete decision
- **Severity**: P2
- **File**: packages/alepha/src/api/jobs/providers/JobProvider.ts:1040-1052 (vs 1336-1346); consumer: api/notifications/jobs/NotificationJobs.ts:52-66
- **Detail**: On success, `keepSuccess` consults only the **global** atom, while trim correctly honors per-job `keep.ok ?? global`. Notifications rely on `record: "all", keep: { ok: 0 }` meaning "keep every row for audit" — but with global `keepLastSuccess: 0`, every successful notification row is deleted at completion, destroying the advertised audit trail. Fix: consult per-job keep in keepSuccess.

### 🗑️ REMOVED (module deleted) — [BUG] Proration mis-computes when the interval changes
- **Severity**: P2 (money math)
- **File**: packages/alepha/src/api/subscriptions/services/SubscriptionService.ts:838-866
- **Detail**: `calculateProration` divides both old and new plan amounts by daysInPeriod of the *current* (old-interval) period. Monthly→yearly immediate change: `newDailyRate = yearlyAmount / ~30` — roughly 12× overcharge (mirror undercharge yearly→monthly). Fix: compute the new daily rate against the new interval's period length.

### 🗑️ REMOVED (module deleted) — [BUG] Trial conversion metric is structurally pinned at ~100%
- **Severity**: P2
- **File**: packages/alepha/src/api/subscriptions/services/SubscriptionService.ts:747-754; BillingService.ts:132-146; SubscriptionJobs.ts:198-244
- **Detail**: `trialConversionRate = activated / trial_ended`, but `trial_ended` is recorded only in `BillingService.activate` — immediately followed by `activated` for the same sub. Lapsed trials never record `trial_ended`, so denominator equals numerator. Fix: record it in the trial-expiry job.

### [BUG] Notification admin list accepts a `status` filter it never applies, with wrong enum values
- **Severity**: P2
- **File**: packages/alepha/src/api/notifications/controllers/AdminNotificationController.ts:38-64; schemas/notificationQuerySchema.ts
- **Detail**: `findNotifications`'s where only sets jobName + org; `query.status` silently ignored. The schema enum (`"retrying" | "completed" | "dead" | …`) doesn't match the outbox statuses (`ok`, `error`, `scheduled`…). Fix: map the public enum and add `where.status`.

### 🗑️ REMOVED (module deleted) — [UNFINISHED] SubscriptionNotifications: six templates defined, zero senders
- **Severity**: P2
- **File**: packages/alepha/src/api/subscriptions/notifications/SubscriptionNotifications.ts
- **Detail**: `trialEnding`, `paymentFailed`, `subscriptionSuspended`, `subscriptionRenewed`, `planChanged`, `cancellationConfirmed` are registered but nothing ever `.push()`es them or subscribes to lifecycle events to send them. No job computes "trial ending soon". Dead weight implying functionality that doesn't exist.

### 🗑️ REMOVED (module deleted) — [UNFINISHED] Subscription event payloads don't match their declared `Hooks` types; three events never emitted
- **Severity**: P2
- **File**: packages/alepha/src/api/subscriptions/index.ts:43-110; SubscriptionService.ts (emits); BillingService.ts (emits)
- **Detail**: Every emit is `emit("subscription:X" as any, …)` because the shapes genuinely diverge (e.g. `created` emits `{ subscription }` vs declared flat ids; `oldPlanId` vs emitted `previousPlanId`; `renewed` missing declared amount/currency). `subscription:expired`, `suspended`, `trial_ending` are declared but never emitted anywhere. Consumers coding against the declared types get undefined fields. Align and drop the `as any`s.

### 🗑️ REMOVED (module deleted) — [UNFINISHED] `UsageService.resetForPeriod` has no caller; usage window is calendar-month, not billing-period
- **Severity**: P2
- **File**: packages/alepha/src/api/subscriptions/services/UsageService.ts:104-117
- **Detail**: Doc says "Used at the start of a new billing period", nothing calls it. Keys are `org:resource:YYYY-MM`, so quotas reset on the 1st regardless of `currentPeriodStart`. Also `increment()` counts denied attempts (increments before the limit check), inflating `current` on rejected calls. Wire into renew with period-based keys, or document calendar semantics and delete.

### [UNFINISHED] Audit filter options are hardcoded stubs
- **Severity**: P2
- **File**: packages/alepha/src/api/audits/controllers/AdminAuditController.ts (getFilterOptions)
- **Detail**: Returns `resourceTypes: ["user", "session", "file", "order", "payment"]` and `userRealms: ["default"]` as literals — the admin UI shows fabricated filter values and omits real ones. Should be SELECT DISTINCT (or removed).

### ✅ FIXED — [UNFINISHED] `$audit` `actions` allow-list is never enforced
- **Severity**: P3
- **File**: packages/alepha/src/api/audits/primitives/$audit.ts:103-108
- **Detail**: `actions: string[]` ("List of allowed actions") — `log()` passes any string with no membership check; typos create unfilterable audit types silently. Add validation in log().

### ✅ FIXED — [UNFINISHED] Notification `sensitive` flag does nothing
- **Severity**: P3
- **File**: packages/alepha/src/api/notifications/primitives/$notification.ts:53; AdminNotificationController.ts:153-160
- **Detail**: `sensitive` is carried through and echoed, but `toDetailResource` returns `variables` (rendered personal data) regardless. Redact for sensitive templates or drop the option.

### [UNFINISHED] `bucket:file:uploaded` hook drops `tags` and `creatorName`
- **Severity**: P3
- **File**: packages/alepha/src/api/files/services/FileService.ts:61-85
- **Detail**: The module augments `BucketFileOptions` with `tags`, but the persist hook ignores `options.tags` and `options.user?.name` — direct `bucket.upload(file, { tags, user })` silently loses them. One-line fix in the hook's create call.

### [UNFINISHED] `retryExecution` / `pushMany` drop push context
- **Severity**: P3
- **File**: packages/alepha/src/api/jobs/services/JobService.ts:176-211; providers/JobProvider.ts:65-71,779-871
- **Detail**: Admin retry re-pushes with `job.push(execution.payload as any)` — `triggeredBy`, `organizationId`, `key` from the original execution are dropped; retried tenant notifications lose org scoping. `PushManyItem` has no organizationId/triggeredBy fields at all.

### 🗑️ REMOVED (module deleted) — [UNFINISHED] MRR endpoint: dead fields and a silent 1000-row cap
- **Severity**: P3
- **File**: packages/alepha/src/api/subscriptions/controllers/AdminSubscriptionController.ts:83-127
- **Detail**: `growth`, `newMrr`, `expansionMrr`, `contractionMrr`, `churnMrr` are hardcoded 0 (schema presents them as real), and computation iterates only the first 1000 active subs — totals silently wrong beyond that. Aggregate in SQL or mark unimplemented.

### [RECO] Admin `createVersion` can bypass parameter schema validation via client-supplied `schemaHash`
- **Severity**: P2
- **File**: packages/alepha/src/api/parameters/controllers/AdminParameterController.ts:155-188; ParameterProvider.ts:459-470
- **Detail**: `save()` validates content only when the supplied hash equals the registered hash; the admin body accepts an arbitrary `schemaHash`, so any non-matching value skips validation and stores arbitrary JSON that typed `$parameter.get()` consumers read as `Static<T>`. Don't accept a differing hash outside an explicit migration flow.

### [RECO] Guard money-state transitions with the existing `version` column
- **Severity**: P2
- **File**: packages/alepha/src/api/payments/entities/paymentIntents.ts:9 + PaymentService.ts (all updateById calls)
- **Detail**: paymentIntents/refunds/subscriptions all declare `db.version()` (optimistic locking), but every service mutation uses `updateById`, which never checks it — only `save()` does. All the races above would be caught by status-guarded updateOne or save() with version check. Adopt one pattern consistently.

### 🗑️ REMOVED (module deleted) — [RECO] `subscribe()` should map unique-constraint races to a 400
- **Severity**: P3
- **File**: packages/alepha/src/api/subscriptions/services/SubscriptionService.ts:206-217
- **Detail**: The exists-check→create window means concurrent subscribes surface as a raw DbConflictError 500. Catch and rethrow BadRequestError.

### [RECO] `AuditService.getStats` loads every row in range into memory
- **Severity**: P3
- **File**: packages/alepha/src/api/audits/services/AuditService.ts:260-322
- **Detail**: `findMany({ where })` with no limit, counts in JS — O(rows) memory on the admin stats endpoint. Use SQL aggregation like FileService.getStorageStats.

### [RECO] Unbounded/serial cleanup loops
- **Severity**: P3
- **File**: packages/alepha/src/api/files/jobs/FileJobs.ts:12-18; subscriptions/jobs/SubscriptionJobs.ts:363-381
- **Detail**: `purgeFiles` fires up to 1000 parallel deleteFile calls — bound concurrency or reuse FileService.deleteFiles batching. `purgeEvents` fetches all expired rows then deletes one-by-one; a single `deleteMany({ createdAt: { lt: cutoff } })` suffices.

### [RECO] Payments admin permissions break the naming convention
- **Severity**: P3
- **File**: packages/alepha/src/api/payments/controllers/AdminPaymentController.ts:25,56,74,90,108,124
- **Detail**: Uses `payments:read`/`payments:write` while every other admin controller uses `admin:<module>:<verb>`. A role granting `admin:*` won't cover the payments admin surface. Rename with aliases.

### ✅ FIXED — [RECO] Mock checkout confirm is an unauthenticated capture endpoint whenever the memory provider is active
- **Severity**: P3
- **File**: packages/alepha/src/api/payments/controllers/MockCheckoutController.ts:170-196; index.ts:78-84
- **Detail**: `AlephaApiPayments` registers MemoryPaymentProvider as default, and MockCheckoutController exposes `POST /payments/mock-checkout/:id/confirm` (no auth) that flips any `processing` intent to `captured`. An app shipped to production without a real PSP silently has a "mark as paid" endpoint. Refuse mock checkout in production unless explicitly opted in.

### Coverage notes
- Read in full: all non-test sources in audits/, files/, jobs/, notifications/, organizations/, parameters/, payments/, subscriptions/. Cross-referenced Repository/QueryManager and drizzle-orm utils to verify update/where semantics; two findings verified by running throwaway specs against the real test Postgres (deleted after; git status clean).
- Test gaps: jobs/ best-tested but sweep-vs-cancel race, heartbeat failure, per-job keep interaction untested. subscriptions/: SubscriptionJobs has **zero tests**; no resume-clears-fields (existing assertion passes vacuously), no resubscribe-after-cancel, no dunning-exhaustion, no proration-across-intervals, no $requirePlan/$requireLimit middleware tests, no UsageService tests. payments/: good state-machine coverage, no concurrency tests, no MockCheckoutController tests. notifications/: admin controller untested. parameters/: load-failure poisoning, cross-instance delete sync, schemaHash bypass untested.

---

## mcp + command + system + datetime + logger + router + fake + bin

### ✅ FIXED — [BUG] ShellProvider capture path is shell-injectable — escaping misses `;`, backtick, `$`, and single quotes
- **Severity**: P1
- **File**: packages/alepha/src/system/providers/NodeShellProvider.ts:93 (buildShellCommand), :43-46, :109-138 (execCapture)
- **Detail**: `run(cmd, { capture: true })` re-joins parsed args via `buildShellCommand` and passes the string to `exec()` (`/bin/sh -c`). The escape regex `/[\s"&|<>^()]/` does not include `;`, backticks, `$`, `\`, or `'`, so an arg like `foo;rm -rf x` goes through unquoted and the shell executes `rm`. Worse, args that DO get quoted use double quotes, inside which `$(...)`/backtick still expand. Any app interpolating a filename/user value into a captured shell command is injectable, despite the method's "properly escaped" claim. Fix: single-quote POSIX escaping (`'...'` + `'\''`), or drop the shell and use `execFile(executable, args)`.

### ✅ FIXED — [BUG] Signal-killed child process treated as success (`code === null`)
- **Severity**: P1
- **File**: packages/alepha/src/system/providers/NodeShellProvider.ts:78-84
- **Detail**: `execInherit` resolves on `code === 0 || code === null`. `exit` reports `code: null` precisely when the child was killed by a signal (SIGKILL, SIGSEGV, OOM-killer). A build step killed mid-run resolves as success, so CLI pipelines silently continue with broken output. Fix: `proc.on("exit", (code, signal) => …)` and reject when `signal != null`.

### ✅ FIXED — [BUG] JsonFormatterProvider throws on circular/BigInt data — logging call crashes the caller
- **Severity**: P1
- **File**: packages/alepha/src/logger/providers/JsonFormatterProvider.ts:22
- **Detail**: `format()` ends with a bare `return JSON.stringify(json)`. PrettyFormatter wraps its stringify in try/catch, but the JSON formatter — the production default — does not. `log.info("msg", someObjectWithCycle)` throws `TypeError: Converting circular structure to JSON` synchronously out of the logging call, in production only. Wrap in try/catch with fallback.

### ✅ FIXED — [BUG] `DateTimeProvider.travel()` double-counts elapsed time across multiple calls — timeouts fire too early
- **Severity**: P1
- **File**: packages/alepha/src/datetime/providers/DateTimeProvider.ts:523-524
- **Detail**: `travel()` computes `spent = now - timeout.now` then `timeout.duration = timeout.duration - spent - ms`, but never updates `timeout.now`. Each travel both subtracts its own `ms` AND is re-counted as `spent` by every subsequent travel. Trace: 10min timeout, `travel(3min)` ×3 → remaining 600→420→60→−480, fires at 9 simulated minutes instead of 10. Existing spec only travels twice (happens to land past expiry). Fix: set `timeout.now = now + ms` after adjusting.

### ✅ FIXED — [BUG] `$interval` handler errors become unhandled promise rejections every tick
- **Severity**: P1
- **File**: packages/alepha/src/datetime/primitives/$interval.ts:36-41, DateTimeProvider.ts:227
- **Detail**: `IntervalPrimitive.onInit` registers `async () => { await this.options.handler(); … }` with no catch, and `onStart` passes it straight to `setInterval`. A throwing handler produces an unhandled rejection (fatal on modern Node) with zero logging. Also the awaited first run inside the `start` hook propagates a first-tick error into app startup. Wrap in try/catch + `log.error`. No error-handling test exists.

### ✅ FIXED — [BUG] Router wildcard fallback loses `params["*"]` (and leaks stale param captures)
- **Severity**: P2
- **File**: packages/alepha/src/router/providers/RouterProvider.ts:119, :123-130 (vs correct direct-hit path at :116)
- **Detail**: Only the direct `cursor.wildcard` branch sets `params["*"]`. The fallback returns return the wildcard route with **no `*` entry**. Trace: routes `/users/*` + `/users/jack/profile`, request `/users/jack/settings` → dead-ends at `jack`, falls back to `/users/*` with `params = {}`. Handlers reading `params["*"]` (static file serving, catch-alls) get `undefined`. Params captured along the abandoned branch also leak in.

### ✅ FIXED — [BUG] Router does not backtrack from static prefix to param route — valid routes 404
- **Severity**: P2
- **File**: packages/alepha/src/router/providers/RouterProvider.ts:102-121
- **Detail**: Matching greedily prefers a static child and never backtracks to a sibling param. With `/a/{x}` and `/a/b/c` registered, request `/a/b` descends into static `b` (intermediate node), finds no route, returns no match — though `/a/{x}` matches. Implement single-level backtracking or validate the restriction at `push()` time.

### ✅ FIXED — [BUG] Path params are never percent-decoded (query params are)
- **Severity**: P2
- **File**: packages/alepha/src/router/providers/RouterProvider.ts:113; server/core/providers/ServerProvider.ts:177, :206
- **Detail**: `params[name] = parts[i]` raw; query values go through `fastDecode`. `GET /users/john%20doe` yields `params.id === "john%20doe"` but `?q=john%20doe` yields `"john doe"` — inconsistent; encoded IDs arrive corrupted. Decode each captured segment with guarded `decodeURIComponent`.

### [BUG] Flag values are consumed as subcommand names during command resolution
- **Severity**: P2
- **File**: packages/alepha/src/command/providers/CliProvider.ts:164-168, :382-397
- **Detail**: `positionalArgs = argv.filter(a => !a.startsWith("-"))` runs before flag parsing, so a space-separated flag value is a positional. `cli deploy --target vercel` with a `vercel` child walks into the child and `--target` then fails "requires a value". Flags before the command (`cli --mode production build`) make `production` the resolved command → "Unknown command". Skip argv positions consumed as flag values (logic exists in `getFlagConsumedIndices`).

### ✅ FIXED — [BUG] `ask.permission` rejects uppercase "N" / "No"
- **Severity**: P2
- **File**: packages/alepha/src/command/helpers/Asker.ts:79-84
- **Detail**: `[Y/n]` prompt validates against `z.enum(["Y", "y", "n", "no", "yes"]).default("Y")`. Typing `N`, `No`, or `YES` fails and loops. Lowercase the answer before decoding or extend the enum.

### [BUG] `NodeFileSystemProvider.mkdir` swallows all errors, not just EEXIST
- **Severity**: P2
- **File**: packages/alepha/src/system/providers/NodeFileSystemProvider.ts:286-297
- **Detail**: Default `force !== false` does `await p.catch(() => {})` — EACCES, ENOSPC, EROFS all vanish; later writes fail confusingly far from cause. (`recursive: true` already makes EEXIST a no-op, so the catch protects nothing.) Also violates the repo's own "never `.catch(()=>{})`" rule.

### [BUG] `createFile({ path })` builds file URL by string concat — breaks on relative paths and `#`/`?` in filenames
- **Severity**: P2
- **File**: packages/alepha/src/system/providers/NodeFileSystemProvider.ts:100
- **Detail**: `` `file://${filePath}` `` — relative path parses first segment as URL host; `#`/`?` truncate into fragment/query; `%` mis-decoded. Use `pathToFileURL()`.

### [BUG] `createFileFromUrl(...).stream()` over HTTP ignores response status
- **Severity**: P2
- **File**: packages/alepha/src/system/providers/NodeFileSystemProvider.ts:589-599
- **Detail**: `getStreamingResponse` pipes `res.body` regardless of `res.ok`, so a 404/500 error page streams through as file content; the buffered path correctly throws on `!response.ok`. Destroy the stream with an error when `!res.ok`.

### [BUG] Paused-time `createTimeout` with `now` silently drops future timers; `wait(…, { now })` hangs
- **Severity**: P2
- **File**: packages/alepha/src/datetime/providers/DateTimeProvider.ts:434-445
- **Detail**: When paused and `now` is passed, a future expiry returns a dummy `{ callback: () => {}, clear: () => {} }` never registered in `this.timeouts` — `travel()` past expiry never fires it, `wait(duration, { now })` never resolves. Production caller: `CronProvider` (scheduler/providers/CronProvider.ts:132-136) — paused-clock tests stall cron chains permanently. Also replay comparison uses strict `<` (expiry exactly equal to now doesn't fire). Register future-dated timeouts against remaining virtual time.

### [BUG] MCP negotiated protocol version is a mutable singleton — breaks multi-client and serverless deployments
- **Severity**: P2
- **File**: packages/alepha/src/mcp/providers/McpServerProvider.ts:65, transports/StreamableHttpMcpTransport.ts:215-235
- **Detail**: `negotiatedVersion` lives on the provider singleton. (a) Client B initializing with older version changes what client A is validated against → spurious 400s; (b) on Workers a fresh isolate resets to `2025-11-25`, so a client that negotiated `2025-06-18` gets 400 mismatch on its next request. Validate header against `SUPPORTED_PROTOCOL_VERSIONS` membership or key per session.

### ✅ FIXED — [BUG] `isInstalled` interpolates the command name into a shell string
- **Severity**: P2
- **File**: packages/alepha/src/system/providers/NodeShellProvider.ts:205-213
- **Detail**: `` exec(`command -v ${command}`) `` — metacharacters execute (`isInstalled("x; curl …")`). Use `execFile` or validate against `/^[\w.-]+$/`.

### [BUG] Bun capture path diverges from Node: shell features silently break and escaped quotes corrupt args
- **Severity**: P2
- **File**: packages/alepha/src/system/providers/BunShellProvider.ts:42-56
- **Detail**: Node's `execCapture` runs the escaped string through `/bin/sh` (pipes/`&&` work), but Bun re-`parseCommand`s it and calls `Bun.spawn` with no shell — `shell.run("a && b", { capture: true })` runs `a` with literal args `&&`, `b` under Bun. Also `buildShellCommand` escapes quotes as `\"` which `parseCommand` doesn't un-escape (`he"llo` → `he\llo`). Same command string, different behavior per runtime.

### [BUG] EnvUtils always loads `.local` variants, making `loadModeEnv`'s documented file list wrong
- **Severity**: P3
- **File**: packages/alepha/src/command/helpers/EnvUtils.ts:44, CliProvider.ts:719-729
- **Detail**: `parseEnv` implicitly adds `${file}.local` for every file, while docs/debug log claim only `.env`/`.env.{mode}`. Also swallows all read errors (EACCES) as "no file found", and inline `# comments` after values kept as part of value. Align docs, narrow catch to ENOENT.

### [BUG] MCP notification response uses 204 (spec says 202) and parse-error id is `0` (spec says `null`)
- **Severity**: P3
- **File**: packages/alepha/src/mcp/transports/StreamableHttpMcpTransport.ts:248, :255
- **Detail**: Spec: notifications "MUST return HTTP 202 Accepted"; transport returns 204. Unparseable messages require `"id": null`; `createErrorResponse(0, …)` fabricates id 0 (can collide with real id 0). Also JSON-RPC batch arrays (required by advertised 2025-03-26/2024-11-05 versions) are rejected by `parseMessage`.

### ✅ FIXED — [UNFINISHED] `FakeProvider.locale` option is accepted but never used
- **Severity**: P2
- **File**: packages/alepha/src/fake/providers/FakeProvider.ts:20, :77-91
- **Detail**: `FakeOptions.locale` (documented, default "en") stored but never read — `configure({ locale: "fr" })` is a no-op. Wire it (`new Faker({ locale })`) or drop it. Related: `generateValueWithContext` ignores min/maxLength constraints.

### [UNFINISHED] `Runner.run.rm` / `run.cp` accept `RunOptions.root` but ignore it
- **Severity**: P2
- **File**: packages/alepha/src/command/helpers/Runner.ts:110-147
- **Detail**: `runFn.rm(files, { root })` / `cp(src, dest, { root })` operate relative to `process.cwd()` — `root` only affects string shell commands. `run.rm("dist/*", { root: appDir })` deletes relative to the wrong directory (or nothing). Also `execute(Task[])` returns `""` ("not supported for now") — parallel task output silently discarded.

### [UNFINISHED] `FileError` extends bare `Error` and is dead code
- **Severity**: P3
- **File**: packages/alepha/src/system/errors/FileError.ts:1
- **Detail**: Violates the "always AlephaError" rule and has zero usages (grep-verified). Delete or base on AlephaError and use it.

### [UNFINISHED] Dead/vestigial code in scope
- **Severity**: P3
- **File**: multiple
- **Detail**: NodeFileSystemProvider.createFileFromStream `_buffer: null` never written (:527, :537); McpServerProvider.initialized set but never read (:58, :275 — pre-initialize requests not rejected); ToolPrimitive.schemaToJsonSchema `options.root === false` branch unreachable (:279); CliProvider.parseCommandArgs `isRootCommand=false` path dead (:886); DateTimeProvider `clearInterval` never removes from `this.intervals` (:477-481 — intervals accumulate); bin/index.ts:10 `as any` on LOG_FORMAT.

### [UNFINISHED] `printHelp` permanently flips the logger to `raw` format
- **Severity**: P3
- **File**: packages/alepha/src/command/providers/CliProvider.ts:1022
- **Detail**: Sets `alepha.logger.format = "raw"` globally, never restores. The `help()` callback is handed to command handlers (parent commands print help then continue) — subsequent logs lose timestamps/levels. Save and restore.

### [UNFINISHED] Env-var descriptions in help read `.description` directly instead of `schemaMeta`
- **Severity**: P3
- **File**: packages/alepha/src/command/providers/CliProvider.ts:1119
- **Detail**: `Env:` help section uses `(schema as any).description`, but wrapped (`.optional()`) env schemas keep it in the inner schema's `.meta()` registry — renders empty. Use `this.schemaMeta(schema).description`.

### ✅ FIXED — [RECO] Logger has no secret redaction at all
- **Severity**: P2
- **File**: packages/alepha/src/logger/services/Logger.ts:188-224, JsonFormatterProvider.ts
- **Detail**: `entry.data` serialized wholesale by every formatter and stored verbatim in MemoryDestinationProvider (devtools displays it). Nothing masks `authorization`, `password`, `token`, `apiKey`, `set-cookie`. One `log.debug("req", { headers })` ships bearer tokens to stdout/aggregation/devtools. Add key-based redaction in `Logger.log`. MCP transport also logs full request bodies at debug.

### [RECO] Suppressed log levels still construct the entry and emit an async event
- **Severity**: P3
- **File**: packages/alepha/src/logger/services/Logger.ts:203-217
- **Detail**: Even when level disabled, `log()` builds the full LogEntry (timestamp, ALS context lookup) and fires `alepha.events.emit("log", …)` returning a promise per call. Gate on level / has-listeners and early-return.

### [RECO] `FileDetector.peekBytes` buffers the entire stream to peek 16 bytes
- **Severity**: P2
- **File**: packages/alepha/src/system/services/FileDetector.ts:515-533
- **Detail**: `detectFileType` on a multi-GB upload materializes the whole file in memory before re-wrapping. Read only first chunk(s) up to 16 bytes and re-prepend.

### [RECO] Prompt/params validation errors surface as `-32603 Internal error` instead of `-32602 Invalid params`
- **Severity**: P3
- **File**: packages/alepha/src/mcp/providers/McpServerProvider.ts:186-202, :468-481
- **Detail**: `PromptPrimitive.get` throws TypeBoxError on bad args; `handleMessage` maps any non-McpError to internal error. `McpInvalidParamsError` exists but is never thrown. Map validation errors to -32602 (tools already handle via `isError: true`).

### [RECO] CLI flag parser cannot accept negative numbers or `--` terminator
- **Severity**: P3
- **File**: packages/alepha/src/command/providers/CliProvider.ts:742-793
- **Detail**: Any token starting with `-` is a flag, so `--count -5` fails; no `--` end-of-flags convention. Accept next-arg matching `/^-\d/` as value; treat `--` as terminator.

### Coverage notes
- Read fully: bin/, datetime/, command/, system/, logger/, mcp/, router/, fake/ — all source files. Cross-checked ServerProvider (param decoding), TypeBoxError shapes, CronProvider (the wait-hang production user).
- Specs skimmed: all __tests__ in scope; no skipped/todo tests.
- Test gaps: $interval throwing handler; travel() with 3+ consecutive travels; future-dated createTimeout under pause; shell escaping/metacharacters/signal-kill; router wildcard fallback + percent-encoded segments; Asker uppercase N; logger circular data through JSON formatter (and no redaction tests — no redaction exists); FakeProvider locale; MCP isolate-restart version negotiation, notification status code, batch messages.

---

## cli

### ✅ FIXED — [BUG] Custom `output.dist`/`output.public` breaks the client build cleanup (hardcoded `dist/public`)
- **Severity**: P1
- **File**: packages/alepha/src/cli/core/tasks/BuildClientTask.ts:121,131
- **Detail**: `buildClient()` builds into `${distDir}/${publicDir}` (from `ctx.options.output`), but then calls `await this.postBuildCleanUpForIndexHtml();` with no argument, and that method defaults to `dist = "dist/public"`. With a customized `build.output.dist` or `output.public`, the cleanup reads `dist/public/.vite/manifest.json` which doesn't exist → the whole build fails (or silently rewrites the wrong tree if a stale `dist/public/` coexists). Fix: pass `opts.dist` through.

### ✅ FIXED — [BUG] `--image=<version>` builds an image named `<version>:latest` instead of `tag:<version>`
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/tasks/BuildDockerTask.ts:315-337
- **Detail**: Docs promise `--image=1.3.4` → `tag:1.3.4`, but only a leading-colon value (`--image=:1.3.4`) maps to tag:version; a bare `--image=1.3.4` becomes `imageTag = "1.3.4:latest"` — the version is treated as the image *name*. Silently produces a wrongly-named image. No test covers the `--image` flag.

### ✅ FIXED — [BUG] `--prebuilt` with `vercel`/`static` targets crashes with a null dereference
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/tasks/BuildVercelTask.ts:76; BuildStaticTask.ts:28
- **Detail**: In prebuilt+manifest mode `ctx.alepha = (null) as unknown as Alepha`; BuildVercelTask and BuildStaticTask have no prebuilt guard: `alepha build -t vercel --prebuilt` reaches `ctx.alepha.primitives("scheduler")` → TypeError on null. Guard on `ctx.flags?.prebuilt` or reject the combination.

### ✅ FIXED — [BUG] `db check` failure hint names a non-existent command (`migrations generate`)
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/db.ts:132
- **Detail**: On drift the check prints `run 'alepha db migrations generate'` — but the subcommand is named `create`. Users and CI logs are told to run a command that doesn't exist. Rename the hint or add an alias.

### ✅ FIXED — [BUG] `gen env` / `gen openapi` swallow failures — exit code 0 on error
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/gen/env.ts:51-53; gen/openapi.ts:61-71
- **Detail**: Both wrap the whole body in `try { … } catch (err) { this.log.error(…); }` and return normally. CLI only exits non-zero when the handler throws, so a failed generation in CI reports success while writing nothing. Rethrow after logging.

### ✅ FIXED — [BUG] `gen openapi` injects `ServerSwaggerProvider` by class identity across module graphs
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/gen/openapi.ts:31-33
- **Detail**: `alepha` is the user's container loaded via Vite's SSR module graph, while `ServerSwaggerProvider` is imported from the CLI's own graph — distinct class objects (BuildCloudflareTask documents this and looks up by name string). `inject(class)` on a miss instantiates a fresh CLI-graph provider instead of throwing, so the "Service not found" branch is dead and apps get a duplicate provider. Use `alepha.inject("ServerSwaggerProvider")`.

### ✅ FIXED — [BUG] Paths with spaces break `db`/`export` shell-outs (unquoted interpolation)
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/db.ts:443; platform-lib/adapters/CloudflareAdapter.ts:658
- **Detail**: `node "${drizzleKit}" generate --config=${drizzleConfigJsPath}` quotes the binary but not the config path (contains project root, may have spaces) — the arg splits. Same for `wrangler d1 export ${dbName} --remote --output=${sqlPath}`. Quote every interpolated path.

### [BUG] `alepha platform build`/`deploy` granular commands emit configs with missing/broken bindings
- **Severity**: P2
- **File**: packages/alepha/src/cli/platform-lib/adapters/CloudflareAdapter.ts:53-55,147-174
- **Detail**: `build()` derives `DATABASE_URL`/`CLOUDFLARE_KV_ID` from `this.provisionedD1Id` / `provisionedKVIds`, populated only by `provision()` in the same process. Standalone `platform build`/`deploy` (platform.ts:516, 551) never call provision, so the generated `wrangler.jsonc` silently lacks the D1 binding (or gets `kv_namespaces: [{id: ""}]`), and deploy ships a worker with no database. Resolve existing resource IDs from the API in `build()`.

### ✅ FIXED — [BUG] `AppEntryProvider` crashes with raw ENOENT when `src/` is absent
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/providers/AppEntryProvider.ts:75
- **Detail**: `await this.fs.ls(join(root, "src"))` runs unconditionally even when custom entries are configured; `ls` is raw `readdir` and throws ENOENT for a missing dir. Guard with `fs.exists` or `.catch(() => [])`.

### ✅ FIXED — [BUG] Secret values written to predictable world-readable `/tmp` files
- **Severity**: P2
- **File**: packages/alepha/src/cli/platform-lib/providers/GitHubSecretStore.ts:87-92
- **Detail**: `set()` writes the plaintext secret to `/tmp/alepha-secret-${key}-${Date.now()}` — hardcoded /tmp, predictable name, default mode — before `gh secret set -f`. On shared machines any local user can read it (or pre-create the path). Write to `node_modules/.alepha/` or use `mkdtemp` + mode 0600. Also uses `Date.now()` (convention: DateTimeProvider).

### ✅ FIXED — [BUG] `alepha verify` skips tests for projects with co-located specs
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/verify.ts:34-36
- **Detail**: Tests gated on the existence of a `test/` directory only, but the framework supports co-located `src/**/*.spec.ts` — such a project silently gets a green verify with zero tests executed. Gate on `test/` OR a glob hit, or always run vitest with `--passWithNoTests`.

### ✅ FIXED — [BUG] `changelog --from/--to` flags interpolated into a real shell
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/gen/changelog.ts:26-31,221
- **Detail**: `GitProvider.exec` uses `promisify(exec)` (true shell) with `` `git ${cmd}` ``, embedding raw flag values (`git log ${fromRef}..${toRef}`). A ref like `HEAD;rm -rf .` executes. The one ShellProvider bypass in the CLI. Route through ShellProvider or `execFile("git", [...])`.

### ✅ FIXED — [BUG] Multi-app `dev` hardcodes `yarn` and shifts ports under `--only`
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/dev.ts:148,181
- **Detail**: `spawnApp` always spawns `yarn alepha dev` regardless of detected package manager (npm/pnpm/bun fail; Windows `spawn("yarn")` without shell fails). Ports assigned `5173 + i` over the *filtered* list, so `--only api` gives `api` port 5173 even if it normally runs 5174 — OAuth redirects/client configs pinned to usual ports break.

### ✅ FIXED — [BUG] `pack` breaks for scoped package names
- **Severity**: P2
- **File**: packages/alepha/src/cli/core/commands/pack.ts:71-72,116
- **Detail**: `filename = ${project}-${tag}.tar.gz` uses package name verbatim; `@acme/app` yields `@acme/app-latest.tar.gz` → tar targets a non-existent `@acme/` subdir and fails. Slugify (NamingService.slugify exists).

### [BUG] `db migrations check` crashes on an empty journal
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/db.ts:92-99
- **Detail**: `journal.entries[length - 1]` is undefined for zero entries; next line reads `.idx` → TypeError instead of "no migrations yet". Guard for empty.

### [BUG] `--compile` flag cannot override `docker.compile: false` from config
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/build.ts:178-186
- **Detail**: `compile: flags.compile ? (current.docker?.compile ?? true) : false` — explicit `--compile` with config `compile: false` evaluates to false; the `?? true` only rescues undefined. CLI flag should win.

### [BUG] `CLOUDFLARE_SERVICES` parsed without guard
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/tasks/BuildCloudflareTask.ts:392
- **Detail**: `JSON.parse(raw)` throws raw SyntaxError with no context on malformed JSON. Wrap and rethrow AlephaError naming the variable.

### [BUG] Cloudflare wrangler config ignores custom `output.public`
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/tasks/BuildCloudflareTask.ts:188-190,208; BuildVercelTask.ts:234
- **Detail**: `hasAssets` checks `join(root, distDir, "public")` hardcoded, and BuildVercelTask.copyStaticAssets likewise — custom public dir silently produces a worker with no static assets. Same family as the P1 BuildClientTask finding.

### [UNFINISHED] `gen/resource.ts` is a TODO-only stub, not wired anywhere
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/gen/resource.ts:1-15
- **Detail**: Single block comment describing a planned scaffolder; no code, not imported. Implement or delete.

### [UNFINISHED] `pwa.offline` option accepted but not implemented
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/atoms/buildOptions.ts:318-323
- **Detail**: `pwa.offline: z.boolean()` documented "TODO: Not yet implemented"; BuildPwaTask never reads it — `offline: true` gets no service worker and no warning.

### [UNFINISHED] `BuildPwaTask` missing from module registration and barrel exports
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/index.ts:69-78,125-134
- **Detail**: Every other BuildXxxTask is in AlephaCli services + barrel; BuildPwaTask is neither (works only via on-demand `$inject`). External consumers can't import or substitute it.

### [UNFINISHED] Dead guard block in `BuildVercelTask.collectCronJobs`
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/tasks/BuildVercelTask.ts:76-79
- **Detail**: Empty if-body holding only a comment; the intended early `return []` was never written. This is what makes the prebuilt null-deref reachable.

### [UNFINISHED] Acknowledged tech debt: `runAlepha` uses `ssrLoadModule` dev-server hack
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/services/ViteUtils.ts:418-423
- **Detail**: "Vite 7 runnerImport doesn't work as expected … clearly a bad stuff" — every db/gen command boots a full Vite dev server just to import the entry; a second `runAlepha` call overwrites `this.viteDevServer`, leaking the first server. Also BuildPrerenderTask.ts:44 TODO "running configure here is a temporary workaround".

### [UNFINISHED] `as any` provider casts in `db push --dry-run`
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/db.ts:236,261
- **Detail**: `(provider as any).connect()` / `.close()` bypass the type system. Add methods to the interface. Similar: `prepareDrizzleConfig({ kit: any })`, prerender task `any[]` lists.

### ✅ FIXED — [RECO] Stop stamping a plain-text hash of secret *values* onto the worker
- **Severity**: P2
- **File**: packages/alepha/src/cli/platform-lib/adapters/CloudflareAdapter.ts:458,1389-1395
- **Detail**: `ALEPHA_SECRETS_HASH` is sha256 of sorted "KEY=VALUE" lines stored as a **readable** plain_text binding — an offline brute-force oracle for low-entropy secrets to anyone with worker-settings read access. Salt with a per-worker nonce or hash only key names + local value digest.

### [RECO] `platform()` sets production `PUBLIC_URL` for every command, including dev
- **Severity**: P3
- **File**: packages/alepha/src/cli/platform/index.ts:66-71
- **Detail**: `process.env.PUBLIC_URL = https://<prod domain>` runs at config *import* time, also during dev/test; ViteDevServerProvider merges with `??=` so dev sessions inherit the production URL (OAuth callbacks, email links to prod). Gate on production mode; skip wildcard domains.

### [RECO] Argv-array overload for ShellProvider to kill quoting bugs wholesale
- **Severity**: P3
- **File**: packages/alepha/src/cli (db.ts, CloudflareAdapter.ts, WranglerApi.ts, BuildDockerTask.ts:355)
- **Detail**: Commands composed as strings and re-parsed; every unquoted interpolated path is a spaces landmine, and `capture: true` routes through a real shell where escaping misses backtick/`$`/`;`. Add `ShellProvider.run(["wrangler", "d1", "export", dbName, ...])` and migrate call sites.

### [RECO] `getWorkspaceContext` can false-positive on unrelated parent repos
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/services/PackageManagerUtils.ts:96-133
- **Detail**: A dir is a "workspace package" if any ancestor 2–3 levels up has lockfile + package.json — without verifying the current dir is declared in that root's `workspaces`. `alepha init` in a nested dir of an unrelated repo skips git init/AGENTS.md/PM setup and installs in the wrong root. Depth 1 (`monorepo/pkg`) is never checked.

### [RECO] `CloudflareApi.fetch` should guard non-JSON responses
- **Severity**: P3
- **File**: packages/alepha/src/cli/platform-lib/services/CloudflareApi.ts:569
- **Detail**: `await response.json()` on a 5xx HTML/empty body throws an opaque SyntaxError with no URL/status context (patchWorkerBindings already does `.json().catch(() => null)`). Also `createD1` TODO: hardcoded `location = "weur"`.

### [RECO] `init` path argument is silently lowercased
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/init.ts:16-20
- **Detail**: `args: z.text({ lowercase: true })` turns `alepha init MyApp` into scaffolding `myapp/` — surprising and undocumented.

### [RECO] `clean` ignores `build.output.dist`
- **Severity**: P3
- **File**: packages/alepha/src/cli/core/commands/clean.ts:10-12
- **Detail**: `run.rm("./dist")` — a project with `output.dist: "build"` gets a no-op clean. Read buildOptions like BuildCommand.

### [RECO] `Date.now()` used in CLI services despite project convention
- **Severity**: P3
- **File**: cli/vendor/services/VendorService.ts:320,346; platform-lib/providers/GitHubSecretStore.ts:87; CloudflareAdapter.ts:1234; BuildDockerTask.ts:347 (`new Date()`)
- **Detail**: Convention is DateTimeProvider.nowMillis(). Vendor tmp-dir naming additionally risks same-ms collision.

### Coverage notes
- Read in full: cli/config, cli/core (commands incl. gen/*, providers, services, tasks, atoms, barrel), cli/devtools, cli/i18n, cli/vendor, cli/platform, cli/platform-lib. Skimmed templates and pure-zod schema files. Cross-checked CliProvider, Alepha.primitives normalization, shell parsing semantics.
- Two-container hygiene: checked every `this.alepha` vs `ctx.alepha` use — no confusion found except gen/openapi (reported).
- Raw fs in tasks: clean except BuildCommand.loadManifest, PlatformCommand.readManifest, PlatformInspector.readManifest (commands, allowed, but inconsistent).
- Test gaps: no specs for BuildClientTask (where the P1 lives), BuildAssetsTask, BuildPrerenderTask, BuildPwaTask, BuildStaticTask, BuildVercelTask, BuildCompressTask, DevCommand, ViteDevServerProvider (most stateful file, untested), ViteUtils, AppEntryProvider, PackCommand, gen/env, gen/openapi, VendorCommand. BuildDockerTask spec doesn't exercise `--image`. Platform-lib comparatively well covered.

---
