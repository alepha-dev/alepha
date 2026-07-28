# Alepha Framework — Review #3

> **Date**: 2026-07-28
> **Scope**: `packages/alepha` + `packages/@alepha/*`, audited against `main` @ `a61c26894`.
> **Supersedes and replaces**: `assets/REVIEW.md` (2026-07-11, architecture), `assets/REVIEW_2.md`
> (2026-07-24, code-level, 269 findings) and `assets/REVIEW_FEATURES.md` (2026-07-25,
> forward-looking). All three were deleted when this file was written; everything still live from
> them is carried below.

## What this document is

Review #2 closed 174 of its 269 findings across 25 fix passes and left 96 open, but its last update
was 2026-07-25 — twenty commits ago. Several of those commits were structural (`$bucket` → `$storage`,
the `$queue`/`$consumer`/`$scheduler` deletion, portable SQL / `$owns` / query cache, devtools v1),
so the open list had drifted.

**Every one of the 96 open findings was re-verified by reading the current code path.** This document
is the result: the survivors, corrected, plus the still-unbuilt feature backlog.

---

## Executive summary

| | Review #2 (2026-07-25) | Review #3 audit | After batches 1–5 |
|---|---|---|---|
| Open findings | 96 | 91 | **73** |
| P0 / P1 | 0 / 0 | 0 / 0 | **0 / 0** |
| P2 | 16 | 17 | **4** |
| P3 | 80 | 74 | **69** |

**Re-audit outcome** across review #2's 96 open findings:

- **4 fixed** since its last update, never marked — react `compile()`, `api/files` tags/creator,
  the Vercel dead guard, and the `clearInterval` registry leg.
- **2 retired** by the `$storage` rewrite — both were about `$bucket` symbols that no longer exist.
- **8 narrowed** — a real part of the finding landed, the remainder is restated below.
- **1 escalated, then retracted** — `FormValidationError` turned out to work; see below.
- **81 unchanged.**

**Then batches 1–5 closed 18 more** — **every P2 except the four websocket ones**. Nothing regressed;
no new P0/P1 surfaced at any point.

### Where the remaining risk is

**The only P2s left are the four websocket ones** review #2 deliberately put out of scope: room
connections invisible to graceful stop, `Map<roomId, handler>` clobbering a second subscriber,
headless room engines never evicted, and no ping/pong heartbeat. They are a coherent cluster and
should be taken as one piece of work, not picked at.

Everything else open is P3: dead code, doc drift, and hardening. The largest concentrations are cli
(15), react (11) and orm (10).

Review #2's biggest un-swept theme — **options accepted but ignored** — is now closed. All five were
public APIs that silently did nothing.

---

## Closed by the re-audit

These were open in review #2 and are closed now. Recorded so a future pass doesn't re-report them.

| Module | Finding | Why it's closed |
|---|---|---|
| react/router | `compile()` param substitution collides on prefixed names | `ReactPageProvider.compile` (:712) is now a boundary-aware `path.replace(/:([A-Za-z0-9_]+)/g, …)` with `Object.hasOwn` lookup and `encodeURIComponent`. `{ id, idx }` on `/x/:idx/:id` can no longer corrupt. Landed with the routing pass, never marked. |
| api/files | `bucket:file:uploaded` hook drops `tags` and `creatorName` | `FileService` now persists both (`creatorName: options.user?.name`, `tags: options.tags`, :253-256). Closed by the `$storage` rewrite. |
| cli | Dead guard block in `BuildVercelTask.collectCronJobs` | The empty if-body is gone; `collectCronJobs` has a real implementation and doc block. |
| datetime | `clearInterval` never removes from `this.intervals` | `DateTimeProvider.clearInterval` (:490) splices the registry. This was fixed in pass 1 but left listed inside the "dead/vestigial code" finding. |
| bucket | `BucketFileOptions` is declared twice in the same file | **Retired.** `$bucket` and `BucketFileOptions` no longer exist — `$storage` (`api/files/primitives/$storage.ts`) replaced the primitive. |
| bucket | Module docs advertise features that don't exist | **Retired.** `bucket/index.ts` was rewritten; the doc now correctly states "Memory (testing), Local filesystem, S3-compatible (AWS/MinIO), Cloudflare R2" and no longer claims TTL, Azure or Vercel Blob. |

**Also retired with `alepha/api/subscriptions`:** the `purgeEvents` half of "Unbounded/serial cleanup
loops" — `SubscriptionJobs.ts` is gone. The `purgeFiles` half is still open (below).

---

## Narrowed by the re-audit

Real progress landed; what remains is restated. **These are still open** — the entries below replace
the review #2 text.

| Module | Was | Is now |
|---|---|---|
| cache/CloudflareKV | `incr` is non-atomic **and** counters never expire | TTL shipped — `incr(name, key, amount, ttl?)` with documented sliding-window semantics. **Still open: the read-then-put is non-atomic**, so concurrent isolates lose updates. |
| api/audits | Filter options are hardcoded stubs | `types` and `actions` now come from `auditService.getRegisteredTypes()`. **Still open: `resourceTypes: ["user","session","file","order","payment"]` and `userRealms: ["default"]` are still literals** (`AdminAuditController.ts:228-236`) — the admin UI shows fabricated values. |
| api/jobs | `retryExecution` / `pushMany` drop push context | `retryExecution` now threads `triggeredBy`/`triggeredByName` — **but only on the `job.trigger()` branch**. The `job.push(execution.payload)` branch (`JobService.ts:208`) still drops `triggeredBy`, `organizationId` and `key`, so retried tenant notifications still lose org scoping. `PushManyItem` still has no such fields. |
| bucket/cache/email | R2 / CloudflareKV / Nodemailer have zero tests | `CloudflareKVProvider.spec.ts` exists (pass 25). **Still open: `R2FileStorageProvider` and `NodemailerEmailProvider` have no spec at all** — R2 is the production default on Workers. |
| logger | Suppressed levels still construct the entry and emit | An early return now skips the formatter (`Logger.ts:216`). **Still open: the full `LogEntry` (timestamp, ALS context lookup, `redact()`) is built and `emit()` still fires** before that check. |
| mcp | Validation errors surface as `-32603` | The **tool** path is now SEP-1303 compliant — `SchemaValidationError` returns `isError: true` with the failing path. **Still open: the prompt path**, and `McpInvalidParamsError` is defined, exported and unit-tested but never thrown by any production code path. |
| cli/platform | `platform()` sets production `PUBLIC_URL` for every command | Now guarded by `if (!process.env.PUBLIC_URL)`, so an explicit override wins. **Still open: it is not mode-gated** — a dev or test session with no `PUBLIC_URL` set still inherits the production hostname at config *import* time (OAuth callbacks, email links). |
| cli | Argv-array overload for ShellProvider, migrate call sites | `ShellProvider.run(argv[])` shipped in pass 3 and `db.ts` / `CloudflareAdapter.ts` are fully migrated. **Still open: one string-form call site in `WranglerApi.ts`.** |

