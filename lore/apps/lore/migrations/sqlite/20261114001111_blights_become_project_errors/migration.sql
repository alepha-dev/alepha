ALTER TABLE `blight_ignore_rules` RENAME TO `project_error_ignore_rules`;--> statement-breakpoint
ALTER TABLE `blights` RENAME TO `project_errors`;--> statement-breakpoint
DROP INDEX IF EXISTS `blight_ignore_rules_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `blights_project_id_fingerprint_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `blights_project_id_last_seen_at_idx`;--> statement-breakpoint
CREATE INDEX `project_error_ignore_rules_project_id_idx` ON `project_error_ignore_rules` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_errors_project_id_fingerprint_idx` ON `project_errors` (`project_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `project_errors_project_id_last_seen_at_idx` ON `project_errors` (`project_id`,`last_seen_at`);--> statement-breakpoint
-- Blight becomes error (#E147, #Q3552). The two tables above are renamed in
-- place, rows kept. Below, every identifier a row stores is rewritten, so
-- nothing that worked before the deploy stops working after it.
--
-- Permissions, exact and wildcard, in ranks and API keys (JSON text arrays).
UPDATE `organization_ranks`
SET `permissions` = REPLACE(REPLACE(REPLACE(`permissions`,
  '"blight:read"', '"error:read"'),
  '"blight:triage"', '"error:triage"'),
  '"blight:*"', '"error:*"')
WHERE `permissions` LIKE '%"blight:%';--> statement-breakpoint
UPDATE `api_keys`
SET `permissions` = REPLACE(REPLACE(REPLACE(`permissions`,
  '"blight:read"', '"error:read"'),
  '"blight:triage"', '"error:triage"'),
  '"blight:*"', '"error:*"')
WHERE `permissions` LIKE '%"blight:%';--> statement-breakpoint
-- The open-errors metric, in dashboard cards and in automation rules (the
-- rule's `select.key`), and the preset a rule was made from.
UPDATE `dashboard_cards` SET `metric` = 'openErrors' WHERE `metric` = 'openBlights';--> statement-breakpoint
UPDATE `project_dashboard_cards` SET `metric` = 'openErrors' WHERE `metric` = 'openBlights';--> statement-breakpoint
UPDATE `automations`
SET `rule` = REPLACE(`rule`, '"openBlights"', '"openErrors"')
WHERE `rule` LIKE '%"openBlights"%';--> statement-breakpoint
UPDATE `automations` SET `preset_key` = 'error-crossing' WHERE `preset_key` = 'blight-crossing';--> statement-breakpoint
-- A sigil's kinds: `blights` is `errors`. A REQUIRED enum inside a JSON
-- column, so a row left behind would fail to decode on every read.
UPDATE `sigils`
SET `kinds` = REPLACE(`kinds`, '"blights"', '"errors"')
WHERE `kinds` LIKE '%"blights"%';--> statement-breakpoint
-- The customised Triage prompt, keyed by its kind.
UPDATE `project_prompts` SET `kind` = 'errorTriage' WHERE `kind` = 'blightTriage';--> statement-breakpoint
-- A forwarded quest names its error as `projectErrorId`: the hand-back reads
-- it, and a row missed here would stop a completed quest resolving its error.
UPDATE `quests`
SET `source` = json_set(json_remove(`source`, '$.sigilBlightId'),
  '$.projectErrorId', json_extract(`source`, '$.sigilBlightId'))
WHERE json_extract(`source`, '$.sigilBlightId') IS NOT NULL;--> statement-breakpoint
-- The area the forward files into: `Blights` becomes `Errors`, merged into
-- an `Errors` area a project already has. The quests move first; areas are
-- hard-deleted and unique on (project_id, name).
UPDATE `quests` SET `area` = 'Errors' WHERE `area` = 'Blights';--> statement-breakpoint
DELETE FROM `areas`
WHERE `name` = 'Blights'
  AND `project_id` IN (SELECT `project_id` FROM `areas` WHERE `name` = 'Errors');--> statement-breakpoint
UPDATE `areas` SET `name` = 'Errors' WHERE `name` = 'Blights';
