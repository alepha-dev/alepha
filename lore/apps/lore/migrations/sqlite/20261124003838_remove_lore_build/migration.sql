-- Lore Build is removed (#Q4217): GitHub hosts the code. Its tables go, a
-- project names its repository by URL again (`repository_url`), and Quality
-- moves to Reports' `quality` option. Pre-v1: the hosted repositories are not
-- migrated anywhere.
ALTER TABLE `projects` ADD `repository_url` text;--> statement-breakpoint
DROP INDEX IF EXISTS `code_blame_cache_repository_id_commit_sha_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commit_parents_repository_id_sha_parent_sha_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commit_parents_repository_id_parent_sha_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commit_paths_repository_id_commit_sha_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commit_paths_repository_id_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commits_repository_id_sha_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_commits_repository_id_committed_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `code_repositories_project_id_slug_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, with restrict, and no table references them.
DROP TABLE `code_blame_cache`;--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, with restrict, and no table references them.
DROP TABLE `code_commit_parents`;--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, with restrict, and no table references them.
DROP TABLE `code_commit_paths`;--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, with restrict, and no table references them.
DROP TABLE `code_commits`;--> statement-breakpoint
-- alepha-allow-drop-table: Lore Build is removed (#Q4217); the code_* tables reference only each other, with restrict, and no table references them.
DROP TABLE `code_repositories`;--> statement-breakpoint
-- Quality moves from Build to Reports: a project whose Build row had
-- `quality` on gets it on its Reports row, which every project holds
-- (#Q4007); `json('true')` writes a JSON boolean, never 1.
UPDATE `project_capabilities`
SET `options` = json_set(`options`, '$.quality', json('true'))
WHERE `key` = 'reports'
  AND `project_id` IN (
    SELECT `project_id` FROM `project_capabilities`
    WHERE `key` = 'build' AND json_extract(`options`, '$.quality') = 1
  );--> statement-breakpoint
-- The `build` capability is gone with its rows.
DELETE FROM `project_capabilities` WHERE `key` = 'build';--> statement-breakpoint
-- And its permissions, `code:read`, `code:write` and `code:admin`, from every
-- stored rank.
UPDATE `organization_ranks`
SET `permissions` = (
  SELECT json_group_array(value) FROM json_each(`organization_ranks`.`permissions`)
  WHERE value NOT IN ('code:read', 'code:write', 'code:admin')
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`organization_ranks`.`permissions`)
  WHERE value IN ('code:read', 'code:write', 'code:admin')
);