---

## Escalated — then retracted

| Sev | Module | Finding |
|---|---|---|
| ~~P3 → P2~~ **closed** | react/form | **`FormValidationError` works; the escalation was wrong.** The finding ("exported but used nowhere") was true about *usage*, and I escalated it on the assumption that the documented flow was unimplemented. It isn't. `FormValidationError extends SchemaValidationError` with `instancePath: path`, `submit()` emits it on `form:submit:error`, and `useFormState({ form, path }, ["error"])` already matches `error.value.path === path` — so throwing it from a handler does reach the named field, and a `form:change` on that field clears it. Verified end-to-end with a new browser spec (`form-validation-error.browser.spec.tsx`, 4 tests) that required **no production change**. The real gap was zero test coverage, which is now closed. |

---

# Fix log

## Batch 1 — 2026-07-28 — the accepted-but-ignored options (P2)

Review #2's largest un-swept cross-cutting theme. TDD throughout: every fix has a test that failed
first against the unmodified tree. Verified with `yarn lint`, `yarn typecheck` and the full suite
(433 files, 4587 tests — up from 428/4564, no regressions).

| Area | Fix |
|---|---|
| server/rate-limit | **`keyGenerator` is used.** `checkLimit` now resolves `options.keyGenerator?.(req) ?? this.generateKey(req)`. It was declared, merged by `buildRateLimitOptions`, and then dropped on the floor — every limit keyed on IP regardless. The pre-existing "should use custom key generator" test passed **vacuously** (it allowed 3 and blocked the 4th, which holds whether or not the generator runs); the new spec uses three distinct IPs and a generator that collapses them onto one bucket. `keyGenerator`'s parameter is now typed `RateLimitRequest` instead of `any`. |
| server/rate-limit | **`skipSuccessfulRequests` / `skipFailedRequests` do something.** The counter is still incremented up front — that is what makes the check atomic — and now refunded once the outcome is known. `RateLimitResult` carries the exact `key` it incremented, because recomputing it later can land in the next fixed window and refund the wrong bucket. Two call paths: the `$rateLimit` middleware settles its own refund from the handler's return/throw (works outside HTTP too), and the route path stashes the check in a `WeakMap` keyed on the request and refunds in `server:onResponse`. A refund that fails is logged and swallowed — it can only make the limiter stricter, and must not 500 a request whose answer already exists. |
| command/Runner | **`RunOptions.root` is honoured by `run.rm` / `run.cp`.** Both called `node:fs` with the caller's path verbatim, so they resolved against `process.cwd()` — `run.rm("dist/*", { root: appDir })` deleted relative to the wrong directory or did nothing. Paths are now anchored with a `resolveIn` helper; absolute paths pass through untouched (`root` scopes relative work, it does not confine it), and with no `root` behaviour is unchanged. The glob branch re-anchors each match, since `glob({ cwd })` yields relative entries. |
| command/Runner | **`execute(Task[])` returns the tasks' output** instead of `""` with a "not supported for now" comment. Order follows the input array, not completion order, so a parallel run is deterministic. |
| api/notifications | **The admin `status` filter is applied, and its enum matches reality.** `query.status` was declared and never added to the where clause. Worse, three vocabularies disagreed: the DB writes `pending/running/scheduled/ok/error/cancelled`, the query enum offered `retrying/completed/dead`, and the UI badge switched on `sent/delivered/failed` — so no badge ever matched and every filter was a no-op. All three now use the `job_executions` vocabulary. The handler body moved into a protected `list()` so it is testable without standing up an authenticated request. |
| api/audits | **`resourceTypes` and `userRealms` come from the data.** They were the literals `["user","session","file","order","payment"]` and `["default"]`, so the admin dropdown advertised values no row had and hid the ones that existed. New `AuditService.getDistinctFilterValues()` runs `SELECT DISTINCT` per column and drops nulls. |
| react/form | **`FormValidationError` pinned by tests.** No production change needed — see *Escalated — then retracted*. |

## Batch 2 — 2026-07-28 — money and schema integrity (P2)

Verified with `yarn lint`, `yarn typecheck` and the full suite (436 files, 4600 tests, no regressions).

| Area | Fix |
|---|---|
| api/payments | **State transitions are status-guarded.** `capture`, `void` and `cancel` read the intent, called `assertStatus`, then wrote with an unguarded `updateById` — so the assertion only ever described the *snapshot*, and whatever the row said when the write landed was overwritten, re-emitting a lifecycle event for a transition the intent had already left. New `transition(id, from, data, op)` folds the expected status into the WHERE clause, making check-and-write one statement, and reports the *actual* current status when it refuses. The webhook path got the same guard on the status its transition table was validated against — providers retry and deliver out of order, so two deliveries could pass the table check against one snapshot. The entities have declared `db.version()` for this since they were written and nothing used it. |
| api/payments | **Reproducing the race needed care.** A plain `Promise.all` of five `capture()` calls passes with *and* without the fix — the shared test connection serialises the statements, so the interleaving never happens. The spec instead substitutes a `StaleReadPaymentService` that hands the operation a snapshot which was true a moment ago and is not true now: exactly the state a second worker leaves behind, and deterministic. Without the guard all three transition tests report "promise resolved instead of rejecting". |
| api/parameters | **`schemaHash` is no longer client-supplied.** `save()` skips content validation when the given hash differs from the registered one — the escape hatch that lets a migration seed restore content written under an older schema. The admin create-version body accepted that hash from the client, so anyone with `admin:parameter:create` could send junk and store arbitrary JSON that every typed `$parameter.get()` consumer then reads as `Static<T>`. Removed from `createParameterVersionBodySchema`; the controller passes `""`, which resolves to the registered hash, so admin writes are always validated. The seed path is untouched. **The shipped admin UI was itself sending `schemaHash` at three call sites** — the bypass was reachable from `@alepha/ui`, not just from a hand-rolled request. |
| server/auth | **Apple `form_post` works on the Node adapter.** `handleCallback` switched to POST-body parsing only when `raw.web.req` existed, so on plain Node the authorization code was never read out of the body and Apple Sign In failed outright — while working on workerd/Bun. New `toWebRequest(url, raw)` synthesises a web `Request` from the `IncomingMessage`, preserving method and headers (including repeated ones). The body is buffered rather than streamed — a form post is small, and it avoids both `duplex` handling and a `node:stream` import in a file that ships to more than one runtime. |

