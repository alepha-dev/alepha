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

| | Review #2 (2026-07-25) | Review #3 audit | Now |
|---|---|---|---|
| Open findings | 96 | 91 | **0** |
| P0 / P1 / P2 / P3 | 0 / 0 / 16 / 80 | 0 / 0 / 17 / 74 | **0 / 0 / 0 / 0** |

**The list is closed.** 80 fixed across nine batches, 5 retired by module rewrites, and 6 found to
describe intended behaviour or not to reproduce at all.

Test coverage went from 428 files / 4564 tests to **452 files / 4725 tests**. `yarn v` — lint,
typecheck, test, test:bun, check:deps, check:i18n, check:migrations, build, e2e — is green.

### Three bugs nobody had listed

Found while writing tests for something else, which is the argument for writing them:

- **The keyless codec did not round-trip an array of objects.** `{rows:[{a:"x",n:1}]}` decoded to
  `{rows:[["x",1]]}` — tuples where the schema promised objects. Latent (the codec is opt-in and
  nothing selects it), but silent.
- **R2's `download()` could be read only once.** Its `FileLike` exposed `stream()`/`arrayBuffer()`/
  `text()` over a single-use body while every other backend serves repeat reads. Live on Workers.
- **`@alepha/ui`'s control-select identified its action with `name`,** a field `useAction` accepts and
  never reads. `id` is what reaches the `react:action:*` events, so the identifier went nowhere.

### The one number worth remembering

**Six of 91 findings were wrong** — they described intended behaviour, or code that had already been
fixed, or a bug that does not reproduce. Two of those would have caused a regression if applied
blindly (`destroy`'s `deletedAt` stamp resurrects soft-deleted rows; `ArrayInputField.items` is
pinned by a test). Every fix here was reproduced first; that is what caught them.

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

## Batch 6 — 2026-07-28 — the websocket cluster

Review #2 declared this cluster out of scope. Taken as one piece here. Verified with a full `yarn v`.

| Area | Fix |
|---|---|
| websocket/node | **Room sockets are in the connection registry.** `handleRoomConnection` never called `this.connections.set`, so `getConnections()`, `getUserConnections()` and `closeConnection()` could not see room sockets and the stop hook's close-all loop skipped them. `wss.close()` on a `noServer` instance does not close established sockets, so shutting the server down tore rooms' TCP connections down abruptly — clients saw `1006`, not the `1001` "going away" every other connection gets. Registered as a thin adapter rather than a `NodeWebSocketConnection` (a room socket has no per-channel validation or send pipeline of its own), and deregistered on close. Four tests, all failing before. |
| websocket/RoomEngine | **Tick reentrancy guard.** An async `onTick` slower than `1000/tickHz` overlapped its own next invocation, and for an authoritative simulation two concurrent `state.step(dt)` calls corrupt the world. The loop now skips the beat and warns — a room that cannot keep up is a capacity problem worth surfacing. Mirrors `CronProvider`'s `executing` guard. A synchronous `onTick` is unaffected. |
| websocket/RoomEngine | `call()` throws `AlephaError` instead of a bare `Error`, per the repo rule. |
| websocket/node | `reply({ exceptSelf })` no longer **mutates the caller's `exceptConnectionIds` array** — it `push`ed onto it, so a reused options object accumulated a new id on every reply. |
| websocket/cloudflare | `webSocketMessage` null-checks `deserializeAttachment()`, as `webSocketClose` already did. A frame arriving on a socket whose attachment is gone crashed the connection with `1011`. |
| websocket | **Dead `$websocket` option `provider?: any` removed** — nothing read it; registration always uses the injected `WebSocketServerProvider`. |

### One finding was invalid

**`(this.options as any).mqtt` in `$topic` is correct, not an escape hatch.** The finding says the
option is "not in `TopicPrimitiveOptions`, no augmentation in-tree". The augmentation *is* in tree —
`@alepha/mqtt`'s `MqttTopicProvider` declaration-merges `mqtt?: MqttTopicSettings` onto
`TopicPrimitiveOptions`, `TopicPublishOptions` and `TopicSubscribeOptions`. Core cannot import an
optional satellite package to see it, so the cast is the right pattern for reading an optionally
augmented field from the module that declares the base interface. Documented in place so it is not
re-reported.

**Still open in websocket (4):** a second `subscribe` to one room clobbers the first handler,
headless `$room` engines are never evicted, there is no ping/pong heartbeat, and three of the minor
nits remain (backoff jitter applied after the max clamp, `WorkerProvider` re-pushing consumers on
restart, Cloudflare `closeConnection()` a silent no-op).

