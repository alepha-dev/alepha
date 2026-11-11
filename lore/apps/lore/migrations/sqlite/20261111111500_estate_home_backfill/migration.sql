-- E126 estate home backfill (#Q3278).
--
-- Data only: no ALTER, CREATE or DROP, and every statement is guarded, so
-- this file can be applied again by hand if an old worker writes during the
-- accepted migrate-to-deploy window.
--
-- An estate is homed only where the person who managed it keeps managing
-- it, so the migration hands nobody a machine. A project qualifies when it
-- is live, has the Apps capability on, and its organization is owned (an
-- `organization_members` row ranked `owner`) by the estate's current
-- `owner_user_id`. The home is, the first that exists:
--
--   1. the project of the estate's oldest loan to a qualifying project;
--   2. the oldest qualifying project;
--   3. none: the estate keeps deploying through its loans, and the instance
--      admin assigns it a home.
--
-- "Oldest" is by `created_at`, then `id`, so two runs pick the same row.
-- `(project_id, slug)` cannot collide: slugs were unique per owner, and
-- rules 1 and 2 only put an owner's estates into that owner's projects.
-- `owner_user_id` already names the home project's owner after this, which
-- is what the cascade anchor must hold.

UPDATE `estates`
SET `project_id` = COALESCE(
  (
    SELECT `ep`.`project_id`
    FROM `estate_projects` AS `ep`
    INNER JOIN `projects` AS `p` ON `p`.`id` = `ep`.`project_id`
    WHERE `ep`.`estate_id` = `estates`.`id`
      AND `p`.`deleted_at` IS NULL
      AND EXISTS (
        SELECT 1
        FROM `project_capabilities` AS `pc`
        WHERE `pc`.`project_id` = `p`.`id`
          AND `pc`.`key` = 'apps'
      )
      AND EXISTS (
        SELECT 1
        FROM `organization_members` AS `om`
        WHERE `om`.`organization_id` = `p`.`organization_id`
          AND `om`.`user_id` = `estates`.`owner_user_id`
          AND `om`.`rank` = 'owner'
      )
    ORDER BY `ep`.`created_at`, `ep`.`id`
    LIMIT 1
  ),
  (
    SELECT `p`.`id`
    FROM `projects` AS `p`
    WHERE `p`.`deleted_at` IS NULL
      AND EXISTS (
        SELECT 1
        FROM `project_capabilities` AS `pc`
        WHERE `pc`.`project_id` = `p`.`id`
          AND `pc`.`key` = 'apps'
      )
      AND EXISTS (
        SELECT 1
        FROM `organization_members` AS `om`
        WHERE `om`.`organization_id` = `p`.`organization_id`
          AND `om`.`user_id` = `estates`.`owner_user_id`
          AND `om`.`rank` = 'owner'
      )
    ORDER BY `p`.`created_at`, `p`.`id`
    LIMIT 1
  )
)
WHERE `project_id` IS NULL;
--> statement-breakpoint

-- Who added the estate, for display: until now that was its owner.
UPDATE `estates`
SET `created_by` = `owner_user_id`
WHERE `created_by` IS NULL;
