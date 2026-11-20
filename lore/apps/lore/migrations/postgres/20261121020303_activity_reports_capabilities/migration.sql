-- The Activity page and Reports get a switch each, the capabilities
-- `activity` and `reports` (#Q4007). A capability is on only while its row
-- exists, so every existing project is given both rows: nobody loses a page.
-- Data only, no table change; a project that already has one keeps it.
INSERT INTO "project_capabilities" ("project_id", "key", "options")
SELECT "id", 'activity', '{}'::jsonb FROM "projects"
ON CONFLICT ("project_id", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "project_capabilities" ("project_id", "key", "options")
SELECT "id", 'reports', '{}'::jsonb FROM "projects"
ON CONFLICT ("project_id", "key") DO NOTHING;