## Batch 7 — 2026-07-28 — orm (5 of 10 closed, two findings corrected)

Verified with a full `yarn v`.

| Area | Fix |
|---|---|
| orm | **`distinct` + `with` is refused instead of returning garbage.** `rawSelectDistinct` selects a flat field map while the join post-processing expects drizzle's nested per-table row shape, so `row[tableName]` was undefined and the mapping quietly produced junk (it returned `[]`). Now throws, naming both escapes. |
| orm | **`updateMany` no longer stamps `updatedAt` onto the caller's patch object** — a reused patch carried a stale timestamp into the next call. Shallow-copies first. |
| orm | **`upsert` survives a SET clause that would otherwise be empty.** When the conflict target is the only field supplied and the entity has no `updatedAt`, removing the target and the PK left `{}` and drizzle rejected the statement outright (`No values to set` — reproduced). The target is now set to itself: a no-op UPDATE that keeps `ON CONFLICT DO UPDATE` valid and, unlike `DO NOTHING`, still RETURNs the conflicting row the caller expects. |
| orm | **FK errors no longer assume a DELETE.** A dangling reference from an INSERT/UPDATE (`is not present in table`) is the other direction of the same constraint and was reported as "Cannot delete …", sending readers after a delete that never happened. Postgres now distinguishes the two; SQLite reports a bare `FOREIGN KEY constraint failed` with no direction, so its message names both possibilities rather than picking one. |
| orm | **`index.browser.ts` lists `AlephaDateTime` under `imports`, not `services`** — it is a module, and every other entrypoint had it right. |

### Two findings were wrong

**`destroy` stamping `deletedAt` onto the caller's entity is deliberate, not a stray mutation.** I
"fixed" it and `testNoUpdateIfAlreadyDeleted` went red, which is how the intent surfaced: the test
does `destroy(entity)` then `save(entity, { force: true })`, and `save` nulls undefined fields — so
without the stamp the follow-up save writes `deletedAt: null` and **resurrects the row**. The
mutation keeps the in-memory object consistent with the row. Reverted, and the reason is now a
comment next to the line plus an explicit test, so it does not get "fixed" again.

**The `node:sqlite` raw-query aliasing finding does not reproduce.** The claim is that the
`db.prepare` shim rewrites user SQL to positional aliases (`__c0`, `__c1`, …), so
`repository.query()` on a JOIN comes back with the wrong keys. Five tests against a real sqlite
database — including the exact precondition the rewrite keys on, a JOIN whose column list has
duplicate *base* names — all pass against the unmodified tree. Either `query()` does not route
through the shimmed prepare, or `aliasSelectColumns` declines these statements. Not fixed; the tests
are kept as behaviour pins.

**Still open in orm (4):** the uuid-vs-slug PK type gap (needs a nominal uuid type), `columns` not
restricting the SQL projection, the per-repository `DbCacheProvider` being `new`'d/unbounded with a
`JSON.stringify` key, and `createMany` batches not being atomic.

## Batch 8 — 2026-07-28 — the high-value P3s and a dead-code sweep

Chosen by impact rather than by module. Verified with a full `yarn v`
(452 files, 4720 tests).