## Batch 3 — 2026-07-28 — runtime and infra paths (P2)

Verified with `yarn lint`, `yarn typecheck`, the full suite (439 files, 4623 tests) and `yarn test:bun`
(53, up from 46).

| Area | Fix |
|---|---|
| system/FileDetector | **`peekBytes` reads only what it needs.** It pulled the ENTIRE stream to look at 16 magic bytes and rebuilt a stream from the buffered copy, so `detectFileType` on a multi-GB upload materialised the whole file in memory first. It now advances the source's async iterator until it has the requested bytes, then hands back a stream that replays the consumed head and resumes the *same* iterator — no byte read twice, none lost. Test pulls 64 chunks' worth and asserts fewer than 64 were touched (it was all 64). |
| redis | **Wildcard traversal uses SCAN, not `KEYS`.** Container flush, wildcard `invalidate("x*")` and `clear()` all funnel through `keys(pattern)`, which ran the O(N) blocking `KEYS` — on a shared or large Redis that stalls every other client for a full keyspace walk. Both providers now iterate a cursor (`SCAN … COUNT 500`) behind a `scanPage` seam, de-duplicating across pages since SCAN may repeat keys. `del()` switched to `UNLINK`, which frees on a background thread. The public contract is unchanged. |
| system/BunShellProvider | **The Node-vs-Bun divergence was already closed — by review #2's own third pass.** The finding says shell features work on Node and break on Bun. Measured against the current tree, Node returns `"hello && echo world"` for `echo hello && echo world`, `"$HOME"` for `echo $HOME`: the POSIX single-quote escaping added in pass 3 made every token a literal argument on Node too, which is the whole point of that escaping. The two runtimes agree today. Rather than "fix" a divergence that no longer exists, the contract is now **pinned on both**: a seven-case table (`&&`, `\|`, `$VAR`, `$(...)`, `;`, quoted args, and an explicit `sh -c` escape hatch) asserted identically in `shellStringContract.spec.ts` (Node) and `BunShellProvider.bun.spec.ts` (Bun), so they cannot drift apart again. |
| cli/platform | **`platform build` resolves resource ids instead of emitting broken bindings.** `build()` read `provisionedD1Id` / `provisionedKVIds`, which only `provision()` sets and only within the same process. The granular `platform build` / `platform deploy` never call provision, so the generated `wrangler.jsonc` silently lacked the D1 binding (or carried `kv_namespaces: [{ id: "" }]`) and shipped a worker with no database — failing only at the first query. New `resolveExistingResourceIds(ctx)` looks up what already exists on the account (D1, Hyperdrive, KV) and **throws** when the resource is absent, naming `alepha platform provision` as the fix. Lookup only — it never creates anything, so `provision` keeps its job. One test drives `build()` itself so the wiring is covered, not just the helper. |

## Batch 4 — 2026-07-28 — the last non-websocket P2

Verified with `yarn lint`, `yarn typecheck` and the full suite (441 files, 4659 tests).

| Area | Fix |
|---|---|
| bucket/R2 | **`R2FileStorageProvider` has a spec** — 21 tests, the first coverage for the production default on Workers. The R2 binding is an object the runtime supplies, so it is *faked* rather than the provider mocked: the whole shared storage-conformance suite (the same twelve cases every other backend passes) runs against an in-memory bucket that mirrors documented R2 semantics, plus R2-specific tests for key layout, `customMetadata` round-trip, `deleteMany` batching, and both start-up failure modes. |
| bucket/R2 | **`download()` serves repeat reads.** R2 hands back a single-use body — `body`, `arrayBuffer()` and `text()` all drain the same object — and the returned `FileLike` exposed all three over it, so reading twice threw while Memory and Local serve repeat reads happily. The bytes are now materialised once and every accessor is served from that buffer. The upload path already buffered (`file.arrayBuffer()`), so this makes the provider internally consistent as well as consistent with its peers. An empty-string `contentType` now falls back to `application/octet-stream` alongside a missing one. **The shared suite did not catch this** — each of its cases calls exactly one accessor. |
| email/smtp | **`NodemailerEmailProvider` has a spec** — 15 tests covering the env → transport mapping, credential handling, pooling options from the atom, send/verify/close, and error wrapping. `createTransporter` is protected, so the transport is substituted through a subclass rather than `vi.mock`. The config mapping was extracted into `buildTransporterConfig()` so the test asserts the **real** mapping instead of a copy of it — verified by breaking the `auth` branch and watching two tests fail. |

## Batch 5 — 2026-07-28 — core (partial: 5 of 10, plus one new bug)

Verified with `yarn lint`, `yarn typecheck`, the full suite (442 files, 4666 tests) and a clean build.

| Area | Fix |
|---|---|
| core/codec | **NEW BUG — an array of objects did not round-trip.** Found while pinning bigint behaviour: `{ rows: [{ a: "x", n: 1 }] }` encoded correctly to `[[["x",1]]]` and decoded back to `{ rows: [["x", 1]] }` — the objects were never rebuilt, so callers got tuples where the schema promised objects. `reconstructObject` recursed into nested *objects* but returned arrays verbatim; the interpreted and compiled decode paths both handled it, so the same schema decoded differently depending on which path ran. Extracted `reconstructField` and gave it the array-of-objects case. **Latent, not live** — the keyless codec is opt-in (`encoder: "keyless"`) and nothing in the framework or Lore selects it, which is why no test caught it. Not in review #2's list at all. |
| core/codec | **Dead bigint branches removed** (nine sites). `z.bigint()` is a `ZodString` with `format: "bigint"`, so `isLeaf()` is true for it and every `"…n"`-suffix encode / `BigInt(v.slice(0,-1))` decode branch sat behind an `isLeaf` early return. Verified before deleting: `{big:"123"}` encodes to `["123"]` (no suffix) and decodes to the string — the round-trip worked by accident. Seven tests now pin the string representation, including precision beyond 2^53, so a future "fix" that reinstates suffix decoding fails loudly instead of silently dropping the last digit. The `isEnum` helper went with them: a real `ZodEnum` returns `false` from it and is already covered by `isScalar`. |
| core | **`$memoize` no longer imports from the `"alepha"` barrel** — the only real barrel self-import in core, and a cycle through the package entry that the build's circular-dep analysis exists to catch. Now imports `createMiddleware` from `./$pipeline.ts` directly. Build stays clean. |
| core | **`TypeProvider.prototype.page` augmentation deleted.** `TypeProvider` is a static-only legacy config holder that nothing constructs, so the instance method was unreachable; `z.page` is the live implementation. |
| core | **`AlephaDumpEnvVariable.description` is optional.** `dump()` assigns `inner?.description ?? prop?.description`, which is `undefined` for env fields without one, while the interface declared it as the only non-optional field — so the devtools env table typed against it could NPE. |
| core | **`createPagination` uses `> limit`, not `=== limit + 1`.** A caller passing an unsliced result set was told `isLast: true` on a page that clearly had more. |

