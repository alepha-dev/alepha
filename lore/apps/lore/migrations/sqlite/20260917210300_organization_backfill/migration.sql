-- E61 organization backfill.
--
-- Every statement is idempotent. This file can be applied again if an old
-- worker writes during the accepted migrate-to-deploy window.
--
-- The UUIDs are deterministic from the integer project or member id. The
-- fixed third and fourth groups keep the values UUID-shaped, while the first
-- group separates organizations, copied memberships, and repaired owners.

INSERT INTO `organizations` (`id`, `name`)
SELECT
  '00000000-0000-4000-8000-' || printf('%012d', `p`.`id`),
  `p`.`title`
FROM `projects` AS `p`
WHERE `p`.`organization_id` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `organizations` AS `o`
    WHERE `o`.`id` = '00000000-0000-4000-8000-' || printf('%012d', `p`.`id`)
  );
--> statement-breakpoint
UPDATE `projects`
SET `organization_id` = '00000000-0000-4000-8000-' || printf('%012d', `id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

-- Copy only live-project memberships. A NULL rank deliberately stays NULL
-- and continues to mean the built-in member rank.
INSERT INTO `organization_members` (
  `id`,
  `created_at`,
  `updated_at`,
  `organization_id`,
  `user_id`,
  `rank`
)
SELECT
  '10000000-0000-4000-8000-' || printf('%012d', `m`.`id`),
  `m`.`created_at`,
  `m`.`updated_at`,
  `p`.`organization_id`,
  `m`.`user_id`,
  `m`.`rank`
FROM `members` AS `m`
INNER JOIN `projects` AS `p` ON `p`.`id` = `m`.`project_id`
WHERE `p`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `organization_members` AS `om`
    WHERE `om`.`organization_id` = `p`.`organization_id`
      AND `om`.`user_id` = `m`.`user_id`
  );
--> statement-breakpoint

-- Repair an ownerless live project without restoring a creator who left
-- after a transfer. An existing owner suppresses both repair statements.
-- First promote an existing creator membership, then insert one only when
-- the creator has no membership yet and still has an account.
UPDATE `organization_members`
SET `rank` = 'owner'
WHERE `id` IN (
  SELECT `om`.`id`
  FROM `organization_members` AS `om`
  INNER JOIN `projects` AS `p`
    ON `p`.`organization_id` = `om`.`organization_id`
  INNER JOIN `users` AS `u` ON `u`.`id` = `p`.`created_by`
  WHERE `p`.`deleted_at` IS NULL
    AND `om`.`user_id` = `p`.`created_by`
    AND NOT EXISTS (
      SELECT 1
      FROM `organization_members` AS `owner`
      WHERE `owner`.`organization_id` = `p`.`organization_id`
        AND `owner`.`rank` = 'owner'
    )
);
--> statement-breakpoint
INSERT INTO `organization_members` (`id`, `organization_id`, `user_id`, `rank`)
SELECT
  '20000000-0000-4000-8000-' || printf('%012d', `p`.`id`),
  `p`.`organization_id`,
  `p`.`created_by`,
  'owner'
FROM `projects` AS `p`
INNER JOIN `users` AS `u` ON `u`.`id` = `p`.`created_by`
WHERE `p`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `organization_members` AS `owner`
    WHERE `owner`.`organization_id` = `p`.`organization_id`
      AND `owner`.`rank` = 'owner'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `organization_members` AS `member`
    WHERE `member`.`organization_id` = `p`.`organization_id`
      AND `member`.`user_id` = `p`.`created_by`
  );
--> statement-breakpoint

-- Rank definitions keep their ids so every stored assignment continues to
-- name the same definition. Definitions on deleted projects stay historical.
INSERT INTO `organization_ranks` (
  `id`,
  `version`,
  `created_at`,
  `updated_at`,
  `organization_id`,
  `key`,
  `name`,
  `builtin`,
  `permissions`
)
SELECT
  `r`.`id`,
  `r`.`version`,
  `r`.`created_at`,
  `r`.`updated_at`,
  `p`.`organization_id`,
  `r`.`key`,
  `r`.`name`,
  `r`.`builtin`,
  `r`.`permissions`
FROM `rank_definitions` AS `r`
INNER JOIN `projects` AS `p` ON CAST(`p`.`id` AS text) = `r`.`scope_id`
WHERE `r`.`type` = 'project'
  AND `p`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `organization_ranks` AS `existing`
    WHERE `existing`.`id` = `r`.`id`
       OR (
         `existing`.`organization_id` = `p`.`organization_id`
         AND `existing`.`key` = `r`.`key`
       )
  );
--> statement-breakpoint

-- Only pending project invitations move. Keeping the id preserves the
-- invitation token purpose and therefore every link already in an email.
INSERT INTO `organization_invitations` (
  `id`,
  `version`,
  `created_at`,
  `updated_at`,
  `organization_id`,
  `invited_by`,
  `email`,
  `status`,
  `rank`,
  `metadata`,
  `expires_at`,
  `resolved_at`,
  `resolved_by`
)
SELECT
  `i`.`id`,
  `i`.`version`,
  `i`.`created_at`,
  `i`.`updated_at`,
  `p`.`organization_id`,
  `i`.`invited_by`,
  `i`.`email`,
  `i`.`status`,
  json_extract(`i`.`roles`, '$[0]'),
  `i`.`metadata`,
  `i`.`expires_at`,
  `i`.`resolved_at`,
  `i`.`resolved_by`
FROM `invitations` AS `i`
INNER JOIN `projects` AS `p` ON CAST(`p`.`id` AS text) = `i`.`resource_id`
WHERE `i`.`resource_type` = 'project'
  AND `i`.`status` = 'pending'
  AND `p`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `organization_invitations` AS `existing`
    WHERE `existing`.`id` = `i`.`id`
  );
