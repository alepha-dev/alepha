# Alepha Framework — Full Code Review

> **Scope:** `packages/*` (the `alepha` unified package + `@alepha/*` satellites).
> **Date:** 2026-07-11. **Reviewed commit:** post `c7f03045` (worktree clean at review time).
> **Overall grade:** **B+** — A-/A design and breadth, dragged down by (a) correctness bugs in the
> concurrency / distributed primitives, (b) "docs oversell the contract" gaps, and (c) an
> **access-control / tenant-isolation** cluster in the `api/*` layer. **8 P0s** total; almost every
> one is a localized fix. Engineering is A-grade; the recurring weak axis is security-by-default.
>
> **Start here:** the **Fix roadmap** (Phase 0 security hotfixes → Phase 3 structural gaps) sequences
> everything below into shippable phases. The **How Alepha is used** and **Framework gaps revealed by
> Lore** sections carry the "good stuff / big problems" ground-truth from the flagship app.
>
> ### Progress (as of v5, 2026-07-14)
> **All 8 P0s are ✅ FIXED.** A first remediation pass (v5) then shipped **9 P1-class fixes** — ORM
> `paginate`, the two Cloudflare prod bugs, the cascade-`DROP TABLE` migration guard, typecheck
> coverage, and the React reactivity cluster. Fixed findings are marked `✅ FIXED` inline with a
> **Status:** note; **the original finding text is left intact below each one** so the reasoning stays
> auditable. Three pieces of this document's own advice turned out to be wrong and are corrected in
> place — read the **Status:** notes, not just the finding, before acting.
>
> **What to do next (highest severity first):**
> 1. **Fix roadmap → Phase 0, items 5–8** (`verifyCode`, OAuth scope intersection, `skipTrial`,
>    tenancy fail-closed). These sat in the *security hotfix* phase alongside the P0s and were never
>    done. None affects Lore, which is likely why — but they ship in framework code.
> 2. **HttpClient cache** (identity-scoped key, opt-in reads, invalidation) — a genuine cross-user
>    leak; needs a policy decision, not a guess.
> 3. **Phase 1 item 13** — the `$job` engine (long-`delay` overflow, dedup race, lease renewal).
>
> **Update history:** v2 added the full `api/*` deep review. **v3** adds deep second passes over
> `react/*` and `cli/*` (finding new bugs the first passes missed) and a study of `apps/lore` (the
> first Alepha app) for real-usage evidence — good idioms, and the framework gaps the app works
> around. Plus the Fix roadmap. **v5** is the first remediation pass. See the *Change log* at the bottom.

---

## How to read this document (for agents)

- Findings are ranked **P0** (exploitable / silent data corruption / a safety gate that lies),
  **P1** (important correctness or security), **P2** (polish / hardening).
- Every finding cites `file:line` at the reviewed commit. **Line numbers drift** — treat them as
  anchors, grep the described code to confirm before acting.
- **Verification status** on each finding:
  - `REPRODUCED` — a throwaway test was written and run; the bug is demonstrated, not inferred.
  - `SOURCE-CHECKED` — the exact lines were read by the lead reviewer (not just a sub-agent).
  - `RELAYED` — reported by a specialized review pass at high confidence, not independently re-read.
- House conventions that are **intentional** (do not "fix" these): `protected` instead of `private`;
  never `vi.mock`; errors must extend `AlephaError`; time via `DateTimeProvider` (except inside
  `core`/`datetime` themselves); no standalone functions in service files; one schema per file;
  React uses `$atom`+`useStore` not Context; `$route` never lives under `/api`.

## Method

12 review passes over `packages/*`, each deep-reading its slice and benchmarking against the
relevant best-in-class framework. 10 ran as parallel deep-read agents; the **server** and **api**
passes were interrupted by a session limit and were completed directly by the lead reviewer (their
grades are marked *provisional* where coverage was partial). Every P0 and the highest-stakes P1s
were re-checked against source; two were reproduced with live tests.

---

## Module scorecard

| Module / package | Grade | One-line verdict |
|---|---|---|
| `core` + logger/datetime/retry/batch/fake/background | **B+** | Crown-jewel DI & compiled events (A- alone); scoped-lifetime, throttle, travel, parseEnv bugs. |
| `server` / router | **B+** *(provisional)* | Excellent body parser (decompression-bomb safe), safe context isolation, clean `$action`. |
| `api` / `$action` core + batch | **B+** | Clean primitive; `/api/_batch` correctly preserves per-action authz (verified). |
| `api/jobs` (`$job` engine) | **B+** | Durable outbox + atomic claim + sweep recovery; long-delay overflow, long-job double-run, dedup race. |
| `api/users` (identity/auth) | **B-** | Solid credentials & lockout; **P0 cross-realm admin takeover**; OAuth unverified-email link; no refresh rotation. |
| `api/oauth` (OAuth server) | **B-** | Good PKCE/redirect-match; **unscoped full-session tokens**, no scope intersection, process-local code single-use. |
| `api/verifications` | **D** | **P0: endpoint returns the secret code** (mounted by default); `verifyCode` accepts any code once verified. |
| `api/subscriptions` | **C-** | `skipTrial` = free paid plan; double-issued intents → double charge; proration computed, never billed. |
| `api/notifications` | **B-** | Clean outbox-over-jobs; `sensitive` flag never redacts → secrets at rest; tenant fail-open. |
| `api/files` | **B** | New `FileAccessProvider` creator-gate is a good IDOR fix; upload-to-any-bucket + client MIME → stored XSS. |
| `api/keys` | **B+** | Hashed 192-bit keys, ownership-checked revoke; stale role snapshot, 15-min revocation lag. |
| `api/parameters` | **B** | Careful per-org cache keying; client `schemaHash` bypasses validation; a GET performs writes. |
| `api/audits` | **B-** | Admin-gated; actor is forgeable, log freely deletable (no WORM), `getStats` loads whole table. |
| `api/organizations` | **C** | A bare `name/slug` table — no membership/roles/invitations; not actually a tenancy model. |
| `orm` | **B** | A- machinery; concurrency-tx, null-where, upsert-tenant footguns reachable from app code. |
| `react` / SSR | **B+** | Streaming SSR + supersession are A-; deep pass adds error-boundary-never-resets, non-type-safe hydration, hash-strip. |
| `react` / HttpClient cache | **B-** | Process-global, URL-only key, unconditional read, no invalidation → staleness + cross-user-leak footgun. |
| `security` / crypto / captcha | **B-** | Solid AEAD & tenant-binding; loose JWT verify defaults; warn-only default secret. |
| `queue`/`topic`/`lock`/`scheduler`/`redis`/`cache` | **C+** | Great cache & DX; distributed guarantees don't survive adversarial reading. |
| `bucket`/`email`/`sms`/`command`/`mcp`/`system` | **B / B-** | Spec-current MCP; shell-injection & fileId-traversal; email "templates" are vapor. |
| `cli` / build pipeline | **B+** | Novel embedded toolchain, secret-safe client bundle; routes-clobber, no queue DLQ, root containers, CF `waitUntil` global. |
| `cli` / dev-server + commands | **B+** | Real reload state machine; reentrancy race, boot hard-crash, `verify` skips co-located tests, `--mode` arg leak. |
| `@alepha/ui` | **B+** | A- blocks, C+ verification; a11y wiring & i18n split-brain; no typecheck script. |
| `@alepha/sigil` | **A-** | Best-architected satellite; strict redirect whitelist, strong tests. Minor salt gap. |
| `@alepha/payments-stripe` | **B** | Correct, edge-safe webhooks & integer cents; zero tests, 2 raw-`Error` breaks. |
| `@alepha/payments-mollie` | **B-** | Sound URL-secret webhooks; 100× zero-decimal currency bug; zero tests. |
| `@alepha/devtools` | **C+** | Polished UI, disciplined polling; unguarded DB-mutation endpoints, stub tests. |
| cross-cutting build/packaging/types | **B+** | Sophisticated exports map; **zero** `@ts-ignore`; typecheck skips 5 workspaces; circular-dep detector blind to `*/core`. |

---

## P0 — Fix first

### P0-1 · `$lock` provides no same-process mutual exclusion · `REPRODUCED` · ✅ FIXED
- **Status:** FIXED (middleware) — the lock id is now generated inside the per-invocation closure, not
  at composition time, so concurrent calls get distinct ids and `SET NX GET` correctly rejects
  contenders. Added `lock-mutual-exclusion.spec.ts` (3 concurrent calls → `maxConcurrent === 1`,
  previously 3). NOTE on `LockPrimitive` (~:414): its lazy `this.id` is a per-*instance* replica
  identity, which is correct/intended for cross-replica scheduler dedup — within-instance overlap is
  the scheduler's responsibility (CronProvider's `executing` flag). Not changed; different semantics
  from the middleware. The lock-release-after-expiry (P1) is a separate follow-up.
