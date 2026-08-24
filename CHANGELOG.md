## [0.27.0] - 2026-08-24

### Features

- **cli**: replace Biome with oxlint and oxfmt (`7a0d7c85`)
- **api/users**: show when a session was last used, not just when it started (`a12f9c7f`)
- **ui**: draw mermaid flowchart fences as themed diagrams (`5d416321`)
- **orm**: bound D1 queries and support the Sessions API (`3522e858`)
- **ui**: let AlephaTable take static data (`bc02a7c5`)
- **ui**: let AppShell style its scrolling main (`3bcb86f1`)
- **ui**: give AlephaTable a page-size picker and a sortable-column affordance (`d029589d`)
- **ui**: give Badge a tint variant and a tone axis (`8fe26380`)
- **ui**: bring the epics list and the questline dialog onto the quests table's shape (`761424b9`)
- **devtools**: run Try It as the session, and keep logs across a restart (`a9c7e923`)
- **ui/admin**: park the built-in nav in a 1000+ band, add a dashboard at /admin (`70160b7c`)
- **react/head**: let a meta tag carry a media query (`dcb7dcf5`)
- **react/router**: answer browser navigations with HTML error pages (`5e12817e`)
- **cli**: add dev.port, bind it strictly, and fix dev with CSS modules (`c497b37c`)
- **cli**: flag secrets pushed before the last env edit, and say a deploy is needed (`079940b0`)
- **platform**: write placeholder blobs on `db export` (`6f3c1d39`)
- **platform**: honour `secret: false` when pushing Cloudflare bindings (`18efd6dd`)
- **react**: give every page its own canonical URL, og:url and twitter:url (`267eae33`)

### Bug Fixes

- **api/workflows**: publish a step's AbortController before the row says running (`febcafe7`)
- **orm**: sqlite could not introspect its own case-insensitive index (`448bf6a3`)
- **ui**: account cards were shaved by their own scroll column (`bc89c8d5`)
- **ui**: the settings rail's active entry matched nothing (`93455af8`)
- **ui**: settings cards had drifted into four different edges (`1b6af5f5`)
- **cli**: report database command failures without a stack trace (`ac7d1424`)
- **cli**: a stray word on a leaf command was silently ignored (`f1735bd8`)
- **react**: static assets were cached for 3.6 seconds, not an hour (`5b178010`)
- **ui**: settings cards drew a doubled edge next to the form card (`5aa7dbf6`)
- **orm**: sqlite schema push was silently applying nothing (`02fa1661`)
- **cli**: stop the linter from rewriting the project's dependencies (`47ac5c75`)
- **devtools**: render structured values as JSON, not [object Object] (`fe1c8108`)
- **react**: stop rebuilding accumulators inside loops (`8b3b9f3c`)
- **websocket**: decode fragmented frames instead of stringifying the list (`94b63d4f`)
- **react**: keep parameterized pages out of sitemap.xml (`a26b464f`)
- **cli**: make a freshly scaffolded project work under yarn and pnpm (`842de36c`)
- **core**: read an empty env string as an absent structured value (`1e84a7af`)
- **platform**: let the deploy name the artifact it packs (`7c534a1c`)
- **ui**: give tooltips a classic open delay (`802d97ea`)
- **ui**: return a stable singleton from useToast (`fdb2b2a1`)
- **orm,mcp**: make a failed relational read diagnosable (`18d70991`)
- **react/router**: restore scroll on back instead of jumping to the top (`b95e4e12`)
- **react/form**: replace the literal NUL byte in useFormQuerySync with \u0000 (`c7e0902c`)
- **cli**: frame the init wizard's questions and trim its sign-off (`ac52fd6f`)
- **react**: show the auth slide in GettingStarted again (`0daa9e51`)
- **cli**: honour an absolute path in `alepha init` (`47f88c9e`)
- **api/users**: refuse a realm that needs codes it cannot send (`74f67e98`)
- **parameters**: skip the ready preload under multi-tenancy (`c8ce8209`)
- **orm**: stop paginate leaking an unhandled rejection when count scoping throws (`aac3ef2f`)

## [0.26.0] - 2026-08-16

### Features

- **ui**: mount the account area, and fix what the back office exposed (`88340abf`)
- **payments**: make sweep cadences configurable, default to */15 (`1fa582e1`)
- **ui,api**: finish AutoForm's settings-card layout, and fix what adopting it exposed (`356bbd0c`)
- **cli**: wire create-alepha to ask.choice/ask.confirm, drop dead Asker injection (`302d3023`)
- **command**: add ask.multiChoice and the selection parser to Asker (`88646ed8`)

### Bug Fixes

- **cli**: rewrite workerd chunks through the AST, not a regex (`dc6047d7`)
- **ui**: stop Segmented's thumb sitting one border-width off its segment (`33d2b206`)
- **devtools**: stop an unrepresentable atom schema breaking the whole UI [BREAKING] (`3c81eaba`)
- **cli**: make pnpm scaffolds hoist the bundled toolchain (`19ef91bb`)
- **ui**: make the account area work inside a clipped app shell (`ee539e99`)
- **core,orm,cli**: close the five defects a 0.25.2 release rehearsal turned up (`a5d3c636`)
- **orm**: refuse to boot in production when entities have no migrations (`3fb97ae7`)
- **cli**: generate a baseline migration for ORM presets at init (`4cf4a445`)
- **cli,react,server,ui**: close the gaps a two-preset init audit turned up (`6e09a2f7`)

## [0.25.2] - 2026-08-15

### Features

- **core,server**: read env vars from aliases, and SERVER_PORT from PORT (`fe81013a`)
- **api/workflows,ui**: context propagation, repeat steps, cancelByKey, startEach, WorkflowTestKit (`64ac6685`)
- **ui**: share one header-actions cluster, and give the account area a header (`00b2a536`)
- **cli**: add --preset=saas to init (`065ef43c`)
- **api/workflows,ui,api/payments**: resurrect the durable workflow engine, dogfooded end to end [BREAKING] (`3eb1f942`)
- **ui,api/users**: add the account module, a user-facing counterpart to admin [BREAKING] (`28bba646`)
- **system**: attach files to a folio and export it as a zip [BREAKING] (`c2462e72`)
- **ui/admin,api**: name users on admin pages instead of bare UUIDs (`00855755`)
- **ui**: address projects by slug at the URL root [BREAKING] (`8222c09e`)
- **analytics,ui**: fold analytics into alepha/api/analytics with an admin explorer [BREAKING] (`2436b61b`)
- **ui/admin**: "Add API key" toolbar action with one-time token reveal (`718e0bb4`)
- **ui/admin**: open three host-page seams on the admin shell (`ed797a08`)
- **orm,crypto**: default primary key is an app-generated UUIDv7 [BREAKING] (`e241b37d`)
- **ui**: give every table filter select a leading icon (`47986a2b`)
- **system**: provider parity, structured shell results, memory-default tests [BREAKING] (`405f20af`)
- **ui/admin**: add adminPage() helper, migrate shop onto it (`173ed2fe`)
- **mcp**: close out the module review — templates, streaming, stdio [BREAKING] (`3ebcb93e`)
- **ui/admin**: add AdminRouter mounting the whole /admin surface (`1c188417`)
- **ui**: add AdminLayout shell for AdminRouter (`6730e02b`)
- **ui/admin**: add AdminRouter boot-time options atom (`26cc4802`)
- **ui/admin**: add default export to admin-payments component (`42fd23c2`)
- **ui**: a dropdown menu sizes to its content, not to its trigger (`fc631ede`)
- **platform**: auto-provision Cloudflare Analytics Engine through platform up (`3dbb3b96`)
- **ui**: one select for every list, and the count only gates the search (`65baeac5`)
- **ui**: weld AlephaTable's pagination row into the table panel (`eeb02a84`)
- **analytics**: the hourly rollup and prune sweep (`2647e45b`)
- **analytics**: the Analytics Engine provider and the workerd entry (`0b62aa7c`)
- **analytics**: the $analytics primitive and its module (`a3fc9bef`)
- **analytics**: relational provider with raw and rolled tiers (`4435d8e8`)
- **analytics**: derive raw and rolled tables from a dataset descriptor (`53d92e14`)
- **analytics**: the provider seam, query types and the memory provider (`e1b68681`)
- **analytics**: hour and day bucket arithmetic (`e9db15ea`)
- **analytics**: package scaffold and the Analytics Engine slot map (`31c3cb2a`)
- **orm**: upsertMany, and vitals stop losing samples to a read-modify-write (`f3673f1a`)
- **react/router**: a guarded page defaults to CSR, and guards refuse the same way on both sides (`11d7c601`)

### Bug Fixes

- **system**: drop node:path from MemoryFileSystemProvider (`e1a496e3`)
- **api/workflows**: never complete a workflow while a step is still running (`9b77cea4`)
- **orm**: emit domain events after the outermost transaction commits (`4090a7d7`)
- **ui/table**: tooltip on the column picker, and chrome that reads in light mode (`bbd12bd9`)
- **ui**: make light-mode interaction states surface-relative (`8385499a`)
- **ui/auth**: let password reset satisfy the captcha it is gated on (`90ac2498`)
- **core**: harden the kernel — parseEnv escaping, DI failure paths, env truthiness [BREAKING] (`c8b7f558`)
- **datetime,scheduler**: keep cron ticks anchored and clamp 32-bit timers (`14bee4e5`)
- **ui/admin**: point AdminRouter's doc at adminPage instead of duplicating it (`da8e1a16`)
- **ui**: close six review findings on AdminRouter (`a8d0f002`)
- **ui/admin**: the user form demanded fields the realm never collects (`76e503ac`)
- **ui/admin**: rename admin-router-options to .tsx, revert exports hack (`84a1dbae`)
- **ui/admin**: type AdminRouter's action gate instead of stringly-naming it (`43b0b43d`)
- **ui/admin**: gate nav entries on action names, not permission alone (`53990594`)
- **core**: stop reporting a boot duration workerd cannot measure (`1c602359`)
- **files**: bound the public-file edge cache at a week, not a year (`728c4b31`)
- **cookies**: the browser and the server disagreed on every shared cookie name (`db5d10c2`)
- **react/router**: apply the SSR payload before the first start hook (`807e0d4b`)
- **analytics**: GROUP BY takes a column name, not the expression (`f16d8750`)
- **analytics**: count() takes no arguments on Analytics Engine (`f922de31`)
- **analytics**: declare the prune-floor table on every runtime, not just workerd (`19402864`)
- **analytics**: look the binding up by its own name, and expose the dataset at runtime (`b85fe8db`)
- **analytics**: rename the read token and quote the dataset name in FROM (`31577f73`)
- **analytics**: scope the prune-floor table to WaeAnalyticsProvider only (`f9fedea1`)
- **analytics**: give WaeAnalyticsProvider a durable prune floor (`dfaa30c0`)
- **analytics**: numeric dimensions on WAE, drop count aggregate, close validation gaps (`0245b5c0`)
- **ui**: a collapsed sidebar's nav group is a dropdown, not a dead button (`c035c1a9`)
- **analytics**: rollup() had the identical raw-name splice as readOne, and the conformance suite's single-word fixture let both ship (`97aa548f`)
- **analytics**: resolve dimension/measure names to real columns in OrmAnalyticsProvider.readOne (`ea9d75bc`)
- **analytics**: merge Analytics Engine and cold on the read side (`df50d060`)
- **analytics**: warn on unwired retention, reject cold<hot, isolate sweep failures (`5f290e65`)
- **analytics**: forward Analytics Engine rows into cold before folding them (`333afb2b`)
- **analytics**: make WaeAnalyticsProvider DI-constructible so it can be auto-selected (`264987d1`)
- **analytics**: replace a stray NUL byte with a space in FakeAnalyticsEngine (`7d78e569`)
- **analytics**: validate the dataset name in $analytics, pin registration ordering (`cdf4e0d4`)
- **analytics**: eager dataset registration, reserve day/hour dimension names (`d442dda6`)
- **analytics**: reserve time_bucket instead of bucket, guard column collisions (`83a3a202`)
- **analytics**: drop min/max, fix prune's tier scope, sharpen conformance suite (`a403a4e9`)
- **analytics**: escape composite grouping keys, cover count/min/max, fix JSDoc style (`5bc7a5e4`)
- **analytics**: type imports, tsconfig, error messages, and measures cap test (`15a47935`)
- **ui**: a clearable Control keeps its clear label in full contrast (`44bff3dc`)
- **react/router**: stop importing a CSR page's component on the server (`ffa6521f`)
- **security**: $secure checks permissions in the browser, and a denied page stops rendering (`04f9e864`)

