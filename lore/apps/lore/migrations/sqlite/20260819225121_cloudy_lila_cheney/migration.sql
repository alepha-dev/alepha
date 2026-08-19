-- Links become polymorphic on their SOURCE side: `from_id` drops its
-- foreign key to `folios` so a quest, an epic or (later) a comment can
-- contain a `[[...]]` reference, and `from_type` says which.
--
-- ⚠️ THE `DROP TABLE` BELOW IS REVIEWED AND SAFE. `folio_links` is a LEAF:
-- nothing in the schema references it, so the D1 cascade that wiped
-- production in 2026-05 has nothing to fire on here. It is the one table in
-- this schema where the rebuild pattern carries no blast radius. Verify
-- before trusting this comment:
--     grep -rn "folioLinks.cols" src/api/entities/     # must be empty
--
-- Rehearsed against a `platform db export` of production before merging:
-- 611 rows in, 611 out, every one stamped from_type = 'folio'.
--
-- The `ADD COLUMN` on line 1 is redundant — the rebuild below recreates the
-- column anyway — but it is left as drizzle emitted it, and it is safe on a
-- populated table because it carries a DEFAULT. (An `ADD COLUMN … NOT NULL`
-- with no default is the trap; see CLAUDE.md.)
--
-- Existing rows all came from folios, so the INSERT lets `from_type` take
-- its 'folio' default rather than backfilling explicitly.
--
-- The unique index gains `from_type`, and that is load-bearing rather than
-- cosmetic: ids are stringified per table, so quest 5 and epic 5 are BOTH
-- '5'. Without the discriminator in the key they collide.
ALTER TABLE `folio_links` ADD `from_type` text DEFAULT 'folio' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`from_type` text DEFAULT 'folio' NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`target_type` text DEFAULT 'folio' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_folio_links`(`id`, `created_at`, `from_id`, `to_id`, `target_type`) SELECT `id`, `created_at`, `from_id`, `to_id`, `target_type` FROM `folio_links`;--> statement-breakpoint
DROP TABLE `folio_links`;--> statement-breakpoint
ALTER TABLE `__new_folio_links` RENAME TO `folio_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `folio_links_from_id_to_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_type_from_id_to_id_idx` ON `folio_links` (`from_type`,`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `folio_links_to_id_idx` ON `folio_links` (`to_id`);