- **Follow-up:** now that the lock actually contends, `$scheduler` surfaced a latent bug — it treated
  `LockAcquireError` (another runner holds the tick's lock) as a `scheduler:error` instead of a normal
  dedup skip. Fixed: contention is now a quiet skip (`$scheduler.ts`); `LockAcquireError` is exported
  from `alepha/lock`. (Also settled a `travel()`-fired fire-and-forget cron race in `FileJobs.spec.ts`.)
- **File:** `packages/alepha/src/lock/core/primitives/$lock.ts` (middleware closure).
- **Mechanism:** the lock id is `crypto.randomUUID()` created in the middleware handler body, which
  runs **once when the pipeline is composed** (`$pipeline.ts:115` memoizes `this.wrapped`). All
  invocations share one id. The acquire is `SET NX GET`; when the key already exists it returns the
  existing value, whose `lockId` equals the shared id, so `lockId === id` passes and the second
  concurrent caller enters the critical section.
- **Reproduction:** a service with `run = $lock({name:"critical"})` and
  `critical = this.run(async () => {...50ms...})`, bound with `.with({provide: LockProvider, use:
  MemoryLockProvider}).with(AlephaLock)`, then `Promise.allSettled([critical(), critical(),
  critical()])` → **all three entered simultaneously (`maxConcurrent = 3`)**. Note: a bare
  `Alepha.create()` without the lock module has no `LockProvider.set` and throws — you must register
  `AlephaLock`.
- **Blast radius:** every `$lock` on an `$action`; and it is the **only** overlap protection for
  interval schedulers (`$scheduler` with `lock:true`) since `createInterval` is fire-and-forget.
  Cron is separately protected in-process by `CronProvider`'s `executing` flag; intervals are not.
- **Fix:** move `const id = crypto.randomUUID()` **inside** the returned per-invocation closure; in
  `LockPrimitive`, generate the id per `run()`.
- **Test gap:** `lock-edge-cases.spec.ts` only ever contends *different* instances. Add a
  same-instance `Promise.all([svc.fn(), svc.fn()])` test.

### P0-2 · Bun Redis `set` discards the reply → locking is a silent no-op under Bun · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — `BunRedisProvider.set` now captures the command reply and mirrors
  `NodeRedisProvider`: returns the written value on `"OK"`/nil, otherwise returns the prior value from
  the `GET` option (as a Buffer). This restores the `SET … NX GET` contract the `$lock` protocol
  depends on. NOTE: the Bun path still needs NX/GET coverage under `test:bun` (needs a Bun+Redis
  runtime); the fix mirrors the Node path which is tested. The binary-arg encoding
  (`buf.toString("binary")`) for large/compressed cache payloads is a separate, lower-severity concern
  left as-is.
- **File:** `packages/alepha/src/redis/providers/BunRedisProvider.ts` (the with-options branch).
- **Mechanism:** the lock protocol depends on `SET … NX GET` returning the **current holder's**
  value (`RedisLockProvider.ts:16`, comment: *"all the secrets of $lock is based on this"*). Node's
  adapter returns `Buffer.from(resp)` correctly (`NodeRedisProvider.ts:178`); Bun's returns `buf` —
  the caller's own value — so every contender parses `lockId === id` and believes it acquired.
- **Blast radius:** under Bun (the default binding, `redis/index.bun.ts`), every `$lock`, scheduler
  dedup, and migration guard runs on **all instances concurrently**. Also `args` encodes the value
  as `buf.toString("binary")` (~:158) which likely corrupts binary/compressed cache payloads on the
  with-options path.
- **Fix:** capture and return the actual command reply (nil → `buf`); use a buffer-safe raw command.
- **Test gap:** `test:bun` runs only `*.bun.spec.ts`; `BunRedisProvider.bun.spec.ts` has **zero**
  NX/GET coverage, so CI can't see this.

### P0-3 · Default `APP_SECRET` only warns in production · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — `SecretProvider.configure` now throws `AlephaError` on start when
  `isProduction() && secret === DEFAULT_SECRET_KEY_VALUE` (still warns outside production). Added
  `crypto/__tests__/SecretProvider.spec.ts`; production-mode server specs now set a test `APP_SECRET`.
  **Follow-ups (same effort):** production-mode tests across the suite needed a test `APP_SECRET`
  (server, sigil), and `apps/playground`'s e2e webServer (which runs the production build via `node
  dist` with `NODE_ENV=production`) now injects one — otherwise the server correctly refuses to boot
  and Playwright times out. (lore/docs run `node dist` with `NODE_ENV` unset → non-production → warn,
  so they are unaffected.)
- **File:** `packages/alepha/src/crypto/providers/SecretProvider.ts` (default constant
  `"change-me-in-production"`).
- **Mechanism:** on a prod deploy that forgot to set `APP_SECRET`, HS256 JWTs are signed with the
  public constant and the `configure` hook merely `log.warn`s. The code comments *"can be changed to
  a hard error in a future release."*
- **Attack:** anyone forges `{sub, roles:["admin"]}`, signs with the known constant → full admin.
- **Fix:** throw `AlephaError` on configure when `isProduction() && secret === DEFAULT_SECRET_KEY_VALUE`.
  One-line severity flip; highest value in the security slice.
- **Test gap:** no test asserts prod + default secret errors (it currently can't).

### P0-4 · DI `lifetime: "scoped"` is broken after start · `REPRODUCED` (by the core pass) · ✅ FIXED
- **Status:** FIXED — the locked-container guard now fires only when instantiating into the **global**
  registry (`this.started && registry === this.registry`). A `scoped` inject targets the per-request
  registry (a fresh Map from `alepha.context.run`) and is stored only there, so it no longer throws
  `ContainerLockedError` after start. Added `scoped-after-start.spec.ts` (resolves after start, and
  isolates across forks); full core suite (425) still green, so the global-container lock is intact.
- **File:** `packages/alepha/src/core/Alepha.ts` (the post-start guard in `inject`).
- **Mechanism:** a scoped injection after `start()` falls into the locked-container guard and throws
  `ContainerLockedError`. The documented contract (`$inject.ts:40`: *"A new scope is created when
  Alepha handles a request"*) is unreachable at runtime — scoped injection only works pre-start.
- **Reproduction (core pass):** `alepha.fork(() => alepha.inject(X, {lifetime:"scoped"}))` after
  `start()` throws `ContainerLockedError: Container is locked… Attempted to inject 'ScopedThing'`.
- **Fix:** bypass the `this.started` guard when `registry !== this.registry` (instantiating into a
  request-scoped map doesn't mutate the global container). There is already a drafted TODO at
  `Alepha.ts:872` to warn-once on scoped fallback.
- **Test gap:** no test injects a scoped service after `start()`.

### P0-5 · DevTools DB / atom / env endpoints ship with no auth and no prod guard · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — the route-bearing providers were removed from the module's `services` array
  (which auto-injects *after* `register`, so a register-only guard was insufficient) and are now
  registered only inside a production-guarded `register` (`if (alepha.isProduction()) return;`),
  mirroring sigil. In production the `$route` fields never mount. Added `production-guard.spec.ts`
  asserting zero `/__devtools` routes in production and >0 outside it. (Defense-in-depth `$secure`/
  localhost gating on the handlers is a good follow-up but no longer load-bearing.)
- **Files:** `packages/@alepha/devtools/src/index.ts` (module registration);
  `providers/DevToolsProvider.ts` (the route definitions, now only mounted in non-production).
- **Mechanism:** every route is a plain `$route` with `silent:true` (suppresses *logging* only, not
  access) and no `$secure`. Bodies are `z.record(z.text(), z.any())` passed straight to
  `repo.create`/`updateById`/`deleteById`, bypassing the app's own validation. Unlike `sigil`
  (`sigil/src/index.ts:38` — `if (!alepha.isProduction()) return;`), devtools has **no**
  `isProduction()` refusal.
- **Nuance (severity scoping):** today it is only wired by the dev-time CLI plugin
  (`packages/alepha/src/cli/devtools/index.ts:181`, inside `alepha dev`) — so it is **not exposed by
  the default flow**. The risk is that the package is published and its own JSDoc says *"Enable by
  importing this module in your WebModule"*; any app that follows the docs exposes, unauthenticated:
  arbitrary CREATE/UPDATE/DELETE on every entity, atom mutation (incl. security atoms), and cleartext
  env (secrets — the UI blurs them client-side, but `/api/metadata` returns them in clear).
- **Fix:** hard-refuse to register (or 404 in the handler) when `isProduction()`, plus a localhost /
  `$secure` gate — belt-and-suspenders like sigil.

### P0-6 · `db migrations check` only checks the first provider · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — the "no journal" / "no changes" branches now `continue` instead of `return`, so
  every provider is checked; drift is collected across all providers and reported before throwing (the
  error names every drifted provider); and the `--provider` filter is now honored. Test gap remains
  (db.ts has no direct tests — a two-provider memory fixture would lock this in).
- **File:** `packages/alepha/src/cli/core/commands/db.ts` (the `check` command loop).
- **Mechanism:** inside `for (const primitive of repositoryProvider.getRepositories())`, both "No
  migration journal found" and "No changes detected" call `return`, exiting the whole handler. A
  multi-provider app (Postgres + D1 sqlite — Lore's exact shape) gets drift-checked only on whichever
  provider iterates first; `yarn check:migrations` goes green while the sqlite migrations are stale.
- **Why it matters:** given the known D1 cascade-on-DROP-TABLE wipe hazard, a false-negative drift
  gate is the worst place for this bug. `flags.provider` (`:45`) is declared but never honored in
  `check`; the positional `path` arg is accepted and silently ignored.
- **Fix:** `continue` instead of `return`; collect failures across all providers; report after the loop.
- **Bonus (both passes suggested):** add a guard that flags a destructive `DROP TABLE` in a new
  migration — the natural automated defense for the D1 hazard that today relies on human review.
  **✅ DONE** — `alepha db migrations create` now snapshots the migrations dir before running
  drizzle-kit and refuses (throws `AlephaError`) if any **newly created** file contains a `DROP TABLE`
  (`--`-comment lines and trailing comments are ignored; pre-existing migrations are never re-flagged).
  The generated file is deliberately left on disk — the point is to force a human to read it; if the
  drop is intended, keep it and re-run (no schema diff → nothing regenerated → the guard stays quiet).
  `DbCommand.spec.ts`, 5 tests. This retires the fear-based grep gate in `apps/lore/CLAUDE.md`.

### P0-7 · Cross-realm/tenant broken access control in admin controllers · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — added `SecurityProvider.assertRealmScope(user, requestedRealm)`, which binds the
  target realm to the authenticated caller's realm (omitted → caller's realm; a *different* realm →
  `ForbiddenError`). Applied to every `userRealmName`-taking handler in `AdminUserController`,
  `AdminSessionController`, and `AdminIdentityController`. A realm-A admin can no longer act on realm-B
  users/sessions/identities via `?userRealmName=B`. `UserController` (public/self-service, where the
  client legitimately names its realm for unauthenticated registration/reset) is intentionally left
  as-is. Added `assertRealmScope.spec.ts`; users suite (201) green. (Single-realm apps like Lore are
  unaffected — no realm claim, no restriction.)
- **Files:** `security/providers/SecurityProvider.ts` (`assertRealmScope`); the three `Admin*Controller.ts`.
  `api/users/services/UserService.ts` (`getUserById(id, userRealmName) => this.users(userRealmName)
  .getById(id)`) selects the **target** realm's repository from that param.
- **Mechanism:** the admin `$action`s guard with `$secure({ permissions: ["admin:user:*"] })` but set
  **no `issuers`**, so `checkIssuers` never runs (`$secure.ts` issuers is optional); and
  `SecurityProvider.checkPermission` (`SecurityProvider.ts:~500`) only asks "does this user hold the
  permission?", never "for which realm?". `resolveUserFromServerRequest` even tries resolvers from
  **all** realms (`SecurityProvider.ts:445`). So the target realm is fully attacker-chosen.
- **Attack:** in a deployment that uses **realms as tenant boundaries** with per-realm admins (a
  supported config — `RegistrationService.spec.ts:764` "Cross-realm email uniqueness" confirms realms
  are isolated tenants), a realm-A admin calls `GET/PATCH/DELETE /api/users?userRealmName=B`, and the
  password/session equivalents, to fully read, modify, delete, and **re-password** realm-B accounts →
  cross-tenant account takeover.
- **Precondition:** realms-used-as-tenants with per-realm admins. Apps that use the `organizations`
  module for tenancy (not realms) are less affected, but the hole is in shipped framework code.
- **Fix:** derive the operating realm from the authenticated token (`user.realm`), not the query
  string; or enforce `$secure({ issuers: [...] })` + realm-scoped `checkPermission`; at minimum reject
  when `user.realm !== userRealmName`.
- **Test gap:** no spec creates two realms and asserts a realm-A admin token is rejected on
  `?userRealmName=B` — the single most important missing test in the api layer.

### P0-8 · Verification endpoint returns the secret code in its HTTP response · `SOURCE-CHECKED` · ✅ FIXED
- **Status:** FIXED — the public token-returning `requestVerificationCode` `$action` was **removed**
  from `VerificationController` (only the no-leak `validateVerificationCode` submission endpoint
  remains). Verification requests are now driven server-side: `RegistrationService`/`UserService` call
  `VerificationService.createVerification` directly (as `CredentialService` already did) and deliver
  the code via their own notifications — the raw token never crosses the wire. Converted the
  verification specs to drive creation through the service. `requestVerificationCodeResponseSchema`
  remains exported (harmless dead export) to avoid a breaking export change. Users (201) + verification
  (16) tests green.
- **Files:** `api/verifications/controllers/VerificationController.ts` (action removed);
  `api/users/services/{RegistrationService,UserService}.ts` (now use the service directly).
- **Mechanism:** the `createVerification` *service* returning the token is by-design for an internal
  caller that sends it out-of-band. The bug is the **controller exposing it over unauthenticated
  HTTP** — unlike the devtools P0 (not mounted by default), this endpoint is live the moment the
  module is loaded.
- **Attack:** `POST /api/verifications/email {target:"victim@x"}` → response contains `token` →
  `POST /api/verifications/email/validate {target:"victim@x", token}` → verified. Anyone verifies any
  email/phone they don't control; every downstream flow that trusts verification (signup, reset) is
  bypassed.
- **Fix:** `createVerification` must stay server-side; the controller must **send** the token via
  SMS/email and return only `{codeExpiration, cooldown, maxAttempts}` — never `token`. If the route is
  for internal callers, gate it with `$secure` and still strip `token`.

---

## P1 — Important

### Security / crypto

- **P1 · Refresh token replayable as bearer access token · `REPRODUCED`.**
  `security/primitives/$issuer.ts:321` (refresh minted with header `typ:"refresh"`),
  `providers/SecurityProvider.ts:114` (default resolver `jwt.parse(token, realmName)` pins no `typ`/
  `aud`), `providers/JwtProvider.ts:153` (`jwtVerify` gets no `audience`/`algorithms`). Access tokens
  are minted with no `typ` (`JwtProvider.ts:225`). A leaked/stored 30-day refresh token presented as
  `Authorization: Bearer <refresh>` verifies and resolves to the victim's real identity.
  **Reproduction:** resolving the refresh token via `resolveUserFromServerRequest` returned a user
  with the real `sub` id and `realm:"issuer"`. **Nuance:** `roles:[]` (refresh tokens carry no
  `roles` claim), so this is **not** admin-escalation — it is full identity assumption for the refresh
  lifetime, granting access to any endpoint gated only by "is authenticated" or ownership-of-`sub`.
  Compare the refresh *verification* path (`$issuer.ts:436`) which correctly pins `typ`/`audience`/
  `subject` — copy that template to the access path.
  **Fix:** mint access tokens with an explicit `typ` (e.g. `at+jwt`) and reject `typ==="refresh"` on
  the access path; pass `audience: realmName` and `algorithms: [...]` to `jwtVerify`.
- **P1 · Access-token verify enforces no `audience`/`issuer` and no `algorithms` allowlist.**
  `JwtProvider.ts:153`. In a multi-realm app where two realms resolve to the same secret (e.g. both
  fall back to `APP_SECRET`), a token minted for realm A can be accepted by realm B —
  `resolveUserFromServerRequest` tries resolvers from **all** realms (`SecurityProvider.ts:445`).
  jose already rejects `alg:none`, so classic confusion is mitigated, but pinning is cheap insurance.

### ORM

- **P1 · Implicit tx stored by mutating the current ALS layer → concurrent cross-contamination.**
  `orm/.../DatabaseProvider.ts:216`. `Promise.all([a(), b()])` inside one request where both call
  `$transactional()` → both see `existing === undefined`, both open txs, both write
  `"alepha.orm.tx"`; the first `finally` clears the key while the second tx is live. Outside a fork
  (`als.exists()` false — scripts, custom hooks) the tx lands in the **global app store** and every
  concurrent request resolves it. Requests are forked (`$action.ts:462`) so the common path is safe,
  but the failure mode is silent data corruption. **Fix:** run `fn` inside a child fork; refuse/warn
  when `!als.exists()`.
- **P1 · `null`/`undefined` filter value silently drops the condition.**
  `orm/.../QueryManager.ts:182` / `:292`. `deleteMany({ userId: maybeNull })` compiles to `DELETE`
  with **no WHERE**; `findOne({where:{email:v}})` with `v==null` returns an arbitrary row. Pinned as
  intended in `QueryManager.spec.ts:148`. **Fix:** map explicit `null` → `isNull`; throw when a
  where compiles to zero conditions inside `updateMany`/`deleteMany` unless the caller passed `{}`.
- **P1 · `upsert` `ON CONFLICT DO UPDATE` bypasses tenant scoping + soft delete.**
  `Repository.ts:828`. `stampOrganization` stamps only the insert values; there is no `setWhere`. With
  a non-org-scoped unique key (e.g. `email`), tenant A's upsert updates tenant B's row — the one
  write path where `withOrganization` doesn't apply. Same hole updates soft-deleted rows.
- **P1 · `paginate` spread destroys the `+1` sentinel when `query.limit` is set · `SOURCE-CHECKED` · ✅ FIXED**
  - **Status:** FIXED — spread reordered to `{ ...query, offset, limit: limit + 1, orderBy }`. Added
    `testPaginationWithQueryLimit` to the shared `$repository` suite (runs on **both** sqlite and
    postgres); it fails on both without the fix (`isLast: true` with 15 rows still to come).
  `Repository.ts:545` — `this.findMany({ offset, limit: limit + 1, orderBy, ...query }, opts)`.
  `...query` overwrites `limit + 1` back to `limit`, and `createPagination` detects a next page only
  via `entities.length === limit + 1` (`createPagination.ts:54`), so `isLast` is **always true** for
  callers using `query.limit`. **Fix:** `{ ...query, offset, limit: limit + 1, orderBy }`.
- **P1 · SQLite `transactional` has no mutex on the single shared connection.**
  `NodeSqliteProvider.ts:134`. Two concurrent `transactional()` both issue `BEGIN` on the same
  `DatabaseSync` → the second throws, or interleaved awaited writes get committed/rolled back by the
  wrong context. Postgres is safe (pool connection per tx). **Fix:** per-connection async queue.

### Queue / lock / scheduler / cache

- **P1 · `$queue` (the raw transport) is at-most-once and its JSDoc oversells durability — but that
  durability lives in `$job`, not here. Fix the docs, don't reimplement.**
  `queue/.../WorkerProvider.ts:223` — the message is `RPOP`'d (`RedisQueueProvider.ts:45`); a handler
  error/crash loses it, the `catch` only `log.error`s. `$queue.ts:23`/`:46` claim "Built-in retry…
  Dead letter queues… persistence across restarts" — **none of that is in the queue layer.**
  **IMPORTANT framing correction:** all of that durability *does* exist in `$job` (see the `api/*`
  section), which is the layer you're meant to use for work that must not be lost. `$queue` is just
  the raw in-memory/Redis fan-out transport. **Fix:** de-market the `$queue` JSDoc to state
  at-most-once honestly and point to `$job`; optionally on workerd rethrow so CF Queues redelivers.
- **P1 · Unconditional lock release can delete another holder's lock.**
  `$lock.ts:120` (`finally { del(name) }`, no owner check). Handler overruns TTL → key expires → B
  acquires → A's `finally` deletes B's lock → C enters while B runs. The value already contains the
  owner id — it's just never checked. **Fix:** compare-and-delete via a Lua script
  (`if GET(k)==id then DEL`); add `LockProvider.delIfValue(key, id)`.
- **P1 · Cron double-fires across instances.**
  `$scheduler.ts:189`. Dedup is only "lock held while handler runs"; a fast handler releases before a
  clock-skewed tick on another instance acquires. The Redis cron/interval dedup tests are marked
  `{retry:3}` (`$scheduler-cron.spec.ts:19`), tacitly admitting the race. **Fix:** pg-boss-style tick
  slots — `SET scheduler:{name}:{tickTimestamp} NX PX <period>` so dedup is keyed to the schedule
  slot, not the handler duration.
- **P1 · Cache fails closed: a Redis outage 500s every cached function.**
  `$cache.ts:334`. `run()` awaits `read()`/`set()` with no try/catch; the middleware path swallows
  *write* errors (`:82`) but not *read* errors (`:69`). Backend down → read throws → wrapped handler
  never runs. **Fix:** try/catch the L2 read → log + treat as miss; make the post-hoc `set` non-fatal.
- **P1 · Cloudflare Queues' native retry/DLQ defeated by the inherited catch-all.**
  `WorkerdWorkerProvider.ts:59` delegates to the same `processMessage` that swallows errors, so every
  message is implicitly ACKed. CF Queues has retries+DLQs but only if the handler *throws*. **Fix:**
  on workerd, rethrow after logging. Cheapest at-least-once win in the slice.

### React / SSR

- **P1 · `useStore` misses updates and is not concurrent-safe. · ✅ FIXED**
  - **Status:** FIXED — rewritten on `useSyncExternalStore`, so the store (not a `useState` copy) is
    the source of truth: (a) and (c) fall out of that, and the `subscribe`/`getSnapshot` callbacks are
    now keyed on the resolved atom key, fixing (b). Added `useStore.browser.spec.tsx` (6 tests; the two
    target-change ones fail without the fix).
    **Deliberately NOT changed:** the default is still seeded *during render*. Effects don't run during
    SSR, and the default must be in the store before `exportAtoms` serializes the hydration payload —
    moving it to an effect (as this finding suggested) would silently break SSR. The StrictMode
    double-emit noted in the P2s is the accepted cost.
    **Still open:** `useFieldValue.ts:17` has the identical stale-subscription shape. Fixing it needs a
    public path accessor on `FormModel` (its `values` are keyed by dot-notation `user.name`, while
    `input.path` is slash-notation `/user/name`).
  `react/.../useStore.ts:26`. Initial value in `useState`, subscription in a `[]`-deps effect: (a) a
  `state:mutate` between first render and effect commit is lost until the next mutation; (b) changing
  `target` never resubscribes; (c) no `useSyncExternalStore` → tearing under concurrent render; also
  writes the default into the store *during render*. Same pattern repeats in `useFieldValue.ts:17`.
  **Fix:** rewrite on `useSyncExternalStore(subscribe, () => store.get(target), getServerSnapshot)`.
  **Highest-leverage single change in the react layer** — every downstream hook inherits it.
- **P1 · `useAction`/`useQuery` drop dep-change refetch while a fetch is in flight. · ✅ FIXED**
  - **Status:** FIXED — `executeAction` takes a `supersede` flag. Dep-change (`runOnInit` effect) and
    interval runs pass it: they skip the concurrency guard, abort the in-flight controller and proceed.
    A manual `run()` still dedupes (a double-clicked mutation must not submit twice). Added a monotonic
    `runIdRef` gating every state write — without it a superseded run's `finally` clears the *newer*
    run's `loading` when its abort lands. Test: a `useQuery` whose dep changes mid-flight (handler
    called once, not twice, without the fix). Same finding as the `react` deep-pass entry below.
  `useAction.ts:176` — the `isExecutingRef` guard runs *before* the abort block (`:180`), making the
  abort dead code during execution. `useQuery({handler}, [userId])` whose `userId` changes mid-flight
  never refetches; the old user's data commits and stays. Docs (`useQuery.ts:103`) claim a
  dependency-change abort that doesn't exist. **Fix:** for dep/interval runs, abort the in-flight
  controller and proceed.
- **P1 · Auto-detected language never reaches the client → guaranteed hydration mismatch.**
  `I18nProvider.ts:116`. Server resolves lang from `Accept-Language` into plain state key
  `"alepha.react.i18n.lang"` — not a registered `$atom` (`react/i18n/index.ts:18`) — so
  `exportAtoms("current")` doesn't serialize it; browser `onStart` reads only the cookie. First-time
  `fr` visitor with no cookie: French SSR HTML hydrated against English strings. **Fix:** make the
  lang an `$atom` (rides the existing hydration channel) or set the `lang` cookie on the SSR response.
- **P1 · Prefix-mode SSR mutates process-global locale across concurrent requests.**
  `ReactServerProvider.ts:349`. The prefix branch (unlike the `i18n.lang` branch) has no
  `isBrowser()` guard; overlapping `/fr/...` and `/en/...` requests race on singleton
  `dateFormat`/`numberFormat` and the **global** `dateTimeProvider.setLocale`. **Fix:** guard with
  `isBrowser()`; derive formatters from `this.lang` per call on the server.
- **P1 · `router.anchor()`/`<Link>` hijacks modifier-clicks and drops user `onClick`.**
  `ReactRouter.ts:211`. No meta/ctrl/shift/alt/button check → cmd-click becomes SPA nav instead of
  open-in-new-tab (the delegated interceptor at `ReactBrowserProvider.ts:371` gets this right).
  `Link.tsx:16` spreads `anchor()` after `props`, discarding a caller's `onClick`. **Fix:** bail on
  modifiers / `button !== 0`; compose the user's `onClick`.

### Core / lifecycle

- **P1 · `$throttle` doesn't throttle under concurrency · `REPRODUCED`.**
  `datetime/primitives/$throttle.ts:59`. All concurrent waiters sleep the same window, wake together,
  and each unconditionally refills the bucket. Reproduced: 6 concurrent calls at `rate:1, per:100ms`
  all ran within 100ms (expected ≥500ms). The JSDoc example is "protect an external API" on an
  `$action` — concurrent by construction. **Fix:** re-check `tokens` in a loop after waking, or
  serialize waiters through a queue.
- **P1 · `travel()` over-subtracts across sequential time-travels · `REPRODUCED`.**
  `datetime/providers/DateTimeProvider.ts:523`. `spent = now - timeout.now` measures from the
  timeout's *creation*, but `timeout.duration` was already decremented by prior travels — previously-
  traveled time is subtracted twice. Reproduced: a 10-min timeout fired after `travel(3m)`×3. This
  underpins `$retry`/`$batch`/queue tests framework-wide. **Fix:** set `timeout.now = nowMillis()`
  (post-advance) when rescheduling, or track an absolute deadline.
- **P1 · `parseEnv` validates before `$KEY` substitution · `REPRODUCED`.**
  `core/Alepha.ts:1021`. `BASE_URL=http://$HOST:$PORT` with a `z.url()` schema throws before
  substitution runs (`:1036`); conversely substitution can produce values violating `maxLength`/
  `pattern` with no re-validation. **Fix:** substitute on the raw coerced map, then validate.
- **P1 · `stop()` is a no-op after a failed boot → leaks resources.**
  `core/Alepha.ts:615`. `boot()`'s catch calls `resetStartup()` (`started=false`), then `stop()`
  early-returns (`:650`). If the `ready` phase throws after `start` hooks opened DB pools/servers, no
  `stop` hook runs — under vitest, open handles hang the process (matches observed "hung verify").
  **Fix:** in `boot()`'s catch, emit `stop` with `{catch:true}` for completed phases before resetting.

### Platform services (bucket / email / mcp / system)

- **P1 · Shell capture path is command-injectable · `REPRODUCED`.**
  `system/providers/NodeShellProvider.ts:93`. `buildShellCommand` escapes only `"` (set
  `/[\s"&|<>^()]/`, omits `$`, backtick, `;`, newline); the capture path runs the reassembled string
  through `exec` → `/bin/sh -c` (`:114`), and `/bin/sh` performs command substitution **inside**
  double quotes. Reproduced: `build("echo", ["hello $(id -u) world"])` → `echo "hello $(id -u) world"`
  → stdout `"hello 501 world"` (the `id -u` executed). The POSIX *inherit* path is safe (uses
  `spawn(exe, args)` without a shell). **Scope:** capture mode is the CLI Runner default below DEBUG;
  a local/defense-in-depth RCE if any user-influenced string reaches `exec(...,{capture:true})`, not
  remote-by-default. **Fix:** capture via `execFile`/`spawn` with the arg array, or single-quote-
  escape (`'` → `'\''`).
- **P1 · Bucket `fileId` is never validated → path traversal + tenant-scope bypass.**
  `bucket/providers/LocalFileStorageProvider.ts:204`, `S3FileStorageProvider.ts:129`,
  `R2FileStorageProvider.ts:246`. `upload/download/exists/delete` accept an arbitrary `fileId`. Local
  does `join(storagePath, tenantId, bucket, fileId)` with no guard → `"../../other-tenant/x"` escapes
  the tenant dir. For S3/R2 `new URL(...).pathname` collapses `tenantA/../tenantB/secret.txt` →
  `tenantB/secret.txt`, defeating the tenant prefix added in `e67ca3a1`. `api/files` is safe today
  (keys on `z.uuid()`, `FileController.ts:197`) but the `$bucket` primitive is a documented
  general-purpose API. **Fix:** reject `fileId` matching `/[/\\]|\.\./` in the primitive.
- **P1 · Cloud uploads buffer the entire payload in memory.**
  `S3FileStorageProvider.ts:153` (`arrayBuffer()`), `R2FileStorageProvider.ts:143`, amplified by
  `$bucket.ts:252` materializing zero-size streams. Downloads stream; uploads don't. A bucket
  declared `maxSize:500` buffers 500 MB/concurrent-upload — OOM lever on a 128 MB Worker. **Fix:**
  pass `file.stream()` (with the known `file.size` as content-length) to `putObject`.
- **P1 · MCP server state is a global singleton → concurrent clients clobber `negotiatedVersion`.**
  `mcp/providers/McpServerProvider.ts:58`. `initialized`/`negotiatedVersion` are mutable fields on a
  DI singleton; the transport validates every request's `MCP-Protocol-Version` against that shared
  value (`StreamableHttpMcpTransport.ts:220`), so client B's `initialize` can start 400-ing client
  A's calls. The Streamable HTTP spec defines `Mcp-Session-Id` for this; the transport neither issues
  nor reads it. Latent bug for the multi-tenant Worker deployment the transport is built for.

### Payments

- **P1 · Mollie mis-charges zero-decimal currencies 100×.**
  `payments-mollie/.../MolliePaymentProvider.ts:64` — `toMollieAmount = (cents/100).toFixed(2)`.
  Amounts are stored as `z.integer()` minor units (`paymentIntents.ts:12`). JPY/KRW/HUF have no minor
  unit, so ¥1000 → `"10.00"` (100× undercharge; Mollie also rejects `.00` on zero-decimal currencies).
  **Fix:** currency-exponent lookup (0/2/3 decimals) instead of hardcoded `/100`.
- **P1 · Stripe & Mollie provider packages have zero tests.** The untested surface is exactly the
  risk-bearing code: `StripePaymentProvider.verifyAndMapWebhook` status map + session-vs-PI ref
  selection (`StripePaymentProvider.ts:241`) and `MolliePaymentProvider.mapStatus`/`toMollieAmount`.
  Both are pure functions needing no live PSP.

### Build / packaging / types (cross-cutting)

- **P1 · `yarn typecheck` silently skips 5 workspaces incl. `@alepha/ui` · `SOURCE-CHECKED` · ✅ FIXED**
  - **Status:** FIXED — `"typecheck": "tsc --noEmit"` added to all five (15 workspaces now participate).
    What it surfaced: `@alepha/ui`, `example-api`, `benchmark` were already clean; **`example-ssr`** had
    192 errors that were **all** in `packages/alepha/src` and **zero** in its own code — it extended
    `alepha/tsconfig.base` (which sets no `types`), so `Buffer` was unresolvable in alepha's sources;
    now extends the root tsconfig like the other example apps. **`playground`** had 5 real errors: the
    Dialogs demo called `toast(...)`/`toast.promise(...)` (sonner's raw API, which the `Toast` facade
    deliberately never exposed — the demo was fixed, not the facade), and the AutoForm demo's `$control`
    callbacks were implicit `any`.
  - **⚠️ Do NOT "fix" the `$control` implicit-`any` by augmenting zod's `GlobalMeta`.** Tried; it
    poisons every `.meta()` call site (`GlobalMeta` is in the inference path of every zod schema, and
    `SchemaControlOption → SchemaControl → FormModel → zod schema → GlobalMeta` closes the loop), giving
    `Type instantiation is excessively deep` in untouched files and driving `tsc` past **100 GB RSS**.
    Annotate locally with `satisfies SchemaControlFn` / `satisfies SchemaControl` instead.
  - **Related:** the root `typecheck` fan-out is now capped at `-j 4`. It was unbounded (= core count),
    and `tsc` has no memory ceiling — 14 concurrent `tsc` processes is a machine-killer.
  `package.json:43` fans out via `workspaces foreach … run typecheck`; workspaces with no `typecheck`
  script are skipped: `@alepha/ui`, `playground`, `example-api`, `example-ssr`, `benchmark`.
  `@alepha/ui` is source-only and ships to prod via Lore auto-deploy — only components actually
  imported get transitively checked; everything else can rot. **Fix:** add `"typecheck": "tsc
  --noEmit"` to all five; ideally a root solution-style tsconfig with `references` so nothing opts out.
- **P1 · Circular-dep detector is blind to every `*/core` module.**
  `scripts/build.ts:463`. The detector keys modules by directory (`cache/core`) but
  `extractAlephaDependencies` extracts deps by specifier (`cache`); `moduleMap.get("cache")` returns
  `undefined` and the branch is skipped. Cycles through ~10 core-suffixed modules are undetectable —
  the exact class of bug this guard is supposed to catch. Source is presently clean. **Fix:**
  normalize `m.name.replace(/\/core$/, "")` when building the map.
- *(Withdrawn — was "dev toolchain shipped as runtime deps = adoption tax." This is **by design**;
  see the CLEAN section. Alepha is bundled into the app's JS in production — `node_modules` is not
  shipped — and the toolchain lives in `dependencies` (not `devDependencies`) on purpose so consumers
  get a version-controlled biome/drizzle-kit/vitest for free. Not a finding.)*

### @alepha/ui

- **P1 · Bulk-selection count lies across pages → destructive action on wrong rows · `SOURCE-CHECKED`.**
  `alepha-table.tsx:533` (`selectedItems = data.filter(...)` — current page only) vs `:767`
  (pill shows `selection.size` — all pages) vs `:780` (`action.onClick(selectedItems, …)`). Select 2
  on page 1, page to 2, select 1 → pill says "3 selected", a destructive bulk action receives 1 item.
  **Fix:** clear selection on `page` change, or cache selected items across pages.
- **P1 · `throttle` prop is a documented no-op · `SOURCE-CHECKED`.**
  `control.tsx:566` (text) and `:467` (textarea) both do `onChange={(e)=>setValue(e.target.value)}`.
  `control.tsx:149` documents it, `auto-form.tsx` propagates it (`:393`), Control never reads it.
  **Fix:** implement it in the text/textarea branches, or delete the prop from both files.
- **P1 · FormField never wires `aria-invalid`/`aria-describedby`; sortable headers are mouse-only.**
  `control-base/form-field.tsx:104` styles invalid state via CSS only; the error `<p role="alert">`
  has no id, inputs get no `aria-invalid`. Sortable headers (`alepha-table.tsx:819`) are a raw
  `onClick` on `<TableHead>` — no `<button>`, no `tabIndex`, no `aria-sort`. Keyboard/AT users can't
  sort. **Fix:** shadcn's `FormControl` wires `aria-describedby={descId errId}`+`aria-invalid`
  automatically; render sortable headers as a `<Button>` + `aria-sort`.
- **P1 · i18n split-brain across blocks.** `control-array`/`control-upload`/`auto-form`/`auth/*`
  translate via `tr()`; but `alepha-table` hardcodes "Reset filters"(`:722`), "Refresh"(`:742`),
  "Columns"(`:1009`), "N selected"(`:767`); `control-select` hardcodes "Yes"/"No"(`:235`),
  "Loading…"(`:551`); `use-dialog` hardcodes "Cancel"/"Confirm"/"OK"(`:191`). A French admin sees
  Franglais. **Fix:** run the same `tr(key,{default})` pattern through the remaining blocks.
- **P1 · DevTools has effectively zero tests.** One TODO stub
  (`devtools/.../DevCollectorProvider.spec.ts`); no test touches the DB-CRUD/atom/logs handlers —
  the exact code carrying the P0-5 exposure.

### API layer — jobs (`api/jobs`, the `$job` durable engine)

> **Context — the `$queue` vs `$job` correction:** `$job` is NOT a thin wrapper over `$queue`. It is
> a durable, DB-backed **transactional-outbox** engine: every queue-mode push INSERTs a `pending` row
> into `jobExecutionEntity` (`JobProvider.ts:645`); a worker `claim()`s it via an atomic
> `updateOne({id, status:"pending"}, {status:"running"})` CAS (`:1011`) — so **queue-mode `$job` does
> NOT depend on the buggy `$lock`; the DB claim is the concurrency guard** (comment at `:882`); a
> reconciliation **sweep** (`:1130`, every `sweepCron`, default 15 min) recovers due-`scheduled`,
> stale-`pending`, and crashed-`running` rows and drives retries. Retry policy is `retry:{retries,
> when}` with a correct off-by-one (`:1049`), priorities, idempotency `key` dedup (`:617`), and
> per-attempt `timeout` via `AbortSignal`. **This is real at-least-once durability** and the correct
> answer for work that must not be lost. Grade for the jobs module: **B+**. Caveat: **cron-mode**
> `$job` with `lock:true` DOES use `LockProvider` (`acquireCronLock`, `:369`), so it inherits the
> `$lock`/Bun P0s for cross-instance cron dedup.

- **P1 · Long `delay` fires immediately (setTimeout overflow) · `SOURCE-CHECKED`.**
  `JobProvider.ts:676` (`scheduleOptimisticDispatch`) computes `delayMs` and passes it unclamped to
  `createTimeout` → `setTimeout` (`DateTimeProvider.ts:454`). Any delay > 2³¹−1 ms (~24.85 days)
  overflows the 32-bit timer and fires almost immediately (Node clamps to 1 ms). `dispatchScheduled`
  also doesn't re-check `scheduledAt <= now` (unlike the sweep at `:1140`). `push(p, {delay:[30,
  "day"]})` runs within ms instead of in 30 days. **Fix:** clamp `delayMs` (skip the timer past ~1
  day, let the sweep handle it) and add `scheduledAt <= now` to the dispatch guard.
- **P1 · Cross-instance sweep can double-execute a legitimately long-running job · `SOURCE-CHECKED`.**
  `JobProvider.ts:1167`. Crash detection uses `this.abortControllers.has(exec.id)` — a **per-process**
  in-memory Set — plus a fixed threshold (`timeout*2`, or `config.runTimeout` 30 min when no timeout).
  Instance B's sweep can't see that instance A is still running the job, so a job outliving the
  threshold on A is marked "crashed" by B and re-dispatched → concurrent double-run. Inherent to
  at-least-once, but there is **no lease/heartbeat renewal** to shrink the window. **Fix:** renew a
  `startedAt`/lease heartbeat while a handler runs (BullMQ `lockRenewTime`); document "jobs must be
  idempotent" loudly.
- **P1 · Key dedup is a check-then-insert race · `SOURCE-CHECKED`.**
  `JobProvider.ts:617` — `findMany(key)` then `create()` (the comment admits "two queries…
  deterministic across dialects"). Two concurrent same-key pushes both find nothing and both insert;
  the unique index `["jobName","key"]` makes the **second `create()` throw** instead of returning the
  existing id. **Fix:** `INSERT … ON CONFLICT DO NOTHING RETURNING`, or catch the unique violation and
  re-query.
- **P1 · Unbounded concurrency in direct mode.** `DirectJobDispatcher.ts:40` — each `dispatch` calls
  `background.defer(...)` with no cap; a `pushMany` of 10k launches 10k concurrent claim+handler
  chains, exhausting the DB pool / memory on one instance. **Fix:** a bounded worker pool / semaphore.
- **P1 · The "DLQ" is lossy by default.** `JobProvider.ts:1242` — `error` rows are the only
  dead-letter surface, and `trimByStatus("error", keepLastError)` (default 10) **deletes** the rest on
  the trim cron. An integration that fails 500× overnight keeps only 10 failure records. **Fix:**
  archive (pg-boss style) or default error retention to keep-forever; only count-trim `ok`.

### API layer — users / auth (`api/users`) — grade **B-**

- **P1 · OAuth auto-link trusts unverified email → account takeover.** `SessionService.ts:694` —
  only an explicit `email_verified === false` blocks linking to a pre-existing local account;
  `undefined` (many IdPs omit the claim) links through (`SessionService.spec.ts:826` asserts this as
  intended). An attacker with an IdP account bearing the victim's email is merged into the victim's
  password account (`identities.create`, `:710`). **Fix:** require `email_verified === true` before
  auto-linking; Auth.js gates this behind `allowDangerousEmailAccountLinking` (default off).
- **P1 · Unauthenticated disclosure of admin identifiers.** `RealmController.ts:24` — `GET
  /api/realms/config` has no `$secure` and returns the entire `realmAuthSettingsAtom`, including
  `adminEmails`/`adminUsernames` (`realmAuthSettingsAtom.ts:94`) — which **auto-promote to admin on
  login** (`SessionService.ts:91`). Hands an attacker the exact high-value target list plus password
  policy and rate-limit thresholds. **Fix:** project a public config (branding/auth-methods) only.
- **P1 · Admin `setPassword` neither revokes sessions nor enforces the password policy.**
  `UserService.ts:430` — unlike `completePasswordReset` (which deletes all sessions), `setPassword`
  upserts the hash and returns; the target's existing sessions + 30-day refresh tokens survive the
  "lock out a compromised account" flow. Validates only `minLength`; endpoint accepts
  `z.string().min(1)` (`AdminUserController.ts:150`). **Fix:** `sessions().deleteMany({userId})` +
  `validatePasswordPolicy`.
- **P1 · `ilike` treats the identifier as a SQL LIKE pattern.** `SessionService.ts:270` /
  `RegistrationService.ts:447` — `where.username = { ilike: username }`; the ORM's `ilike` branch does
  NOT escape `%`/`_` (`QueryManager.ts:351`), whereas `contains`/`startsWith` do. Login `adm_n` matches
  `admin`; `a%` matches the first user starting with `a`; availability checks misreport. **Fix:** an
  escaped case-insensitive-equals (`LOWER(col)=LOWER(?)`) for identifier lookups.
- **P1 · No refresh-token rotation or reuse detection.** `SessionService.ts:522` — refresh only bumps
  `lastUsedAt`; the same UUID stays valid 30 days. Combined with the security-module replay finding, a
  single leaked refresh token = ~30 days of undetectable access. **Fix:** rotate on each refresh, kill
  the session family on reuse.

### API layer — subscriptions (`api/subscriptions`) — grade **C-**

- **P1 · `skipTrial:true` mints an `active` paid subscription with no payment.**
  `SubscriptionController.ts:79` + `createSubscriptionSchema.ts:7` + `SubscriptionService.ts:266` —
  `skipTrial` is a client-controlled body field; when true the code creates `status:"active"`
  immediately and never reads `paymentMethodId`. An org admin with the normal `subscription:create`
  grant posts `{planId:"pro", skipTrial:true}` and gets full paid entitlements free until
  `nextBillingAt`. **Fix:** require a captured payment before `skipTrial`; don't expose it on the
  public body.
- **P1 · `billingCycle` and `trialExpiry` crons double-issue payment intents → double charge.**
  `SubscriptionJobs.ts:76,198` — for a trialing sub `nextBillingAt === trialEnd`, so both hourly crons
  fire and each calls `createIntent`, the second overwriting `lastPaymentIntentId`; neither advances
  `nextBillingAt`, so an unpaid capture re-issues every hour. Two intents may both capture (double
  charge), or the overwritten intent's capture finds a mismatched `lastPaymentIntentId`
  (`BillingService.ts:97`) → payment collected, subscription not renewed. **Fix:** one job owns
  renewal; advance `nextBillingAt` optimistically; correlate via immutable `metadata.subscriptionId`,
  not the mutable `lastPaymentIntentId`.
- **P1 · An org that ever expired/cancelled can never resubscribe.** `subscriptions.ts:57`
  (`organizationId` unique) + `SubscriptionService.ts:206` — `subscribe()` only checks for a
  `[trialing,active,past_due]` sub then `create()`s unconditionally; for an `expired`/`cancelled` row
  the pre-check passes and the insert violates the unique index → opaque 500, no revive path.
  **Fix:** upsert/reset the existing row.

### API layer — verifications & notifications — grades **D** / **B-**

- **P1 · `verifyCode` returns `ok:true` without checking the code once verified · `SOURCE-CHECKED`.**
  `VerificationService.ts:172` — `findByEntry` returns the most-recent row for `(type,target,purpose)`;
  if `verifiedAt` is set it returns `{ok:true, alreadyVerified:true}` with no code comparison. Until a
  new code is requested, any `verifyCode(target, <anything>)` returns ok:true. Any flow re-using it as
  an authz gate accepts a bogus code. **Fix:** only short-circuit for the exact code, or bind
  consumption to a one-time transition.
- **P1 · notifications `sensitive` flag never redacts anything.** `$notification.ts:113` +
  `NotificationJobs.ts:52` + `AdminNotificationController.ts:153` — `sensitive` is copied into the
  payload but `variables` are persisted in the `job_executions` payload (`record:"all"`, 7-day
  retention) and returned in full by `getNotification`. A `sensitive:true` template carrying a reset
  token/OTP stores it in plaintext at rest and exposes it to any `admin:notification:read`. **Fix:**
  redact `variables` before persisting and never return them in the detail resource.

### API layer — oauth server (`api/oauth`) — grade **B-**

- **P1 · OAuth access tokens are unscoped, full user-session JWTs · `SOURCE-CHECKED`.**
  `OAuthClientService.ts:126` mints via `entry.issuer.createToken(user, undefined, {clientId})`, and
  `createToken(user, refreshToken?, context?)` takes **no scopes** (`$issuer.ts:269`) — verified: the
  signature has no scope parameter. The `scope` in the response and `grant.scopes` are cosmetic. Any
  registered MCP/third-party client that completes the flow gets a token identical to a full
  interactive login. **Fix:** attenuate — pass granted scopes into `createToken`, stamp `scope`/`aud`,
  and enforce at resource guards; don't reuse the realm session token as the OAuth access token.
- **P1 · Requested scope is never intersected with the client's registered scopes.**
  `OAuthController.ts:187,264` — `scopes: query.scope ? query.scope.split(" ") : client.scopes`; the
  requested scope string is trusted verbatim, `client.scopes` is only a fallback. Direct scope
  escalation the moment finding #1 is fixed. **Fix:** `granted = requested.filter(s =>
  client.scopes.includes(s))`.
- **P1 · Authorization-code single-use is process-local — replayable on serverless.**
  `OAuthClientService.ts:75,430` — replay defense is an in-memory `Set`; two isolates within the 60 s
  TTL each accept the same `jti`. This framework targets Cloudflare Workers. **Fix:** persist consumed
  `jti` in a shared store (LockProvider/KV) atomically; on reuse, revoke the issued session.

### API layer — keys / files / parameters / audits / organizations

- **P1 · Any authenticated user can upload into any bucket, including public-served ones · `SOURCE-CHECKED`.**
  `FileController.ts:93` — `bucket` is a free `z.string().optional()` **query param** →
  `FileService.uploadFile` → `this.bucket(options.bucket)` accepts any registered bucket. Default
  `user` role grants `*` so `file:create` is universal; MIME allowlisting is opt-in/off by default
  (`$bucket.ts:233`); stored `mimeType` is the client's `file.type` (`FileService.ts:76`). If an app
  opts a bucket into `assertPublic`, a user uploads `x.html` as `text/html` to `?bucket=avatars`, then
  `/public/files/:id` serves attacker HTML from the app origin, edge-cached → **stored XSS**. **Fix:**
  allowlist which buckets an upload action targets; sniff content-type server-side; serve with
  `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` for non-allowlisted types.
  *(Note: the new `FileAccessProvider` creator-gate is a genuinely good IDOR fix — this is a separate
  upload-side hole.)*

### React — deep second pass (NEW findings)

- **P1 · Error boundary never resets after navigation · `SOURCE-CHECKED` · ✅ FIXED**
  `react/router/components/NestedView.tsx:42` — `const [boundaryKey, setBoundaryKey] = useState(0)`;
  `setBoundaryKey` is **never called** anywhere (grep-confirmed — it appears only at its declaration),
  so `<ErrorBoundary key={boundaryKey}>` (`:151`,`:168`) never remounts. Once a route throws, the
  fallback latches; navigating to a healthy page still shows the old error until a full reload. **Fix:**
  bump `boundaryKey` on `react:transition:end`, or key the boundary by the layer path.
  - **Status:** FIXED — but **not** by the suggested fix. Bumping the `key` (either form) remounts the
    whole subtree, throwing away page state on *every* navigation. Instead `ErrorBoundary` gained a
    `resetKeys` prop (the react-error-boundary pattern): `componentDidUpdate` clears a caught error when
    a reset key changes, recovering **without tearing down the children**. `NestedView` passes
    `[state.url.pathname]` and the dead `boundaryKey` state is gone. Added
    `ErrorBoundary.browser.spec.tsx` (4 tests).
- **P1 · HttpClient server cache is process-global, URL-only keyed → cross-user leak potential · `SOURCE-CHECKED`.**
  `HttpClient.ts:95` — the cache **read is unconditional** for every GET, keyed on the bare `url` with
  no auth/identity dimension; the no-ETag branch (`:103`) returns `cached.data` **directly**, and
  server ETag caching is also unconditional (`:162`). If an app routes an **authenticated request
  through server-side `HttpClient.fetch` with caching**, user B can receive user A's cached body.
  **Scope:** the default SSR data path uses in-process `$client` (local links call `action.run()`,
  bypassing HttpClient), so this is a real footgun, not an automatic leak — **P0 in apps that cache
  authenticated server-side GETs**. **Fix:** add an identity dimension to the cache key; gate the
  cache *read* on the caller opting in; never cache authenticated responses by default.
- **P1 · `localCache` reads leak to callers who never opted in; no invalidation after mutations.**
  `HttpClient.ts:95` (read runs for every GET; only the *write* at `:154` is gated on `options.cache`),
  and there is no `cache.del`/`cache.clear` anywhere (grep). Component A's `fetch(url,{localCache})`
  populates the cache; component B's plain `fetch(url)` gets A's stale body for the TTL, and a
  POST/PUT/DELETE never evicts the related GET — edit-then-refetch shows pre-mutation data. (Within
  one browser these are staleness bugs, not cross-user; on the server they compound the item above.)
  **Fix:** serve from cache only when the current call requests it; invalidate on mutating calls.
- **P1 · Hydration handoff is not type-safe.** `ReactServerTemplateProvider.ts:175` +
  `ReactBrowserProvider.ts:313` — loader props & atoms are `JSON.stringify`'d server-side and set on
  the client with **no codec decode**. A loader returning `{ createdAt: new Date() }` → client gets a
  `string` (hydration text mismatch, `.getTime()` throws); `Map`/`Set` → `{}`; `bigint` → throws
  inside `safeJsonSerialize` → blank page. **Fix:** decode hydrated atoms against their schema
  client-side; document loader returns must be JSON-primitive; make `safeJsonSerialize` survive bigint.
- **P1 · In-app navigation strips the URL hash. · ✅ FIXED** `ReactBrowserProvider.ts:208` — `push(url)` rebuilds
  the committed URL as `pathname + search` (no hash; `get url()` at `:138` also omits it), so
  `push("/docs#section")` compares `"/docs" !== "/docs#section"`, takes the redirect branch, and
  `pushState("/docs")` drops the fragment. Every internal `<a href="/x#y">` loses its anchor and never
  scrolls. **Fix:** include `state.url.hash` in the comparison and the `pushState` argument.
  - **Status:** FIXED — `get url()` now returns `pathname + search + hash`, and `push()` compares
    against (and re-pushes) the committed URL including its hash. Added 3 tests to
    `ReactBrowserProvider.browser.spec.ts`.
- **P1 · SPA navigation accumulates duplicate `<link>` tags (SEO harm).**
  `BrowserHeadProvider.ts:122` — link tags are matched by **href**, not `rel`, so navigating A→B where
  both set `<link rel="canonical">` appends a second canonical and never removes A's; same for
  per-route `hreflang` alternates. After a few client navs the document has conflicting canonicals —
  actively harmful for an SSR/SEO framework. **Fix:** track framework-managed head nodes (data attr)
  and replace by `rel` each navigation.
- **P1 · `useAction`/`useQuery` dep-change supersession is dead code (precision on pass-1). · ✅ FIXED**
  - **Status:** FIXED — see the `useAction`/`useQuery` entry in the *React / SSR* P1 section above
    (same defect). Note the guard was **kept** for manual `run()`: it is what stops a double-clicked
    mutation submitting twice. Only dep-change/interval runs supersede.
  `useAction.ts:176` — the `isExecutingRef` guard returns *before* the abort-previous block (`:181`),
  and `finally` clears `abortControllerRef` (`:260`), so "cancel in-flight, start newer" is
  unreachable. That is *why* a `useQuery([userId])` whose `userId` changes mid-flight never refetches;
  `data` stays on the old user permanently. **Fix:** let a dep-change/manual run abort and supersede.

### CLI — deep second pass (NEW findings)

- **P1 · CF worker entry stores per-invocation `waitUntil` on a process-global → clobbered under concurrency · `SOURCE-CHECKED` · ✅ FIXED**
  - **Status:** FIXED — the generated worker no longer touches the shared store. `fetch`, `scheduled`
    and `queue` each run their body inside `__alepha.context.run(fn, {"cloudflare.waitUntil": …})`, so
    the handle lives in the per-invocation async context. ALS **is** enabled under workerd
    (`core/index.workerd.ts:71`, + `nodejs_compat`), so `WorkerdBackgroundTaskProvider`'s existing
    `store.get` resolves it per-request via the ALS fork chain — that provider was already correct and
    is unchanged. Verified in prod: CI `deploy-lore-production` green.
  - **Diagnostic note for future passes:** the provider-level concurrency test (two concurrent forks,
    each with its own `waitUntil`) **passes on the unfixed code** — the ALS lookup was never the bug.
    The defect was *only* that the generated worker wrote outside any fork. It is kept as a regression
    guard. The codegen itself is now asserted in `BuildCloudflareTask.spec.ts`.
  `BuildCloudflareTask.ts:560` — the generated worker `fetch` calls `setWaitUntil(executionCtx)` →
  `__alepha.set("cloudflare.waitUntil", …)` on **every** request. A single CF isolate serves
  concurrent requests: request A sets it, request B overwrites it, and A's `$job` direct-dispatch then
  calls B's `executionCtx.waitUntil`, which throws "waitUntil after response" once B returned —
  silently killing A's background work. **This hits Lore's production (CF Workers).** **Fix:** thread
  the exec ctx through the emitted event context, not a shared store.
- **P1 · CF queue consumer has no dead-letter queue or retry ceiling → silent job loss · `SOURCE-CHECKED` · ✅ FIXED**
  - **Status:** FIXED — `enhanceQueue` now emits `dead_letter_queue` (defaults to `<queue>-dlq`; CF
    creates the queue on demand, so a derived default is safe) and `max_retries` (default 3, matching
    CF). Both overridable via `CLOUDFLARE_QUEUE_DLQ_NAME` / `CLOUDFLARE_QUEUE_MAX_RETRIES`; a
    non-numeric override falls back to the default rather than emitting `NaN`. 3 tests.
  `BuildCloudflareTask.ts:500` (`queues.consumers.push({queue})`) — grep confirms **no**
  `dead_letter_queue`/`max_retries` are ever emitted; the worker `queue` handler calls `msg.retry()`
  on any throw, so a poison message burns CF's default 3 retries and is then **dropped with no DLQ or
  signal**. **Fix:** emit `dead_letter_queue` + configurable `max_retries`; ack+log poison messages.
- **P1 · `enhanceDomain` clobbers user-configured `cloudflare.config.routes`.**
  `BuildCloudflareTask.ts:344` — `generateCloudflare` spreads the user's config, then `enhanceDomain`
  does `wrangler.routes = [...]` (assignment, not `??=`/append) whenever `CLOUDFLARE_DOMAIN` is set. A
  user who declares a second hostname/pattern in `alepha.config.ts` silently loses it in prod. **Fix:**
  merge into existing routes.
- **P1 · `verify` skips a co-located-only test suite — the safety net can green-light an untested app.**
  `cli/core/commands/verify.ts:34` gates the test step on an existing `test/` directory, but the
  framework blesses co-located `src/**/*.spec.ts`. An app with no `test/` dir passes `alepha verify`
  **without running a single test**. **Fix:** always run `alepha test` (`--passWithNoTests`); don't
  gate on a directory.
- **P1 · `--mode <value>` leaks into positional args.** `CliProvider.ts:822` — `parseCommandArgs`
  computes consumed indices from the command's own flags only; the synthetic `--mode`/`-m` flag is
  injected elsewhere (`:587`), so `cli cmd --mode prod realArg` hands `["prod","realArg"]` to the arg
  schema. Latent for any `mode:true` command that reads its positional. **Fix:** include the mode alias
  in the flagDefs used for consumed-index computation.
- **P1 · Dev-server error-retry loop has no reentrancy guard; rapid saves race `loadAlepha`.**
  `ViteDevServerProvider.ts:692` — `waitForSuccessfulLoad`'s `onFileChange` is async with no in-flight
  flag (unlike `performReload`'s `isReloading` guard). Two close file events run `destroyAlepha()` →
  `ssrLoadModule()` concurrently, both mutating `this.alepha`/`__alepha`/the wholesale `process.env`
  snapshot → double-started Alepha or a stale-env restore. And the initial `start()` retry path
  (`:127`) re-runs `start()`+`listen()` with no try/catch, so a boot error hard-crashes the dev server
  a later save could have fixed. **Fix:** serialize reloads through one guard; loop start/listen through
  the retry machinery.
- **P1 · CRLF `.env` files break value parsing.** `command/helpers/EnvUtils.ts:49` — `split("\n")`
  leaves a trailing `\r`, so `KEY="v"` stores `"v"\r` (quotes intact, CR included) and unquoted values
  gain a `\r`. **Fix:** `split(/\r?\n/)`.

---

## P2 — Polish / hardening

- **security · `randomCode` throws for `length ≥ 15` · `SOURCE-CHECKED`.**
  `crypto/.../CryptoProvider.ts:152` — `randomInt(10**length)` exceeds Node's 2⁴⁸ ceiling; the
  browser path (`BrowserCryptoProvider.ts:117`) infinite-loops for `length ≥ 10`. Real for
  config-driven OTP length. Clamp/validate `length`.
- **security · Turnstile captcha verify checks only `success`.** `TurnstileCaptchaProvider.ts:113` —
  `hostname` and `action` ignored, so a token solved on any site sharing the sitekey is replayable.
- **security · `deriveAesKey` is a single unsalted SHA-256.** `CryptoProvider.ts:172` — fine for the
  high-entropy `APP_SECRET`, brute-forceable if a caller passes a human passphrase to the public
  `encrypt(plaintext, key)`. Document "high-entropy only" or route low-entropy through the PBKDF2 KDF.
- **security · scrypt `N=16384` below OWASP floor; hash format has no cost prefix.**
  `CryptoProvider.ts:16` — bare `salt:hex` with no algorithm/param identifier, so you can't raise `N`
  later without breaking existing hashes. Store a versioned prefix (`scrypt$N=…$…`).
- **security · resolver errors swallowed by bare `catch {}`.** `SecurityProvider.ts:462` — every
  resolver failure (bad key, malformed token) is indistinguishable from "no credentials"; the request
  silently becomes anonymous. Distinguish "no credential" from "credential present but invalid".
- **security · 4 error classes extend `Error`, not `AlephaError` · `SOURCE-CHECKED`.**
  `SecurityError`, `InvalidTokenError`, `InvalidPermissionError`, `RealmNotFoundError`
  (`security/errors/*.ts`). House-rule violation.
- **core · `SchemaValidator` surfaces only the first zod issue.** `SchemaValidator.ts:27` — a form
  with three invalid fields gets three round-trips of one error each. Zod v4 gives the full array.
  (Also: the canonical validation error is still named `TypeBoxError` after TypeBox was removed.)
- **core · `$debounce` is a coalescing window, not a debounce.** `$debounce.ts:61` — one fixed timer
  at the first call, never reset on subsequent calls; fires mid-typing on a search box.
- **core · `Alepha.create` clobbers an explicitly-passed `NODE_ENV`.** `Alepha.ts:178` — a production
  shell forces `NODE_ENV:"production"` even when the caller passed `{env:{NODE_ENV:"test"}}`. Guard
  with `??=`.
- **core · `run()` exits 0 on `uncaughtException`.** `core/index.ts:120` — the shared trap
  `process.exit(0)`s all traps; orchestrators see a clean exit on a crash. Exit non-zero for the
  exception path.
- **core · Suppressed log lines still allocate an entry + fire an async event.** `Logger.ts:203` —
  every below-level `log.trace(...)` builds the full `LogEntry` and emits. Short-circuit when the
  `"log"` event has zero hooks.
- **core · Batch item states grow unboundedly by default.** `BatchProvider.ts:245` — nothing evicts
  completed entries unless the caller calls `clearCompleted`; a fire-and-forget `$batch` leaks one
  entry/item for the process lifetime. Auto-evict on completion when no `wait()` was attached.
- **react · Backpressure in the SSR pipe is a no-op.** `ReactServerTemplateProvider.ts:224` — on
  `desiredSize ≤ 0` it awaits one microtask then enqueues anyway; slow clients buffer the whole page.
- **react · Error spread can leak internals into prod hydration JSON.**
  `ReactServerTemplateProvider.ts:190` — `{...layer.error}` ships enumerable custom props even though
  `stack` is gated. Whitelist `{name, message, status}`.
- **react · Inline `<script>` head content injected raw; attribute keys unescaped.**
  `ReactServerTemplateProvider.ts:140` — no `</script>` split guard; `renderAttributes` (`:93`)
  escapes values but not keys. Dev-controlled, but a `.replace(/<\/(script)/gi,"<\\/$1")` is cheap.
- **react · Client-side head never cleans up; selector injection.**
  `BrowserHeadProvider.renderHead` (~:116) only adds/overwrites — meta from page A persists on page
  B; hreflang links accumulate per nav. `querySelector` with a raw href throws on quotes. Track
  framework-owned tags (`data-alepha-head`) and reconcile per navigation.
- **react · `compile()` path substitution is prefix-unsafe and doesn't URL-encode.**
  `ReactPageProvider.ts:697` — `path.replace(`:${key}`, value)`: `:id` corrupts `:idx`, only first
  occurrence, values with `/` or `?` break the URL. Use a bounded regex + `encodeURIComponent`.
- **react · No server-only guard on atom hydration.** `ReactServerTemplateProvider.ts:203` exports
  every atom written during the request; one accidental atom a loader touches = data leak. Add a
  `serverOnly`/allowlist flag on `$atom`.
- **orm · Error classification by message substring, not SQLSTATE.** `Repository.ts:1363` — greps
  lowercased messages ("duplicate key value"); breaks on localized servers. pg exposes `code`
  (23505/23503/40P01). Use codes, keep strings as the SQLite fallback.
- **orm · `columns` doesn't reduce the SQL projection.** `Repository.ts:292` — non-distinct queries
  always `SELECT *`; `columns` only trims after rows arrive. Wide jsonb tables pay full I/O.
- **orm · `findMany` mutates the caller's `query` and caps SQLite offset-only queries at 1000.**
  `Repository.ts:389` — writes `query.limit = 1000` back into the caller's object; rows past 1000
  silently vanish. Use `-1` (SQLite "no limit") and never write into the input.
- **orm · `isNull:false` applies `IS NULL` anyway.** `QueryManager.ts:335` — `operator?.isNull !=
  null` is true for `false`. JSON-driven filters invert semantics. Check `=== true`.
- **orm · `"drizzle"` codec doesn't exist; `encodeValue` throws-and-swallows for every filter value.**
  `QueryManager.ts:256` — the Dayjs→ISO layer is dead code that works only because drizzle's own
  column mapping saves it, and pays exception construction on the hot path. Register the codec or
  delete the path.
- **orm · `dbCache = new DbCacheProvider()` bypasses DI; cached reads inside tx cache uncommitted
  data.** `Repository.ts:101` — per-instance cache never invalidated by another repo/raw write;
  `opts.cache` inside `$transactional` stores pre-commit rows that survive rollback. Inject it; skip
  cache when a tx is live.
- **orm · Relation types lie about nullability; to-many joins break `paginate`.** `PgQuery.ts:39` —
  left-join relations are typed always-present but yield `undefined`; `buildJoins` has no `hasMany`
  aggregation, so a to-many `with` duplicates parent rows and page size disagrees with `totalElements`.
  Document "to-one only" until the Drizzle-v1 relational API.
- **cli · Dev URL & `SERVER_PORT` can lie when the port is busy.** `ViteDevServerProvider.ts:118` —
  port read from config before `listen`; with `strictPort` unset Vite bumps to 5174 but the logged
  URL and baked `SERVER_PORT` keep the requested value. Use `server.resolvedUrls`.
- **cli · User app `stop` hooks never run on Ctrl+C in dev.** The dev server closes only the CLI
  container; a user app's `$hook({on:"stop"})` runs in prod but never in dev — hides broken shutdown
  until deploy.
- **cli · Stale `globalThis.__alepha` makes build/db commands adopt the CLI's own container.**
  `ViteUtils.runAlepha` (~:431) reads `__alepha` without clearing first; if the user entry forgets
  `run(alepha)`, the CLI silently introspects itself (empty manifest, no crons). The dev path already
  clears it (`clearAlephaRefs`). Clear before `ssrLoadModule`.
- **cli · Custom `output.dist` breaks the client build.** `BuildClientTask.ts:121` calls
  `postBuildCleanUpForIndexHtml()` with no arg while the method hardcodes `dist="dist/public"`; any
  non-default `output.dist` targets a non-existent path. Pass `opts.dist`.
- **cli · Multi-app dev hardcodes `yarn` and has no SIGKILL escalation.** `dev.ts:181` —
  `spawn("yarn", …)` despite `PackageManagerUtils` being injected; npm/pnpm/bun and Windows break.
  `cleanup` sends SIGTERM once with no timeout.
- **cli · `i18n check` hard-exits with `process.exit()`.** `I18nCommand.ts:36` — bypasses post-hooks,
  `runner.end()`, stop hooks; untestable via `CliProvider.run()`. Throw `CommandError` instead.
- **cli · `verify` never runs co-located specs.** `verify.ts:34` gates tests on a `test/` dir, but
  the framework supports co-located `*.spec.ts`; an app that deletes `test/` gets a green verify with
  zero tests. Also glob `src/**/*.spec.*`.
- **cache · `KEYS` used for wildcard invalidation.** `RedisCacheProvider.ts:106` — blocking O(N)
  `KEYS` scan on every wildcard invalidation. Use `SCAN` cursors.
- **lock · No lock heartbeat/extension; expiry-during-handler is invisible.** `$lock.ts:48` — a
  handler outliving `maxDuration` silently loses exclusion, no watchdog. BullMQ renews; Redlock has
  `extend()`. At minimum log an error when `heldMs > maxDurationMs` on release.
- **email · "Template support" is a misnomer; no escaping helper.** `$email.ts:38` /
  `EmailProvider.ts:15` — no templating engine, `body` is an opaque string shipped verbatim as HTML;
  the primitive's own example interpolates user data into HTML with no escape utility. No cc/bcc/
  replyTo/attachments in core `EmailSendOptions`.
- **system · `createFile({url})` is an unguarded SSRF / local-file-read.**
  `NodeFileSystemProvider.ts:606` — `loadFromUrl` fetches any http(s) URL and `fileURLToPath`s any
  `file://` with no allow-list. Any consumer letting user input reach `createFile` inherits SSRF +
  arbitrary read. Gate `file://` behind explicit opt-in.
- **sigil · Visitor hash uses a public hardcoded salt, not the documented secret.**
  `SigilProxyController.ts:80` — `saltSecret="lore-sigil"` hardcoded; `SIGIL_IP_SALT` never read. If
  `sigilId` leaks, the IPv4 space is brute-forceable against the daily hash, defeating "raw IP never
  stored". Fold in a real `SIGIL_IP_SALT` or switch to HMAC.
- **sigil · `/api/sigil/ingest` is unauthenticated and unthrottled.** `SigilProxyController.ts:45` —
  each accepted call triggers a server-side forward to Lore; no rate limit → cheap telemetry
  poisoning / outbound-volume amplification.
- **stripe · Two `throw new Error` violate the AlephaError convention.** `StripePaymentProvider.ts:435`
  & `:480`. Also the Stripe client is constructed without a pinned `apiVersion` (`:50`).
- **build · Single `types` condition despite divergent runtime entries.** `package.json:259` — every
  export has one `types` pointing at the node entry while `browser`/`workerd`/`bun` resolve different
  files built with `dts:false`; consumers get node types for browser code. Per-condition `types` or
  run `@arethetypeswrong/cli` in CI.
- **build · Exact-pinned `alepha` peer dep on satellites.** `@alepha/devtools`/`payments-stripe` pin
  `"alepha":"0.23.0"` exactly; any patch skew is a hard peer conflict. Use `^0.23.0`.
- **build · No `sideEffects` field in any package.** Bundlers assume every one of the 60+ subpath
  barrels has side effects, defeating tree-shaking. Add `"sideEffects": false` (+ `"*.css"` for ui).
- **build · Stale vitest coverage excludes + dead `loadEnv()`.** `vitest.config.ts` excludes
  `packages/ui`, `packages/devtools`, `.../vite`, `.../thread` — none exist (actual paths are
  `packages/@alepha/*`), so devtools/ui `.tsx` are counted despite intent; `loadEnv()`'s return is
  discarded.
- **build · Compiler-semantics drift in recently-modified tsconfigs.** `@alepha/ui`, `@alepha/sigil`,
  `playground` set `ignoreDeprecations:"6.0"`; ui/sigil also `verbatimModuleSyntax:false`, compiling
  under different import-elision than the other 15 packages.
- **28 `Date.now()`/`new Date()` in non-test source** despite the DateTimeProvider rule (core/datetime
  are exempt; `server`×4, `topic`×2, `bucket`×1, `cli`×4, `react`×2 are not). Also convention nits:
  `vi.spyOn` in `WorkerProvider.spec.ts` and `RetryProvider.spec.ts` (banned); ~27 single-line JSDoc
  in core (banned format); standalone `toDayjs`/`unwrap` in `DateTimeProvider.ts`.

### API layer P2s

- **tenant · Row-level multi-tenancy leans on `org = value OR org IS NULL`, fail-open when no tenant · `SOURCE-CHECKED`.**
  `Repository.withOrganization` (`Repository.ts:1488`) returns the where **unfiltered** when no tenant
  resolves, and otherwise matches `org = value OR org IS NULL`. So (a) any row written without an
  active tenant (background job, service account, single-tenant legacy) gets `organizationId = NULL`
  and becomes readable by **every** tenant — api keys, files, parameters, audits alike; and (b) a
  principal with neither tenant nor `organization` sees all rows. The `IS NULL` branch is presumably
  intentional for shared/global rows, but for security-sensitive tables it's an escape hatch.
  **Borderline P1** given the blast radius. **Fix:** for sensitive tables require a resolved tenant
  (fail closed) and drop the `IS NULL` escape, or add explicit org predicates in the services.
- **jobs · `record:"none"` ignored on queue failures.** `JobProvider.ts:980` — `handleFailure` never
  consults `record`, so a `record:"none"` queue job still writes a terminal `error` row (contradicts
  `$job.ts:118`). Also a crash post-claim/pre-handler consumes an `attempt` (`claim` increments before
  the handler runs), so with `retries:0` one crash flips to terminal `error` though the handler never
  ran. Cron lock `acquireCronLock` (`:369`) fails open on lock-store error.
- **oauth · `redirect_uri` localhost check is prefix-based.** `OAuthClientService.ts:319` accepts any
  `probe.startsWith("http://localhost")`, so `http://localhost.evil.com/cb` and
  `http://localhost@evil.com/cb` pass. **Fix:** parse and assert `hostname === "localhost"`/`127.0.0.1`.
  Also `/oauth/register` (DCR) is unauthenticated with no rate limit / lifecycle
  (`OAuthController.ts:94`) — any anonymous caller creates unlimited `oauth_clients` rows.
- **keys · API-key roles are a stale snapshot of the creator's roles.** `ApiKeyController.ts:39` /
  `ApiKeyService.ts:104,302` — an admin creates a key, is later demoted, the key keeps admin roles
  until revoked. And revocation propagates slowly: the validation cache is per-isolate `memory` with a
  15-min TTL (`ApiKeyService.ts:32`); `revoke` invalidates only the local isolate, so a warm peer
  honors a revoked key up to 15 min. **Fix:** resolve roles live at validation (intersect with current
  roles); publish a revocation signal over `$topic`.
- **parameters · client-supplied `schemaHash` bypasses content validation.** `ParameterProvider.ts:468`
  only validates when `schemaHash === registered`; the client controls `body.schemaHash`
  (`AdminParameterController.ts:170`), so a `admin:parameter:create` holder stores arbitrary
  out-of-schema JSON that then breaks every `param.get()`. Also `getCurrent` (a `:read` endpoint) calls
  `getCurrentWithDefault` which `save()`s a v1 row + publishes an event (`ParameterProvider.ts:696`) —
  a GET performs writes. **Fix:** resolve `schemaHash` from the primitive, never the client; move
  seeding to an explicit write action.
- **audits · caller can forge the actor; log is freely deletable.** `AuditService.create` does
  `{...contextData, ...data}` (`:134`) so caller body overrides request-derived actor/IP; the HTTP
  `createAudit` (`AdminAuditController.ts:88`) passes the body straight in → audit poisoning /
  false attribution. `deleteAudits` removes arbitrary entries by id with no hash-chain/WORM. `getStats`
  loads the whole audit table into memory (`AuditService.ts:282`) → OOM DoS on a wide range. **Fix:**
  force actor/IP from request context; separate retention pruning from id-deletion + add a prev-hash
  integrity chain; aggregate stats in SQL.
- **verifications · code entropy capped at 10⁶ regardless of `codeLength`; calendar-day rate windows.**
  `VerificationService.ts:246` — `randomInt(0, 1_000_000).padStart(codeLength,"0")`, so `codeLength>6`
  pads with constant zeros (false security). Rate windows filter `createdAt ≥ startOf("day")`
  (`:76`), so just after midnight the cooldown/`limitPerDay` reset — burst 2× across midnight. **Fix:**
  `randomInt(0, 10 ** codeLength)`; rolling 24 h window.
- **subscriptions · proration computed but never billed; usage quota increments before the check; dunning non-atomic; MRR truncates.**
  `SubscriptionService.ts:494` (upgrade `netAmount` computed, never charged), `:512` (downgrade credit
  written to `metadata.credit`, never applied), `UsageService.ts:53` (`incr` then check → rejected
  requests still consume quota, never rolled back), `BillingService.ts:323` (3–4 sequential non-atomic
  `updateById` on a stale snapshot despite `db.version()`), `AdminSubscriptionController.ts:91` (MRR
  sums only the first 1000 active subs, growth metrics hardcoded to 0). Lifecycle handlers
  (`subscribe`/`cancel`/`changePlan`) are read-modify-write with no `db.version()` guard (TOCTOU).
- **notifications · admin list fails open if the tenant is unresolved.** `AdminNotificationController.ts:46`
  applies the org filter only `if (org)`; in a pooled multi-tenant worker with `currentTenantAtom`
  unset it returns all tenants' rows. `$notification.push` is also unthrottled per-recipient
  (amplification vector) and there's no in-app channel / read-unread state.

### React & CLI P2s (deep pass)

- **react · `useStore` seeds the default (and emits `state:mutate`) during render.** `useStore.ts:20`
  — a side effect + synchronous event during render; with StrictMode-on-by-default the component
  renders twice and the mutation + async listeners (e.g. `I18nProvider.mutate`) fire on a possibly
  discarded render. Move seeding to `useEffect` / `useSyncExternalStore`.
- **react · clearing a number field submits `0`, not empty.** `FormModel.ts:546` — `Number("") === 0`,
  so emptying an optional numeric input persists `0` (compounded by the known `t.nullable` dropping the
  `minimum` bound). Treat empty/whitespace as `undefined` before `Number(...)`.
- **react · date localization is not SSR-safe.** `I18nProvider.ts:380` — `Intl.DateTimeFormat(lang)`
  with no `timeZone` uses the runtime's zone (server UTC vs browser local) → hydration mismatch;
  `date:"fromNow"` reads wall-clock and is non-reactive. Require/derive an explicit `timeZone` or render
  through `ClientOnly`.
- **react · i18n interpolation is fragile; no pluralization.** `I18nProvider.ts:412` — `replace(\`$${i+1}\`,
  args[i])` replaces only the first occurrence, matches `$10` with the `$1` pass, and doesn't escape `$`
  in args; a missing key silently returns the raw key. Use a global regex + function replacer; add plurals.
- **react · `setQueryParams` desyncs router state.** `ReactRouter.ts:240` — writes `history` directly,
  never updates `state.url` or emits `state:mutate`, so `router.query`/`pathname` go stale while
  `getURL()` is fresh. Route query-only updates through a state update.
- **react · `invalidate(props)` is fragile / silently no-ops.** `ReactBrowserProvider.ts:156` — uses only
  the first key, guards on truthiness (so `0`/`""`/`false`/`null` never match), `break`s after the first
  hit, and refreshes nothing when the key is absent from all layers. Iterate all keys; use `in`.
- **react · `isActive(..,{startWith})` prefix false-positives.** `ReactRouter.ts:60` — `/foo` matches
  `/foobar` (no path-segment boundary); nav highlighting lights up sibling routes. Require next char `/`
  or end.
- **react · server ETag cache grows unbounded.** `HttpClient.ts:165` — ETag writes pass no TTL and
  `MemoryCacheProvider` only evicts when a TTL is set, so a long-lived Node server accumulates one entry
  per distinct URL (incl. every query permutation). Bound the TTL / cap entries.
- **react · superseded client navigations keep running (no loader `AbortSignal`).**
  `ReactPageProvider.ts` loaders get no signal, so a superseded slow loader still completes and can
  `store.set` before its result is discarded — wasted work + stray writes. Thread an abort signal tied
  to `transitionId`. Also `useFieldValue.ts:17` never re-subscribes when the `input` prop changes.
- **cli · generated Docker images run as root.** `BuildDockerTask.ts:261` — no `USER` in any of the
  three Dockerfiles (node-alpine, bun-alpine, distroless). Add `USER node`/`:nonroot` + `chown`.
- **cli · compression runs *after* the Docker image is built.** Pipeline order (`BuildCommand.ts:41`)
  puts `BuildDockerTask` (index 7) before `BuildCompressTask` (index 9), so a `--image` build ships
  without `.br` files and serves everything uncompressed. Run compress before the image build.
- **cli · SSG has no per-page error isolation.** `BuildPrerenderTask.ts:84` renders pages in a bare
  loop; one page whose build-time loader fails aborts the whole build with no offending path. Wrap each
  render, aggregate failures.
- **cli · other build hardening.** `enhanceKV` emits `id:""` when `CLOUDFLARE_KV_ID` unset (`:479`);
  `enhanceServices` does unguarded `JSON.parse(process.env…)` → raw `SyntaxError` (`:320`); Vercel
  `.func` gets `package.json` deps but no install step (latent, masked by `noExternal`, `:207`); server
  source maps ship inside the Docker image (`BuildServerTask.ts:131` + `COPY . .`); `fetch` may return
  `undefined` (`:592`). `postBuildCleanUpForIndexHtml` is called with **no arg** (`:121`) so it hardcodes
  `dist/public` — custom `output.dist` → ENOENT (two bugs, not one).
- **cli · dev/command hardening.** `start()` boot error hard-crashes the dev server (no retry loop,
  `:127`); scaffolder `ensureTsConfig` walks to `/` and skips writing if any ancestor has a `tsconfig`
  (`ProjectScaffolder.ts:126`); multi-app SIGINT sends SIGTERM to `yarn` (doesn't forward) with no
  SIGKILL escalation and `Promise.allSettled` never resolves so core signal traps never install
  (`dev.ts:151`); user-app `stop` hooks never run on Ctrl+C in dev; `i18n check` hard-exits via
  `process.exit`; drizzle config with DB credentials persists on disk (`db.ts:496`); space-separated
  `--flag -value` rejected (`CliProvider.ts:785`).

---

## Things that were checked and are CLEAN (do not re-report as bugs)

- **Client-supplied `x-request-id` does NOT bleed state across requests · `SOURCE-CHECKED`.**
  `ServerRouterProvider.getContextId` (`:184`) trusts `x-request-id`/`x-correlation-id`, but
  `AlsProvider.run` (`core/providers/AlsProvider.ts:22`) builds a **fresh store object and a fresh
  `registry` Map on every call** (`{ ...data, [ALS_PARENT]: parent }`); the context-id is only a
  label. Two concurrent requests sharing an id get isolated DI scopes and ALS stores — only shared
  log correlation, not a security issue.
- **`/api/_batch` does NOT bypass authorization · `SOURCE-CHECKED`.**
  `server/links/providers/ServerLinksProvider.ts:197` (batch route) → `LinkProvider.follow`
  (`:240`) → `link.handler(...)`, where each action registers its link with `handler: (config,
  options) => action.run(config, options)` (`ServerLinksProvider.ts:65`). `action.run()`
  (`$action.ts:345`, `:470`) executes the **full PipelineHandler including `$secure`** inside a fork
  that inherits the request's user, and re-validates the body against the action's own schema. The
  `z.record(z.text(), z.any())` batch body is not a validation bypass. Batch size is capped at 20
  (`MAX_BATCH_SIZE`).
- **Body parser has genuine decompression-bomb protection · `SOURCE-CHECKED`.**
  `ServerBodyParserProvider.ts` — content-length pre-check (413), streaming size cap in
  `streamToBuffer`, and `maxDecompressed = limit * 10` with the transform destroyed on overflow
  (413). Rejects disallowed `Content-Encoding` (415). Better than many frameworks.
- **Response serialization sanitizes correctly.** `ServerRouterProvider.ts:303` sanitizes the
  `content-disposition` filename (strips `\` `"` `\r` `\n`); 5xx error messages are sanitized in
  production (`:434`, `:449`).
- **Stripe webhook verification is correct and timing-safe.** `StripePaymentProvider.ts:250` uses
  `constructEventAsync` + `createSubtleCryptoProvider` (right for Workers), inheriting Stripe's HMAC
  constant-time compare and 300s replay tolerance; missing `stripe-signature` rejected. Amounts stay
  integer end-to-end on the Stripe path. Idempotency via `PaymentService.VALID_WEBHOOK_TRANSITIONS`
  (`:187`) rejects transitions out of terminal states.
- **Per-request SSR state isolation is correct.** Every request runs in `alepha.context.run`
  (`ServerRouterProvider.ts:168`); `StateManager.set` targets the ALS layer; hydration serializes
  only the current layer via `exportAtoms("current")`. The `$atom`-over-Context design is sound at the
  storage level. Navigation supersession uses a monotonic `transitionId` and is tested.
- **Client build is secret-safe** (deep pass refuted the pass-1 worry). `BuildClientTask.ts:90` only
  `define`s `process.env.NODE_ENV` and never overrides Vite's `VITE_` `envPrefix`; the client Vite
  pass never executes app/config code, so no server env value can bake into the client bundle.
- **Hydration `__ssr` JSON is not an XSS vector.** The block is `type="application/json"` and `<` is
  escaped to `<` (`ReactServerTemplateProvider.ts:175`), so no `</script>` breakout. (Only the
  `$head` inline-*script* content is an injection point — see the P2 above.)
- **`exportAtoms("current")` deliberately does not walk the parent fork chain** (`StateManager.ts:40`),
  so SSR serialization can't leak parent-fork state — the isolation is intentional and correct.
- **Toolchain in `dependencies` (biome, drizzle-kit, vitest, vite, tsc, tsx) is BY DESIGN — not
  bloat** (maintainer-confirmed). Alepha is **bundled into the app's JS** in production (tree-shaking
  drops the CLI-only toolchain; `node_modules` is not shipped), so there is no runtime weight. The
  `dependencies` (not `devDependencies`) placement is *required*: npm does not install a dependency's
  devDependencies transitively, so the toolchain must be a real dependency for a consumer's install to
  expose the CLI (`alepha lint`/`build`) — and this is what lets Alepha **own the toolchain version**
  so no consuming project ever manages biome/drizzle-kit upgrades. `@redis/client`/`postgres` are
  likewise tree-shaken out unless the app imports `alepha/redis` / the ORM. Do not re-flag this.

---

## Cross-cutting patterns (root causes worth fixing structurally)

1. **Shared mutable state under concurrency.** Same shape recurs: `$lock`'s id (P0-1), ORM tx storage
   (P1), MCP `negotiatedVersion` (P1), SQLite shared connection (P1). A "per-request vs per-instance"
   review checklist catches the class.
2. **Docs oversell the contract.** `$queue` promises DLQ/retry/persistence; `$throttle` doesn't
   throttle; `$debounce` doesn't reset; email advertises "templates" with no engine; `useQuery` docs
   a dep-change abort that doesn't exist. Rewrite JSDoc to match reality (delivery semantics per
   provider), or implement the promise.
3. **Fail-open defaults.** Default secret warns instead of throwing; cache read errors 500 instead of
   degrading; queue handler errors swallowed and ACKed. Pick the safe default per case — throw on
   insecure config, fail-*open* for cache, fail-*closed* for queues.
4. **Swallowed errors erase signal.** `catch {}` on auth resolvers, SWR refresh, ORM codec, queue
   processing, topic `waitForMessage` parse. Each converts a debuggable failure into invisible
   degradation. Log at `warn` at minimum.
5. **Access control checks "can you?" but not "on what?" — and tenancy fails open.** The recurring api
   security shape: the permission is verified but the *target scope* is attacker-chosen (P0-7 admin
   `?userRealmName`; OAuth scope not intersected; files `?bucket`), and the tenant filter is *skipped*
   when no tenant resolves (`org IS NULL` escape; notifications `if(org)`). Rule of thumb: every
   authz check must bind to the resolved subject's realm/tenant/ownership, and tenancy must **fail
   closed** on sensitive tables. This one theme underlies most of the api P0/P1s.

## Ideas worth stealing (prioritized by leverage)

1. **React → `useSyncExternalStore`** adapter for `useStore` — fixes 3 P1-class reactivity defects in
   one move.
2. **BullMQ / pg-boss →** visibility-timeout + DLQ (`LMOVE` + stalled-message reclaimer) for the
   queue (~40 lines of Lua); time-slot cron dedup (singletonKey per tick) fixes the double-fire.
3. **Prisma →** null-where semantics (`{field:null}`→`IS NULL`, reject `undefined` in unique wheres);
   `select` that narrows the SQL projection.
4. **better-auth / Auth.js →** refresh-token rotation with reuse detection; pin
   `algorithms`+`audience`+`issuer` on the access-token verify path.
5. **Remix →** `defer`-style streamed loaders (promises resolving through Suspense after the shell) —
   the streaming plumbing already exists; today one slow loader blocks first paint of everything.
6. **Drizzle →** optional-peer driver pattern (lazy-import `postgres`/`@redis/client`) instead of
   hard runtime deps; and its relational query API (the planned v1 migration) for to-many joins.
7. **tRPC / Hono →** `publint` + `@arethetypeswrong/cli` in verify; `sideEffects:false` everywhere.
8. **flydrive / AWS SDK →** presigned URLs + streamed uploads for buckets (biggest capability gap).
9. **MikroORM →** savepoint-based nested transactions (the `$transactional.ts:34` TODO); filters that
   propagate to joins (soft-delete currently scopes only the base table).
10. **CASL →** typed `can(action, subject)` tuples for compile-time permission safety on top of the
    already-good `$secure` model.
11. **node-oidc-provider / Ory Hydra (oauth) →** audience-restricted, introspectable access tokens
    (not the reused login session) with scope enforcement + reuse-detection that revokes issued tokens
    — fixes the OAuth P1 cluster wholesale.
12. **Unkey (keys) →** per-key explicit permission sets (≤ creator's roles) + per-key rate limits +
    edge-wide revocation propagation, instead of snapshotting the creator's full role set.
13. **BullMQ (jobs) →** stalled-job lock/lease **renewal** (kills the long-job double-run) and
    pluggable **jittered backoff**; **pg-boss** `ON CONFLICT` singleton keys (kills the dedup race)
    and archive-not-delete for failed jobs (fixes the lossy DLQ).
14. **Stripe billing / Novu (subscriptions & notifications) →** proration as invoice items + credit
    balance applied at renewal; idempotency key per billing period correlated on immutable ids;
    subscriber preferences + per-recipient throttle + in-app inbox with read/unread state.

## How Alepha is used (evidence from `apps/lore`)

Lore is the flagship dogfooding app (~270 files, ~43k LOC, deployed to Cloudflare Workers/D1 on every
push). Reading it is ground-truth about the framework's real surface area and DX. Primitive usage
(grep of `apps/lore/src`): heavy — `$inject` ~132, `$secure` ~129, `$action` ~128, `$repository` ~103,
`$page` ~48, `$atom` ~20, `$entity` ~19; medium — `$job` 5, `$bucket` 5, `$sequence` ~16, `$client`
~22, `$tool` (MCP) ~52, `$transactional` ~33; light/absent — `$route` 3, `$realm` **1**, `$hook` 3;
**zero** — `$queue`, `$cache`, `$cron`, `$sse`.

**What that distribution proves:**
- **Security-by-default is real, not aspirational** — `$secure` ≈ `$action` (nearly 1:1), so almost
  every endpoint is guarded by construction (`QuestController.ts:90` `use:[$secure({permissions:
  ["quest:create"]}), $transactional()]`).
- **The `$job`-over-`$queue` story holds** — the app uses `$job` (durable) and **never** touches raw
  `$queue`. Validates the framing in this review.
- **`$cache` (a rated "crown jewel") is unexercised in production** — a real dogfooding gap; the
  crown-jewel cache modules aren't validated by the flagship app.
- **Lore uses a single realm and hand-rolls tenancy** — `$realm` = 1, and multi-tenancy is rebuilt in
  `AppSecurityProvider.assertMember/assertOwner` over `campaigns.createdBy` + a join table
  (`AppSecurityProvider.ts:83`). So it does **not** hit P0-7 (cross-realm admin takeover), and its
  avoidance of the built-in realm/org tenant model is itself the tell that that model wasn't usable
  for a real resource-ownership app.

**What's genuinely good (the framework's best ideas, proven in real usage):**
1. **One `$action` = HTTP route + typed browser client + in-process MCP callable, no codegen.**
   `createQuest` is defined once (`QuestController.ts:89`), called type-safely from the browser via
   `$client<QuestController>()` (type-only import → no server code ships, `AppRouter.ts:42`) and from
   the MCP server in-process (`QuestTools.ts:214`) — all three sharing one response type. tRPC gives
   client typing but not the free in-process agent surface; NestJS gives neither without DTO plumbing.
2. **Auth composes with transactions in one line** (`use:[$secure(...), $transactional()]`) and the
   handler receives an authenticated `user` with zero boilerplate.
3. **Entities are Zod schemas that derive insert/update/page schemas + static types** (`quests.ts:216`),
   with column metadata (`z.string().meta({size:"rich"})`, `db.ref(..,{onDelete:"cascade"})`) driving
   both migrations and validation.
4. **`$sequence` cleanly solves per-tenant human-friendly IDs** — `questShortId.next(String(campaignId))`
   allocates the campaign-scoped `#42` inside the caller's transaction (`QuestService.ts:141`).
5. **Route loaders + `$atom` give SSR-friendly data-loading without a data library** — the `campaign`
   loader fetches in parallel via typed `$client` and fans into atoms; children read via `useStore`,
   never re-fetch; `onLeave` clears them (`AppRouter.ts:278`).
6. **Auto-batching is relied on deliberately** — three `$client` calls in one tick collapse into one
   `/api/_batch` round-trip; the dev just writes `Promise.all([...])` (`AppRouter.ts:915`).
7. **DI substitution swaps infra with no call-site churn** — `main.server.ts:41,65` swaps
   `FileAccessProvider` and the sigil forwarder to dodge a Cloudflare self-subrequest via one
   `alepha.with({provide,use})`.
8. **End-to-end typing genuinely delivers** — only **9** `as any`/`as unknown` casts in 43k LOC, and
   the destructured response of `campaignApi.getCampaignById(...)` is inferred entirely from the
   server action's schema (`AppRouter.ts:279`); the same resource type flows server→client→MCP.

**Idioms a new Alepha dev should copy:** guard-returns-context (`assertMember` both authorizes and
returns `{campaign,character}`, `AppSecurityProvider.ts:83`); thin handlers, mechanics in a service
(`QuestService.createQuest`); response = a resource schema, not the raw entity (composable via
`.extend()`); one `$page` per route with a co-located `loader` storing into an `$atom`; MCP tools as
thin adapters over controllers; encode migration-safety constraints in the schema in comments.

## Framework gaps revealed by Lore (the app fighting the framework)

Workarounds in the flagship app are signal about what the framework lacks. Ranked by DX pain:

1. **No portable SQL / aggregation API — the #1 gap.** 56 raw `` sql`` `` templates + 35
   dialect-branching lines (`isSqlite ? sql\`…strftime…\` : sql\`…EXTRACT(EPOCH…)\``). Two entire
   controllers (`CampaignStatsController.ts:60`, `InsightsController.ts:158`) are hand-written SQL with
   manual Zod result schemas, doubled for SQLite/Postgres, because the ORM can't express portable
   date/aggregation math. **Fix:** dialect-neutral date/interval/epoch helpers or a relational
   aggregation API.
2. **D1 migration land-mines drive fear-based development.** A framework-generated `DROP TABLE`
   migration silently wiped prod once (per `apps/lore/CLAUDE.md`); the mitigation is a human grep gate
   before every push and **permanently undead columns** kept only to avoid a rebuild
   (`campaigns.ts:72`, comment: "Column is kept … to avoid a Drizzle/D1 rebuild … cascade-wipe"). Also
   `ALTER TABLE ADD COLUMN REFERENCES` emits no `ON DELETE`, so `QuestController.ts:1144` pre-clears
   dependents by hand. **Fix:** migration generator must detect a cascade-parent `DROP TABLE` and
   refuse/backup; carry declared `onDelete` into generated FKs.
3. **No resource-scoped authorization primitive.** Every owned-resource app rebuilds
   `assertMember`/`assertOwner` over `createdBy` + a join table (`AppSecurityProvider.ts:83`), plus a
   subtle `!user.ownership` privileged bypass that's hand-maintained (`:91`,`:152`) — exactly where an
   authz bug hides. **Fix:** a `$owns`/membership primitive that binds authz to a resource + tenant.
4. **No `useQuery`-style data-loading hook.** `useAction` covers mutations only, so GET-on-mount is
   hand-rolled **27×** as `useEffect + alive-flag + .catch(()=>null)` (`QuestView.tsx:128`, +others) —
   verbose, swallows errors, inconsistent. **Fix:** ship a loading/error/cancel/dedup query hook.
5. **`UserAccountToken` type doesn't line up across handler / helper / `ReactAuth`.** The only
   framework-API casts in the app: `user as any` into `assertOwner` (`InvitationController.ts:50`,
   `InvitationService.ts:63`) and `(auth.user as any).picture` (OAuth profile fields missing from
   `ReactAuth`, `CampaignPetitionRequest.tsx:410`). **Fix:** one complete, exported token type shared
   by all three surfaces.
6. **No rate-limiting primitive** — `PetitionRateLimiter` runs a `COUNT` per request and the runbook
   requires a manual Cloudflare WAF rule. Ship `$rateLimit` (per-user/IP, DB- or edge-backed).
7. **No file→owner index** — finding which entity owns a file is `SELECT … WHERE attachments LIKE
   '%"uuid"%'` (`LoreFileAccessProvider.ts:142`), a table scan. The files module needs a first-class
   attachment relation.
8. **DI substitution is order-sensitive and fails opaquely** — three `main.server.ts` comments
   (`:29`,`:37`,`:57`) document that `.with()` must run before the declaring module or it "trips the DI
   guard." The constraint isn't discoverable from the API.

## Per-module strengths (context for future work — don't regress these)

- **core:** zero-decorator DI via `__alephaRef` cursor (no reflect-metadata); compiled event
  executors with topo-sorted before/after tiers (`EventManager.ts:230`); `KeylessJsonSchemaCodec`
  (schema-ordered array encoding, JIT + CSP-safe interpreter fallback); substitution-based testing.
- **server:** decompression-bomb-safe body parser; safe per-request context; clean `$action` with
  direct `run()` (forked ALS) vs `fetch()`.
- **orm:** real injection discipline (90-payload security suite, LIKE-wildcard escaping incl. SQLite
  `ESCAPE '\'`); cross-dialect shared test suites; attribute-symbol schema (soft-delete/tenancy/OCC/
  updatedAt); OCC distinguishes version-mismatch from row-gone by re-fetching.
- **react:** streaming SSR with early-head flush (`createEarlyHtmlStream`); correct per-request ALS
  isolation; Remix-grade nested loaders; deploy-aware chunk recovery; hydration JSON escapes `<`/`>`/
  `&`.
- **security:** AES-256-GCM with per-message random IV + auth tag; tenant-bound tokens (default
  resolver rejects mismatched `tenant` claim); timing-safe compares (password/Basic-Auth/`equals`);
  strict refresh *verification* path; asymmetric EdDSA/RS256 + JWKS path now exists (HS256 remains the
  default).
- **api/jobs:** transactional-outbox durability (INSERT `pending` → atomic `claim()` CAS → sweep
  recovery), correct retry off-by-one, idempotency `key` dedup, priorities, `AbortSignal` timeouts,
  race-safe cancel (`guardedUpdate`), and exceptionally honest limitation-documenting JSDoc.
- **api (auth/users):** two-phase intents keep the password hash server-side and validate policy
  before consuming the code; reset invalidates all sessions; layered IP + per-account lockout;
  captcha before side effects; registration can't mass-assign `roles`/`enabled`/`emailVerified`.
- **api (oauth/keys/files):** S256-only PKCE with exact redirect-match + fully-escaped consent page;
  API keys stored as SHA-256 of a 192-bit token, looked up by indexed hash; `FileAccessProvider`
  creator-gate closes the "download any file by UUID" IDOR and is well-tested.
- **cache:** SWR envelopes, per-key single-flight, write-through L1 LRU + negative caching,
  `cache:hit/miss/stale/set/revalidate` events; `DatabaseCacheProvider` has atomic `incr` via
  `ON CONFLICT DO UPDATE` + probabilistic sweep.
- **cli:** embedded toolchain resolution (`resolveBin` runs tsc/vitest/biome/drizzle-kit from
  `alepha`'s own install); dev-server depth (dual graph invalidation, the empty-`<head>`
  `transformIndexHtml` trick, `/__alepha/ready` poll); Wrangler config generation.
- **mcp:** spec-current (2025-11-25) — origin allow-list, protocol-version negotiation, RFC 9728 auth
  challenge, `isError` vs protocol-error per SEP-1303.
- **sigil:** secret id never serialized, strict redirect whitelist, 11 spec files / 746 lines.
- **@alepha/ui:** `fetchRef` pattern kills effect→refetch loops; `useConfirmedAction`; security-
  conscious auth blocks (`safeRedirect`); idempotent Turnstile loader; swappable toast facade.
- **build:** dual-shape exports map (src for dev, dist via `publishConfig`) with per-runtime
  conditions; `.yarnrc.yml` hardening; depcheck clean across 17 workspaces; **zero** `@ts-ignore`.

## Quick stats

- `as any` in non-test source: **198** (worst: `Repository.ts` 25, `ModelBuilder.ts` 14,
  `FakeProvider.ts` 10, `core/Alepha.ts` 9). `: any`: ~291, leaking into ~6 public signatures.
- `@ts-ignore` / `@ts-expect-error`: **0** (outstanding).
- `throw new Error` in src: 2 (both in payments-stripe, P2). 21 `AlephaError` subclasses.
- JSDoc coverage of exported symbols: ~36% (627/1743); worst: mcp 19%, logger/router 20%.
- God-class sizes: `Alepha.ts` 1486, `Repository.ts` 1836, `SecurityProvider.ts` 1016,
  `CliProvider.ts` 1378 (`command/providers/`). All are wide facades with delegation, not monoliths —
  extracting `EnvProvider`/`PlatformProvider` (core), and a `HelpRenderer`/`FlagParser` (cli) would
  settle the "god-class" question.

## API layer audit — completed (was the original coverage gap)

The original review's `api/*` pass died on a session limit; it has since been **completed** across
four focused passes (jobs; users/auth; notifications+subscriptions+verifications;
organizations+keys+oauth+parameters+files+audits) and the load-bearing findings verified against
source. Headline results, now folded into the sections above:

- **Two new P0s**: cross-realm admin account-takeover via `?userRealmName` (P0-7) and the verification
  endpoint returning the secret code unauthenticated + mounted-by-default (P0-8).
- **Security is the api layer's weak axis**: OAuth tokens are unscoped full sessions; verification
  `verifyCode` accepts any code once verified; OAuth email-link takeover; billing `skipTrial` = free
  paid plan; upload-to-public-bucket stored XSS; the `org IS NULL` tenant escape.
- **`$job` is genuinely strong** (durable outbox + atomic claim + sweep recovery) — the correction to
  the earlier `$queue` framing.
- **`api/organizations` is a stub**, not a tenancy model (no membership/roles/invitations).

Recommended next pass: a dedicated **billing-correctness** review of subscriptions↔payments (proration,
dunning, double-charge, idempotency) with fixture-driven webhook-ordering tests — the money paths are
both the buggiest and the least tested.

## Fix roadmap

Sequenced remediation. Each phase is shippable on its own; within a phase, order by the effort/impact
noted. Prefer fixing **by cross-cutting theme** (see the 5 patterns above) over one bug at a time —
several findings collapse into one fix.

### Phase 0 — Security hotfixes (days, mostly one-liners)
These are exploitable-by-default or one-line severity flips. Ship first.

> **Items 1–4 are ✅ DONE** (all 8 P0s are fixed). **Items 5–8 are the highest-severity work still
> open in the whole document** — they sat in Phase 0 alongside the P0s but were never done. None of
> them affects Lore (single realm, hand-rolled tenancy, no OAuth server, no subscriptions), which is
> presumably why they were skipped — but they are live in shipped framework code.

1. **Throw on default `APP_SECRET` in prod** (P0-3, `SecretProvider.ts:28`) — 1 line.
2. **Strip the token from the verification HTTP response + gate the route** (P0-8,
   `VerificationController.ts:14`) — the endpoint is mounted by default; highest exploitability.
3. **Guard devtools behind `!isProduction()` + localhost/`$secure`** (P0-5, `devtools/src/index.ts:28`).
4. **Bind admin actions to the token's realm** (P0-7, `AdminUserController.ts`) — reject
   `user.realm !== userRealmName`, or scope `checkPermission` by realm.
5. **`verifyCode`: compare the submitted code even when already-verified** (`VerificationService.ts:172`).
6. **OAuth: intersect requested scope with the client's registration + attenuate the token**
   (`OAuthController.ts:187`, `OAuthClientService.ts:126`) — and make auth-code single-use shared-store.
7. **Refuse `skipTrial` without a captured payment** (`SubscriptionService.ts:266`).
8. **Tenancy fail-closed switch** for sensitive tables — require a resolved tenant, drop the `org IS
   NULL` escape (`Repository.ts:1488`); at least make it opt-in per entity.

### Phase 1 — Correctness / data-loss P0s + prod-runtime bugs (1–2 weeks)
9. **`$lock` per-invocation id** (P0-1, `$lock.ts:46`) + **Bun `SET` reply** (P0-2,
   `BunRedisProvider.ts:204`) — restore mutual exclusion; add a same-instance concurrency test and a
   Bun NX/GET test.
10. **DI `lifetime:"scoped"` after start** (P0-4, `Alepha.ts:882`).
11. ~~**`db migrations check` `continue` not `return`** (P0-6) + a cascade-`DROP TABLE` guard~~ — **✅ DONE** (both).
12. ~~**CF worker `waitUntil` per-request, not global** + **queue DLQ / `max_retries`**~~ — **✅ DONE** (both).
13. **`$job`: clamp long `delay`** (`JobProvider.ts:676`), **`ON CONFLICT` keyed dedup** (`:617`),
    **lease/heartbeat renewal** to stop long-job double-run (`:1167`). ← **Phase 1's remaining work.**

### Phase 2 — High-impact P1 correctness (2–4 weeks)
14. **ORM**: implicit-tx child fork (`DatabaseProvider.ts:216`), `null`→`isNull` + zero-condition guard
    on write paths (`QueryManager.ts:182`), `upsert` tenant/soft-delete scoping (`Repository.ts:828`),
    ~~`paginate` spread fix~~ (**✅ DONE**), SQLite tx mutex (`NodeSqliteProvider.ts:134`).
15. **React**: ~~error-boundary reset~~ (**✅ DONE**, via `resetKeys` — *not* a `key` bump),
    ~~`useSyncExternalStore` for `useStore`~~ (**✅ DONE**), ~~dep-change supersession~~ (**✅ DONE**),
    ~~hash-strip~~ (**✅ DONE**).
    **Remaining, and now the single biggest open React item: scope the HttpClient cache by identity +
    gate reads on opt-in + invalidate on mutation** — a real cross-user leak in any app that routes an
    authenticated GET through server-side `HttpClient.fetch`. Left deliberately: each choice changes
    behavior for existing callers, so it wants a policy decision, not a guess. Also still open: head
    reconcile-by-`rel` (`BrowserHeadProvider.ts:122`), and `useFieldValue`'s stale subscription (same
    shape as the old `useStore` — needs a public path accessor on `FormModel` first).
