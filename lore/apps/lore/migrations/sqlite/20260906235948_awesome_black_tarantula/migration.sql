-- Lore Capabilities (#1880): a project composes four capabilities, and
-- `projects.features` stops being the place they live.
--
-- ⚠️ Purely additive: one CREATE TABLE, one index, four INSERTs. Nothing here
-- touches `projects`, which is the `ON DELETE CASCADE` parent of members,
-- quests, releases, folios and feedback — the shape that wiped production on
-- 2026-05-13. That is the whole reason capabilities are a child table rather
-- than four more keys in the JSON bag: adding a key to
-- `defaultProjectFeatures` changes the column DEFAULT, and a drizzle rebuild
-- of `projects` on D1 fires every one of those constraints.
--
-- Everything below the index is DATA. Read its comment before changing it.
--
-- ⚠️ **Regenerated after merging main, on purpose.** It first landed as
-- `20260906181833_great_firelord`, generated from a base that did not yet have
-- `20260906225939_mighty_spiral` - and that one was generated from a base that
-- did not have this table. Two migrations produced in parallel from one base
-- are mutually blind: each snapshot describes a schema the other half is
-- missing, so the newest one on disk proposed to CREATE this table a second
-- time and `check:migrations` went red. Regenerating after the merge is the
-- only thing that makes the newest snapshot the union of both. Nothing in the
-- SQL changed; only the timestamp and the snapshot beside it.

CREATE TABLE `project_capabilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`enabled_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_project_capabilities_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_capabilities_project_id_key_idx` ON `project_capabilities` (`project_id`,`key`);--> statement-breakpoint
-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- The acceptance bar for the whole epic: **no existing project changes
-- behaviour**. Four rules make that true, and each one is a way this could
-- have been silently wrong:
--
-- 1. **`work` goes on for EVERY project.** Quests never had a flag, so there
--    is no row that can lose them.
-- 2. **`enabled_at` is the project's `created_at`, not the migration's
--    clock.** The capability has been on since the project existed, and the
--    activity feed reads this column.
-- 3. **Every row, soft-deleted included.** No `deleted_at IS NULL` filter: a
--    restored project keeps its behaviour.
-- 4. **A key absent from an old row must read as false.** Every optional
--    switch (`sigils`, `quality`, `epics`, `folioSummary`, the three quest
--    toggles) is missing from every project that predates it, and
--    `json_extract` answers NULL there. `NULL = 1` is NULL, which a CASE
--    treats as not-matched, so the test is `= 1` and never a negation.
--
-- The options are written with `json(...)` around a literal so the stored
-- values are JSON `true`/`false` and not SQLite's integer 1/0. The entity
-- decodes `options` as a record of booleans, and an integer there fails to
-- decode the row — the 2026-08-05 failure mode, one table over.
--
-- ⚠️ A row exists ONLY for an enabled capability; absence is disabled. Hence
-- a WHERE on three of the four and no `enabled` column anywhere.
INSERT INTO `project_capabilities` (`project_id`, `key`, `enabled_at`, `options`)
SELECT
  `id`,
  'work',
  `created_at`,
  json_object(
    'board',    json(CASE WHEN json_extract(`features`, '$.kanban')        = 1 THEN 'true' ELSE 'false' END),
    'epics',    json(CASE WHEN json_extract(`features`, '$.epics')         = 1 THEN 'true' ELSE 'false' END),
    'releases', json(CASE WHEN json_extract(`features`, '$.milestones')    = 1 THEN 'true' ELSE 'false' END),
    'estimate', json(CASE WHEN json_extract(`features`, '$.questEstimate') = 1 THEN 'true' ELSE 'false' END),
    'chrono',   json(CASE WHEN json_extract(`features`, '$.questChrono')   = 1 THEN 'true' ELSE 'false' END),
    'reminder', json(CASE WHEN json_extract(`features`, '$.questReminder') = 1 THEN 'true' ELSE 'false' END)
  )
FROM `projects`;--> statement-breakpoint
-- `features.milestones` reaches `work.releases` here, and that is the only
-- rename this whole epic gets to make: the persisted key could never be
-- fixed in place, because renaming a required key inside `projects.features`
-- leaves every existing row missing one and the row stops decoding.
INSERT INTO `project_capabilities` (`project_id`, `key`, `enabled_at`, `options`)
SELECT
  `id`,
  'knowledge',
  `created_at`,
  json_object(
    'agentSummary', json(CASE WHEN json_extract(`features`, '$.folioSummary') = 1 THEN 'true' ELSE 'false' END)
  )
FROM `projects`
WHERE json_extract(`features`, '$.folios') = 1;--> statement-breakpoint
INSERT INTO `project_capabilities` (`project_id`, `key`, `enabled_at`, `options`)
SELECT
  `id`,
  'support',
  `created_at`,
  json_object()
FROM `projects`
WHERE json_extract(`features`, '$.feedback') = 1;--> statement-breakpoint
-- ⚠️ `sigils` OR `quality`, and that OR is load-bearing. Quality joins the
-- Apps baseline and loses its own flag, so a project carrying
-- `quality: true` with no `sigils` would silently lose its Quality tab if
-- `apps` came from `sigils` alone. It lands here with `track` off: the
-- baseline only, which is exactly what it had.
--
-- `deploy` is written false on every row. It gates nothing that exists today
-- — estates are lent to a project and that page lists what it holds — and
-- Lore Deploy carries its own backfill for the projects with an estate.
INSERT INTO `project_capabilities` (`project_id`, `key`, `enabled_at`, `options`)
SELECT
  `id`,
  'apps',
  `created_at`,
  json_object(
    'track',  json(CASE WHEN json_extract(`features`, '$.sigils') = 1 THEN 'true' ELSE 'false' END),
    'deploy', json('false')
  )
FROM `projects`
WHERE json_extract(`features`, '$.sigils') = 1
   OR json_extract(`features`, '$.quality') = 1;