| Area | Fix |
|---|---|
| react/i18n | **Placeholder substitution rewritten as one regex pass.** The ascending `result.replace("$" + (i+1), args[i])` loop had two faults: `$1` was replaced before `$10` was ever considered, so `$10` matched the `$1` pass and became `args[0] + "0"`; and a *string* pattern replaces only the first occurrence, so a placeholder used twice was substituted once. A single pass also stops a substituted VALUE being rescanned, so a user string containing `$2` is inserted literally. **The first test I wrote passed by luck** — with args `A1..A10`, `"$10".replace("$1","A1")` yields `"A10"`, the right answer for the wrong reason; using distinct values exposed it as `"one0"`. |
| react/router | **`isActive({ startWith })` matches on a segment boundary.** A bare `current.startsWith(href)` made `/foo` active on `/foobar` and `/settings` active on `/settings-archive` — and this drives nav highlighting in every sidebar. |
| orm + api/users | **New `eqInsensitive` filter operator, and the auth path uses it.** Identifier lookups were written with `ilike`, which is a *pattern* match: `_` matches any single character and `%` any run of them, so a raw user-supplied value was a wildcard expression — `admi_` matched `admin`, `admix`, … and `findOne` picked one arbitrarily. `eqInsensitive` is `LOWER(col) = LOWER(value)`: equality with case folding and no metacharacters, mirroring the `(realm, LOWER(username))` unique index that guards it. Migrated the five identifier lookups (login, two availability checks, registration, the username slugger). The admin *search* keeps `ilike` — there a pattern is the point. One test deliberately pins the old wildcard behaviour so the reason the operator exists stays visible. |
| cli | **`db migrations check` no longer crashes on an empty journal** — it read `.idx` off `undefined` instead of saying "no migrations recorded yet". |
| cli | **`--compile` wins over `docker.compile: false`.** `flags.compile ? (current.docker?.compile ?? true) : false` let a config value swallow an explicit flag, because the `?? true` only rescued `undefined`. |
| cli | **`CLOUDFLARE_SERVICES` parse failure names the variable and the input** instead of throwing a bare `SyntaxError`. |
| cli | **Cloudflare and Vercel honour `output.public`.** Both hardcoded `"public"`, so a project configuring a different directory silently shipped a worker with **no static assets**. Now `ctx.options.output?.public ?? "public"`, the pattern every other build task already used. |

### Dead-code sweep

Deleted, each verified unreferenced first: `FileError` (extended a bare `Error`, violating the repo
rule, and was exported from three barrels with zero usages), `cli/core/commands/gen/resource.ts` (a
TODO-only stub, imported nowhere), the exported types `CreateTokenOptions` and `ServiceAccountStore`,
`NodeFileSystemProvider`'s `_buffer` (declared in the return type, set to `null`, never written), and
`McpServerProvider.initialized` (assigned once, never read).

**One "dead" field was not dead.** `UseActionOptions.name` is accepted and never read by `useAction`
— but `@alepha/ui`'s control-select passes `name: "select:loader:init"`, clearly meaning it as the
action's identifier. `id` is the field actually threaded into the `react:action:*` events, so that
identifier was reaching nothing. Fixed the consumer to use `id` and then removed `name`.

### Also found while fixing

- **A stray `packages/alepha/copy/` appeared mid-session** — a byte-identical mirror of `packages/alepha/src/` (327 spec files), untracked and not gitignored. Vitest collected it, so the suite ran twice against a stale second copy and reported failures that did not exist in `src`. **I could not identify what wrote it**: it is not `scripts/build.ts`, `copy-swagger.ts` or `gen-docs.ts`, and a later `yarn build` did *not* recreate it. Removed. Whatever the source, `packages/alepha/copy/` deserves a `.gitignore` entry and a vitest `exclude` — the same defence the config already has for `**/.claude/**` worktrees, and for the same reason.

---

## Batch 9 — 2026-07-28 — everything remaining

The last 53. Verified with a full `yarn v` (452 files, 4725 tests).