16. **Infra**: compare-and-delete lock release (`$lock.ts:120`), tick-slot cron dedup
    (`$scheduler.ts:189`), cache fail-open on read (`$cache.ts:334`), workerd rethrow so CF Queues
    redeliver.
17. **Billing**: one job owns renewal + advance `nextBillingAt` + correlate on immutable id (fixes
    double-charge, `SubscriptionJobs.ts:76`); redact `sensitive` notification variables.
18. **Auth**: refresh-token rotation + reuse detection; pin `algorithms`/`aud` on access verify; require
    verified email before OAuth account-link.

### Phase 3 — Structural / DX gaps (the Lore-revealed backlog; weeks–months)
These are the features whose absence forces the flagship app to fight the framework. Highest long-term
leverage.
19. **Portable SQL / aggregation API** — kills 56 raw-SQL sites and the dialect-branching. #1 DX win.
20. **Migration-safety generator** — refuse/backup cascade-parent `DROP TABLE`; carry `onDelete` into
    generated FKs. Removes the fear-based grep gate + undead columns.
21. **Resource-scoped authorization primitive** (`$owns`/membership) — every owned-resource app
    currently rebuilds `assertMember`/`assertOwner`.
22. **`useQuery` data-loading hook** — replaces 27 hand-rolled `useEffect + alive + catch` fetches.
23. **Unified `UserAccountToken`** across handler / helper / `ReactAuth` (+ OAuth profile fields).
24. **`$rateLimit` primitive**; **file→owner attachment relation**; **discoverable DI substitution
    ordering** (or make `.with()` order-independent).