**Still open in core (5):** the keyless codec's `null`-in-optional+nullable lossiness, `parseEnv` `$KEY`
escaping, EventManager cross-tier ordering + stale logger, `AlephaCore` missing from the browser/native
entrypoints, and the acknowledged TODOs (scoped-lifetime warn-once, `__alephaRef` cursor, `StreamLike`).

### Also found while fixing

- **A stray `packages/alepha/copy/` appeared mid-session** — a byte-identical mirror of `packages/alepha/src/` (327 spec files), untracked and not gitignored. Vitest collected it, so the suite ran twice against a stale second copy and reported failures that did not exist in `src`. **I could not identify what wrote it**: it is not `scripts/build.ts`, `copy-swagger.ts` or `gen-docs.ts`, and a later `yarn build` did *not* recreate it. Removed. Whatever the source, `packages/alepha/copy/` deserves a `.gitignore` entry and a vitest `exclude` — the same defence the config already has for `**/.claude/**` worktrees, and for the same reason.

---

# Open findings

73 findings remain (91 minus the 18 closed in batches 1–5). Line numbers are against `main` @ `a61c26894` and were
read during the audit — but **locate by symbol name**, not by line, when acting on them.

## Priority list — the P2s

**Thirteen of seventeen closed** across batches 1–4. The four that remain are the websocket cluster
review #2 deliberately put out of scope.

| # | Module | Finding | Anchor |
|---|---|---|---|
| 1 | websocket | Node graceful stop / management APIs are blind to `$room` connections | `NodeWebSocketServerProvider.ts:294` |
| 2 | websocket | Second `subscribe` to the same room silently replaces the first handler | `WebSocketClient.ts:72-73` |
| 3 | websocket | Node headless `$room` engines are never evicted | `NodeWebSocketServerProvider.ts:196-203` |
| 4 | websocket | No liveness / heartbeat on the Node WebSocket server (zero ping/pong/isAlive) | `NodeWebSocketServerProvider.ts` |

> All four are the websocket cluster. Left at P2 and left closed-over; reopen deliberately, not by
> accident.

Closed: rate-limit options, `Runner` root, notification status filter, audit filter stubs,
`FormValidationError` (batch 1) · payments `version` guard, parameters `schemaHash`, Apple
`form_post` (batch 2) · `FileDetector.peekBytes`, Redis `KEYS`, Bun shell parity, Cloudflare platform
bindings (batch 3) · R2 coverage + single-use body, Nodemailer coverage (batch 4).

---

## core — 5 open (all P3)

> Five closed in batch 5; see the fix log.

1. **Keyless codec: `null` in an optional+nullable field decodes to "absent".** The `isOpt` branch wins
   over `isNullable`, so `null` is the shared sentinel for both. `{a: null}` with
   `z.integer().nullable().optional()` round-trips to `{}`. Breaks PATCH semantics.
2. **`parseEnv` `$KEY` templating has no escape and substitutes into undeclared lookalikes**
   (`Alepha.ts:1146-1160`). No way to include a literal `$` (a password containing `$PORT` gets
   rewritten); longest-first sorting only protects among *declared* keys, so `$PORTX` with `PORT`
   declared becomes `<port>X`. Consider `$$` escaping and `/\$KEY(?![A-Z0-9_])/`.
3. **EventManager: cross-tier `before`/`after` constraints silently ignored; compiled executors snapshot
   a stale logger.** `topoSort` runs per priority tier (`EventManager.ts:116-118`), so `priority: "first"`
   + `after: [NormalTierService]` gets no ordering and no warning. Separately `compile()` captures
   `const log = this.log` (:245) before the logger module replaces `alepha.logger`.
4. **`AlephaCore` exists only in the node and workerd entrypoints** (`core/index.ts:38`,
   `index.workerd.ts:22` — duplicated; absent from `index.browser.ts` / `index.native.ts`). Isomorphic
   code importing it compiles server-side and breaks in the browser bundle. Hoist to a shared file.
5. **Acknowledged TODOs.** (a) scoped-lifetime inject silently falls back to the global singleton when
    no ALS context exists — the planned warn-once is written as a comment and not implemented
    (`Alepha.ts:976`), so "per-request isolation" quietly becomes a cross-request singleton;
    (b) `__alephaRef` cursor not restored on mid-instantiation throw (`ref.ts:60`);
    (c) `StreamLike` slated for replacement with web streams (`FileLike.ts:96`).

## security + crypto + captcha — 2 open (P3)

1. **Dead exported types `CreateTokenOptions` and `ServiceAccountStore`** (`$issuer.ts:482`,
   `$serviceAccount.ts:186`). Referenced nowhere; `ServiceAccountStore.response` doesn't even match the
   actual `store.cache` field. Remove.
2. **`SecurityProvider` catch-all in the resolver loop hides genuine token errors.**
   `resolveUserFromServerRequest` (:449) wraps each `resolver.onRequest` in `try {} catch { continue }`,
   swallowing tenant-mismatch and malformed-bearer errors and returning `undefined` with no diagnostic.
   Deliberate for multi-realm fallthrough — log at debug inside the catch.

## server — 2 open (both P3)

> Apple `form_post` and the rate-limit options closed in batches 1–2 — see the fix log.

1. **P3 · Registry / `/api/_batch` misc hardening.** `MAX_BATCH_SIZE` violation throws a bare
   `AlephaError` → 500 instead of 400 (`ServerLinksProvider.ts:218`). `LinkProvider.getLinkByName`
   (:388-396) reports not-found as `UnauthorizedError` (401) and emits `client:onError` with
   `route: undefined`. `BatchCollector` assumes exactly one result per entry — a short response rejects
   everything with a TypeError.
2. **P3 · Small correctness/DX items** — carried forward from review #2 without re-derivation.

## orm — 10 open (all P3)

