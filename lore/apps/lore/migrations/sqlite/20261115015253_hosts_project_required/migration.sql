-- #Q3627: every host has a home project. Tightening `hosts.project_id` to
-- NOT NULL on SQLite is a rebuild of `hosts`, which has nine CASCADE and
-- SET NULL children: D1 refuses that here (migration-safety.spec,
-- apps/lore/AGENTS.md "Migration safety on D1"). The snapshot records NOT
-- NULL; the column stays nullable, and two triggers refuse a NULL instead.
-- The UPDATE below fires the update trigger on any host still without a
-- project, which aborts the whole migration rather than delete the host.
CREATE TRIGGER `hosts_project_required_insert` BEFORE INSERT ON `hosts` WHEN NEW.`project_id` IS NULL BEGIN SELECT RAISE(ABORT, 'hosts.project_id is required'); END;--> statement-breakpoint
CREATE TRIGGER `hosts_project_required_update` BEFORE UPDATE OF `project_id` ON `hosts` WHEN NEW.`project_id` IS NULL BEGIN SELECT RAISE(ABORT, 'hosts.project_id is required'); END;--> statement-breakpoint
UPDATE `hosts` SET `project_id` = `project_id` WHERE `project_id` IS NULL;