| Area | Fix |
|---|---|
| websocket | **A second `subscribe` to one room no longer clobbers the first.** `Map<roomId, handler>` became `Map<roomId, Set<handler>>`, dispatch fans out to all of them, and unsubscribe drops the room only when its last subscriber leaves. The reconnect now fires **only for a room new to the connection** — a second subscriber to an already-joined room used to tear down the live socket, so every other component on it saw a disconnect for nothing. |
| websocket | **Headless `$room` engines are evicted.** Engines were removed only on the socket-close path, so a room reached solely through `call()` was never collected — unbounded for an id-per-user pattern. A sweep disposes socket-less engines idle past a 5-minute TTL; engines with sockets are never touched. |
| websocket | **Liveness heartbeat.** 30-second ping; a socket that ignored the previous ping is terminated. Half-open connections used to linger forever, counting against `maxConnectionsPerUser` (locking a user out of their own account) and holding room tick loops alive for a client that was gone. Shares the sweep timer, `unref`'d so it cannot hold the process open. |
| retry | **Backoff jitter is clamped.** It was applied *after* the max clamp, so a delay already at `backoff.max` came out 1.5× it — `max` was not a maximum. |
| queue | `WorkerProvider.register` de-duplicates, so a second start/stop cycle in one process no longer runs every consumer twice. |
| websocket/cloudflare | `closeConnection()` warns instead of returning silently. Connections live inside room Durable Objects and the main isolate holds no handle — a no-op that looks like success is worse than one that says what it is. |
| core | **`parseEnv` `$KEY` templating** got word-boundary matching (an undeclared `$PORTX` is no longer rewritten by a declared `PORT`) and `$$` escaping, so a password containing `$PORT` can survive. |
| core | **`AlephaCore` hoisted to a shared file.** It was defined byte-identically in the node and workerd entrypoints and absent from browser/native, so isomorphic code importing it compiled server-side and broke in the browser bundle. Build stays circular-dep clean. |
| core | **Scoped DI warns once** when it falls back to a singleton because no AsyncLocalStorage context is active — silent before, which turned "per-request isolation" into a cross-request singleton on a server. Browser builds stay quiet, where the fallback is expected. |
| orm | **`columns` narrows the SQL projection**, not just the schema `clean()` uses — a wide table paid full row I/O for a two-column read. Joins keep `SELECT *`, which the join mapper needs. |
| orm | `DbCacheProvider` is injected rather than `new`'d, so it is substitutable and no longer one unbounded Map per repository. |
| api/users | **`checkUsernameAvailability` is case-insensitive and realm-scoped**, matching the `(realm, LOWER(username))` unique index — it reported "available" for `Admin` when `admin` existed, then the registration 409'd, and it searched every realm. |
| api/users | **Password reset has a per-IP cap.** The per-target cooldown is scoped to `(type, target, purpose)`, so one IP could request resets for thousands of *distinct* real addresses — an email-bombing primitive aimed at other people's inboxes. Over the cap it returns the same shape as success, so it reveals nothing. |
| api/audits | **`getStats` aggregates in SQL.** It loaded every row in range and counted in JS — O(rows) memory on an admin endpoint over a table whose whole purpose is to grow. |
| api/files | `purgeFiles` deletes with bounded concurrency (10) instead of firing `Promise.all` over the entire backlog at the storage backend and the database at once. |
| api/jobs | `retryExecution`'s push branch carries `organizationId` and the trigger attribution across, so a retried tenant notification keeps its org scoping. |
| api/payments | Admin permissions gained `admin:payment:*` alongside the legacy `payments:*` names, so a role granting `admin:*` covers the surface. |
| cache | `$cache.incr()` respects the same `disabled`/`enabled`/lifecycle gate as `read()`/`set()` — a disabled cache was still mutating the store, and on KV it threw before the binding existed. |
| cache/KV | The non-atomic `incr` is now documented as such on the method, with what it is and is not safe for. |
| bucket/R2 | **File ids derive from the MIME type**, like S3 and Local. R2 took everything after the last `.` of the user-controlled filename, so `"x.png/../y"` produced the extension `"png/../y"` — attacker-shaped nested keys, and two backends disagreeing on the scheme for the same upload. |
| email/sms | The `email:sending` / `sms:sending` hooks no longer declare a `variables` payload they always filled with `{}`. |
| security | The resolver catch-all logs at debug before trying the next realm. Trying the next one is correct; swallowing a tenant mismatch or malformed bearer with no trace was not. |
| server | `/api/_batch` answers **400** for an over-size batch instead of 500 — the caller sent too many entries, which is not a server fault. |
| cli | `pwa.offline` removed (declared, documented "not implemented", never read); `BuildPwaTask` registered in the module and barrel; `db push --dry-run` uses typed optional `connect?()`/`close?()` on `DatabaseProvider` instead of `as any`; `platform()` only sets a production `PUBLIC_URL` in production and skips wildcard domains; `CloudflareApi.fetch` reports a non-JSON response with URL, status and body snippet; `init` no longer lowercases the path; `clean` honours `output.dist`; `Date.now()`/`new Date()` replaced with `DateTimeProvider` across the CLI services; `runAlepha` closes the previous Vite dev server instead of orphaning it. |
| cli | **`getWorkspaceContext` verifies membership.** Any ancestor with a lockfile counted as "our workspace root", so `alepha init` inside an unrelated repo skipped git init / AGENTS.md / PM setup and installed into that repo's root. It now checks the root's `workspaces` patterns actually declare the directory, and finally checks depth 1. Six tests. |
| command | The flag parser accepts negative numbers (`--count -5`) and a `--` terminator. |
| command | `printHelp` restores the logger format in a `finally` — it flipped to `raw` permanently, and since `help()` is handed to command handlers, every later log lost its timestamp and level. |
| command | Env-var help reads `schemaMeta`, so descriptions on wrapped (`.optional()`) schemas render instead of coming out blank. |
| command | `EnvUtils` documents that it loads `.local` for *every* file given, and narrows its catch to ENOENT — an unreadable `.env` (EACCES) used to look exactly like an absent one. |
| mcp | Prompt/resource validation failures answer **-32602 Invalid params** rather than -32603 Internal error. `McpInvalidParamsError` existed, was exported and unit-tested, and was never thrown. |
| react | The unmatched-route synthetic layer uses the non-throwing `findRoute()`; `page()` throws for unknown names, so the `?.` guarded nothing. |
| react | A loader redirect forwards `replace`, so history stops growing an entry that immediately redirects again. |
| react | A debounced `run()` settles when superseded, cancelled or unmounted — the promise was resolved only inside the timeout, so `await action.run(...)` hung forever. |
| react | `useInject` keys its memo on `service`; the dev error page no longer renders wall-clock time (an SSR hydration mismatch); and the fake "backpressure" check is gone rather than left looking like it does something. |


