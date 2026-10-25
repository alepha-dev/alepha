ALTER TABLE `petitions` RENAME TO `feedback`;--> statement-breakpoint
ALTER TABLE `archive_blobs` RENAME TO `folio_blobs`;--> statement-breakpoint
ALTER TABLE `archive_directories` RENAME TO `folio_directories`;--> statement-breakpoint
ALTER TABLE `archive_names` RENAME TO `folio_names`;--> statement-breakpoint
ALTER TABLE `chapters` RENAME TO `milestones`;--> statement-breakpoint
ALTER TABLE `campaigns` RENAME TO `projects`;--> statement-breakpoint
ALTER TABLE `blight_ignore_rules` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `blights` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `feedback` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `folio_blobs` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `folio_directories` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `folios` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `members` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `milestones` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `outposts` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `projects` RENAME COLUMN `chapter_duration` TO `milestone_duration`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `chapter_id` TO `milestone_id`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `petition_id` TO `feedback_id`;--> statement-breakpoint
ALTER TABLE `releases` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `sigils` RENAME COLUMN `campaign_id` TO `project_id`;--> statement-breakpoint
-- The `projects.features` rebuild drizzle-kit generated here was removed by
-- hand. Its only change was the JSON DEFAULT's key names, and on D1 a rebuild
-- means DROP TABLE projects, which cascade-wipes members/quests/folios/feedback
-- (2026-05-13 incident). Nothing reads that default: createProject injects
-- defaultProjectFeatures server-side. The snapshot and the live column
-- deliberately disagree on it. Do not "fix" this with a rebuild.
DROP INDEX IF EXISTS `blight_ignore_rules_campaign_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `blights_campaign_id_fingerprint_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `blights_campaign_id_last_seen_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `petitions_campaign_id_status_deleted_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `petitions_campaign_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `petitions_campaign_id_short_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `petitions_reporter_user_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_blobs_campaign_id_short_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_blobs_directory_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_directories_campaign_id_short_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_directories_parent_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_names_parent_directory_id_root_scope_lower_name_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `archive_names_entity_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `folios_campaign_id_updated_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `folios_campaign_id_title_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `folios_campaign_id_short_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `members_user_id_campaign_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `chapters_campaign_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `chapters_campaign_id_number_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `outposts_campaign_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `campaigns_created_by_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `quests_campaign_id_deleted_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `quests_campaign_id_short_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `quests_chapter_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_campaign_id_app_environment_version_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_campaign_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigils_campaign_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigils_campaign_id_app_environment_idx`;--> statement-breakpoint
CREATE INDEX `projects_created_by_idx` ON `projects` (`created_by`);--> statement-breakpoint
CREATE INDEX `blight_ignore_rules_project_id_idx` ON `blight_ignore_rules` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blights_project_id_fingerprint_idx` ON `blights` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `blights_project_id_last_seen_at_idx` ON `blights` (`project_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `feedback_project_id_status_deleted_at_idx` ON `feedback` (`project_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `feedback_project_id_created_at_idx` ON `feedback` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_project_id_short_id_idx` ON `feedback` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `feedback_reporter_user_id_created_at_idx` ON `feedback` (`reporter_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_blobs_project_id_short_id_idx` ON `folio_blobs` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `folio_blobs_directory_id_idx` ON `folio_blobs` (`directory_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_directories_project_id_short_id_idx` ON `folio_directories` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `folio_directories_parent_id_idx` ON `folio_directories` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_names_parent_directory_id_root_scope_lower_name_idx` ON `folio_names` (`parent_directory_id`,`root_scope`,`lower_name`);--> statement-breakpoint
CREATE INDEX `folio_names_entity_id_idx` ON `folio_names` (`entity_id`);--> statement-breakpoint
CREATE INDEX `folios_project_id_updated_at_idx` ON `folios` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_project_id_title_idx` ON `folios` (`project_id`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `folios_project_id_short_id_idx` ON `folios` (`project_id`,`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_project_id_idx` ON `members` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `milestones_project_id_idx` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_id_number_idx` ON `milestones` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `outposts_project_id_idx` ON `outposts` (`project_id`);--> statement-breakpoint
CREATE INDEX `quests_project_id_deleted_at_idx` ON `quests` (`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `quests_project_id_short_id_idx` ON `quests` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `quests_milestone_id_idx` ON `quests` (`milestone_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_id_app_environment_version_idx` ON `releases` (`project_id`,`app`,`environment`,`version`);--> statement-breakpoint
CREATE INDEX `releases_project_id_status_idx` ON `releases` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `sigils_project_id_idx` ON `sigils` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sigils_project_id_app_environment_idx` ON `sigils` (`project_id`,`app`,`environment`);--> statement-breakpoint
-- `$sequence` keys its counter row in `alepha_sequences` on the property
-- name, not the table name, so renaming the property orphans the old
-- counter row instead of renaming it. Tasks 3 and 4 renamed
-- MilestoneController's `chapterNumber` to `milestoneNumber` and
-- FeedbackController's `petitionShortId` to `feedbackShortId`; the two
-- UPDATEs below repoint the existing counter rows at their new names.
-- Without them, the first milestone and the first feedback item created
-- after this deploy would restart numbering at 1 and collide with
-- whatever numbers already exist in production. No test catches this —
-- test databases start with an empty `alepha_sequences` table.
UPDATE alepha_sequences SET name = 'milestoneNumber' WHERE name = 'chapterNumber';--> statement-breakpoint
UPDATE alepha_sequences SET name = 'feedbackShortId' WHERE name = 'petitionShortId';