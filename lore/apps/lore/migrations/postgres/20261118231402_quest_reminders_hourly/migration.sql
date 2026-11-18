DROP INDEX "quests_automation_reminders_idx";--> statement-breakpoint
CREATE INDEX "quests_reminders_due_idx" ON "quests" ("reminder_next_at") WHERE ((("deleted_at" is null)) and (("completed_at" is null)) and (("shelved_at" is null)) and (("accepted_at" is not null)) and (("accepted_by" is not null)) and (("reminder_interval" is not null)));--> statement-breakpoint
-- Quest reminders leave automations (#E159, #Q3893): each past
-- `reminder_next_at` moves to now plus its interval, so the first hourly
-- tick sends no burst of reminders the old rule never sent.
UPDATE "quests"
SET "reminder_next_at" = now() + CASE "reminder_interval"
  WHEN 'daily' THEN interval '1 day'
  WHEN 'weekly' THEN interval '7 days'
  ELSE interval '30 days'
END
WHERE "reminder_interval" IS NOT NULL
  AND "reminder_next_at" IS NOT NULL
  AND "reminder_next_at" < now();
