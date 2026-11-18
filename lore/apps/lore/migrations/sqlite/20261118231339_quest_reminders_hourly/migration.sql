DROP INDEX IF EXISTS `quests_automation_reminders_idx`;--> statement-breakpoint
CREATE INDEX `quests_reminders_due_idx` ON `quests` (`reminder_next_at`) WHERE ((("quests"."deleted_at" is null)) and (("quests"."completed_at" is null)) and (("quests"."shelved_at" is null)) and (("quests"."accepted_at" is not null)) and (("quests"."accepted_by" is not null)) and (("quests"."reminder_interval" is not null)));--> statement-breakpoint
-- Quest reminders leave automations (#E159, #Q3893). A reminder was
-- scheduled whether or not the project held the reminder automation, so
-- projects that never had the rule hold reminders long overdue; the first
-- hourly tick would send every one. Each past `reminder_next_at` moves to
-- now plus its interval instead (milliseconds, as SQLite stores datetimes).
UPDATE `quests`
SET `reminder_next_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER) + CASE `reminder_interval`
  WHEN 'daily' THEN 86400000
  WHEN 'weekly' THEN 604800000
  ELSE 2592000000
END
WHERE `reminder_interval` IS NOT NULL
  AND `reminder_next_at` IS NOT NULL
  AND `reminder_next_at` < CAST(unixepoch('subsec') * 1000 AS INTEGER);