### Ongoing hygiene (parallel to all phases)
- **De-market the docs to match reality** — `$queue` (point to `$job`), `$throttle`, `$debounce`,
  email "templates". One session, big trust payoff.
- **Typecheck all workspaces** (`@alepha/ui` + 4 others ship unchecked) and fix the circular-dep
  detector's `*/core` blind spot.
- **Test the failure paths** — the recurring test gap across every module is crash/retry/concurrency/
  cross-tenant coverage; the happy paths are well covered.
- **Exercise `$cache` in Lore** — the crown-jewel cache modules are unvalidated by the flagship app.

## Verification log (what the lead reviewer did directly)

- **Reproduced with live tests:** P0-1 (`$lock` maxConcurrent=3), P1 shell injection (`$(id -u)`
  executed). Both throwaway tests were deleted after; a leftover sub-agent PoC
  (`security/__tests__/poc-refresh-as-bearer.spec.ts`) was also removed — the worktree is clean.
- **Reproduced by the core pass:** scoped-lifetime (P0-4), `$throttle`, `travel()`, `parseEnv`.
- **Source-checked (exact lines read):** P0-2, P0-3, P0-5, P0-6; **P0-7 cross-realm admin takeover**;
  **P0-8 verification token leak** (+ mounted-by-default via `verifications/index.ts`); ORM paginate;
  UI selection & throttle; the two CLEAN findings (`x-request-id`, `/api/_batch`); body parser;
  refresh-token nuance (roles empty). **api/jobs:** `$job` engine internals (outbox/claim/sweep),
  long-delay overflow, key-dedup race, long-job double-run. **api/users:** the admin-controller realm
  chain. **api/verifications:** `verifyCode` short-circuit. **api/oauth:** `createToken` has no scope
  param. **api/files:** `bucket` query-param + `mimeType: file.type`. **tenant:** `withOrganization`
  `org IS NULL` + fail-open.
