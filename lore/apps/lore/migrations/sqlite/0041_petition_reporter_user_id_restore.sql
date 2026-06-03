-- Roll back reporter_email → reporter_user_id WITHOUT a table rebuild.
--
-- SQLite (and D1) cannot ALTER a column to NOT NULL, nor add a FOREIGN KEY to an
-- existing table. So reporter_user_id is restored as a NULLABLE column carrying
-- the cascade FK via the `ADD COLUMN ... REFERENCES` form (allowed because its
-- implicit default is NULL). This avoids the DROP-TABLE rebuild entirely — no D1
-- cascade hazard, no quests.petition_id backup/restore, no orphan deletion
-- (orphans simply keep reporter_user_id = NULL).

-- 1. Add the nullable reporter_user_id with the cascade FK (default NULL).
ALTER TABLE `petitions` ADD COLUMN `reporter_user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint

-- 2. Back-fill from the email we are about to drop; unresolved rows stay NULL.
UPDATE `petitions`
  SET `reporter_user_id` = (SELECT `id` FROM `users` WHERE `users`.`email` = `petitions`.`reporter_email`);
--> statement-breakpoint

-- 3. reporter_email is indexed — drop the index before dropping the column.
DROP INDEX `petitions_reporter_email_created_at_idx`;
--> statement-breakpoint
ALTER TABLE `petitions` DROP COLUMN `reporter_email`;
--> statement-breakpoint

-- 4. Recreate the reporter index on the new column.
CREATE INDEX `petitions_reporter_user_id_created_at_idx` ON `petitions` (`reporter_user_id`,`created_at`);
