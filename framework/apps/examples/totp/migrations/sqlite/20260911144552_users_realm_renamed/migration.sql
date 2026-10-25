-- The default realm is named `users`, not `default` (#Q2264). This
-- example's `$realm()` declares no name, so its users move with it.
--
-- ⚠️ HAND-WRITTEN. drizzle-kit generated a rebuild of `users` for the changed
-- column DEFAULT ('default' to 'users'), which drops the table. The rebuild
-- is deleted and only the data moves; the snapshot says DEFAULT 'users' and
-- the live column keeps DEFAULT 'default', which nothing reads because every
-- insert path writes `realm` itself. This app has neither `oauth_clients`
-- nor `parameters`.

UPDATE `users` SET `realm` = 'users' WHERE `realm` = 'default';
