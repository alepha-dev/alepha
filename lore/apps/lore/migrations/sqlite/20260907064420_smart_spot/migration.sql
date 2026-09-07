-- ⚠️ REGENERATED after merging origin/main, and that is the whole reason this
-- file has today's timestamp rather than the two it replaces.
--
-- Two migrations generated in parallel from one base are mutually blind: the
-- other branch's snapshot was written from a tree that had never seen `rank`
-- or `rank_definitions`, so applying both in timestamp order leaves the
-- snapshot claiming neither exists. Timestamp order does not save you - the
-- LAST snapshot is the one `db migrations check` diffs against.
--
-- Everything below the indexes is hand-written and was carried across from
-- `20260907024902_wealthy_black_bird`, which this replaces along with
-- `20260907031228_brief_star_brand`. Neither had been applied anywhere.

CREATE TABLE `rank_definitions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`type` text NOT NULL,
	`scope_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `members` ADD `rank` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rank_definitions_type_scope_id_key_idx` ON `rank_definitions` (`type`,`scope_id`,`key`);--> statement-breakpoint
CREATE INDEX `rank_definitions_type_scope_id_idx` ON `rank_definitions` (`type`,`scope_id`);--> statement-breakpoint
-- Backfill. Hand-written; everything below the ADD COLUMN was added to the
-- generated file on purpose, in the shape of the slug backfill
-- (`20260813135343_nappy_excalibur`). The ORDER of these statements is
-- load-bearing.
--
-- Purely additive: ADD COLUMN + UPDATE + INSERT. No table is dropped and no
-- table is rebuilt, so none of the D1 cascade risk that wiped production on
-- 2026-05-13 applies here. See apps/lore/CLAUDE.md "Migration safety on D1".
-- (Phrased without the literal statement name on purpose: the safety check in
-- that runbook is a grep, and a comment that matches it is a false alarm for
-- whoever runs it next.)
--
-- ⚠️ There is deliberately NO partial unique index on
-- `(project_id) WHERE rank = 'owner'`. The ORM supports one and it was the
-- obvious way to make "exactly one owner" a database fact. It is rejected
-- because D1 has no transactions and SQLite checks UNIQUE per row while a
-- statement runs, so a one-statement ownership transfer could trip it
-- mid-statement depending on row order. Exactly one owner is enforced in code:
-- these two statements produce one, the assignment endpoint refuses `owner`,
-- and the transfer swaps in a single UPDATE.
--
-- ⚠️ `ALTER TABLE ... ADD ... NOT NULL` is the other trap this avoids by
-- construction: SQLite refuses it on a populated table, so it is green on
-- every empty test database and red only against the one database with data.
-- `rank` is nullable, and a NULL reads as the built-in `member`.
--
-- Half 1. The creator of each project becomes its `owner`. Nothing else is
-- written: a non-creator stays NULL, which the entity reads as `member`.
-- Writing the word `member` into every row would touch every membership for
-- no gain and freeze today's default into data.
UPDATE members
   SET rank = 'owner'
 WHERE user_id = (
         SELECT created_by FROM projects WHERE projects.id = members.project_id
       );--> statement-breakpoint
-- Half 2, and the dangerous half.
--
-- `assertMember` lets a project's creator through with NO membership row at
-- all, and `createProject` was not transactional until #Q1926 - so a failed
-- third write leaves exactly that state, and `projects.created_by` has been
-- the invisible safety net repairing it on every request. This epic removes
-- that net. A project missed here is a project whose owner is locked out
-- permanently, with no path back short of a manual database write.
--
-- `created_at`, `updated_at` and `owner` all carry database defaults (verified
-- against the baseline: `unixepoch` and `true`), and `id` is AUTOINCREMENT, so
-- the insert names only these three columns.
--
-- Soft-deleted projects are skipped: every read path filters them out, so a
-- membership row there would repair nothing and would occupy the unique index
-- on `(user_id, project_id)` if the project were ever restored.
INSERT INTO members (user_id, project_id, rank)
SELECT p.created_by, p.id, 'owner'
  FROM projects p
 WHERE p.deleted_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM members m
          WHERE m.project_id = p.id
            AND m.user_id = p.created_by
       );