## [0.25.1] - 2026-08-07

### Features

- **cli**: secrets ride the deploy, so an app never boots without them (`dfbcd5ac`)
- **cli**: deploy to Bay over ssh instead of an admin panel (`03ab985f`)
- **cli**: add host to the platform environment config (`3001a040`)
- **system**: pipe stdin into argv shell commands (`9c6262f1`)
- **protobuf**: publish @alepha/protobuf (`72e238da`)
- **protobuf**: restore @alepha/protobuf, on zod (`c59711f1`)
- **cli**: tell the agent about the devtools API (`c9230e7a`)
- **cli**: platform push, and --tag on up and deploy (`57aa558a`)
- **mqtt,ui**: publish @alepha/mqtt and @alepha/ui to npm (`a871f0de`)
- **cli**: LoreAdapter deploys a tag, and reuses a pinned one rather than rebuilding it (`cfb01bd4`)
- **cli**: ship a static site the framework did not render, and let Lore deploy one (`4ccc08ca`)
- **bucket**: Bay hands apps a bucket, and owns APP_NAME (`bd30b2ec`)

### Bug Fixes

- **ui**: a searchable select could be set, but never cleared (`ac624fe1`)
- **cli**: an answered prompt kept stdin open, so the command never exited (`92ee7abe`)
- **oauth**: the refresh_token grant authenticated nobody (`8e688b55`)
- **api/users**: the login lockout was disabled on Workers, and fail-open besides (`2655ec3c`)
- **cli**: Bay could not take a secret from CI, where there is no .env file (`f7cd6ca0`)
- **cli**: BayAdapter pushed no secrets at all, and said nothing about it (`3f13f434`)
- **cli**: four review follow-ups from the outpost-purge / sigil-apps plan (`e45e2fa0`)
- **cli**: make the Bay pre-flight actually reach the control socket (`2dcce305`)
- **cli**: fix control-socket misdiagnosis, add --control-socket support (`e8a4f4cb`)
- **ui**: make the shadcn sync actually write files, and refresh the primitives (`afdd0cb6`)
- **api**: stop racing the wall clock in the parameter TTL test (`e93de2ef`)
- **cli**: stop reporting a domain the deploy did not choose (`280d8a5c`)
- **server**: drop the body on null-body statuses, and centre the error page (`d8c6f2af`)
- **cli,command**: a mistyped subcommand exited 0, and openapi refused to run without $swagger (`34f72a12`)

## [0.25.0] - 2026-08-04

### Features

- **cli**: the changelog publishes an allowlist, not whatever was not denied (`6a49fa53`)
- **files**: the upload route streams the bytes in flight (`c6f5dbee`)
- **bucket**: R2 and S3 upload a stream, proven on workerd (`8ce40ed6`)
- **bucket**: S3 uploads a stream of unknown size (`3c1172d8`)
- **server**: z.stream() hands the bytes to the handler, in flight (`145d7e97`)
- **command**: stdout for what a command produces, the logger for what it narrates [BREAKING] (`2c748fdb`)
- **files**: the targeted bucket decides the request budget (`fc623115`)
- **server**: the multipart cap is decided per request, and the parser replaces formData() (`aa1405dd`)
- **server**: alepha/server/multipart, a parser that retains nothing (`aee7b577`)
- **cli**: a new project asks no questions and is born lint-clean (`24ce501c`)
- **core**: z.custom, the escape hatch for the passthrough type (`8586916d`)
- **cli**: adapt lore, which only hands back control once the app is serving (`89ed7a74`)
- **security**: the application declares whether it is multi-tenant [BREAKING] (`8c58731e`)
- **users**: the password reset requires a captcha, and the old flow goes away [BREAKING] (`a456d5c1`)
- **logger**: per-context log buffer, and breadcrumbs on the errors that need them (`27246e84`)
- **server**: /health is part of AlephaServer, not an opt-in module [BREAKING] (`de473344`)
- **platform**: alepha platform auth login|logout (`67ef88aa`)
- **cli**: wire $room apps into the cloudflare build (`f5c6ea4c`)
- **oauth**: device authorization grant (RFC 8628) (`6c248482`)
- **cli**: deploy to Bay with `alepha platform up` (`62a14c8c`)
- **cli**: emit dist/manifest.json for every build target (`80353bdd`)
- **websocket**: configurable maxPayload on the node ws server (`3ca9e032`)
- **websocket**: authenticate ws upgrades from the session cookie (`b89c02e5`)
- **websocket**: surface the URL query on room connections and serve ws upgrades in vite dev (`348029ad`)
- **orm**: filter a query by a relation's columns (`f53f7c18`)
- **orm**: let a relational read ask for soft-deleted rows (`d21733a9`)
- **orm**: run $relations on Drizzle's relational query builder (`99949f09`)
- **orm**: object-shaped writes, full delegation, $repositories (`f0a299b0`)
- **orm**: complete the $relations feature set (`7121765b`)
- **orm**: $relations proof of concept with a fully inferred include (`de3f3fa8`)
- **cli**: wire D1 baseline-mark reset into `alepha platform db baseline mark` (`46d6127a`)
- **cli**: add d1MigrationsBaseline for the wrangler bookkeeping path (`d514a1ef`)
- **orm,cli**: add 'alepha db baseline mark' (`247d994d`)
- **cli**: add 'alepha db baseline create' (`d89b3419`)
- **orm**: upgrade drizzle-orm and drizzle-kit to 1.0.0-rc.4 (`e4617c46`)
- **server**: answer 403 for actions pruned by permissions (`e5a35ea1`)
- **devtools**: match the v3 design across every screen (`43c712ae`)
- **files,bucket**: replace $bucket with $storage; one bucket, prefixed containers [BREAKING] (`b32fa197`)
- **devtools**: v1 — dark instrument panel, JSON Schema metadata, jobs [BREAKING] (`04bd5596`)
- **queue,scheduler**: delete $queue, $consumer and $scheduler; $job is the only background primitive [BREAKING] (`1107f0c4`)
- **cli**: one project shape for alepha init, PM detected from invoker [BREAKING] (`9b9a23a0`)
- **users,email,cli**: close registration enumeration, CF email REST, devtools by default (`f36f01f7`)
- **orm,security,react**: portable SQL, $owns, keyed query cache (`cca4ef7f`)
- **api/parameters**: document a parameter, and let apps own a field (`179d9cbd`)
- **api/parameters**: resolve the version in force at a given instant (`6f6450cc`)
- **websocket**: add $room and RoomEngine for stateful WebSocket rooms (`6c7ec940`)
- **payments-stripe**: embedded Connect onboarding support (`3dfcc4e1`)
- **websocket**: Cloudflare alarm() watchdog — recover a ticking room after isolate reset (`639c6bef`)
- **websocket**: host the RoomEngine inside the Cloudflare Durable Object (`3fd6aa32`)
- **websocket**: $room primitive + Node hosting (tick rooms + headless coordinators) (`895fa085`)
- **websocket**: runtime-neutral RoomEngine (state + tick loop + per-recipient send + lifecycle) (`5aeadae6`)
- **websocket**: revive module + Cloudflare Durable Object provider (`222fd03e`)
- **cli**: export AlephaWebSocketDurableObject through the workerd server bundle (`9d6985ef`)
- **cli**: worker entry routes ws upgrades to room DO + exports DO class (`851bf2f8`)
- **cli**: emit Durable Object binding + migration for websocket apps (`81f496b4`)
- **websocket**: Cloudflare Durable Object provider + workerd module (`f7ca171b`)
- **websocket**: AlephaWebSocketDurableObject (hibernatable room object) (`52bb4c37`)
- **websocket**: finish handshake auth + multi-room dev warning (node) (`426f8a58`)
- **websocket**: shared handshake auth resolver + getEndpoint contract (`20eec9ee`)

### Bug Fixes

