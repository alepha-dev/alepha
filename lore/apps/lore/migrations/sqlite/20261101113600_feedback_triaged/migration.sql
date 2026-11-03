ALTER TABLE `feedback` ADD `triaged_at` integer;--> statement-breakpoint
ALTER TABLE `feedback` ADD `triaged_by` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
-- Backfill from the accept and reject audits (#Q3005). An audit names a report
-- by its shortId inside its project scope. The newest one wins, and a row
-- whose audit was never written or was pruned stays NULL: unknown, not fast.
UPDATE `feedback` SET `triaged_at` = (
  SELECT `a`.`created_at` FROM `audits` `a`
  WHERE `a`.`type` = 'feedback' AND `a`.`action` IN ('accept', 'reject')
    AND `a`.`scope_type` = 'project'
    AND `a`.`scope_id` = CAST(`feedback`.`project_id` AS TEXT)
    AND `a`.`resource_id` = CAST(`feedback`.`short_id` AS TEXT)
  ORDER BY `a`.`created_at` DESC LIMIT 1
) WHERE `status` <> 'pending';--> statement-breakpoint
-- A foreign key: an actor whose account is gone leaves the column NULL.
UPDATE `feedback` SET `triaged_by` = (
  SELECT `a`.`user_id` FROM `audits` `a`
  WHERE `a`.`type` = 'feedback' AND `a`.`action` IN ('accept', 'reject')
    AND `a`.`scope_type` = 'project'
    AND `a`.`scope_id` = CAST(`feedback`.`project_id` AS TEXT)
    AND `a`.`resource_id` = CAST(`feedback`.`short_id` AS TEXT)
    AND `a`.`user_id` IN (SELECT `id` FROM `users`)
  ORDER BY `a`.`created_at` DESC LIMIT 1
) WHERE `status` <> 'pending';