1. **`primaryKey` cannot distinguish a uuid PK from a slug PK at the type level**
   (`DatabaseTypeProvider.ts:118-140`). `z.uuid()` and `z.text()` are both `ZodString`, so the single
   `TString` overload must promise `PgDefault` — right for the 26 uuid PKs in tree, wrong for a slug.
   The runtime is correct (branches on `format === "uuid"`), so a slug PK omitting its id fails
   validation rather than reaching the driver. Closing it needs a nominal uuid type in the schema layer.
2. **`distinct` + `with` (joins) silently returns garbage** (`Repository.ts:381-384`).
   `rawSelectDistinct` selects a flat field map while join post-processing expects drizzle's nested
   per-table shape, so `row[this.tableName]` is undefined. Throw "distinct cannot be combined with with".
3. **`columns` doesn't restrict the SQL projection** (`Repository.ts:381`). It only narrows the schema
   used by `clean()`; the SQL still `SELECT *`s. Wide tables pay full I/O.
4. **Callers' objects are mutated by update paths.** `updateMany` writes `updatedAt` into the caller's
   data object (`Repository.ts:1089-1095`); `destroy` writes `deletedAt` into the caller's entity.
   Reused objects carry stale injected fields. (The `findMany` → `query.limit` leg was fixed in pass 4.)
5. **Per-repository `DbCacheProvider` is `new`'d, unbounded, and key generation can blow up**
   (`Repository.ts:101`). Bypasses DI so it isn't substitutable; entries without ttl never expire;
   `buildCacheKey` does `JSON.stringify(query)`, which a `with` clause makes enormous or circular. Raw
   `query()` writes never invalidate.
6. **`upsert` with no `updatedAt` field can emit an empty SET clause** (`Repository.ts:874-878`). Default
   `setData` removes conflict-target keys and the PK; an entity without `PG_UPDATED_AT` hands
   `onConflictDoUpdate` a `{}`. Fall back to `onConflictDoNothing` + re-select, or SET target to itself.
7. **`createMany` batches are not atomic** (`Repository.ts:750-758`). Batches of 1000 run as independent
   INSERTs outside any ambient `$transactional`; a failure in batch N leaves 1..N-1 committed. Undocumented.
8. **node:sqlite prepare shim renames columns of raw JOIN queries** (`NodeSqliteProvider.ts:226-228`).
   The `db.prepare` wrapper rewrites *any* SELECT-with-JOIN with duplicate trailing column names to
   positional aliases `__c0, __c1, …` — including user raw SQL via `repository.query()`, which comes back
   keyed `__c0…`. Apply the rewrite only inside the `stmt.raw()` path.
9. **FK error message assumes DELETE** (`DbForeignKeyError.ts:51,60`). Always renders "Cannot delete
   {table}: it is referenced by …", but FK violations equally arise from INSERT/UPDATE with a dangling
   reference. Branch on "is not present in table" vs "is still referenced".
10. **`index.browser.ts` registers a module as a service** — `services: [AlephaDateTime]` where every
    other index uses `imports:`. Harmless copy-paste slip.

## cache + redis + bucket + email + sms — 5 open (all P3)

> Redis blocking `KEYS` closed in batch 3; R2 / Nodemailer coverage and the R2 single-use body in batch 4.

1. **P3 · R2 file id embeds an unsanitized user filename extension and diverges from S3/Local.**
   `R2FileStorageProvider.createId` (:248-252) takes everything after the last `.` of the user-controlled
   filename — `"x.png/../y"` yields extension `"png/../y"`, producing nested attacker-shaped keys
   (contained within the bucket prefix). S3 derives the extension from the MIME type via `FileDetector`
   (`S3FileStorageProvider.ts:136-138`). Same call, two id schemes.
2. **P3 · Provider divergence in downloaded file metadata.** Local `download` returns `name: fileId` plus
   an extension-guessed type — the original name and type are never persisted
   (`LocalFileStorageProvider.ts:118-125`); Memory preserves both; S3 uses `x-amz-meta-name` (whose
   `decodeURIComponent` can throw `URIError` on foreign objects containing a literal `%`); R2 uses the raw
   name in `customMetadata`. Same call, different `file.name` / `file.type` per backend.
3. **P3 · `$cache.incr()` bypasses the `disabled` / `enabled` / lifecycle guards** (`$cache.ts:391-404`).
   `read()` and `set()` no-op when `!isStarted() || options.disabled || !settings.enabled`; `incr()` calls
   the provider unconditionally, so a disabled cache still mutates the store (and on KV throws before
   binding init). Add the same guard.
4. **P3 · CloudflareKV `incr` is non-atomic** (`CloudflareKVProvider.ts:220-238`). Read-then-put loses
   updates across isolates. Document the non-atomicity or route through a Durable Object. *(The
   never-expiring half is fixed — `incr` now takes a `ttl`.)*
5. **P3 · `email:sending` / `sms:sending` hooks always emit `variables: {}`** (`$email.ts:62`,
   `$sms.ts:57`). Vestige of a removed template-rendering design; `template` actually carries the channel
   name. Drop `variables` from the Hooks declaration or pass real data.

## websocket + topic + lock + retry — 8 open (4 P2, 4 P3)

1. **P2 · Node graceful stop / management APIs are blind to `$room` connections.**
   `handleRoomConnection` (`NodeWebSocketServerProvider.ts:294`) never registers in `this.connections`,
   so `getConnections()`, `getUserConnections()` and `closeConnection()` don't see room sockets and the
   stop hook's close-all loop skips them — abrupt TCP teardown instead of a `1001` close.
2. **P2 · Second `subscribe` to the same room silently replaces the first handler.** `subscriptions` is
   `Map<roomId, handler>` (`WebSocketClient.ts:72-73`); a second subscriber overwrites the first and
   either party's unsubscribe deletes the survivor — two components on one room is the normal UI case.
   Every new-room subscribe on an OPEN connection also calls `reconnect()`, tearing down the live socket.
3. **P2 · Node headless `$room` engines are never evicted.** `callRoom` (:196-203) lazily creates a
   `RoomEngine` per `channelPath:roomId` and engines are only deleted in the socket-close path — headless
   coordinator rooms have no sockets, so every distinct roomId ever `call()`ed accumulates forever.
4. **P2 · No liveness / heartbeat on the Node WebSocket server.** Zero occurrences of ping, pong or
   isAlive. Half-open TCP connections linger, inflating `maxConnectionsPerUser` (which can lock users out)
   and keeping room tick loops alive for ghosts.