- **orm,core**: give each transaction its own context, not one shared slot (`c6274f5b`)
- **security**: revert the hook reorder — resolvers need the cookies [BREAKING] (`29c26068`)
- **security**: resolve who is calling before the body is read (`4d2f64fc`)
- **bucket**: a refusal keeps its status, and both providers give the same one (`43ea7ba9`)
- **api/files**: a suffix is not an identity, and a default nobody honoured (`05dbad3d`)
- **server**: the message budget bounds reading, and the walk gets closed (`3fc89782`)
- **server**: the sender does not get to pick which field its part lands in (`465a409c`)
- **server**: one reading of "is this multipart", not two [BREAKING] (`5c7ef03f`)
- **server**: an optional file field is still multipart (`cfb68951`)
- **server**: a route that streams is multipart too (`3e34c07a`)
- **react**: the language resolved by the server finally reaches the client (`ebedbacb`)
- **core**: a hook ordering constraint that does nothing is worth less than no constraint (`5890952b`)
- **react**: a $page can answer 404, $secure warns, and @alepha/ui speaks French (`00cbf437`)
- **cli**: the CLI is tested as npm ships it, and eight bugs fall with it [BREAKING] (`7cd8924e`)
- **cli**: --hints carries a JSON document, not a 255-char label (`358f07a2`)
- **orm,security,server**: ten defects, each reproduced before it was fixed (`7b709588`)
- **cli**: npm needs npx, not `npm run` (`1e4234ff`)
- **cli**: the Bay adapter assumed yarn (`116d40c2`)
- **cli**: three fixes that were living only in a vendored copy (`623d5ec4`)
- **server**: only warn about /metrics when it is actually reachable (`5f414a56`)
- **websocket**: expose the upgrade query on cloudflare room connections (`81a810fb`)
- **oauth**: close the three P0s in the authorization server (`5df5fd9e`)
- **core**: resolve substituted services when injecting by name (`6d2c9348`)
- **websocket**: keep the ws Node provider out of the workerd entry graph (`53ae02d2`)
- **cli**: stub import.meta.url in workerd server chunks so module-scope asset URLs survive validation (`8284179a`)
- **cli**: neutralize createRequire(import.meta.url) banners in workerd server chunks (`f3ce3583`)
- **platform**: keep the refresh token, or a Bay login dies in 15 minutes (`7d3b757d`)
- **cli**: honor the app vite config's publicDir in client builds (`f701fd29`)
- **cli**: refuse to pack a database app with no migrations (`9e121045`)
- **react**: survive a Redirection thrown by the very first render's loader (`ead9fbb8`)
- **bucket,email**: let the host place blobs and scratch data outside the bundle (`c638828d`)
- **orm**: let a generated column stay optional on a raw insert (`7225a52e`)
- **orm**: make nested create atomic, and classify relational read errors (`82a1cbe1`)
- **orm**: make SchemaToTableConfig carry column value types (`fd8e03b4`)
- **orm**: match driver errors through drizzle rc.4's cause chain (`53de81a6`)
- **orm**: give downstream un-baselined projects an actionable migrate error (`05a88691`)
- **cli**: archive drizzle-kit v1 migration folders, not just flat .sql (`ad92ef49`)
- **cli**: close the D1 anti-silence guard hole and drop dead configPath (`10f9daa6`)
- **cli**: close the v1-layout blind spot in the DROP TABLE guard + strip (`549486a7`)
- **cli**: teach D1 migration discovery drizzle-kit v1's folder layout (`5ddd60ed`)
- **cli**: archive into a real directory, and check drizzle-kit v1 migrations (`27de99de`)
- **cli,orm**: stop the D1 baseline-mark Postgres guard reading process.env (`dbc69cf5`)
- **orm**: reset NodeSqliteProvider's connection state in close() (`052e4428`)
- **orm,cli**: connect providers before baseline mark; correct D1 error text (`481516ba`)
- **orm**: convert pre-rc.4 snapshots and guard the sqlite insertDefaultValues gap (`5c2befed`)
- **cli**: let an explicit R2_BUCKET_NAME declare object storage (`bb1ae42c`)
- **cli**: apply D1 migrations without wrangler's transaction (`ae5484bc`)
- **react,orm,cli**: the high-value P3s, plus a dead-code sweep (`14beebc6`)
- **orm**: stop table rebuilds from cascading child rows away (`da276e3b`)
- **server,orm,cli**: quieter 4xx logs, bare-Error warning, contract docs (`a710ebc7`)
- **orm**: distinct+joins guard, upsert empty SET, FK message direction (`a6444133`)
- **websocket**: room connections in the registry, tick reentrancy, nits (`b287a338`)
- **core**: array-of-objects decode corruption, and clear five review findings (`30c26569`)
- **devtools**: show server-only atom values, and stop the form icons overlapping (`d56e512c`)
- **orm,cache**: the four Cloudflare-runtime P2s (`8c371742`)
- **react/form,core**: nested initial values, union arrays, schema docs (`2b1b09e5`)
- **orm**: audit pass over every closed finding — one was half-applied (`69958c89`)
- **react**: close every open react P2 (form, router, head, i18n, core) (`b2300d27`)
- **cli,system,datetime,mcp**: seven findings (`8c5e6060`)
- **orm**: five query, schema and migration bugs (`37f6f78f`)
- **server**: nine findings across core, static, proxy and links (`b711b7a7`)
- **core**: five container lifecycle bugs (`9485f1d4`)
- **queue,topic,retry,batch**: seven silent-failure bugs (`356ec50e`)
- **keys**: revocation could be undone by an in-flight validation (`b7156601`)
- **cli**: nine command and build-task bugs (`b623d3d4`)
- **auth,cookies**: five session-lifecycle bugs (`b140a1b4`)
- **orm**: five silent data-correctness bugs (`6292b79d`)
- **router**: backtracking match, wildcard captures, percent-encoding (`069678bd`)
- **server**: sanitize 5xx in /api/_batch + review audit pass (`3f42448e`)
- **jobs,parameters**: retention, sweep containment + refund ordering (CI red) (`91c7f1dd`)
- **security**: 8 security-adjacent P2s across cli, server, crypto and keys (`d7f86a1a`)
- **websocket**: room teardown, connection ids and cross-room frames (batch 6) (`c4060482`)
- **react**: DX bugs in useQuery, anchors and query-only navigation (batch 5) (`5914f450`)
- **jobs**: claim 'cancelled' before aborting the handler (CI race) (`1352f016`)
- **server**: identity-scope HttpClient cache and in-flight dedup (`0f9d9553`)
- **users**: stop leaking admin allowlist from public /realms/config (`77eac5f6`)
- **orm**: scope upsert conflict-update to the caller's tenant (`6eb34522`)
- **react**: handle cleared date/time inputs without crashing (`9ab8e58f`)
- **command**: accept uppercase answers in ask.permission (`35a80b26`)
- **cli**: correct db check migration hint (`ef4f0046`)
- **core**: exit non-zero after an uncaughtException (`e7632647`)
- **core**: return false instead of throwing in isFileLike (`60312663`)
- **websocket**: stop zombie reconnect and off-browser setTimeout crash (`cd58f731`)
- **server**: preserve multiple Set-Cookie headers in proxy (`9aae793a`)
- **datetime**: catch $interval handler errors (`b3a86afc`)
- **datetime**: correct travel() double-count and clearInterval leak (`7afb6de2`)
- **logger**: guard JSON formatter against circular/BigInt data (`cbcf3f8e`)
- **system**: reject signal-killed child processes (`001487eb`)
- **cache**: don't cache undefined handler results (`7741f030`)
- **cache**: don't wipe the container on a zero-match wildcard invalidation (`5ea8f6de`)
- **server**: accept application/json with charset in HttpClient (`cc6cdcdf`)
- **server**: serialize falsy handler return values (`9647c548`)
- **bucket**: reject path traversal via fileId in LocalFileStorageProvider (`91d8b2b2`)
- **users**: require email_verified for OAuth account auto-link (`e07c2972`)
- **server**: reject backslash paths in validateRedirectUri (`5ab247be`)
- **subscriptions**: guard org-less users on /subscriptions/mine/* (`2d863f06`)
- **cli,websocket**: strip forged ws identity header, guard CF cross-room reply, carry websocketPaths in manifest (`7cad000a`)
- **websocket**: harden WebSocketRoom message error handling, test broadcast RPC (`f94430bd`)
- **websocket**: relative import in auth.spec to break websocket->websocket cycle; sync build-generated exports (workerd re-added by build when index.workerd.ts lands in Task 6) (`69dec958`)
- **websocket**: add missing workerd export condition to ./websocket (`2db6c77a`)

## [0.24.0] - 2026-07-15

### Features

- **core,react,server,devtools**: $atom feature pack (`fd60624e`)
- **core,devtools**: add atom reset/watch, serverOnly guard, mutation log (`3df5f09b`)
- **core,react**: add $computed primitive + useComputed hook (`a6e6ff33`)
- **core,server**: add persist adapters for $atom (cookie, localStorage, sessionStorage) (`43802902`)
- **react**: add useSelector hook + shallowEqual utility (`20be7cc4`)
- **bucket**: scope file storage keys by tenant when one is active (`e67ca3a1`)
- **cli**: gate sub-process output on log level (>= DEBUG) (`e6fe66a6`)
- **ui**: rebuild ControlSelect combobox on Base UI with multi-select pills (`215231cf`)
- **api/notifications**: org-scope the admin notification list (`73a0fd8c`)
- **audits**: implement audit retention policy with scheduled cleanup (`55bc57fb`)
- **ui**: extract TurnstileWidget — reusable Turnstile captcha component (`9dda983c`)
- **ui**: translatable parameter labels in the admin parameters editor (`a77f3fcc`)
- **users**: MySessionController — self-service session management (`be9af87c`)
- **payments**: connected-account refunds + checkout email pre-fill (`f46498f5`)
- **payments**: connected-accounts webhook support (`4968e01d`)
- **api/notifications**: lang-aware notifications — request-language capture + translations resolution (+ fr security emails) (`50212d3c`)
- **security**: $issuer access tokens compose name from first/last + mint given_name/family_name (`8b7b5f3a`)
- **payments**: redesign the dev mock checkout page as a hosted-checkout-style card (`5c6baa1f`)
- **auth**: first/last name in registration + OIDC profile claims in id_token (`1db9a343`)
- **logger**: add CliFormatterProvider for compact CLI output format, remove prettyprint [BREAKING] (`14f261cf`)
- **ui/auth**: rename post-auth redirect query param r → redirect (`e5f16fcb`)
- **cli/cloudflare**: derive the wildcard Worker-route zone from the domain (`a003e3be`)
- **oauth**: trusted (first-party) clients skip the consent screen (`4015403e`)
- **security**: ephemeral EdDSA key fallback in setSigningKey (dev/test, empty privateKey) (`2b60324e`)
- **oauth**: id_token issuance + openid-configuration + /oauth/jwks + confidential token auth (Plan 0 Task 6) (`cb163eef`)
- **oauth**: authorize prompt=none (login_required + silent SSO) + nonce round-trip (Plan 0 Task 5) (`325be5f7`)
- **oauth**: confidential client secret + bounded wildcard redirect (Plan 0 Tasks 3+4) (`9bbe5f93`)
- **security**: realm/issuer 'signing' config -> asymmetric tokens + JWKS (`5f0c3372`)
- **security**: JwtProvider asymmetric signing + getJwks (HS256 default kept) (`8777c007`)

### Bug Fixes

- **docs,test**: migrate guide examples t→z, de-flake crud updatedAt test (`d8bf1ce2`)
- **core,server,devtools**: close cross-feature $atom review findings (`77d411fc`)
- **devtools**: close serverOnly leak in atom log + metadata routes (`39a8bb89`)
- **core,devtools**: close task-5 atom review findings (`adbcc406`)
- **core,react**: close task-4 $computed review findings (`581e2d3d`)
- **core,server**: close task-3 atom-persistence review findings (`ea61f555`)
- **core,react,devtools**: address review findings on atom validation (task 2) (`8e68e1d4`)
- **core,react,devtools**: enforce atom schema validation on writes + hydration decode (`dedfae5e`)
- **security,api,ui**: close Phase 0 hotfixes + payments/jobs/ui remediation (`6af79d19`)
- **react**: correct useStore reactivity, error-boundary reset, action supersession, hash-strip (`0c89bf94`)
- **cli**: scope Cloudflare waitUntil per invocation, add queue DLQ, guard destructive migrations (`00f63e8d`)
- **orm**: keep paginate's next-page sentinel when size comes from query.limit (`d772cc6e`)
- **scheduler**: treat lock contention as a dedup skip, not an error (`89131817`)
- **core**: allow scoped injection after start() (`7e5f9a5a`)
- **api/users**: scope admin actions to the caller's realm (`869c6d67`)
- **api/verifications**: stop returning the verification code over HTTP (`17081a47`)
- **devtools**: never mount devtools endpoints in production (`e652bd3c`)
- **lock**: generate the lock id per invocation, not per composition (`3b98fd69`)
- **redis/bun**: return the SET reply so lock protocol works under Bun (`6c185d9e`)
- **cli/db**: check all providers for migration drift, not just the first (`b14f20a4`)
- **crypto**: fail closed on default APP_SECRET in production (`c3cf7c45`)
- **api/parameters**: emit parameter schema as JSON Schema, not raw ZodObject (`b9dccf45`)
- **orm/sqlite**: map array-of-enum columns to JSON (`5933dff6`)
- **orm**: stop SchemaValidator cache from growing unboundedly (`faf2e65e`)
- **ui/segmented**: match Button height pixel-for-pixel per size token (`3b59b701`)
- **oauth**: re-mint id_token on the refresh_token grant (`038f286f`)
- **sigil**: enforce excludedPaths on the petition button; fix profile avatar crop (`2042f98c`)
- **ui**: AutoForm i18nPrefix — skip description when the dict key is missing (`bed242ca`)
- **parameters**: serverless cache revalidation TTL (cross-isolate staleness) (`7054d52e`)
- **payments**: capture checkout-session webhooks on connected accounts (`3832f5eb`)
- **payments-stripe**: create Connect v2 accounts via account token (FR/PSD2) (`0fbf5377`)
- **ui/app-shell**: fill-mode sidebar anchors to the wrapper, not the viewport (`765f9600`)
- **orm**: or/and where keys AND-combine with sibling conditions instead of short-circuiting (`ed8b1dbd`)
- **ui/auth**: login + reset links propagate ?redirect= alongside realm (`91085cc0`)
- **react/form**: useForm keeps submit/lifecycle callbacks fresh across renders (`5e428a50`)
- **server/auth**: /_auth/userinfo returns the request's RESOLVED user, not a raw-token re-derivation (`ea8a7884`)
- **ui**: ControlSelect combobox trigger surface matches native SelectTrigger (bg-transparent, not bg-background) (`e97a6013`)
- **parameters**: org-scope the parameters table + provider caches (multi-tenant isolation) [BREAKING] (`44cf49c7`)
- **api/oauth**: hand login page return URL as redirect, not redirect_uri (`a9011515`)
- **ci**: repair green pipeline — oauth migration, playground e2e, table refresh (`74a67368`)
- **auth**: OIDC discovery is always lazy (never a boot dependency for a relying party) (`2ae2bcc9`)

## [0.23.0] - 2026-06-06

### Features

- **sitemap**: runtime $sitemap primitive + static-route prerendering (`05dbebe8`)
- **mcp**: resolve + forward-to-quest blights from the Lore MCP (`e3e56053`)
- **quests**: set quest dependencies from the UI (`9885315f`)
- **quests**: make the quest description optional (`36a96eaa`)
- **cli/i18n**: resolve lazily-imported per-language dictionary files (`ec3e40d7`)
- **mcp**: link quests to petitions from the Lore MCP (`f3f9b9b0`)
- **sigil**: capture host-page context on petition submissions (`7c7d2bde`)
- **mcp**: view petition attachments inline via the Lore MCP (`0ff00fa8`)
- **ui**: federated provider buttons link to the auth broker (`2e569bc1`)
- **auth**: $realm identities.federated wiring + realm-config exposure (`8c486d33`)
- **auth**: $authFederationClient (verify assertion -> link -> session) (`0741de42`)
- **auth**: $authFederationBroker (OIDC broker emitting signed assertion) (`a4924d6c`)
- **auth**: on-demand Apple ES256 client-secret signer (`e1256d73`)
- **auth**: federation assertion sign/verify (EdDSA) (`f5af450a`)
- **react/router**: URL path-prefix i18n routing for SEO (`216037e7`)
- **payments-stripe**: add setup-mode checkout + inline subscription price_data (`445ba268`)
- **sigil**: close the petition popup on submit + thank-you on the button (`b726814f`)
- **sigil**: center the petition popup on the current monitor (`868d0be3`)
- **react/i18n**: autodetect language from Accept-Language header (`f7ce001b`)
- **sigil**: integrate SIGIL_ID into environment configuration (`287a90cc`)
- **sigil**: assemble AlephaSigil module (`d79105e0`)
- **sigil**: feedback button + annotated petition dialog (`3c0b2d85`)
- **sigil**: port ScreenshotEditor + styles (`dba6caf8`)
- **sigil**: browser telemetry bootstrap (`99150293`)
- **sigil**: web-vitals collector (`f1d8fff6`)
- **sigil**: telemetry batching queue (`ff210865`)
- **sigil**: forward server:onError to blights (`8f3ab026`)
- **sigil**: petition proxy forwards optional reporterEmail (`a5aa7238`)
- **sigil**: proxy controller (ingest + petition) (`6c4b9007`)
- **stripe**: update to Accounts v2 API for connected account creation (`8f8df71f`)
- **sigil**: SigilForwardProvider with activation rule (`66e458d2`)
- **sigil**: shared ingest/petition/vitals schemas (`081c7b22`)
- **sigil**: env schema (`b8a17e68`)
- **react**: export RootComponentsProvider (`12496a91`)
- **react**: render rootComponents slot in ReactPageProvider.root (`acce0f2e`)
- **react**: add RootComponentsProvider slot (`b01aa7c9`)

### Bug Fixes

- **payments-stripe**: edge-safe webhook signature verification (`acdc0c29`)
- **ui**: AlephaTable treats `fetch` as a latest-wins data source (`38b4aba9`)
- **blights**: stop the inbox infinite render loop at its source (`6c43b11f`)
- **quest**: remove spurious scrollbar on the quest view (`5e563edf`)
- **home**: render the campaign 'updated' time client-only (React #418) (`58ee31a1`)
- **petitions**: Cancel on the request form no longer 403s into the error page (`554b4a57`)
- **i18n**: exempt dynamic language.* keys from the unused-key check (`7770f34b`)
- **ui**: forward the ?r= redirect from register to the sign-in link (`2e504874`)
- **platform**: R2 teardown deletes buckets reliably on `down` (`efc67af7`)
- **sigil**: resolve + forward in-process for Lore's own sigil (`70e043c3`)
- **sigil**: serve petition redirect at root /sigil/request, not /api (`b8008911`)
- **react/form**: submit buttons no longer stick in loading state (`f7f8ddb3`)
- **cli**: emit send_email binding in prebuilt/manifest cloudflare deploys (`045e09fb`)
- **react**: avoid react/router self-import in RootComponentsProvider test (build circular dep) (`39253d71`)

## [0.22.0] - 2026-05-31

### Features

- **react/i18n**: add <Translate> (alias <Tr>) for reactive key translation (`2d08a203`)
- **jobs**: default sweepCron to every 15 minutes (`c8ac0afc`)
- **cli**: global --verbose flag (debug + pretty plain logs) (`55a6074c`)
- **platform**: auto-detect worker secrets from the build manifest (`2f334bba`)
- **platform**: secrets.keys allowlist — deliver worker secrets from process.env (`cf150624`)
- **platform**: `alepha platform db export` + group migrate under `db` (`3008cfde`)
- **bucket**: add list() to FileStorageProvider and $bucket (`fdef603b`)
- **platform**: multi-tenant deploys via tenancy + --tenant (`54b253b1`)
- **cli/build**: accept 'cf' as alias for '--target cloudflare' (`1f1995fa`)
- **payments-stripe**: store Stripe customer cache in SQL via DatabaseCacheProvider (`dd7f3ceb`)
- **audits**: add SessionAudits to alepha configuration (`b6879c68`)
- **jobs**: cron jobs keep their last successful run by default (`ae16d223`)
- **admin-ui/jobs**: open executions drawer on row click + fix priority schema (`9c63cca1`)
- **admin-ui/parameters**: confirm factory reset with a diff preview (`c9d6da5a`)
- **admin-ui/audits**: link Resource column to its admin page (`2a746f11`)
- **users/sessions**: record + show login country (`4c1d3f0b`)
- **admin-ui/audits**: source the Action filter from getAuditActions (`666c0763`)
- **admin-ui/audits**: link Actor column to the user detail page (`6ed4bb6e`)
- **background**: alepha/background module — defer() for fire-and-forget work (`5c37e8ed`)
- **ui/auth**: brand icons, OTP reset code, conditional login autofocus (`13f63791`)
- **email/cloudflare**: support display-name sender in EMAIL_FROM (`3cc69538`)
- **ui**: data-driven nav registry — $page.nav, NavShell, Spotlight (`52d83c96`)
- **admin**: global action-error toast, useQuery/useAction ports, permission gating (`9bfa0efe`)
- **ui**: brand-icon set, select leading icon, brighter dark destructive (`4fb64ab9`)
- **react**: implement useQueryParams format/push, fix useQuery initial loading (`22d9cd43`)
- **admin/parameters**: history accordion, scheduling, live creator join, audit (`be6faeb1`)
- **admin**: parameter history cards + file creator join (`9f6fc617`)
- **admin/files**: upload action, uploader column, bucket filter, image preview (`2bb3f6ec`)
- **ui**: AutoForm card mode + admin parameters editor (`cf56286e`)
- **admin**: parameters editor + lore.campaign.limits (`38922e38`)
- **admin/users**: AdminUserDetail page + clickable email column (`84a2e07a`)
- **security**: admin setUserPassword + uniqueness + auto-unverify (`6bb57178`)
- **ui/control-select**: hide search for short lists + per-option disabled (`ddacca67`)
- **ui/alepha-table**: merge filter toolbar and table seamlessly (`63954b1f`)
- **admin**: embed slim user on session rows + EN/FR translations (`4355ae60`)
- **security**: track users.lastLoginAt + surface in admin (`2a895060`)
- **ui/alepha-table**: inline action icons, tooltips, refresh spin (`cbad8f0f`)
- **orm**: findById/getById accept `with`, allow readonly `on` tuples (`b18daaee`)
- **admin**: split user table columns + sidebar brand row (`c349087f`)
- **cli/init**: default to my-app/ when run in a non-project dir (`8d8124e6`)
- **cli/vendor**: add 'vendor link' for live dev against a local checkout (`abc5053b`)
- **admin**: role picker + status filter + sticky-body table layout (`58721a1c`)
- **ui**: polish admin-users + AlephaTable floating bar (`da05b2a5`)
- **ui/alepha-table**: sticky thead + Linear-style floating bulk bar + Settings icon for table actions (`540f45ba`)
- **ui**: migrate shadcn stack to base-nova (Base UI primitives) (`0168735a`)
- **ui/alepha-table**: built-in toolbar with filters, column picker, refresh/reset, persistence (`cee49c69`)
- **ui/alepha-table**: add defaultSort + onSortChange for sort persistence (`f0ad564f`)
- **container**: make rocket-worker → CF Container → example-ssr e2e green (`d09d5ca4`)
- **rocket-worker**: example CF Worker fronting Rocket via \$container (`d8f19cd8`)
- **build,platform,bin**: manifest captures envConfig — drop alepha.config.ts from artifact (`6184203d`)
- **build,platform,rocket**: manifest-driven prebuilt deploys (`5815d03f`)
- **cli,rocket**: `alepha pack` command + workspace slugify + extract-by-name (`1c8b19c5`)
- **build/docker**: skip `RUN npm install` when dist/package.json has no deps (`77420472`)

### Bug Fixes

- **bucket**: read upload body once and clean up the file upload chain (`957d4db8`)
- **command**: parseEnv JSON-decodes double-quoted values (symmetric with stringify writers) (`dd8abb5f`)
- **platform**: push per-deploy .env.<env>.local keys, not just declared env (`36037311`)
- **core**: dump() must force-instantiate the graph before reading env (`b8bdd6f6`)
- **bucket**: export S3FileStorageProvider from the workerd entrypoint (`e3b3a8f0`)
- **env**: expose PUBLIC_URL at runtime on Cloudflare for absolute email links (`491e39d7`)
- **subscription**: update gracePeriodSweep cron time to 3 AM (`1ceaefe1`)
- **ui/dropdown-menu**: size action menus to content, not trigger width (`4423a538`)
- **audits**: failed login records Failed; add distinct-actions endpoint (`4522d611`)
- **react**: useAction — release the concurrency guard on unmount (`0385b616`)
- **cli/cloudflare**: don't set send_email destination_address from EMAIL_FROM (`182bc369`)
- **email/cloudflare**: use 'email' key in from object, not 'address' (`322320a7`)
- **vite**: improve SSR module invalidation for workspace-linked sources (`79442917`)
- **ui/command**: only highlight the active CommandItem (`46e23a88`)
- **cli/vendor**: resolve link source via node:path, not via shell (`dab2236a`)
- **ui**: use Base UI Checkbox indeterminate prop in AlephaTable (`1a9af18d`)
- **api/jobs**: register sweep+trim crons in constructor, not in onStart (`ac5a2dc4`)
- **email/cloudflare**: gate EmailProvider substitution on isServerless() (`c919c905`)
- **email/cloudflare**: make EMAIL_FROM env optional, re-check in send() (`433409c8`)
- **cli/cloudflare**: look up CloudflareEmailProvider by name string (`a9831388`)
- **email/cloudflare**: boot inert off-Workers instead of throwing (`7fe44067`)

## [0.21.2] - 2026-05-26

### Features

- **rocket**: support `down` op + add end-to-end smoke test (`a17e67d9`)
- **rocket**: parse `alepha platform --json` output instead of regex (`2ab87f77`)
- **platform**: emit JSON on --json for up/down/migrate (`fb3abc61`)
- **rocket**: DeployRunner spawns `alepha platform --prebuilt` (`4618cdc1`)
- **build,platform**: --prebuilt skips bundle, keeps deploy-config gen (`f2e3584c`)
- **rocket**: wire S3 artifact fetch + Docker target with global tools (`be087dff`)
- **containers**: add $container primitive for typed RPC to ephemeral containers (`f8f6756d`)
- **apps/rocket**: Docker image scaffold for the Rocket runner (`c6b5c1df`)
- **@alepha/rocket**: scaffold remote alepha platform runner lib (`7e6999a8`)
- **platform**: graduate alepha/platform out of alepha/cli/platform (`7a5e62cb`)
- **cli/platform**: default PUBLIC_URL to https://<production.domain> when unset (`c9509399`)
- **email/cloudflare**: add CloudflareEmailProvider using Workers binding (`1becab6a`)
- **ui/alepha-table**: add defaultSort + onSortChange for sort persistence (`46b671d1`)
- **api/files**: add /public/files/:id route and avoid duplicate DB lookup on stream (`2a23568b`)
- **react/form**: add useFormQuerySync — two-way bind useForm to URL query params (`eadacddc`)
- **ui**: add ContextMenu component (Radix wrapper, matches DropdownMenu shape) (`8bac85bf`)
- **ui**: useToast returns a lib-agnostic Toast interface (`96e84222`)
- **ui**: polish Segmented styling and add playground demo (`baac276b`)

### Bug Fixes

- **rocket**: unblock e2e — schema log/error caps + better failure output (`5a9b0b50`)
- **react/form**: setInitialValues emits form:change for cleared keys (`310c98a0`)
- **react/form**: useFormQuerySync preserves initial form values on first mount (`f853e5a3`)
- **react/form**: useFormQuerySync preserves initial form values when URL is empty (`2be05b8a`)
- **react/form**: treat null/undefined input as unset in FormModel.getValueFromInput (`5a3a49c4`)
- **react/router**: popstate re-renders on query-only URL changes (`e236d824`)
- **ui**: make markdown links visibly distinct from body text (`006cc5d5`)
- **orm**: include table name in Repository PK-not-found error (`0a4497aa`)
- **verifications**: scope verification cooldown to a purpose bucket (`12afd379`)

## [0.21.1] - 2026-05-22

### Features

- **react/router**: redirect to login on a denied page guard (`5cc742ce`)

### Bug Fixes

- **ui-registry**: remove the AlephaTable toolbar refresh button (`04107657`)
- **cli**: auth layout no longer double-wraps the full-page auth blocks (`d7fbfb29`)
- **server**: never leak 5xx error internals to the client in production (`dc1e00cb`)
- **cli**: scaffold admin emails into .env, not hard-coded source (`2c72dd5e`)
- **core**: detect production in the browser via import.meta.env.PROD (`b902a586`)
- **react/router**: enforce $page use middleware on client navigation (`45745e40`)
- **cli**: run embedded drizzle-kit with global exec (regression) (`b074ea24`)

## [0.21.0] - 2026-05-21

### Features

- **cli**: alepha test accepts a filename filter argument (`96e4de2a`)
- **ui**: update HeroSection, AppRouter, and README for branding consistency (`f897db44`)
- **cli**: embed the toolchain in alepha, drop it from project package.json (`7451f952`)
- **ui**: add the shadcn chart component (`39180428`)
- **ui/control**: autoFocus, rows, and an inputProps escape hatch (`5cce1d69`)
- **oauth**: support the refresh_token grant at /oauth/token (`d2a39dc6`)
- **security**: tag sessions with the OAuth client they were minted for (`aebd9f7d`)
- **mcp**: RFC 9728 401 challenge for OAuth-protected MCP endpoints (`c7432ad5`)
- **api/oauth**: add OAuth 2.1 authorization server module with dynamic client registration and PKCE support (`5c6f5eea`)
- **cli**: add i18n plugin for unused-key detection (`30dc35c6`)
- **ui**: numbered pagination + top-toolbar refresh on AlephaTable (`1c359adb`)
- **ui**: allow to customize logo during login/register (`a26470c7`)
- **cli**: platform - allow to down R2 (`d5791797`)
- **ui**: add autoApplyFilters to AlephaTable, drop Apply button in lore board (`69c29b10`)
- **ui**: improve register form (`ed6240ba`)
- **orm**: implement SequenceProvider and alephaSequences for portable numeric sequences (`fed23fb8`)

### Bug Fixes

- **ui-registry**: ship @alepha/pagination with First/Last page controls (`37a2af56`)
- **cli**: drop --test from e2e-cli spec and docs after flag removal (`a34c1381`)
- **cli**: generated alepha.config.ts puts platform under plugins[] (`4583ec47`)
- **ui/auto-form**: auto-save select fields on change (`a9e3a697`)
- **security**: resolve request.user from non-header credentials too (`650f4f75`)
- **orm/d1**: CloudflareD1Provider.execute returned undefined for SELECTs (`9787b304`)
- **devtools**: fix build dir (`60e7d512`)
- **server/links**: split batch when action is multipart (`09be4f42`)
- **react/form**: fix flaky state reset on render (`1d7c063f`)

## [0.20.8] - 2026-05-13

No public changes in range 0.20.7..HEAD

## [0.20.7] - 2026-05-12

### Features

- **ui**: enhance button components with variant support and improve layout consistency (`96187a54`)
- **cloudflare**: implement bulk patching for worker bindings to optimize secret updates (`2b17e694`)
- **payments-stripe**: subscription helpers (Checkout, cancel, portal, webhook) (`8e98b6e7`)
- **cache**: add in-process L1 memory tier with stale-while-revalidate support (`75e93842`)
- **cloudflare**: support wildcard domains with required zone configuration (`dbc82a54`)
- **payments**: optional applicationFeeAmount on createSession (`641f6063`)
- **payments-stripe**: add Connect onboarding helpers (`7b4c9232`)
- **payments-stripe**: optional stripeAccount on Stripe API helpers (`eecb6d83`)
- **orm**: db.organization({ nullable: false }) for non-null tenant scoping (`e08a597d`)
- **server/auth**: validateRedirectUri accepts cross-subdomain URLs under trusted parent (`d5544915`)
- **api**: add organizationId to apiKeys, audits, and files tables (`1129e0d1`)
- **payments**: add Mollie payment provider integration (`70ace9af`)
- **api/payments**: add MemoryPaymentProvider to variants (`418cc391`)
- **api/payments**: add subcriptions again (`ce40b1ad`)
- **api/payments**: add mock controller (`c69b804d`)

### Bug Fixes

- **core**: run .register() before imports:[] (`b517dc1e`)

## [0.20.6] - 2026-05-09

### Features

- **api/users**: $realm - allow username as email (`beb700a0`)

### Bug Fixes

- **api/jobs**: improve job direct call, add vercel support (`a7b93248`)
- **cli**: build - improve build sitemap task (`80ebe8a2`)
- **ui**: update registry inputs (`de2fdf2f`)

## [0.20.5] - 2026-05-04

No public changes in range 0.20.4..HEAD

## [0.20.4] - 2026-05-04

### Features

- **server**: improve $action header validator (`0df3f96c`)
- **api/users**: add session max idle (`4cd1a359`)
- **react**: add useQuery (sugar for useAction + HttpClient) (`661c8050`)
- **core**: start to isolate TypeBox and Dayjs access for future migration (generic type validator and Temporal API) [BREAKING] (`fefc4579`)
- **bucket**: add native support of s3, no more external package for node.js runtime (`ba75b593`)
- **mcp**: upgrade spec version (`0eec48c1`)
- **ui**: add AutoForm + examples (`2986cc73`)
- **cli**: config - refactor alepha.config.ts to use plugins (`de1f2c2d`)
- **react/router**: add $page ssr: boolean to avoid server rendering on pages (`8e7d14b3`)

### Bug Fixes

- **core**: fix dependency bundle (`9a197279`)

## [0.20.3] - 2026-04-30

### Features

- **react/router**: add a delegated anchor-click interceptor (`fbbf5885`)
- **cli**: init - add "--shadcn" (`dda47a53`)

### Bug Fixes

- **ui-registry**: update registry targets for control components and add new dependencies (`f638f01c`)
- **cli**: fix build + copy migrations (`0ed986a4`)

## [0.20.2] - 2026-04-26

### Features

- **jobs**: update job configurations and schemas for improved scheduling and execution tracking (`119e7168`)
- **api**: remove workflow, subscriptions and issues for now (`4f9ab5f5`)
- **mqtt**: remove package for now (`371b819a`)
- **cli**: platform - Cloudflare - implement putSecret method and update secrets handling (`f95a3064`)

### Bug Fixes

- **react/head**: fix dup server+browser inline script (`a36c3385`)
- **router**: minor fixes for internal router (`a1cdf70a`)
- **api/users**: fix lazy loading of external api modules (`37257438`)

## [0.20.1] - 2026-04-23

### Bug Fixes

- **cli**: change log level from info to debug for platform hooks (`54b5235c`)

## [0.20.0] - 2026-04-16

### Features

- **core**: streamline service registration and enhance module imports [BREAKING] (`ccd92800`)
- **core**: add 'override' method for primitives (`d4f7be43`)
- **auth**: add captcha support for registration and verification processes (`170b2735`)
- **auth**: add captcha requirement option for registration and reset password (`3baf1a0a`)

## [0.19.5] - 2026-04-12

### Features

- **auth**: enhance Apple Sign In integration with external profile support (`5dc3ced2`)
- **cli**: platform - add support for data jurisdiction in R2 and D1 resources (`69ad18aa`)
- **payments**: add Stripe payment provider with webhook provisioning (`d36cc242`)
- **captcha**: add Memory and Turnstile captcha providers with documentation (`33e8d0cc`)
- **cli**: vendor - enhance diff output with line-level changes for modified files (`0cb4af22`)
- **auth**: add authentication primitives for Facebook, Microsoft, and France Connect (`4541aeb3`)
- **react/i18n**: enhance language fallback logic and add tests for non-English dictionaries (`7595d6cd`)
- **cli**: build - add PWA configuration and manifest generation (`e500ec15`)
- **api/issues**: create issues module (`cf9a0a15`)

### Bug Fixes

- **auth**: correct condition for OIDC token retrieval in ServerAuthProvider (`134b2bce`)
- **auth**: improve intent cache invalidation logic for password reset and user registration (`6233e872`)
- **security**: add security notes and clarify intentional design choices in authentication and session handling (`62efcd71`)
- **cli**: dev - update stylesheet inclusion to use module script (`ebd47254`)
- **cli**: improve default value handling in CliProvider (`3be4f5e9`)

## [0.19.4] - 2026-04-10

### Features

- **orm**: replace db.enum by t.enum [BREAKING] (`c5c1c94f`)
- **workflow**: add schemas for workflow execution, registration, and activity tracking (`6ab8fcbb`)
- **subscriptions**: add schemas for managing subscription plans and events (`236bffa3`)
- **users**: implement user deletion cleanup for sessions and identities (`24721278`)
- **auth**: add defaultRoles to login, register, and reset password components (`a615a09b`)
- **notifications**: remove 'failed' status from admin notifications (`cf6882a6`)
- **jobs**: remove batch display from job details and refine status color coding (`612a93a1`)
- **payments**: implement customer caching and error handling in Stripe payment processing (`f29bcab2`)
- **payments**: enhance payment handling with improved error handling, status transitions, and user intent management (`845d3e14`)
- **parameters**: add validation, pagination, and deletion functionalities for parameter management (`71009e9f`)
- **invitations**: implement invitation management module with create, accept, decline, revoke, and expire functionalities (`7927c1e3`)
- **jobs**: add pause/resume functionality and enhance job management (`9d030774`)

### Bug Fixes

- **react**: added a monotonic transitionId counter on ReactBrowserProvider (`cd532bb1`)
- **ui**: remove unused Mantine charts styles import (`0c49bfcf`)
- **cli**: vendor - correct file addition and removal logic in VendorService (`5f2c3241`)
- **cli**: vendor - improve local modifications check before syncing (`31e14868`)
- **cli**: init - update admin layout structure and include admin user layout (`5450c35f`)
- **payments**: rename billing to payments and update related components (`9d956428`)
- **cli**: fix init --saas (`a2bbab62`)

## [0.19.3] - 2026-04-03

### Features

- **cli**: dev - add readiness endpoint and reload handler for Alepha (`7c03a096`)
- **cli**: enhance configuration handling for devtools, platform, and vendor options (`3ef50624`)

### Bug Fixes

- **orm**: streamline SQL execution and enhance error handling (`3207d158`)
- **devtools**: update build script to include UI build step (`f782a908`)
- **logger**: adjust log level for production and browser environments (`61ddb8f5`)
- **core**: enforce production mode during Vite builds (`6a6dbfe4`)

## [0.19.2] - 2026-04-02

### Features

- **orm**: allow index expressions in $entity (`ff75f6c2`)
- **devtools**: expose email/sms to devtools (`63b7de7e`)
- **core**: rename $use to $state [BREAKING] (`4cf2e1ca`)
- **logger**: allow DEBUG=1 which convert to LOG_LEVEL=trace and LOG_FORMAT=pretty (`1b43e6e3`)
- **devtools**: expose devtools as AlephaCli plugin now (`ebdb9457`)
- **ui/admin**: split ui admin pages into submodules (`fec91f42`)
- **api/billing**: init module (`40e05352`)
- **cli**: add vendor plugin - copy alepha sources in project workspace (`10f8f0f7`)
- **api/organizations**: add CRUD module (`9d3c2f7e`)
- **cli**: dev - allow to run 'dev' on multi apps (`40e3eea6`)
- **orm**: add db.organization() for automatic software multi-tenant (`55c6263f`)

## [0.19.1] - 2026-03-20

### Features

- **orm**: pg - use uuid v7 by default (`04d95cdd`)
- **ui**: add SectionHeader and Panel components (`d29dc4aa`)
- **api/users**: add login rate limit (`3ffcc736`)
- **ui/admin**: improve ApiFiles search UI (`92b396b4`)

### Bug Fixes

- **api/files**: add missing security (`8e8d931d`)

## [0.19.0] - 2026-03-18

### Features

- **security**: allow $secure in browser (`8a473778`)
- **topic**: add $topic retain (`d9df97c7`)
- **mqtt**: new module mqtt (`55f3d43e`)
- **server/etag**: add cache control stale-while-revalidate (`6a4de2b5`)

### Bug Fixes

- **cli**: use Map for per-app KV namespace IDs in CloudflareAdapter (`e82110ff`)
- **command**: strip surrounding quotes in .env parser (`92c64d1f`)
- **websocket**: filter sendToLocalConnections by channelPath (`09f07a50`)
- **orm**: pass column key to identity column constructors in PostgresModelBuilder (`74e4dba6`)
- **orm**: add missing return for plain bigint columns in PostgresModelBuilder (`4655e44e`)
- **orm**: fix not operator discarding sibling conditions in toSQL (`35248aeb`)
- **api/users**: fix expired session deletion using wrong key (`08ab071b`)
- **react/router**: fix parent can() checks skipped in SSR access control (`be712687`)
- **websocket**: prevent concurrent connect race condition (`5d9e13ba`)
- **scheduler**: prevent overlapping cron handler executions (`e8167ed9`)
- **orm**: throw explicit error for transactions on unsupported drivers (`2dd7ecc8`)
- **http**: only deduplicate GET/HEAD/OPTIONS requests (`1cb0f7e8`)
- **server**: hide internal error details in production 500 responses (`5d22187f`)
- **server/cors**: default credentials to false for safe CORS defaults (`1340fa87`)
- **server**: prevent header injection via Content-Disposition filename (`cae72f87`)
- **core**: prevent env variable substring collision in parseEnv (`e73f3715`)
- **orm**: use dynamic primary key in Repository.save() (`b2978faf`)
- **orm**: allow filtering by falsy values (0, false, empty string) (`7e8df451`)
- **server/cookies**: split on first = only to preserve base64 cookie values (`fc231082`)

## [0.18.3] - 2026-03-08

### Features

- **orm**: partial indexes, subqueries (exists/notExists), connection pooling config, aggregate functions, dry-run migrations, generated columns, query caching, database views (`cca9a73e`)
- **server/auth**: defer IODC discovery on serverless and dev (`4d74f9db`)
- **server**: add $sse server action primitive (`15216b2c`)
- **cli**: platform - add secret management (`92e7ba9d`)
- **api/notifications**: add admin ui (`e06f5d83`)
- **cli**: platform - docker - add rustfs as default S3 resource (`a2ff5eea`)

## [0.18.2] - 2026-02-27

### Features

- **cli**: platform - add vercel adapter (`ca0c9ec1`)
- **cli**: add favicon support (`5bc8ceb6`)
- **react/head**: allow to refresh a $head (`4fc71bd9`)
- **email**: add brevo provider (`24c0d340`)

### Bug Fixes

- **core**: fix event order (`64cad5bd`)

## [0.18.1] - 2026-02-24

### Features

- **orm/postgres**: don't write schema in migration files (`9c87a892`)
- **cli**: add pretty prompt (`861621f8`)

### Bug Fixes

- **cli**: fix r2 mapping (`5eff4d7b`)
- **orm**: override of now (`63d6574e`)

## [0.18.0] - 2026-02-23

No public changes in range 0.17.3..HEAD

## [0.17.3] - 2026-02-23

### Features

- **server/cookies**: allow $atom inside $cookie for state sync across requests (`18e4797b`)

### Bug Fixes

- **alepha**: fix some duplicate bundles (`a35e23ac`)

## [0.17.2] - 2026-02-17

### Features

- **cli**: "alepha platform" for managing project infrastructures and instances (only CF for now) (`3dc1b6e9`)
- **cli**: alepha deploy cloudflare + provision (`97711038`)

### Bug Fixes

- **command**: pretty runner with stdout (`ee59f0ca`)

## [0.17.1] - 2026-02-15

### Features

- **orm**: use $mode for MIGRATE and SEED (with $seed) (`6afb5702`)
- **core**: add $mode, a primitive for activate a selective boostrap mode (`11dd9503`)

### Bug Fixes

- **cli**: bad refresh with vite in "alepha dev" (`d4ef99ff`)
- **server/links**: reload registry on login (`8c1ec695`)

## [0.17.0] - 2026-02-14

### Features

- **orm**: add $transactional middleware (`12ae668c`)
- **datetime**: add middleware $debounce and $throttle (`a2b5a743`)
- **core**: add $memoize middleware (`576c1b7e`)
- **cli**: add db generate --name <migration-name> (like drizzle-kit) (`da3a858b`)
- **cli**: add dev options (noDevtools, noViteReactPlugin) (`907b7a3c`)
- **server**: add $action.use and $middleware(path:"/", use) (`d1b6aedd`)
- **datetime**: add $timeout middleware (`867ae469`)
- **core**: introduce $pipeline - a middleware runner + $scope, first middleware (`cce16a7f`)
- **api/jobs**: rework module (`06e37ba1`)
- **ui**: DataTable now can add/remove filters, columns. (`7e4a812b`)
- **ui**: add button onClick preventDefault (`2f692ee7`)
- **ui**: add typeform, control size="xs" (`37244dc0`)
- **orm**: add .upsert method (`ff548cd9`)
- **queue**: add cloudflare provider (`6e3d9178`)
- **cli**: init --tailwind (`751c8dff`)

## [0.16.2] - 2026-02-08

### Features

- **cache**: add compress:true (`9676992a`)
- **api/clients**: introduce experimental oauth2 server (`34a6e481`)
- **orm**: findOne/findById now returns T or undefined, add getOne/getById when T or Throw is required [BREAKING] (`2d0b5685`)
- **ui**: minor updates (`39ff895d`)
- **ui**: add Breadcrumb (`86449ef8`)
- **ui**: sidebar - add section group (`90372a96`)
- **cli**: add build --target static for building spa, and easy push to surge.sh (`c948beda`)
- **orm**: add many custom DbError (`846821c4`)
- **bucket**: add R2 support for Workers (`88ea25dc`)

### Bug Fixes

- **react/router**: remove crossorigin from earlyHint css files (`2206fd5e`)
- **system**: buildShellCommand support directory with spaces in command (`d3615e8a`)

## [0.16.1] - 2026-02-03

### Bug Fixes

- **cli**: add missing workerd export (`b122692d`)
- **ui**: remove css inside ts for now (`79f9c405`)

## [0.16.0] - 2026-02-03

### Features

- **server/links**: add can("group:*") (`ecc7bfa9`)
- **commands**: Pretty runner now display duration of current task (`c2e343af`)
- **cli**: rework 'alepha dev', start using shared instances (re-use http server on reload), for better dx & speed (`f3413fc1`)
- **admin**: add default sidebar admin (`d4e6f33f`)
- **ui**: Hide sidebar node if all children are not visible (`97aea7a0`)

### Bug Fixes

- **react/router**: reject transition if can() false (`1c27613c`)
- **server/static**: fix static hosting on Windows (`d4526265`)
- **cli**: fix shell warning on Windows (`47350114`)
- **cli**: fix cli crash on Windows (`7717e214`)
- **ui**: fix lazy loading of styles (`dfdd7ba4`)

## [0.15.5] - 2026-02-02

### Features

- **cli**: greatly improve "alepha init --admin" experience (`7ee728d2`)
- **api/users**: now choose features in $realm (notif, param, job, audit, ...) (`f64930bb`)

### Bug Fixes

- **cli**: fix stacktrace in dev-mode with vite (`9a22c89f`)

## [0.15.4] - 2026-02-01

### Features

- **scheduler**: add workerd support (`4085f724`)
- **email**: add workerd support (`0cb39e3d`)

### Bug Fixes

- **react/auth**: add cache-busting to logout URI to prevent non-desired caching (`c8470d91`)
- **react/server**: fix 'alepha dev' ssr (`d77cfc42`)
- **server/links**: action.secure = undefined add now a link (`2af04138`)

## [0.15.3] - 2026-01-31

### Features

- **react/router**: rename useRouter() .go to .push [BREAKING] (`f385060c`)
- **cli**: show flag enum values in printHelp (`a8d557eb`)
- **security**: actions are not secured by default anymore. secure: true is now required. [BREAKING] (`0973bdfd`)

### Bug Fixes

- **core**: fix unhandled error when running .start() twice (`65661fa6`)

## [0.15.2] - 2026-01-29

### Features

- **react/router**: add page.onEnter (browser only event) (`1fae5992`)
- **cli**: throw error if --arg doesn't exist (`034340a3`)
- **ui**: greatly improve sidebar component (`e551b3a6`)
- **react/router**: merge @alepha/react into alepha main package [BREAKING] (`020b309e`)
- **cli**: init now runs "git init" (`91a0357f`)
- **server**: add more server request context helper (`7a09387c`)
- **cache**: add incr (`15cd4fe0`)
- **redis**: add incr (`fe6d2f0c`)
- **api/keys**: new module for managing API_KEYs (`dbece8bc`)
- **cache**: add testing utils function for memory cache impl (`afdb4454`)
- **security**: allow more than one user-resolver - load user from jwt or apikey or whatever (`10932117`)
- **orm**: repository update accept custom sql``, like Drizzle (`2cc66b23`)
- **cli**: alepha init --pm=bun|node|... and --agent (auto detect claude|codex|...) (`aef9288d`)

### Bug Fixes

- **cli**: allow init in package directory (`a7b1776f`)
- **server/rate-limit**: fix edge cases (`3ac0ab25`)

## [0.15.1] - 2026-01-23

### Features

- **cli**: make index.html optional (`c5476432`)
- **mcp**: add mcp auth provider (`e3b58b19`)
- **orm**: allow to extend Repository.of(entity) (`27210847`)

### Bug Fixes

- **react/router**: fix hydration layer cache (missing part) (`2d5bb481`)

## [0.15.0] - 2026-01-18

### Features

- **cli**: allow "alepha build --bun" for building only with alepha bun-only deps (`bb75c247`)
- **server**: greatly improve http server performance (`232b7a95`)
- **orm**: add db provider "driver" - for specify sqlite driver (default, d1, ...) or postgres (`6dd0fd06`)
- **security**: move all server/security code into security [BREAKING] (`f0eaefd8`)
- **security**: rename $realm -> $issuer and $userReal -> $realm [BREAKING] (`b9230720`)

### Bug Fixes

- **react/router**: fix redirect in SSR streaming mode (`c8657629`)

## [0.14.4] - 2026-01-13

### Features

- **react/router**: rename page 'resolve' to 'loader' as it's more friendly term [BREAKING] (`5fbfb81c`)
- **server/cache**: add stream support (`e6b13604`)
- **vite**: configure alepha build via alepha.config.ts instead of vite.config.ts (`f34590d5`)
- **cli**: add 'alepha gen env' - dump env variables of current app (`a86dd07f`)

## [0.14.3] - 2026-01-08

### Features

- **cli**: add openapi extractor (`5e87f93e`)
- **server/links**: expose link schemas in browser by default (`bd531100`)

### Bug Fixes

- **vite**: use correctly vite server port (`084ee1b6`)
- **server/compress**: fix crash with compress+bun (`24f1ae4f`)
- **ui**: <Sidebar> filter pages based on permissions before populating menu (`eae4bb11`)

## [0.14.2] - 2026-01-05

### Features

- **orm**: alias 'pg' to 'db' and deprecate 'pg' (`9360f3f6`)
- **react/head**: add head.script (`b32b7899`)
- **react**: move all router code in "@alepha/react/router", now "@alepha/react" can be used in Next.js or Expo [BREAKING] (`606260f6`)
- **ui/demo**: add AlephaUIDemo as Alepha UI demonstrator (`6eeaae7a`)
- **ui/json**: add JsonViewer component as standalone module (`10f9fa71`)

## [0.14.1] - 2026-01-01

### Features

- **redis**: add native Bun client support (`e566caeb`)
- **orm**: add native Bun pg/sqlite support (`c5889f17`)
- **orm**: remove all jsonb query features (`2a97d911`)
- **command**: add sub-command support, command env parsing and mode (production, preview, ...) (`565f9093`)
- **cli**: add deploy command (vercel, cloudflare, surge) (`d537cf46`)
- **react/head**: add SEO options (generate og, twitter meta) (`761d5ab9`)

## [0.14.0] - 2025-12-29

### Features

- **cli**: implement changelog generation command (`94559bd1`)
- **vite**: update logger implementation and enhance server start process (`c759db50`)
- **mcp**: integrate MCP API key management and context handling (`951d4fe3`)
- **mcp**: add MCP transport and error handling primitives (`e649f563`)
- **bucket/s3**: add new bucket provider 's3' (`09678594`)
- **command**: equal in '--hello=world' is now optional (`296c9c8e`)
- **vite**: add support of Cloudflare D1 driver + build (`1dbfb6d9`)

### Bug Fixes

- **vite**: precompress files during vite build (`e9712924`)

## [0.13.8] - 2025-12-19

### Features

- **cli**: alepha init now install vite & biome by default (`699d218a`)

## [0.13.7] - 2025-12-15

### Features

- **ui**: add nested object support to TypeForm (`c4e2aaea`)
- **react/form**: support for nested object/array (`54c069f4`)
- **react/core**: add $page props, allow to override props (`f8783eaf`)
- **orm**: add createMany batchSize to avoid hitting database limits (`22a70bc9`)
- **core**: add alepha.core module (`55ccaf61`)
- **core**: add jsonschema to typebox schema converter (`38f4aa19`)
- **api/users**: allow multi user-realm login page (`0a5caebb`)
- **api/users**: allow to add branding stuff to user-realm for ui customization (`b6a6a5c7`)
- **api/parameters**: create api/parameters, a versioned configuration manager (`6601145f`)
- **api/audits**: create api/audits, a new way to log important events inside the app (`78c8d0ab`)
- **cli**: add pre/post hooks (`76ce04c4`)
- **ui**: add theme cookie ttl (`83408abd`)

### Bug Fixes

- **ui/admin**: add admin pages for all api modules (`f9f43fc0`)
- **react/i18n**: fix date format when input is number (`ff8fab47`)
- **orm**: fix t.array of pg.enum (`ff2120de`)
- **core**: register atom set default value on parent store during request (`9305c07e`)
- **vite**: fix error stacktrace on logger output (`d94bb9ea`)
- **orm**: fix missing sqlite bigint mapping (`b4037f6f`)
- **react**: fix ssr template (`7b7d122a`)
- **cli**: fix pnpm bin path (`1dde1534`)

## [0.13.5] - 2025-12-07

### Bug Fixes

- **cli**: fix exec on Windows (`f9495145`)

## [0.13.4] - 2025-12-06

### Bug Fixes

- **ui**: fix export file (`7d1ef88c`)

## [0.13.3] - 2025-12-04

### Features

- **react/head**: allow to add links (`1d830875`)
- **cli**: add command extension via alepha.config.ts (`a926dd43`)
- **command**: add ask.permission (`24ee0e6a`)
- **ui/auth**: add verify email ui (`3a818901`)
- **ui**: add more administration pages (`33ad2a20`)
- **ui**: add theme button (`ea9639fd`)
- **api**: add browser exports (`4617237b`)

### Bug Fixes

- **api/users**: set emailVerified: true when creating a user from oauth2 provider (`7740d68b`)

## [0.13.2] - 2025-12-01

### Bug Fixes

- **server-swagger**: fix ui path (`ca0577e0`)
- **cli**: fix missing env on db:* commands (`5e57bff3`)

## [0.13.1] - 2025-11-30

### Bug Fixes

- **cli**: fix build (`f6ebb040`)
- **cli**: minor fixes (`5d13299b`)

## [0.13.0] - 2025-11-29

### Features

- **server**: add node http server "keepAlive" to true by default (`044fa014`)
- **server-multipart**: add more security (check length) (`09f33d81`)
- **server-rate-limit**: add global $rateLimit (`db668e44`)
- **server-cors**: add global $cors (`3b44cb8e`)
- **core**: add text.lowercase (`3d34493b`)
- **websockets**: add example app (`6b10f757`)
- **api-users**: add login view (`9683a31a`)
- **server-auth**: add login component (`d6d05805`)
- **vite**: add cloudflare workers support (`94de6179`)
- **server**: add node & web request handler, use web request body parser (`c142617c`)
- **benchmark**: add bench again (`63773bf7`)
- **security**: add InvalidCredentialsError (`1882363f`)

### Bug Fixes

- **command**: fix pretty display (`757e6604`)
- **vite**: fix pre-rendering (`81a7bafd`)
- **cli**: fix alepha build (`9861a65a`)
- **api-users**: fix user context (`4ce6e2b8`)
- **api-users**: fix reset password (`612a1e40`)
- **api-users**: fix register (`9c06f6bd`)
- **fake**: fix faker export (`a868127f`)
- **ui**: fix vite.config imports (`74119b23`)

## [0.11.12] - 2025-11-17

### Bug Fixes

- **react**: fix deps (`12f38f70`)
- **devtools**: fix build on ci (`de53eccc`)
- **security**: fix some bugs (`3ffc033d`)

## [0.11.11] - 2025-11-15

### Features

- **alepha**: add keywords (`69ee0954`)
- **alepha**: add npm description (`3f6b8373`)

### Bug Fixes

- **alepha**: add init --orm, fix alepha dev with server only (`a0d83602`)
- **postgres**: rename module to orm alepha: fix init command file: add more methods (`3e7e3652`)

## [0.11.9] - 2025-11-14

### Bug Fixes

- **alepha**: fix main paths (`2fef20ef`)
- **alepha**: fix release (`9960ed7f`)
- **cli**: fix bah subpath (`199f2f6e`)

## [0.11.7] - 2025-11-14

### Features

- **server**: add test for action response filter (`37c8e2f8`)
- **api-jobs**: add provider (`64b24101`)
- **retry**: add retry for flaky test (`2c1d1023`)
- **react-form**: add submitting state (`e6334da5`)
- **ui**: add POC of JsonViewer (`893e6d90`)

### Bug Fixes

- **react**: fix useStore refresh (`39d299cb`)

## [0.11.6] - 2025-11-10

### Features

- **ui**: add DataTable infinite scroll (`a68c119d`)
- **postgres**: add converter string -> querywhere (`150a5744`)
- **cli**: add more drizzle-kit commands (`ca278739`)
- **core**: add $atom, remove .configure() (`4bf9442c`)
- **email**: add $email (`35fb739d`)
- **postgres**: add crud hooks (`f1559d61`)
- **core**: add codec.validate (`51fe9656`)

### Bug Fixes

- **batch**: fix uncaught error (`d447a47b`)
- **core**: prefix all states by "alepha." (`0e73a640`)
- **vite**: fix stacktrace error (`951d8d21`)
- **postgres**: fix missing dep (`b301dc81`)

## [0.11.5] - 2025-11-05

### Features

- **vite**: add stats plugin (`f8ea7708`)
- **file**: add FileSystem & NodeFileSystem (`7d8e7c51`)
- **ui**: add collapsed sidebar (`6e11e39d`)
- **devtools**: add logviewer (`24ed1484`)
- **devtools**: add ui (`1eddb861`)
- **ui**: refactor Sidebar, add ActionButton, OmnibarButton, LanguageButton (`5050b655`)
- **react**: add useAction() for handling user action on ui (`2ba970fe`)
- **fake**: add new module for faking data based on typebox (`8520c50c`)
- **react**: add browser test (`54f4aa76`)

### Bug Fixes

- **ui**: fix action href when http://, fix theme (`22b26dd1`)
- **server**: fix vite dev server reload when file got ?t=timestamp (`34e2eb51`)
- **react**: fix useAction refresh, replace useRouterEvents by useEvents, add new method router.concretePages (`cda992ff`)
- **cli**: fix bad version (`a7a56ff3`)

## [0.11.3] - 2025-10-31

### Features

- **react-i18n**: add <Localize/> (`4dd0ff7d`)

### Bug Fixes

- **server-links**: fix browser links (`555512c2`)
- **postgres**: fix sqlite count (`a8632856`)

## [0.11.2] - 2025-10-30

### Features

- **starter**: add tests (`2bfde2c5`)
- **starter**: add starter inside monorepo too (`b5f5789b`)
- **integration**: add react ssr test (`b2811e4d`)

### Bug Fixes

- **postgres**: fix dev synchro of sqlite (`45893603`)
- **server-links**: fix local link (`5526e49f`)

## [0.11.1] - 2025-10-29

### Bug Fixes

- **server-cookies**: fix useless load of security (`e196fb79`)
- **ui**: fix build (`f1133bde`)

## [0.11.0] - 2025-10-29

### Features

- **cli**: add commands for each tool used by alepha (`a63fe444`)
- **ui**: add DataTable, Sidebar, more Action options (`5a1818c5`)
- **postgres**: add missing test file (`1f7fc23e`)
- **core**: allow func instead of class logger: improve colors cli: add alepha dev (`6a5aaf16`)

### Bug Fixes

- **core**: fix trim server: http client fetch now use schema for response typing logger: shorter uuid on dev (`49f0e6f7`)
- **scheduler**: fix bad log (`2106326f`)

## [0.10.7] - 2025-10-23

### Features

- **alepha**: add ui, verifications & notifications (`289ff463`)
- **postgres**: relations - add more tests (`ed2dfc95`)
- **ui**: add ControlDate (`37f452aa`)
- **ui**: add TypeForm first version ui: add DarkModeButton (`dd4dba74`)
- **ui**: add default router (`5a17fc93`)
- **protobuf**: add enum support (`04338008`)
- **api-users**: add all CRUD controllers server: add beginning of 'web' server support server-cache: improve cache api (`cbc4f8b0`)
- **playground**: add jp ui (`c0efbca2`)
- **api-users**: add verify email service (`9a92ab6c`)
- **api-notifications**: add sms provider (`8b7b890b`)
- **core**: add text trim api-validations: create module (`30796249`)
- **email**: add support of () => body (`d7a579b3`)
- **email**: add support of template {{ value }} (`a7cbcf48`)
- **api-users**: add users forget password (`fbb861dd`)
- **api-users**: add users forget password (`6b33f4ed`)
- **postgres**: add pg jsonb queries (`086fba23`)
- **postgres**: another try to add relations (`b1c3acfe`)
- **postgres**: add 'where' -> findOne (`f5dc6e8f`)

### Bug Fixes

- **api-files**: add metadata update postgres: minor fixes react-i18n: add more tests ui: add examples (`69a7792e`)
- **postgres**: relations - fixes (`55f170d2`)
- **postgres**: fix distinct (`f16aedc4`)
- **core**: add alepha.isViteDev core: fix events.emit typing api-notifications: create module (`2aade9c4`)

## [0.10.6] - 2025-10-16

### Features

- **server-links**: add realm security (`c4a26b29`)
- **server-cache**: add support of etag without caching (`cabf02f8`)

### Bug Fixes

- **cli**: fix bin path (`fad8e0d8`)
- **server-cache**: fix etag-only feature (`f25d25a4`)
- **postgres**: fix bad mapping of t.date() with postgres date string (`3075ba67`)

## [0.10.5] - 2025-10-13

### Features

- **postgres**: add missing export (`db714f67`)

### Bug Fixes

- **vite**: let vite handle request in dev only if writeHead has not been called (`613dcdc1`)

## [0.10.4] - 2025-10-13

### Features

- **postgres**: add pg.one (`0ca23297`)
- **postgres**: add pg.many (`7664d584`)
- **api-users**: add built-in realm & auth configurations (`f36c6f67`)
- **scheduler**: add begin/end events (`946b462f`)
- **api-files**: add more tests (`cc0b1fd3`)
- **api**: add all entities for all api modules (`aae593fd`)
- **devtools**: add /logs (`d538216b`)
- **cache**: add .clear() (`bcaf84d9`)

### Bug Fixes

- **api-users**: fix deps (`d43f9293`)
- **server**: fix queryparams parser (`3688ae75`)

## [0.10.3] - 2025-10-04

### Features

- **devtools**: add POC ui (`1d44df81`)
- **react**: add router.reload() (`adb59853`)

## [0.10.2] - 2025-10-03

### Features

- **devtools**: add module/provider collector (`ce5aef54`)
- **devtools**: add several collectors (`75abd610`)

### Bug Fixes

- **server**: fix run config typings (`ed3965df`)

## [0.10.1] - 2025-09-29

### Features

- **cli**: add pm choice (`342f18d7`)
- **command**: add Ask helper (`3eddfc93`)

### Bug Fixes

- **server-compress**: fix build (`9d8db551`)
- **cli**: fix version replace (`2edcfef6`)

## [0.10.0] - 2025-09-20

### Features

- **swagger**: add array support for request body (`3fefd1ba`)
- **commands**: add cli cmd <args> parser (`4eafb12e`)
- **protobuf**: add support of array and more primitives (`9966648b`)
- **server**: add request-id to http error response (`0d1d875d`)
- **server-cache**: add etag-only on route (`c13374d5`)

### Bug Fixes

- **command**: fix tests (`703028d5`)
- **react-i18n**: fix tr() typing (`0977e8be`)
- **queue**: fix build (`e2ba1c0e`)

## [0.9.5] - 2025-09-14

### Features

- **thread**: add polling (`a715c4ce`)
- **react**: add more tests (`a2251d3c`)
- **react-head**: add useHead() (`5eeae0ef`)
- **server-rate-limit**: add $rateLimit and by $action (`8efa179f`)
- **server-rate-limit**: add more tests (`651ff506`)
- **server-rate-limit**: add proof of concept (`6164b30c`)
- **server-static**: add support of filename with space (`fed43c15`)
- **react**: add page animation enter/exit (`93f940cc`)
- **react**: add page.animation (`0ac77910`)

### Bug Fixes

- **thread**: fix build (`47e22333`)
- **react**: fix nested view bad refresh when 2 layers are refreshed (`a1c4341c`)
- **core**: fix tests (`8f55407b`)
- **core**: fix non-singleton service injection after start (`90b64ae9`)

## [0.9.4] - 2025-08-22

### Features

- **postgres**: add soft delete with pg.deletedAt() (`198a0150`)

### Bug Fixes

- **logger**: fix typings (`06919988`)
- **bucket-azure**: fix name mapping (`c9f0a48a`)
- **server**: fix multipart client (`d402ce3c`)
- **postgres**: fix bad type mapping (`96ae3075`)
- **react**: fix push base path (`34c705cc`)
- **server**: minor fixes (`63dfab06`)

## [0.9.3] - 2025-08-10

### Features

- **react**: add internal auth (`1df00a70`)
- **react**: add static cache page (`12d7f30c`)
- **i18n**: add more docs (`3356d2fd`)

### Bug Fixes

- **react-auth**: fix bad ttl on tokens cookie (`6f065f97`)
- **react-auth**: fix refresh typ (`c2b23b50`)
- **vite**: fix bad path (`400bd66e`)

## [0.9.2] - 2025-07-30

### Features

- **react**: add react form docs (`aebcd8cd`)
- **react**: add new package "react-form" (`7b0031c9`)

## [0.9.1] - 2025-07-29

### Features

- **command**: add run.cp (`17da7efd`)
- **command**: add typebox string augmentation (`31a299e9`)

### Bug Fixes

- **vite**: fix pre-rendering (`2fcc485f`)

## [0.9.0] - 2025-07-26

### Features

- **thread**: add package (`513ca7ed`)
- **bucket**: add more options to events (`cf281df9`)
- **bucket**: add upload/delete events (`87f72c65`)
- **bucket**: add memory & local impl (`bfb320df`)

### Bug Fixes

- **server**: node - fix body response stream from webstream (`5a7453cb`)

## [0.8.1] - 2025-07-16

### Features

- **react**: add support of base url (`cc8d088f`)

## [0.8.0] - 2025-07-13

### Features

- **command**: add new package (`0916f79d`)
- **queue**: add context id (`a0af80af`)
- **server-static**: add tests (`e5343987`)
- **alepha**: add compress & multipart (`68ad485c`)
- **server-cors**: add tests (`26a40ed8`)
- **server-cookies**: add encrypt+sign and tests (`b2006484`)
- **server**: add x-request-id support (`d9a5d02c`)
- **postgres**: add $db (`9e63a1fb`)

### Bug Fixes

- **server-static**: fix deps (`2ce5a02e`)
- **server**: fix browser imports (`1735d416`)

## [0.7.7] - 2025-07-06

### Features

- **postgres**: add a sneaky sqlite mode (`81467fb1`)

### Bug Fixes

- **server-links**: fix typings (`1d0e0821`)

## [0.7.5] - 2025-07-02

### Features

- **postgres**: add distinct & columns (`f75794dd`)

### Bug Fixes

- **postgres**: fix var env order (`75cc2b96`)
- **core**: fix crash on browser (`574d2e69`)
- **cache**: fix tests (`357b4596`)

## [0.7.4] - 2025-06-30

### Bug Fixes

- **scheduler**: still trying fix tests on gh (`85451a0f`)
- **scheduler**: add prefix to tests (`3c147739`)
- **scheduler**: try to fix tests on gh actions (`8f0aa3f7`)

## [0.7.3] - 2025-06-28

### Bug Fixes

- **postgres**: improve built in drizzle kit server: fix etag bad cache key on browser vite: refactor plugins (`fca91f63`)

## [0.7.1] - 2025-06-25

### Features

- **bucket**: add bucket-azure (`1b4fd4e4`)
- **server**: cache - add etag support (`9d3100f1`)
- **react**: add $page.client (like ssr=false) (`2087bebe`)
- **react**: add server cache (`0a0c3a20`)
- **react**: add SSG (`c365e16b`)
- **core**: add file() util (`289a9825`)
- **server**: add get link schema (`9e0e69ca`)
- **server**: add action cache (`7d799a20`)
- **security**: add permission exclude (`35be968c`)
- **server**: client - add getLinks force:boolean (`aecedb92`)
- **server**: add $remote.withSchema (`fceb9989`)
- **server**: add compress for stream, add server timing (`d9a49704`)
- **server**: add compress (`f5ce2066`)
- **server**: add client scope options (`46228e06`)

### Bug Fixes

- **postgres**: fix push with pgschema (`e74484b0`)
- **react-auth**: fix get access token from cookies (`d4634c11`)
- **postgres**: fix sync devmode (`7b757bb5`)
- **postgres**: fix synchro in devmode (`28b3d015`)
- **core**: fix json logger error (`2ae82a0c`)

## [0.7.0] - 2025-05-31

### Features

- **server**: add not-ready, health project: upgrade dependencies (`40ed00f7`)
- **core**: add $retry onError (`3faf3288`)
- **static**: add historyApiFallback (`d5916e26`)
- **postgres**: add pagination count (`6a5c5098`)
- **security**: add jwt service account (`0d6572f8`)

### Bug Fixes

- **react-auth**: fix bad url (`ae96c774`)
- **react**: fix auth (`a1214a00`)
- **react**: fix typings (`e568c40f`)
- **server**: fix tests (`f9b67630`)
- **security**: fix typings (`5f6e3737`)

## [0.6.10] - 2025-05-21

### Features

- **server**: $remote - add more options (`76dc820a`)
- **server**: add missing type + tests (`41f6ad75`)

### Bug Fixes

- **server**: fix invalid content type mapping (`1e0dbbfd`)
- **proxy**: add rewrite url + fix forward headers (`2a5da077`)
- **server**: fix client file response (`a9d3f70f`)
- **queue**: fix browser module (`145fc5fe`)

## [0.6.9] - 2025-05-19

### Features

- **server**: add filepath to FileLike (`e1ae1189`)
- **server**: add http client response file (`5cbf68d0`)

### Bug Fixes

- **server**: fix node import inside browser (`0499f21e`)
- **server**: fix header merge (`92c63e58`)
- **server**: fix local function response parsing (`205c30c8`)
- **server**: minor fixes on multipart (`35e3225c`)
- **server**: fix missing casting fileLike on http request (`6f5ac2eb`)
- **server**: fix arrayBuffer casting (`91b512c5`)

## [0.6.8] - 2025-05-17

### Features

- **vite**: add line to separate each run (`dad5e0f6`)
- **server**: add var env for als, default to true (`ebb2e79b`)
- **react**: add useApi<T> (`4eaad177`)

### Bug Fixes

- **postgres**: add $entity, fix default schema name (`d6fce4e1`)
- **queue**: fix provider start order (`cc164410`)

## [0.6.6] - 2025-05-16

### Bug Fixes

- **alepha**: fix package.json (`e749caa5`)

## [0.6.5] - 2025-05-16

### Bug Fixes

- **swagger**: allow string response, fix ui patch (`39b9904d`)

## [0.6.4] - 2025-05-11

### Features

- **swagger**: add initOauth options (`1f52aca4`)
- **alepha**: add missing exports (`c637d941`)

## [0.6.3] - 2025-05-10

### Features

- **server**: add ip, user-agent to http request logger (`9f8b356b`)
- **static**: add headers supports (`cacf4100`)
- **server**: add t.file() response support (`535cb959`)
- **swagger**: add option to disable ui (`1f1d2cae`)
- **server**: add multipart support (`6331127e`)
- **server-proxy**: add $proxy (`f492ee0e`)

### Bug Fixes

- **react-auth**: fix browser side user (`d2a99dde`)
- **cookies**: fix set-cookie header (`f53b1aa5`)
- **swagger**: fix copy script (`16c68e6d`)
- **playground**: fix ssr (`d995ae77`)