- **Everything else:** relayed from a specialized pass at high confidence — re-read before acting.

## Change log

- **v1** — initial 12-pass review (`packages/*`). Overall B+; 6 P0s.
- **v2** — deep `api/*` review added (4 focused passes over jobs / users / notifications+subscriptions
  +verifications / organizations+keys+oauth+parameters+files+audits) after the original api pass died
  on a session limit. Added P0-7 (cross-realm admin takeover) and P0-8 (verification token leak) →
  **8 P0s total**; corrected the `$queue`→`$job` durability framing; expanded the module scorecard with
  per-sub-module grades. The api layer's weak axis is **access control / tenant isolation**, not
  engineering.
- **v3** — deep second passes over `react/*` (2) and `cli/*` (2), each finding new bugs pass 1 missed
  (error-boundary-never-resets, non-type-safe hydration, HttpClient cross-user-cache footgun,
  hash-strip; CF `waitUntil` global + no queue DLQ, `verify` skips co-located tests, `--mode` arg leak,
  dev-server reentrancy). Plus a two-pass study of `apps/lore`: **How Alepha is used** (idioms, the
  one-definition-three-transports win, 9 casts in 43k LOC) and **Framework gaps revealed by Lore**
  (portable SQL, migration safety, resource-scoped authz, `useQuery` hook — the structural backlog).
  Added the **Fix roadmap**. No new P0s (the HttpClient cache is a scoped P1). Still **8 P0s**.