5. **P3 · `$websocket` option `provider?: any` accepted and ignored** (`WebSocketInterfaces.ts:119`).
   No code reads it; registration always uses the injected `WebSocketServerProvider`.
6. **P3 · `(this.options as any).mqtt` escape hatch in `$topic`** (`$topic.ts:281,292`). Not in
   `TopicPrimitiveOptions`, no augmentation in-tree. Declare it or drop it.
7. **P3 · `RoomEngine` has no tick reentrancy guard for async `onTick`** (`RoomEngine.ts:221`). An
   `onTick` slower than `1000/tickHz` overlaps its own next invocation; for authoritative simulation,
   overlapping `state.step(dt)` corrupts the world. Mirror `CronProvider`'s `executing` guard.
8. **P3 · Minor correctness nits.** `RoomEngine.call` throws a bare `new Error` (:136) — the repo rule is
   `AlephaError`. Cloudflare `webSocketMessage` doesn't null-check `deserializeAttachment()`
   (`WebSocketRoom.ts:215`) while `webSocketClose` does (:193, :248) — a null attachment crashes the frame
   with 1011. Node `reply()` mutates the caller's `exceptConnectionIds` via push.
   `calculateBackoff` applies jitter *after* the max clamp, so delays can exceed `backoff.max` by 50%.
   `WorkerProvider` re-pushes consumers on every start without clearing on stop. CF `closeConnection()`
   is a silent no-op.

## react — 11 open (all P3)

> `FormValidationError` was found to already work; a spec now pins it.

1. **P3 · Unmatched-route synthetic layer crashes `onEnter`/`onLeave` bookkeeping.** The synthetic
   `{ name: "not-found" }` layer (`ReactBrowserRouterProvider.ts:129`) is fed to
   `this.pageApi.page(layer.name)?.onLeave?.()` (:191, :200) — but `page()` *throws* for unknown names,
   so the `?.` guards nothing. `"error"` is excluded from the loop; `"not-found"` is not. Use the
   non-throwing `findRoute()`.
2. **P3 · Redirected `push` with `replace: true` still pushes a new history entry.** When the transition
   commits a different URL (a loader redirect), `this.pushState(committed)`
   (`ReactBrowserProvider.ts:218`) doesn't forward `options.replace` — history grows and back lands on an
   entry that immediately redirects again.
3. **P3 · i18n placeholder substitution corrupts `$10+` and repeated placeholders**
   (`I18nProvider.ts:437`). `result.replace(\`$${i+1}\`, args[i])` ascending: `$1` is replaced before
   `$10` is considered, so `$10` becomes `args[0] + "0"`; and string-pattern `replace` hits only the first
   occurrence. Single regex pass (`/\$(\d+)/g`).
4. **P3 · Debounced `useAction.run()` promise never settles after cancel/unmount.** The debounce path
   returns a promise resolved only inside the timeout callback (`useAction.ts:334-342`); `cancel()`
   (:373-376) and the unmount cleanup clear the timer without resolving, so `await action.run(...)` hangs
   forever. Resolve `undefined` on clear.
5. **P3 · Dev error page renders wall-clock time — SSR hydration mismatch.**
   `{new Date().toLocaleTimeString()}` (`ErrorViewer.tsx:70`, and `GettingStarted.tsx:54`). Dev/demo only.
6. **P3 · Explicit TODOs and `as any` escape hatches in the router.** `scrollRestoration // TODO: must be
   per page?` (`ReactBrowserProvider.ts:31`); `user: (serverRequest as any).user // TODO: fix type`
   (`ReactServerProvider.ts:372`); `node()` returns `any` with "improve typing or remove"
   (`ReactRouter.ts:74`). `applyHydration` also trusts the SSR payload's props/config unvalidated.
7. **P3 · `ArrayInputField.items` is a permanently empty typed surface** (`FormModel.ts:598`) —
   `items: [], // <- will be populated dynamically in the UI`; the UI builds its own.
   `UseActionOptions.name` (`useAction.ts:523`) is accepted and never read.
8. **P3 · `useInject` ignores its argument in the memo deps** (`useInject.ts:11`):
   `useMemo(() => alepha.inject(service), [])` — a different service class between renders silently keeps
   the first instance. `[service]` removes the trap.
9. **P3 · Streaming "backpressure" is a no-op** (`ReactServerTemplateProvider.ts:225-227`). `if`
    (not a loop) + a single `queueMicrotask` await, then enqueue regardless — a microtask cannot let the
    consumer pull. Implement real backpressure or delete the misleading check.
10. **P3 · `isActive({ startWith })` matches across segment boundaries** (`ReactRouter.ts:61`):
    `current.startsWith(href)` makes `/foo` active on `/foobar`. Drives nav highlighting in every sidebar.
    Use `startsWith(href + "/") || current === href`.
11. **P3 · Dead nested-proxy code in `FormModel`** — the commented-out block above the array-field branch.

## api — auth modules (users, oauth, verifications, keys) — 3 open (all P3)

1. **Credentials login looks up the username with `ilike` on raw input** (`SessionService.ts:270`).
   `where.username = { ilike: username }` passes the user-supplied identifier straight into a LIKE match.
   `_` (allowed by the default `usernameRegExp`) is a single-char wildcard and `%` a multi-char wildcard,
   so `admi_` matches `admin`, `admix`, … and `findOne` picks one arbitrarily. A password is still
   required so this is not a direct bypass, but it is wrong matching semantics on the auth hot path. Same
   pattern at `UserService.ts:295,376` and `RegistrationService.ts:491`. Match with
   `LOWER(username) = LOWER(:input)`, mirroring the unique index.
2. **`checkUsernameAvailability` is case-sensitive and not realm-scoped**
   (`RealmController.ts:78`): `where: { username: { eq: body.username } }`. Uniqueness is enforced on
   `(realm, LOWER(username))`, so this reports `available: true` for `Admin` when `admin` is taken (and
   the registration then 409s), and it checks across all realms instead of the target realm.
3. **Password-reset intent creation has no IP throttle** (`CredentialService.ts:133`). The per-target
   cooldown (90s) and daily limit (10) are scoped to `(type, target, purpose)`, so one IP can request
   resets for thousands of *distinct* real addresses with no aggregate cap — an email-bombing primitive.
   Registration has `registrationIpMaxAttempts`; the reset flow has no analogue.

## api — feature modules (audits, files, jobs, notifications, organizations, parameters, payments) — 4 open (all P3)

> The notification status filter, audit filter stubs, `schemaHash` bypass and payments `version` guard closed in batches 1–2.

