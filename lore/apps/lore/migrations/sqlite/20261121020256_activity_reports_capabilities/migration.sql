-- The Activity page and Reports get a switch each, the capabilities
-- `activity` and `reports` (#Q4007). A capability is on only while its row
-- exists, so every existing project is given both rows: nobody loses a page.
-- Data only, no table change; a project that already has one keeps it.
INSERT OR IGNORE INTO `project_capabilities` (`project_id`, `key`, `options`)
SELECT `id`, 'activity', '{}' FROM `projects`;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_capabilities` (`project_id`, `key`, `options`)
SELECT `id`, 'reports', '{}' FROM `projects`;
