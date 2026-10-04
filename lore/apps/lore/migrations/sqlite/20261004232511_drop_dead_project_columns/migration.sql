-- #E74 / #Q2606: the eight dead projects columns.
--
-- projects is the CASCADE parent of 20 tables and the table the 2026-05-13
-- rebuild wiped, so it is never rebuilt: one plain ALTER TABLE ... DROP
-- COLUMN per column. None is in an index or carries a foreign key (checked
-- on the previous snapshot), and nothing reads or writes them since #Q2617.
-- Dropping features also ends its DEFAULT drift (snapshot vs live column).
ALTER TABLE `projects` DROP COLUMN `public`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `areas`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `features`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `milestone_duration`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `default_surface`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `default_env`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `unlocked_features`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `unlock_history`;