- **v5** — **first remediation pass shipped** (`65f50620..0c89bf94`, 4 commits, CI green incl.
  `deploy-lore-production`). Fixed 9 findings, each TDD'd with a test that fails first: ORM `paginate`
  sentinel; CF `waitUntil` per-invocation + CF queue DLQ/`max_retries`; the cascade-`DROP TABLE`
  migration guard (P0-6's bonus — retires Lore's human grep gate); typecheck for the 5 skipped
  workspaces (+ `-j 4` fan-out cap); and the React cluster — `useStore` on `useSyncExternalStore`,
  error-boundary reset via `resetKeys`, `useAction`/`useQuery` dep-change supersession, router
  hash-strip. **Three corrections to this document's own advice**, recorded inline: (a) `useStore`'s
  default seeding must stay *during render* (effects don't run in SSR — moving it breaks hydration);
  (b) the error boundary must **not** be fixed by bumping `key` (that remounts the subtree and discards
  page state every navigation) — use `resetKeys`; (c) the `useAction` concurrency guard must be **kept**
  for manual `run()` (it prevents double-submit) — only dep/interval runs supersede. **Landmine
  recorded:** do NOT type `$control` by augmenting zod's `GlobalMeta` — it explodes the type graph and
  takes `tsc` past 100 GB. **Now the top of the backlog:** Phase 0 items 5–8 (verifyCode, OAuth scope,
  `skipTrial`, tenancy fail-closed) — the highest-severity work still open — and the HttpClient cache.
- **v4** — maintainer correction: **withdrew** the "dev toolchain shipped as runtime deps = adoption
  tax" P1. Alepha is bundled into the app's JS in production (no `node_modules` shipped), and the
  toolchain lives in `dependencies` on purpose so the framework owns/controls the biome/drizzle-kit/
  vitest version for consumers. Recorded as by-design in the CLEAN section; do not re-flag.
