-- Switch from magic-link (token-as-capability) to in-app inbox flow.
-- 1. Revoke every pending invitation so old magic-link emails stop working.
-- 2. Lowercase invitation emails so they match session.user.email at query time.
-- 3. Drop the now-unused token column (and its unique index).

UPDATE `invitations`
   SET `status` = 'revoked',
       `resolved_at` = unixepoch('subsec') * 1000
 WHERE `status` = 'pending';--> statement-breakpoint
UPDATE `invitations` SET `email` = LOWER(`email`);--> statement-breakpoint
DROP INDEX `invitations_token_idx`;--> statement-breakpoint
ALTER TABLE `invitations` DROP COLUMN `token`;