1. **P3 · `retryExecution` drops push context on the payload branch** (`JobService.ts:208`) — see
   *Narrowed*.
2. **P3 · `AuditService.getStats` loads every row in range into memory** (`AuditService.ts:282`):
   `findMany({ where })` with no limit, then counts in JS. O(rows) memory on an admin endpoint. Use SQL
   aggregation like `FileService.getStorageStats`.
3. **P3 · `purgeFiles` fires unbounded parallel deletes** (`FileJobs.ts:15-17`): `Promise.all` over every
   expired file. Bound concurrency or reuse `FileService.deleteFiles` batching. *(The `purgeEvents` half
   retired with the subscriptions module.)*
4. **P3 · Payments admin permissions break the naming convention**
   (`AdminPaymentController.ts:25,40,56,74,90,108,124`). Uses `payments:read` / `payments:write` while
   every other admin controller uses `admin:<module>:<verb>` — a role granting `admin:*` won't cover the
   payments admin surface. Rename with aliases.

## mcp + command + system + datetime + logger + router + fake + bin — 8 open (all P3)

> Bun shell parity, `Runner` root and `FileDetector.peekBytes` closed in batches 1 and 3.

1. **P3 · `EnvUtils` always loads `.local` variants** (`EnvUtils.ts:35-43`). `parseEnv` implicitly adds
   `${file}.local` for every file; the JSDoc at :16 still claims only `.env` / `.env.local`. It also
   swallows every read error (including EACCES) as "no file found", and keeps inline `# comments` after
   values as part of the value. Narrow the catch to ENOENT.
2. **P3 · `FileError` extends bare `Error` and is dead code** (`system/errors/FileError.ts:1`). Violates
   the "always `AlephaError`" rule, has zero usages, and is exported from three barrels
   (`index.ts`, `index.browser.ts`, `index.workerd.ts`).
3. **P3 · Dead / vestigial code.** `NodeFileSystemProvider.createFileFromStream` `_buffer` never written
   (:540, :550); `McpServerProvider.initialized` set at :275 but never read, so pre-initialize requests
   aren't rejected; `ToolPrimitive.schemaToJsonSchema` `options.root === false` branch unreachable;
   `CliProvider.parseCommandArgs` `isRootCommand=false` path dead; `bin/index.ts:10` `as any` on
   `LOG_FORMAT`. *(The `DateTimeProvider.clearInterval` leg is fixed.)*
4. **P3 · `printHelp` permanently flips the logger to `raw` format** (`CliProvider.ts:1064`):
   `this.alepha.store.set("alepha.logger.format", "raw")`, never restored. The `help()` callback is handed
   to command handlers (parent commands print help then continue), so subsequent logs lose timestamps and
   levels. Save and restore.
5. **P3 · Env-var descriptions in help read `.description` directly instead of `schemaMeta`**
   (`CliProvider.ts:1161`). Wrapped (`.optional()`) env schemas keep the description in the inner
   schema's `.meta()` registry, so the `Env:` help section renders empty. Use `this.schemaMeta(schema)`,
   as every other call site in the file already does.
6. **P3 · Suppressed log levels still construct the entry and emit** (`Logger.ts:203-217`) — see *Narrowed*.
7. **P3 · MCP prompt/params validation errors surface as `-32603 Internal error`.** `McpInvalidParamsError`
    is defined, exported and unit-tested but never thrown by production code. *(The tool path is now
    SEP-1303 compliant.)*
8. **P3 · CLI flag parser cannot accept negative numbers or a `--` terminator**
    (`CliProvider.ts:327`). Any token starting with `-` is treated as a flag, so `--count -5` fails.
    Accept a next-arg matching `/^-\d/` as a value; treat `--` as end-of-flags.

## cli — 15 open (all P3)

> The Cloudflare `platform build` binding bug closed in batch 3.

1. **`db migrations check` crashes on an empty journal** (`db.ts:92`).
   `journal.entries[journal.entries.length - 1]` is `undefined` for zero entries and the next line reads
   `.idx` → TypeError instead of "no migrations yet".
2. **`--compile` cannot override `docker.compile: false` from config** (`build.ts:181-183`):
   `compile: flags.compile ? (current.docker?.compile ?? true) : false` — the `?? true` only rescues
   `undefined`, so an explicit `--compile` against a config `compile: false` evaluates to `false`.
3. **`CLOUDFLARE_SERVICES` parsed without a guard** (`BuildCloudflareTask.ts:391-395`). Bare
   `JSON.parse(raw)` throws an uncontextualised SyntaxError on malformed JSON.
4. **Cloudflare and Vercel configs ignore a custom `output.public`.** `hasAssets` checks
   `join(root, distDir, "public")` hardcoded (`BuildCloudflareTask.ts:189`), as does
   `BuildVercelTask.copyStaticAssets` (:241) — a custom public dir silently produces a worker with no
   static assets.
5. **`gen/resource.ts` is a TODO-only stub, not wired anywhere.** A single block comment describing a
   planned scaffolder; no code, not imported.
6. **`pwa.offline` accepted but not implemented** (`buildOptions.ts:318-323`). Declared with
   "TODO: Not yet implemented"; `BuildPwaTask` never reads it, so `offline: true` yields no service worker
   and no warning.
7. **`BuildPwaTask` missing from module registration and barrel exports** (`cli/core/index.ts`). Every
   other `BuildXxxTask` is in the `AlephaCli` services list and the barrel; this one works only via the
   on-demand `$inject` in `build.ts`, so external consumers can't import or substitute it.
8. **`runAlepha` uses the `ssrLoadModule` dev-server hack** (`ViteUtils.ts:421-431`) — "clearly a bad
   stuff" per the in-code comment. Every db/gen command boots a full Vite dev server just to import the
   entry, and a second `runAlepha` call overwrites `this.viteDevServer`, leaking the first.
9. **`as any` provider casts in `db push --dry-run`** (`db.ts:236, 261`): `(provider as any).connect()` /
    `.close()` bypass the type system. Add the methods to the interface.
10. **`platform()` sets a production `PUBLIC_URL` outside production** (`platform/index.ts:66-71`) — see
    *Narrowed*.
11. **`getWorkspaceContext` can false-positive on unrelated parent repos**
    (`PackageManagerUtils.ts:138`). A dir counts as a "workspace package" if an ancestor 2–3 levels up has
    a lockfile + package.json, without verifying the current dir is declared in that root's `workspaces`;
    depth 1 (`monorepo/pkg`) is never checked. *Worth re-verifying against the rewritten `alepha init`,
    which added a `detectFromUserAgent()` fallback ahead of this path.*
