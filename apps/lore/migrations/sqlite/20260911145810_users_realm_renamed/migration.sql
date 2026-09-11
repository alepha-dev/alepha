-- The default realm is named `users`, not `default` (#Q2264).
--
-- The name is persisted in three places, and each is carried across here:
-- every user row, every OAuth client registered through DCR (Claude's MCP
-- connection among them), and the realm's settings `$parameter`, which holds
-- Lore's live registration switch (#Q1653). Without the last one the realm
-- would read `api.realms.users`, find nothing, and silently fall back to the
-- boot-time literal in `AppSecurityProvider`.
--
-- ⚠️ HAND-WRITTEN. drizzle-kit generated a rebuild of `users` for the changed
-- column DEFAULT ('default' to 'users'): CREATE `__new_users`, copy, DROP TABLE
-- `users`, RENAME. On D1 that DROP cascades into `dashboard_cards`,
-- `dashboard_settings` and `notification_preferences`, or fails on the
-- `sessions` and `identities` foreign keys ("Migration safety on D1" in
-- apps/lore/CLAUDE.md). The rebuild is deleted, so from here on the snapshot
-- says DEFAULT 'users' and the live column still says DEFAULT 'default'.
-- That drift is deliberate and harmless: every insert path writes `realm`
-- itself (`RegistrationService`, `UserService`), so the physical default is
-- never read. Same precedent as the `projects.features` DEFAULT.
--
-- Browsers holding a `tokens` cookie minted for `default` are signed out once
-- (`ServerAuthProvider.findProvider`), a break the owner accepted on #Q2264.
-- There is no DROP TABLE below.

UPDATE `users` SET `realm` = 'users' WHERE `realm` = 'default';--> statement-breakpoint
UPDATE `oauth_clients` SET `realm` = 'users' WHERE `realm` = 'default';--> statement-breakpoint

-- Guarded: `parameters` is unique on (organization_id, name, version), so a
-- row somebody already saved under the new name is left alone rather than
-- collided with. `audits.user_realm` is history and keeps what it recorded.
UPDATE `parameters` SET `name` = 'api.realms.users' WHERE `name` = 'api.realms.default' AND NOT EXISTS (SELECT 1 FROM `parameters` AS `p` WHERE `p`.`name` = 'api.realms.users');