# Open findings

**None.** All 91 findings from the re-audit are resolved: 80 fixed, 5 retired by module rewrites, and
6 found to describe intended behaviour or not to reproduce (listed below, so they are not re-raised).

## Findings that were wrong

These are the ones worth remembering — each cost real time, and each would have been a regression if
"fixed" blindly. **Reproduce before fixing** is the lesson the whole exercise paid for.

| Finding | What was actually true |
|---|---|
| `FormValidationError` is exported but unusable | It works end to end. `useFormState({ form, path }, ["error"])` already matches `error.value.path`. Escalated in error, then retracted; a spec now pins it. |
| Bun `execCapture` diverges from Node | Already closed by review #2's own third pass — the POSIX single-quote escaping made every token a literal argument on Node too. A seven-case table now pins both runtimes. |
| `$topic`'s `(options as any).mqtt` is an undeclared escape hatch | The augmentation is in tree: `@alepha/mqtt` declaration-merges `mqtt` onto `TopicPrimitiveOptions`. Core cannot import an optional satellite, so the cast is the correct pattern. |
| `destroy` mutates the caller's entity with `deletedAt` | **Load-bearing.** The follow-up `save(entity, { force: true })` nulls undefined fields, so without the stamp the row is resurrected. `testNoUpdateIfAlreadyDeleted` is what caught it. |
| `ArrayInputField.items` is a permanently empty typed surface | Intentional and tested. The model cannot know the row count; the property is always an array so consumers can `.map()` without a null check. |
| `node:sqlite` shim renames columns of raw JOIN queries | Does not reproduce. Five tests against a real sqlite database — including the exact duplicate-base-name precondition — pass unmodified. |

Two more turned out to be *partly* wrong: the `ServerRequest.user` cast in the React server provider is
the same correct declaration-merging pattern as the mqtt one, and the logger's "suppressed levels still
emit" is deliberate — the event is what feeds the devtools log viewer, so early-returning would starve it.

## Deliberate non-fixes

- **`primaryKey` cannot distinguish a uuid PK from a slug PK at the type level.** `z.uuid()` and
  `z.text()` are both `ZodString`; closing it needs a nominal uuid type in the schema layer, which is
  a design change rather than a patch. The runtime is already correct — a slug PK that omits its id
  fails validation instead of reaching the driver.
- **`createMany` batches are not atomic.** Documented rather than silently wrapped: an implicit
  transaction around an arbitrarily large insert has its own costs (lock duration, WAL growth), and
  the caller wrapping in `$transactional` is better placed to decide.
- **`runAlepha`'s `ssrLoadModule` dev-server hack.** Acknowledged Vite debt; the *leak* it caused (a
  second call orphaning the first server) is fixed, the approach is not.

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

Its four cross-cutting root causes, with where they stand now:

1. `undefined` vs `null` semantics in drizzle WHERE/SET — **fixed at the root** (QueryManager throws).
2. Unguarded read-modify-write on status transitions — **fixed**; payments was the last instance
   (batch 2 folded the expected status into the WHERE clause).
3. Options accepted but ignored — **fixed**; all five were closed in batch 1.
4. Provider behavioral divergence — **mostly fixed** (topic, redis, cache and bucket conformance
   suites; Bun/Node shell parity pinned on both runtimes; R2 now serves repeat reads like its peers).
   Remaining: bucket download metadata still differs per backend, and R2 derives its file-id extension
   from the filename where S3 uses the MIME type.

**`REVIEW_FEATURES.md` (2026-07-25, forward-looking).** Named five top-leverage gaps; four shipped within
three days. See the backlog above.
