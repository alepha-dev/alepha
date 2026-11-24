-- Lore Build is removed (#Q4217): GitHub hosts the code. Its tables go, a
-- project names its repository by URL again (`repository_url`), and Quality
-- moves to Reports' `quality` option. Pre-v1: the hosted repositories are not
-- migrated anywhere.
ALTER TABLE "code_commit_parents" DROP CONSTRAINT "code_commit_parents_repository_id_code_repositories_id_fkey";--> statement-breakpoint
ALTER TABLE "code_commit_paths" DROP CONSTRAINT "code_commit_paths_repository_id_code_repositories_id_fkey";--> statement-breakpoint
ALTER TABLE "code_commits" DROP CONSTRAINT "code_commits_repository_id_code_repositories_id_fkey";--> statement-breakpoint
ALTER TABLE "code_blame_cache" DROP CONSTRAINT "code_blame_cache_repository_id_code_repositories_id_fkey";--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, their foreign keys dropped above, and no table references them.
DROP TABLE "code_repositories";--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, their foreign keys dropped above, and no table references them.
DROP TABLE "code_commit_parents";--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, their foreign keys dropped above, and no table references them.
DROP TABLE "code_commit_paths";--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, their foreign keys dropped above, and no table references them.
DROP TABLE "code_commits";--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, their foreign keys dropped above, and no table references them.
DROP TABLE "code_blame_cache";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repository_url" text;--> statement-breakpoint
-- Quality moves from Build to Reports: a project whose Build row had
-- `quality` on gets it on its Reports row, which every project holds (#Q4007).
UPDATE "project_capabilities"
SET "options" = "options" || '{"quality":true}'::jsonb
WHERE "key" = 'reports'
  AND "project_id" IN (
    SELECT "project_id" FROM "project_capabilities"
    WHERE "key" = 'build' AND ("options"->>'quality')::boolean IS TRUE
  );--> statement-breakpoint
-- The `build` capability is gone with its rows.
DELETE FROM "project_capabilities" WHERE "key" = 'build';--> statement-breakpoint
-- And its permissions, `code:read`, `code:write` and `code:admin`, from every
-- stored rank.
UPDATE "organization_ranks"
SET "permissions" = array_remove(array_remove(array_remove("permissions", 'code:read'), 'code:write'), 'code:admin')
WHERE "permissions" && ARRAY['code:read', 'code:write', 'code:admin']::text[];