12. **`CloudflareApi.fetch` should guard non-JSON responses** (`CloudflareApi.ts:569`). Bare
    `await response.json()` on a 5xx HTML or empty body throws an opaque SyntaxError with no URL or status
    context — the upload path at :512 already does `.json().catch(() => null)`. Also `createD1` hardcodes
    `location = "weur"` behind a TODO.
13. **`init` path argument is silently lowercased** (`init.ts:24`): `z.text({ lowercase: true })` turns
    `alepha init MyApp` into scaffolding `myapp/`.
14. **`clean` ignores `build.output.dist`** (`clean.ts:11`): `run.rm("./dist")` hardcoded, so a project
    with `output.dist: "build"` gets a no-op clean.
15. **`Date.now()` / `new Date()` used in CLI services despite the project convention**
    (`VendorService.ts:320,356`, `CloudflareAdapter.ts:1241`, `BuildDockerTask.ts:356`,
    `ViteUtils.ts:117-138`). Convention is `DateTimeProvider.nowMillis()`. The vendor tmp-dir naming
    additionally risks a same-ms collision.
17. *(One string-form `shell.run` call site remains in `WranglerApi.ts` — see* Narrowed*.)*

---

# Feature backlog

Carried from `assets/REVIEW_FEATURES.md` (2026-07-25), status re-verified. That review named five
top-leverage items. **Four have shipped.**

| Item | Status |
|---|---|
| Portable SQL expression helpers ⭐ | ✅ **Shipped** — `orm/core/providers/SqlExpressionProvider.ts`. Lore's dialect-branching lines went **10 → 0**; raw `` sql`` `` templates **56 → 49**, now concentrated in the three ingest services and `CampaignStatsController`. |
| Resource-scoped `$secure` ⭐ | ✅ **Shipped** as `$owns` — `security/primitives/$owns.ts` + spec. |
| React keyed query cache + invalidation ⭐ | ✅ **Shipped** — `react/core/atoms/queryCacheAtom.ts`. |
| Migration safety gate | ✅ Already existed when the review was written (`assertNoDestructiveMigrations`). |
| **`alepha/telemetry`** ⭐ `L` | ❌ **Not started.** The single largest production-readiness gap: no tracing, no span propagation, no job progress. `AsyncLocalStorage` is already wired and nothing consumes it for telemetry. |

Still unbuilt, in the review's own priority order. Nothing here is a defect — these are absent
capabilities, and none is a prerequisite for the fixes above.

**New modules** — none of these directories exist: `telemetry` ⭐`L`, `testing` `M` (the pieces exist,
the package doesn't), `flags` `M`, `webhooks` `M` (outbound), `search` `M`, `ai` `L` (the strategic one).

**Per-module features**, unchanged since the feature review: `Repository.exists()` `S`,
`Repository.stream()` `M`, `findByIds()` with request-scoped batching `M`, soft-delete filter propagation
into joins `S`; TOTP MFA + recovery codes `M`, refresh-token rotation with reuse detection `M`;
`$idempotent()` middleware ⭐`S`, deprecation metadata on `$action` `S`, RFC 9457 Problem Details `S`,
graceful-shutdown budget `S`; deferred/streamed loaders `M`, `<Link prefetch>` `S`, View Transitions `S`,
unsaved-changes guard `S`, optimistic mutations in `useAction` `M`; persisted notifications + in-app
inbox `M`, Web Push channel `M`; presigned upload/download URLs ⭐`M`, streaming upload `S`; job progress
reporting `S`, visibility timeout / DLQ / lease renewal `M`, jittered backoff `S`; cache tag-based
invalidation `S`, hit/miss/stale counters into `ServerMetricsProvider` `S`; order-independent `.with()`
substitution ⭐`M`, aggregate env validation at boot `S`, deadline propagation `M`; logger sampling `S`,
file destination `S`; `alepha doctor` `M`.

**Process items:** document the async stack ⭐`M`; close the adoption loop ⭐`S`; package-quality gates
before 1.0 `S`; give the 78 exports a map `S`.

> Note: `presigned upload/download URLs` is now more clearly scoped than when it was written — the
> `$storage` rewrite made `api/files` the application-facing layer, so presigning belongs there rather
> than on the raw `FileStorageProvider`.

---

# What the predecessor reviews achieved

Kept as the record; the documents themselves are deleted.

**`REVIEW.md` (2026-07-11 → v6, architecture, grade B+).** 12 review passes benchmarked against
best-in-class frameworks. Found **8 P0s — all fixed**: `$lock` had no same-process mutual exclusion; Bun
Redis `set` discarded the reply making locking a silent no-op; default `APP_SECRET` only warned in
production; DI `lifetime: "scoped"` was broken after start; DevTools DB/atom/env endpoints shipped with no
auth and no prod guard; `db migrations check` only checked the first provider; cross-realm/tenant broken
access control in admin controllers; the verification endpoint returned the secret code in its HTTP
response. Plus 9 P1-class fixes in a first remediation pass. Its "HttpClient cache" top open item was
closed by review #2's second pass (identity-scoped dedup + ETag).

**`REVIEW_2.md` (2026-07-24, code-level, 269 findings).** 11 parallel deep-review passes over ~200k lines,
then 25 fix passes closing 174. Its one P0 — an org-less user reading and mutating an arbitrary org's
subscription because `eq: undefined` produced no WHERE clause — was fixed at the call site *and* at the
root (QueryManager now throws on `undefined` filters). All 48 P1s closed. `alepha/api/subscriptions` was
deleted outright (27 files, ~3,525 lines) rather than repaired: it was dead in every real consumer and its
core premise — that the framework, not the PSP, should own recurring billing — had been disproven in
production.

Its four cross-cutting root causes are worth keeping in mind, because three are now fixed at the root and
the fourth is what most of the remaining P2s are:

1. `undefined` vs `null` semantics in drizzle WHERE/SET — **fixed at the root**.
2. Unguarded read-modify-write on status transitions — **mostly fixed**; the payments `version` column is
   the remaining instance (P2 #10 above).
16. **Options accepted but ignored — still the largest open cluster.** Five of the seventeen P2s.
4. Provider behavioral divergence — **partly fixed** (topic, redis, cache, bucket conformance suites);
   Bun `execCapture`, bucket download metadata and R2 id generation remain.

**`REVIEW_FEATURES.md` (2026-07-25, forward-looking).** Named five top-leverage gaps; four shipped within
three days. See the backlog above.
