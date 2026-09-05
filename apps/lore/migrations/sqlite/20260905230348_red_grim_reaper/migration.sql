-- Apps v3 (#1767): `app_instances` is the deployed copy of an app, and from
-- now on the thing an operator creates. A sigil becomes an unlock hanging off
-- it rather than the app's identity.
--
-- ⚠️ NO `DROP TABLE`, and nothing is added to `sigils`. That table is the
-- `ON DELETE CASCADE` parent of the four analytics tables and of
-- `blights.sigilId`, and a drizzle rebuild on D1 is the cascade wipe in
-- `apps/lore/CLAUDE.md`. `app_instances` is new, so both its foreign keys are
-- free; the two statements at the bottom are DATA, not schema.
--
-- Read the backfill's comment before changing either statement: the order
-- between them is load-bearing.

CREATE TABLE `app_instances` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`env` text NOT NULL,
	`url` text,
	`sigil_id` text,
	`estate_id` text,
	`created_by` text,
	CONSTRAINT `fk_app_instances_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_app_instances_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_instances_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_instances_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_instances_project_id_app_env_idx` ON `app_instances` (`project_id`,`app`,`env`);--> statement-breakpoint
CREATE INDEX `app_instances_project_id_idx` ON `app_instances` (`project_id`);--> statement-breakpoint
CREATE INDEX `app_instances_sigil_id_idx` ON `app_instances` (`sigil_id`);--> statement-breakpoint
CREATE INDEX `app_instances_estate_id_idx` ON `app_instances` (`estate_id`);--> statement-breakpoint
-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- One instance per existing sigil, with the sigil's name taken BYTE FOR BYTE
-- as the app and `production` as the env. So `docs-production` becomes
-- `app: 'docs-production', env: 'production'`, NOT `app: 'docs'`.
--
-- ⚠️ Splitting on a `-production` suffix was considered and refused. It is a
-- guess that renames rows in production; `lindocara/main` does not even match
-- `APP_NAME_PATTERN`, so the parser has a case it cannot handle on day one; and
-- a misfiring heuristic here is silent, because nothing distinguishes a suffix
-- from a name that happens to end that way. Tidying up afterwards is a rename,
-- which is editing two text columns and changes no URL either way.
--
-- The id is a uuid built in SQL: `app_instances.id` carries no column default,
-- and SQLite has no uuid function. Version nibble 4, variant nibble from
-- `89ab`, same shape the application generates.
INSERT INTO `app_instances` (`id`, `project_id`, `app`, `env`, `url`, `sigil_id`, `created_by`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
  ),
  `project_id`,
  `name`,
  'production',
  `url`,
  `id`,
  `created_by`
FROM `sigils`;--> statement-breakpoint
-- `sigils.name` is a mirror of `"<app>/<env>"` from here on, written only by
-- `AppService`. Every existing row is relabelled: `lore` reads `lore/production`
-- in the blights filter, the insights dimension, the dashboard scope and MCP
-- afterwards. Accepted by the owner on 2026-09-06.
--
-- ⚠️ MUST run AFTER the INSERT above, which reads `name` as the app.
--
-- Safe on the `(project_id, name)` unique index: appending one constant to
-- every row preserves distinctness. Safe on the column's `max(100)` read
-- validation: the longest possible result is 64 + 11 = 75, because a pre-v3
-- name could not exceed `APP_NAME_MAX_LENGTH`. And `/` is outside
-- `APP_NAME_PATTERN`, so no mirror can ever collide with a name typed before
-- this ran.
UPDATE `sigils` SET `name` = `name` || '/production';
