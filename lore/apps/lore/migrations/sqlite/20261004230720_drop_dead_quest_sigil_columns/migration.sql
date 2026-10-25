-- #E74 / #Q2618: quests.note, sigils.feedback_position and sigils.url.
--
-- None is in an index or carries a foreign key, so each goes with a plain
-- ALTER TABLE ... DROP COLUMN and neither cascade parent is rebuilt. Nothing
-- reads them since #Q2617.
ALTER TABLE `quests` DROP COLUMN `note`;--> statement-breakpoint
ALTER TABLE `sigils` DROP COLUMN `feedback_position`;--> statement-breakpoint
ALTER TABLE `sigils` DROP COLUMN `url`;