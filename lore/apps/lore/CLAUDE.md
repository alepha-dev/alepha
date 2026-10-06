# Alepha Lore

Project management app built with [Alepha](https://github.com/alepha-dev/alepha). Users create **projects**, forge **quests** with objectives, invite **members**, and progress together across **areas**. The RPG vocabulary describes the work, never the person — there is no XP, gold, level or achievement system (see "De-gamification" in [`packages/@lore/core/CLAUDE.md`](../../packages/@lore/core/CLAUDE.md)).

It has since grown well past a quest tracker. The load-bearing surfaces today are **quests** (roadmap + in-flight work), **folios** (project memory, wiki-linked, optionally end-to-end encrypted, and — since the 2026-08 rename — including the directory tree + binary blobs that used to be a separate "Archive" module), **feedback** (inbound bug/feature triage), and **blights** (deduplicated crash telemetry from partner sites via **sigils**). All four are exposed over **MCP**, which is the primary consumer.

Alepha Lore is the **only public Alepha app** and exists in large part to **dogfood the framework** — improvements and bug fixes upstream are part of the job, not a side quest.

## The Lore of Lore (start here)

The production Alepha Lore instance hosts the project we actually use to run this project: **`https://lore.alepha.dev/lore`** — the "Lore of Lore", **project id `74`** over MCP since 2026-10-01, when Lore left the Alepha monorepo (#E72) and its quests, epics and folios moved out of project `1` (`Alepha`) with their numbers unchanged. Before that it was project `1`, and before 2026-08-18 project `2` (an older note's quest `#208` is `#1208` since that merge). The web URL is slug-addressed since 2026-08-13 (`/p/2` no longer resolves); the slug comes from the project's title, "Lore", via the backfill in `20260813135343_nappy_excalibur`. MCP still addresses it by id, so the id stays the durable reference. It is the canonical source of truth for what's planned, in-flight, and remembered on Alepha Lore itself. It also dogfoods the MCP surface — every Claude session working on this repo should treat that project as a first-class input, not background trivia.

**Before non-trivial work, orient via MCP** (these tools are already exposed on `mcp__claude_ai_Lore__*` for this account, project id `74`):

1. `project_context` — one-shot orientation (project metadata + active quests + folio index, ~2K tokens).
2. `folio_get` on the folios that look relevant — folios are the shared memory between you and the user across sessions. The user relies on them heavily, so **read first, write often**.
3. `quest_list` / `quest_get` — quests are the **most load-bearing** piece. They are the roadmap and the in-flight work tracker. If a task corresponds to a quest, drive it from the quest (read objectives, update status, complete on done).

**Write back what's worth keeping.** When a session produces a non-obvious decision, gotcha, or architectural fact about Lore/Alepha, persist it as a folio (`folio_create` / `folio_update` with a good `summary`). When in-flight work changes scope or completes, reflect it on the matching quest. Conversation history is ephemeral; folios and quests are the project's long-term memory.

Lore's vocabulary has been renamed twice. Originally the codebase used the plain technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`; a first rename swapped every one of those for RPG flavor — `campaign`/`quest`/`zone`/`member`/`chronicles`/`difficulty` — across code identifiers, DB tables, HTTP routes, MCP tools and URL params. The **2026-08 great rename** partially reversed that: the top-level container went back to the plain, technical **`project`** (campaign → project, `/c/:campaignId` → `/:projectSlug`, `campaign_*` MCP tools → `project_*`), because "campaign" read as more RPG-themed than the container itself deserved. The RPG vocabulary that describes the _work inside_ a project was kept and in some cases sharpened: **quest**, member, folio, blight, sigil are all still RPG-flavored on purpose (the F/C/B/A/S difficulty ranks were part of that list until 2026-08-20, when the whole difficulty mechanic was erased: see "De-gamification" in `packages/@lore/core/CLAUDE.md`). A later de-RPG pass (2026-08-09) then took **zone → `area`**: it named the functional part of the system a quest belongs to — "analogous to an Epic in Jira" by its own MCP description — and the map metaphor was carrying no weight. Column, route, `$page` name, MCP param and both locales moved together (FR: _Domaine_). Three other nouns were renamed in the same pass for clarity rather than theme: Petitions → **Feedback**, Chapters → **Milestones**, and Chronicles → **Reports** (with Reports▸Party → Reports▸Members). The old standalone "Archive" module (directory tree + blobs) was folded entirely into **Folios** — same entities, same MCP tools, one mental model instead of two. A **user** is the account; a **member** is that user's membership row in a project. Identity (name, picture) always comes from the account — the per-project "character" concept was removed in the 2026-07 de-gamification pass.

A fourth pass (2026-08-30, epic #14) took **Milestone → `release`**: table, entity, controller, jobs, routes, `$page` names, components, both locales and the specs. It is a rename plus a **wipe** — every milestone row was deleted and Releases start empty in every project — because the two are not the same model. A milestone was a time window that collected whatever happened to complete inside it; a release is a named goal (`0.28.0`, `demo-1`) that **holds** the epics and quests due to ship in it. Membership is an assignment, not a window. Two identifiers deliberately did **not** move with it at the time, `projects.features.milestones` (a REQUIRED key inside a JSON column, see the incident below) and `projects.milestoneDuration`; both columns were dropped with #E74. Migration: `20260830112947_milestones_to_releases`, `DELETE` + two `RENAME`s, zero `DROP TABLE`.

A project may name **one** of its open releases the **default** (epic #E48, `releases.defaultSince`): where a completed quest that names no release, and inherits none from its epic, lands, and what an epic begun without a release takes and carries down to its own release-less quests. ⚠️ **Not a third state.** A default release is still `open`, `ReleaseState` still has exactly two values, and the UI draws a second orthogonal chip beside the state one - folding it in would make the state filter lie. A fallback rather than a plan: zero defaults is normal, creating a release never picks one, publishing the default clears it on that row (otherwise the next completion could not close) and hands it to the release next in line - the lowest open release above it whose patch is 0, never a patch, a prerelease, a named tag or anything older (`DefaultReleaseService.successor`) - and reopening does not restore it. That hand-off is a second, best-effort write after the publish patch (D1 has no transaction): if it fails the project is left with no default, never with a failed publish. The swap is a single `UPDATE ... CASE ... RETURNING` in `DefaultReleaseService` with **no** partial unique index behind it - SQLite checks uniqueness per row as the update walks, so the guard would throw mid-swap. Written up in `docs/1-guides/8-releases.md`.

All user-facing strings still go through `I18n.ts` for EN/FR localization.

## This app is the executable

Since #E75 (2026-10-06) the product lives in four packages, and `apps/lore` is what composes and ships them. Each package documents itself; read the one you are changing:

| package           | is               | its `CLAUDE.md`                                                                                                                                         |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lore/core`      | the glue         | [`packages/@lore/core/CLAUDE.md`](../../packages/@lore/core/CLAUDE.md): barrels, registries, capabilities, access, routing traps, I18n, no transactions |
| `@lore/work`      | Lore as Jira     | [`packages/@lore/work/CLAUDE.md`](../../packages/@lore/work/CLAUDE.md): quests, epics, releases, kanban, roadmap, feedback                              |
| `@lore/knowledge` | Lore as Obsidian | [`packages/@lore/knowledge/CLAUDE.md`](../../packages/@lore/knowledge/CLAUDE.md): folios, directories, attachments, protected folios                    |
| `@lore/deploy`    | Lore as Vercel   | [`packages/@lore/deploy/CLAUDE.md`](../../packages/@lore/deploy/CLAUDE.md): apps and instances, sigils and telemetry, deployments, estates              |

The framework is **vendored**: `.vendor/alepha` and `.vendor/@alepha/ui` are the framework's `main`, synced by `yarn vendor:sync` and committed, and they are workspaces, so `alepha` / `@alepha/ui` resolve to them as source. Alepha has near-zero training data: read `../../.vendor/alepha/src/...` and `../../.vendor/@alepha/ui/src/...` as the authority, and **never edit them here**.

```
apps/lore/
├── src/
│   ├── main.server.ts    # Server entry: the environment wiring, every entry-level substitution, then the @lore/* modules, core first
│   ├── main.browser.ts   # Browser entry: the four web modules, the admin pages, AlephaSigil
│   ├── main.css          # Tailwind, with one @source per package
│   ├── providers/        # LoreSigilSinkProvider: Lore reporting on itself, in process
│   └── web/admin/        # Lore's pages inside the shared admin shell
├── test/                 # Scenario specs: they span several packages, and boot through bootLore()
├── migrations/sqlite/    # Drizzle migrations (D1 / SQLite), the whole app's
├── scripts/              # inventory, rehearsal, font fetch
└── public/               # Static assets served at /
```

**The entries are the only place the packages meet.** `main.server.ts` registers, in this order: every substitution that must precede a module (the job sweep cron, email, captcha, file access, OAuth, the estate command transport, scope grants, inbox and preference providers); `LoreCoreApi`, `LoreWorkApi`, `LoreKnowledgeApi`, `LoreDeployApi`; the four MCP modules; the `SigilSinkProvider` substitution; then the four web modules, `AlephaSigil` and `LoreWebAdmin`. A substitution recorded after a module resolved what it replaces is a `TooLateSubstitutionError`, so a new one goes above the modules. `main.browser.ts` registers the same four web modules: SSR and hydration read one page registry. There is no `LoreApi`, `LoreMcp` or `LoreWebApp` any more.

**Specs.** A spec whose subject is one package lives in that package's `test/` and boots its module alone. `apps/lore/test` holds the scenario specs, the ones that need several packages registered, and boots them with `bootLore(alepha, layers)` (`test/fixtures/bootLore.ts`): `api`, `mcp`, `web`, or `routes` (every router and account page, without the UI behind them). The migration specs live here too, because the migrations are the app's.

## Commands

```bash
yarn dev               # Dev server (HMR) on http://localhost:3303
yarn start             # Prod-like (build + node dist) on http://localhost:3000
yarn build             # Production build
yarn typecheck         # alepha typecheck
yarn lint              # alepha lint
yarn test              # alepha test
yarn db:generate       # Generate new migration from entity changes
yarn v                 # From the repo root: lint, typecheck, audits, unit tests, build, both e2e suites (apps/e2e)
yarn v --fast          # The inner loop: stops after the unit tests. CI stays the gate
yarn deploy            # alepha platform up -e production (Cloudflare D1)
```

## What's deployed? — `GET /version`

`GET /version` is **baseline Alepha** now — `ServerVersionProvider` ships with
`AlephaServer`, the way `/health` does, so Lore has no controller of its own for
it any more (`VersionController` was deleted).

```bash
curl -s https://lore.alepha.dev/version
# {"name":"lore","version":"0.27.1","commit":"6faea71",
#  "build":{"date":"2026-08-31T...","runtime":"workerd","dev":false},
#  "framework":"0.27.1"}
```

Use it to confirm a deploy actually went live (vs. a stale Cloudflare cache) and
to map a reported bug to the exact tip it runs against.

The record is resolved once at build time and baked into the server **and** the
client bundle, so `alepha.meta` reads the same answer in the browser as on the
server. The endpoint is public on purpose: Lore lives in the open-source
`github.com/alepha-dev/lore` repository, so the commit SHA leaks nothing.

⚠️ **`version` is declared in `alepha.config.ts` and has to be.** The framework
resolves it from `git tag --points-at HEAD`, falling back to `"latest"`. Lore
deploys on **every push to main** while tags exist only on releases, so the
built-in chain would report `"latest"` on almost every deploy. The `meta` block
publishes Lore's own `pkg.version` (`apps/lore/package.json`, bumped by the
release with `@alepha/lore`); the framework it runs on is the `framework` field:

```ts
meta: { version: pkg.version },
```

`commit` and `build.date` need no such help and are gone from the config: the
build resolves both. `commit` survives CI's shallow clone (resolving HEAD needs
no tags), so even a `"latest"` build says exactly which commit is running.

## ⚠️ Migration safety on D1 (production-data bomb, real incident)

A table rebuild is how drizzle-kit changes what SQLite cannot alter in place (`CREATE __new`, `INSERT FROM SELECT`, `DROP old`, `RENAME`). Its `DROP old` fires `ON DELETE CASCADE` and `SET NULL` on every referencing child row unless `PRAGMA foreign_keys=OFF` holds for that statement.

**This already cost us all of lore-production once** (2026-05-13, migration `0023_special_purifiers.sql` flipping campaign feature defaults — `DROP TABLE campaigns` cascade-wiped `characters`, `quests`, `chapters`, `folios`, `petitions`). Recovered from D1 backup. Tracked upstream as [drizzle-team/drizzle-orm#4938](https://github.com/drizzle-team/drizzle-orm/issues/4938), no fix shipped.

**Which transport decides it.** In May the migrations went through the D1 query endpoint, which ignores the pragma. Since framework #1514 `D1MigrationsService` applies each migration file through the D1 **import** flow, which honoured it in one measurement (2026-09-07: 5 of 5 child rows kept, against 0 of 5 through the query endpoint; folio #F1359). One five-row measurement is not a guarantee, so the rule stands for a different reason: **a rebuild of a table with children is unproven at scale, and never needed** - a plain column goes with `ALTER TABLE ... DROP COLUMN`, which drizzle-kit generates on its own for any column without a foreign key, and which D1 has applied to `quests`, `sigils`, `folios` and `projects`.

**What guards it** (#E74):

1. **The framework marker.** `check:migrations` (and `platform up`) refuses any `DROP TABLE` without a `-- alepha-allow-drop-table: <why>` comment on the line above it.
2. **`test/migration-safety.spec.ts`.** Every dropped table needs a per-migration `SANCTIONED_DROPS` entry, and since `CASCADE_BASELINE` a table whose previous snapshot shows a `CASCADE` or `SET NULL` child is refused **whatever the entry says**. Only a leaf can be rebuilt or dropped (precedent: `folio_blobs` in `20261004225050_drop_dead_folio_columns`).
3. **The `Rehearse migration` workflow** (`workflow_dispatch`, run it on the branch carrying the migration and link the run from the quest). `alepha rehearse` copies lore-production into a throwaway remote D1, applies the pending migrations through `D1MigrationsService` (production's transport), and fails when a surviving table's row count moves or a table vanishes that no marker names. A backfill that grows its table on purpose says so with `-- alepha-rehearse-allow-insert: <why>` directly above its `INSERT` (#Q2626): growth is then accepted for that table, a shrink still fails. The copy and the dump never leave the runner and are deleted whatever happens.
4. **The Time Travel bookmark.** `Deploy latest` prints `wrangler d1 time-travel info lore-production` before every deploy; the restore is the one command it prints.

**A column stops being read before it is dropped,** and the drop ships alone, in its own push to `main`.

**The migrate-before-deploy window is accepted.** `platform up` migrates, then deploys, so for a few seconds the previous Worker still SELECTs a dropped column and its reads of that table fail. With one user, the owner accepted it (2026-10-04): a drop simply deploys, with no quiet hour and no post-deploy migration phase.

**Why local testing won't catch it:** every database the suites build is empty or seeded by hand, so a cascade only shows up where rows exist. The rehearsal is the step that has them.

**CI auto-deploys to prod on every push to `main` whose Verify succeeds** (this repository's `.github/workflows/verify.yml`, workflow **Verify**, then `.github/workflows/deploy-latest.yml` → `deploy-lore-production` job, a `workflow_run` on Verify → `yarn alepha platform up --env production` from `apps/lore`). A Verify cancelled by a newer push skips that commit's deploy; the next green push ships it. There is no human gate between push and prod migration. Treat every D1 migration as you would a `DROP DATABASE` — read every line before pushing.

### What the 2026-08 great-rename migration got right (worked example)

`migrations/sqlite/20260805005114_green_captain_universe/` is a rename-only migration for the whole vocabulary rename — **6 table renames** (`campaigns`→`projects`, `petitions`→`feedback`, `chapters`→`milestones`, `archive_directories`→`folio_directories`, `archive_blobs`→`folio_blobs`, `archive_names`→`folio_names`) and 15 column renames, entirely via `ALTER TABLE ... RENAME TO` / `RENAME COLUMN`. **Zero `DROP TABLE`.**

drizzle-kit's auto-generator wanted to add a `projects` table _rebuild_ on top of the renames, because the `features` column's JSON `DEFAULT` embeds the old key names. That block was **deleted by hand** from the generated migration, which left the snapshot and the live column disagreeing on that DEFAULT until #E74 dropped the column. Do not "fix" a drift like that by generating a rebuild of a parent table: that is the bomb, not the fix.

### ⚠️ Renaming a REQUIRED key inside a JSON column takes production down (real incident, 2026-08-05)

The rename above shipped green — the checks passed, e2e passed, the migration was
rename-only with zero `DROP TABLE`, and prod data survived intact. Production
still broke on **every project read**, minutes after deploy:

```
SchemaValidationError: Invalid input: 'features/feedback' is required at /features/feedback
  → DbError: Query select has failed
```

`projects.features` was a JSON column (dropped with #E74) validated against
`projectFeaturesSchema`. Four of its keys were **required** `z.boolean()` — `kanban`, `folios`, `feedback`,
`milestones` (which gated the **Releases** module: the key deliberately kept its
pre-rename name for exactly the reason this section exists) — while the rest
(`sigils`, `blights`, `beacon`, `vitals`, the
`quest*` trio) are `.optional()`. The migration renamed the
_table and columns_, but the JSON **inside** the column still said `petitions`
and `chapters` on all 54 existing rows. A missing required key does not read as
`undefined` and fall back to `false` — **the whole row fails to decode**, so
every query touching `projects` throws.

The plan had predicted "the flags read as undefined → off, owners re-enable them
once." That reasoning came from the _optional_ flags and was never checked
against these four. Losing four toggles and losing every project read are not
the same failure.

**Nothing in the pipeline could have caught it.** Test and CI databases are
created empty from the entities, so every row they contain is already in the new
format. Only a database with pre-rename rows can fail this way, and there is
exactly one of those.

Fixed forward by rewriting the JSON in place, preserving each owner's real
setting rather than defaulting anything off:

```sql
UPDATE projects SET features = json_remove(
  json_set(features,
    '$.feedback',   CASE WHEN json_extract(features,'$.petitions')=1 THEN json('true') ELSE json('false') END,
    '$.milestones', CASE WHEN json_extract(features,'$.chapters') =1 THEN json('true') ELSE json('false') END
  ), '$.petitions', '$.chapters')
WHERE json_extract(features,'$.feedback') IS NULL
   OR json_extract(features,'$.milestones') IS NULL;
```

The `CASE … json('true')` is load-bearing: `json_extract` on a JSON boolean
returns integer `1`, so a naive round-trip writes `1` and the row _still_ fails
`z.boolean()`.

**The rule:** renaming a key inside a JSON column is a data migration, not a
schema migration. Before renaming one, check whether it is required — and if it
is, carry the `UPDATE` in the same deploy. Making the key `.optional()` instead
would also stop the crash, but silently discards the owner's setting; prefer the
rewrite. This was run as a one-off against prod rather than as a migration file
because Lore has exactly one instance and a fresh database starts empty.

### ⚠️ `ADD COLUMN … NOT NULL` is green on every database except production (2026-08-06)

Folding `sigils.app` + `environment` + `label` into a single `name`
(`20260806093400_confused_dazzler`), drizzle-kit generated:

```sql
ALTER TABLE `sigils` ADD `name` text NOT NULL;
```

**SQLite refuses this on any table that has rows** — _"Cannot add a NOT NULL column
with default value NULL"_ — and accepts it on an empty one. Every database CI
and the test suite construct is empty, so the statement is green everywhere it is ever
exercised and fails only against the single database that has data. It is the same
blind spot as the JSON-key incident above, from the opposite direction: there, empty
databases hid a row that could not decode; here they hide a statement that cannot run.
The blast radius is smaller — D1 applies a migration as one transaction, so this is a
failed, rolled-back deploy rather than data loss — but nothing in the pipeline goes red
first.

The shape that works, and the one to reach for whenever a new column must end up
`NOT NULL`:

```sql
ALTER TABLE `sigils` ADD `name` text;--> statement-breakpoint          -- nullable
UPDATE `sigils` SET `name` = substr(`label`, 1, 100);--> statement-breakpoint  -- backfill
-- …de-duplicate, swap indexes, then DROP the old columns LAST
```

Add nullable, backfill from a column that is already `NOT NULL`, and let the entity
schema carry the constraint. Order matters beyond the constraint: SQLite refuses to drop
a column an index still references, so the index swap precedes every `DROP COLUMN`.
Also note drizzle emitted no backfill at all — it dropped `label` without carrying it
anywhere, which would have left every existing sigil nameless before handing them to a
`UNIQUE` index. Read generated migrations for what they _omit_, not only for `DROP TABLE`.

**The drift this leaves behind is deliberate — do not "fix" it.** `sigils.name` is
physically nullable on D1 while the snapshot declares it `NOT NULL`, because SQLite
offers no way to add a `NOT NULL` column to a populated table without also inventing a
`DEFAULT` the snapshot does not have. It cannot cause `check:migrations` drift —
drizzle diffs the entity against the **snapshot**, never the live database — so this is
invisible to tooling and lives only here and in the migration's own comment block. The
only way to make the physical column match is a table rebuild, and `sigils` is the
`ON DELETE CASCADE` parent of `sigil_uniques_daily`, `sigil_error_groups` and more,
and the `SET NULL` parent of `blights.sigil_id` and `app_instances.sigil_id` — so that
"fix" is the rebuild of a parent that `test/migration-safety.spec.ts` now refuses
outright. Accepted drift beats a rebuild.

### ⚠️ A table registered only under one runtime gets a migration under neither (2026-08-11)

Every Insights read 500'd in production - so every `/:projectSlug/apps/…` page
rendered the generic ErrorPage — because `analytics_prune_floors` did not exist
on D1. `WaeAnalyticsProvider.query()` reads that table before _every_ read.

`alepha/api/analytics` registered it only from `WaeAnalyticsProvider.register()`,
deliberately: only the Analytics Engine backend needs a prune floor (WAE has no
delete API), so a plain relational deployment was spared a table it can never
read. That gate made **the set of tables the app declares a function of the
runtime it booted under**, and the two runtimes are not the same one:

- `yarn db:generate` runs on **Node**, where `index.ts` selects
  `OrmAnalyticsProvider` → the table entered no snapshot and no migration.
- Production runs **workerd**, where `index.workerd.ts` selects
  `WaeAnalyticsProvider` → it reads a table nothing ever created.

Same blind spot as the two entries above, third mechanism: not an empty test
database, a _different runtime_. `yarn test`, `yarn typecheck` and
`yarn check:migrations` all run on the side where the table is not declared, so
none of them could have gone red. Fixed in the framework —
`OrmAnalyticsProvider.register()` now registers it unconditionally — plus
migration `20260810222423_tidy_ozymandias` (bare `CREATE TABLE`, D1-safe).

**It was not alone.** Four faults sat on this one code path, each hidden behind
the one in front of it, so each fix revealed the next and every "is it fixed?"
answered itself with a new error:

| #   | Fault                                                   | Fix                                          |
| --- | ------------------------------------------------------- | -------------------------------------------- |
| 1   | `analytics_prune_floors` missing on D1                  | register the table unconditionally           |
| 2   | `CLOUDFLARE_ANALYTICS_TOKEN` never pushed to the Worker | add it to the build manifest's env allowlist |
| 3   | `HAVING COUNT(*) > 0` → 422                             | `count()`, which takes no arguments          |
| 4   | `GROUP BY substring(blob2, 1, 10)` → 422                | group by the projected alias                 |

**#1 and #2 are the same root cause.** The secret push is filtered by the build
manifest's `env` list, which comes from `alepha.dump().env` — the graph as
instantiated under node — and `CLOUDFLARE_ANALYTICS_TOKEN` is declared by
`WaeAnalyticsProvider`, which exists only under workerd. So `platform up`
dropped the key from every push while reporting success. A missing secret is
worse than a missing binding: it fails at request time, not at boot, so the
deploy is green and the feature is dead.

**#3 and #4 are a different lesson: the test fake agreed with the bug.**
`FakeAnalyticsEngine` was written to mirror the SQL `WaeAnalyticsProvider`
generates, so it accepted whatever that SQL said — including two statements the
real Analytics Engine parser rejects outright. Teaching the fake the _parser's_
rules instead turned 28 of 43 WAE specs red immediately. A fake that mirrors
generated SQL can never disagree with it; only one that mirrors the parser can.
And validate against the real endpoint **before** fixing: #3 and #4 shipped a
deploy apart purely because the first error masked the second.

**The rule:** schema must not vary by runtime. Migrations are generated under one
and applied under another, so anything registered behind "which provider did we
select" exists in exactly one of the two. To check a suspicion of this class,
diff what the snapshot declares against what production actually has:

```bash
npx wrangler d1 execute lore-production --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

The companion defect — why no blight was ever raised for any of it — is under
"Sigils, Blights, Beacon, Vitals" in [`packages/@lore/deploy/CLAUDE.md`](../../packages/@lore/deploy/CLAUDE.md); both are written up in folio #82.

### ⚠️ Dropping a conjunct from a gate is a data migration with no SQL (accepted, 2026-08-06)

Moving telemetry capabilities off the project's feature flags and onto each app's
own `sigils.kinds` changed what `SigilIngestService.gatesFor` computes:

```ts
// before
views: master && features.beacon === true && carries(sigil, "beacon");
// after
views: master && carries(sigil, "beacon");
```

Same for `errors` (`features.blights`) and `vitals` (`features.vitals`). Only
`feedback` still carries a project-level switch - today the **Support**
capability - because it also governs the first-party form at
`/:projectSlug/request`, which exists with no app enrolled.

**Removing a conjunct is monotone in the "on" direction.** No sigil loses a
capability; some gain one. A newly minted sigil carries all four kinds, and
`ProjectCreate.tsx`'s `DEFAULT_FEATURES` never set `blights` / `beacon` / `vitals` —
so on every wizard-created project those flags are _absent_, the old `=== true`
conjunct was false, and ingest was **silently discarding** everything those apps
sent. The moment this deploys the same payloads are accepted: page views, web
vitals, error groups, blights, and the daily visitor hash in `sigil_uniques_daily`
— the one piece of personal data on this path. Enrolled apps never stopped
sending — they read their own `SIGIL_CONFIG` and know nothing of this — so the
write gate reopening is enough. No owner action, no notification, no migration
file in the diff.

**No SQL runs. The rows do not change — the meaning of `kinds` does.** That is
what makes this easy to miss: `check:migrations` is green, `migrations/sqlite/` is
untouched, and every test constructs its own fixtures so nothing goes red. There is
no artifact anywhere in the pipeline that says data behaviour changed.

**This was decided, not overlooked.** It was acceptable here because production
holds a single sigil — `lore` — enrolled by the operator into their own project, so
the set of people whose telemetry starts flowing is the operator's own visitors
under a project the operator controls, and the new behaviour is the intended end
state rather than a leak to be corrected. Writing an `UPDATE sigils SET kinds = …`
migration to strip the newly-effective kinds was considered and rejected: it would
have frozen every app into the retired flags' accidental values and left an owner
with switches whose default disagreed with the design.

**The rule.** A gate is a data-behaviour surface. Dropping a conjunct from one —
or widening any authorization or ingest predicate — is a semantic data migration
even when no schema changes and no SQL is written, and it belongs in this register
next to the ones that do. Before merging such a change, answer: which existing rows
change meaning, what starts being written that was not, does any of it include
personal data, and would the affected owner want to be told. If the answer to the
last one is yes and nobody is telling them, write the `UPDATE` instead.

### ⚠️ `$sequence` keys its counter on the property name, not the table

`$sequence()` fields (used for per-project short IDs / numbering, e.g. `ReleaseController.releaseNumber`, `FeedbackController.feedbackShortId`) persist their running counter in the `alepha_sequences` table, keyed by **the property name**, not by the entity/table it numbers. Renaming the property — `chapterNumber` → `milestoneNumber`, `petitionShortId` → `feedbackShortId` — does not rename the existing counter row. It orphans it: the renamed property starts a brand-new counter at 1, colliding with whatever numbers already exist in production for that project.

This is exactly what would have happened silently in the 2026-08 rename if the migration hadn't carried two explicit statements to repoint the existing rows:

```sql
UPDATE alepha_sequences SET name = 'milestoneNumber' WHERE name = 'chapterNumber';
UPDATE alepha_sequences SET name = 'feedbackShortId' WHERE name = 'petitionShortId';
```

**No test catches this.** Test databases start with an empty `alepha_sequences` table, so a missing `UPDATE` is invisible in `yarn test` and only surfaces against a production database that already has rows. Any future rename of a `$sequence`-backed property needs the same treatment — check `alepha_sequences` for the old name and carry an `UPDATE` in the migration.

## Tests

### Two vitest runners, one file list (2026-08-06 / 2026-08-09)

**Verify with `yarn test` from the repo root**: that is what CI runs. It and `yarn w lore test` collect the same files with the same settings, because the root `vitest.config.ts` spreads each workspace's `projects` and every workspace config names only itself and a `jsdom` flag through `workspaceProjects` (`scripts/vitest.projects.ts`). A runner setting goes there, never in a caller.

Before that, the two runners diverged twice, once in each direction: a path alias present only in the app config (a spec green in the workspace, dead at import time from the root), and Node ≥ 25's native `localStorage` shadowing jsdom's, disabled only at the root (`useFolioPanes.browser.spec.tsx` red in the workspace while CI stayed green). Both are the shape of the `ADD COLUMN … NOT NULL` trap above, a check that could not have gone red. Guarding the spec instead (`window.localStorage?.clear()`) was rejected: it would pass while running in the wrong environment.

Notable specs in `apps/lore/test` (Vitest, in-memory SQLite). A spec whose subject is one package is listed in that package's `CLAUDE.md`:

- `mcp-security.spec.ts` — MCP auth, API keys, user isolation
- `project-capabilities-migration.spec.ts` / `capability-gate.spec.ts` / `route-capability-guards.spec.ts` - the capability model across packages: the backfill, the gate, and the route guards
- `sigil-self-report.spec.ts` — Lore's own in-process self-report path
- `app-routes.spec.ts` — **regression guard**: boots every router and resolves every route name the app passes the router as a plain string (every `router.path`/`push` call site and every `route: "…"` nav array in `src/`, including `projectSettingsSections.ts`'s — the array that broke once). `router.path()` takes `keyof VirtualRouter<T> | string`, so a deleted or renamed route is never a type error — this is the only thing that turns it into a red test instead of a production throw. Also asserts that **every static root segment in the route table is reserved** in `ProjectSlugService` — the invariant `/:projectSlug` creates
- `project-slug-migration.spec.ts` — **regression guard**: reads the backfill migration for `DROP TABLE` / `ADD COLUMN … NOT NULL`, then actually _applies_ it to a seeded database and asserts the slugs that come out (collision, accented title, CJK title, soft-deleted row). `migration-safety.spec.ts` stops at earlier migrations, so nothing else executes this SQL
- `blight-tools.spec.ts` — the MCP triage surface
- `migration-safety.spec.ts` — every dropped table needs a per-migration `SANCTIONED_DROPS` entry, a table with `CASCADE` or `SET NULL` children (read from the previous snapshot) cannot be dropped at all after `CASCADE_BASELINE`, historical replays keep their rows, and a fresh D1-shaped database boots with all migrations applied
- Shared fixtures live in `test/fixtures/`

End-to-end testing has its own workspace, `apps/e2e`: read `apps/e2e/CLAUDE.md` for the Playwright suite (one Lore instance per worker, ports, one file per feature) and the CLI suite.

## Manual testing via Playwright (Claude)

When you need to drive the app yourself with the Playwright MCP, use these shortcuts.

### Servers

| Mode                        | Command      | URL                   | Database                                               |
| --------------------------- | ------------ | --------------------- | ------------------------------------------------------ |
| **Dev** (HMR, no build)     | `yarn dev`   | http://localhost:3303 | `node_modules/.alepha/sqlite.db` (persistent)          |
| **Prod-like** (build + run) | `yarn start` | http://localhost:3000 | in-memory (`DATABASE_URL=:memory:`) — wiped on restart |

Dev mode is what you usually want — it keeps state between runs and emails accumulate on disk.

### ⚠️ Prod-like is not production — only workerd is

| Mode         | Runtime       | Catches                               |
| ------------ | ------------- | ------------------------------------- |
| `yarn dev`   | Node + Vite   | most things                           |
| `yarn start` | Node, bundled | bundler/env issues                    |
| **wrangler** | **workerd**   | **isolate limits, Workers-only APIs** |

The third row is not optional for anything that smells production-only. Quest #132 (folio page → error boundary in prod) was investigated once and closed as "not reproducible": dev fine, `node dist` fine, SSR already off. All true, and all irrelevant — the bug was an isolate crash, and neither Node mode runs an isolate. Under wrangler it reproduced on the first try.

```bash
yarn alepha platform build -e production
```

Then, in `dist/`, copy `wrangler.jsonc` to `wrangler.local.jsonc` with `routes` and `send_email` removed and `APP_SECRET` set in `vars`, and:

```bash
npx wrangler dev --config wrangler.local.jsonc --local --port 8788
```

`--local` is what keeps the D1/R2/KV bindings simulated. **Never drop it** — the config carries the real production `database_id`.

Traps, all of which cost time once:

- **The local D1 starts empty.** `alepha platform build` wipes `dist/`, and `dist/.wrangler/state` with it, so this is needed after every rebuild:
  ```bash
  for d in migrations/sqlite/2*/; do sed 's|--> statement-breakpoint|;|g' "$d/migration.sql"; echo ";"; done > /tmp/all.sql
  npx wrangler d1 execute DB --config wrangler.local.jsonc --local --file=/tmp/all.sql
  ```
- **No email.** Registration still works: the verification code sits in plaintext in the job payload —
  `SELECT payload FROM job_executions WHERE job_name LIKE '%notification%' ORDER BY rowid DESC LIMIT 1`.
- **Sessions expire in 15 minutes.** A batch of `curl`s that suddenly all return 302 means the token aged out, not a regression.
- **Measure bytes, not status codes.** A crashed isolate still returns `200` — the early head has already been flushed. The signal is a truncated body: ~300 bytes with no `</html>`, versus ~21KB for a healthy page.
- **Restart between probes.** Once an isolate dies, every later route on that instance looks broken too. Diagnosing without a restart makes one broken route look like six.

### Accounts

The realm admin (`.env` → `ADMIN_EMAIL=admin@alepha.dev`) is auto-bootstrapped on first start. Use that for owner/admin flows.

To test a fresh signup:

1. POST `/auth/register` via the UI with a throwaway email like `feat$(date +%s)@example.com`.
2. The verification email lands as a JSON file in `node_modules/.alepha/emails/<email>,<timestamp>.eml.json` — open it, grab the `verify` URL from the HTML body, and load it in the browser to confirm.
3. Same flow for password reset (`/auth/reset-password`).

### Mail inbox

There's no SMTP — dev mode persists every sent email as JSON under `node_modules/.alepha/emails/`. Filename is `<recipient>,<ISO timestamp>.eml.json`. Read with `cat`/`jq`, scrape links with `grep -oE 'href="[^"]+"'`.

### Reset the dev database

```bash
rm node_modules/.alepha/sqlite.db
yarn dev   # recreates + runs migrations from migrations/sqlite/
```

Clears all projects, members, sessions, etc. Migrations auto-apply on boot. Optionally also `rm -rf node_modules/.alepha/emails/` to clear the inbox.

### Playwright tips

- Hostname is `localhost`, no HTTPS in dev/prod-like.
- The session cookie persists across reloads; if you need a clean slate, clear cookies via `context.clearCookies()` rather than relaunching the browser.
- Pages load lazily — wait for the visible text of a known route element (e.g. "Projects") before asserting.
- `claude-in-chrome` MCP works fine; the deferred `playwright` MCP is what most of the existing e2e specs target.
