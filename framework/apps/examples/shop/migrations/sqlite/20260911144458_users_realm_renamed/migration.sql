-- The default realm is named `users`, not `default` (#Q2264). The shop's
-- `$realm()` declares no name, so its users move with it.
--
-- ⚠️ HAND-WRITTEN. drizzle-kit generated a rebuild of `users` for the changed
-- column DEFAULT ('default' to 'users'), which drops the table. The rebuild
-- is deleted and only the data moves; the snapshot says DEFAULT 'users' and
-- the live column keeps DEFAULT 'default', which nothing reads because every
-- insert path writes `realm` itself. The shop has no `oauth_clients` table.

UPDATE `users` SET `realm` = 'users' WHERE `realm` = 'default';--> statement-breakpoint

-- Guarded: `parameters` is unique on (organization_id, name, version).
UPDATE `parameters` SET `name` = 'api.realms.users' WHERE `name` = 'api.realms.default' AND NOT EXISTS (SELECT 1 FROM `parameters` AS `p` WHERE `p`.`name` = 'api.realms.users');
