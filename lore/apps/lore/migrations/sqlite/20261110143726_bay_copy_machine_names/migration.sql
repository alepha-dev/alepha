-- A copy on a Bay machine takes the name the machine really runs it under
-- (#Q3285). Data only: no table, no column and no index changes.
--
-- A copy's name is `<project>-<app>-<env>`, and Bay composes its instance key
-- from the project segment a deploy command carries. The command frame never
-- carried it (`EstateCommandService.frameOf` dropped the field), so every copy
-- deployed so far runs on its machine as `<app>/<env>`, while Lore looked it up
-- in the inventory, and sent its backups and its removal, as `<project>-<app>`.
--
-- The frame carries the segment from this release on. Left as they are, these
-- copies would then deploy to a NEW, empty `<project>-<app>/<env>` beside the
-- running one, which keeps the database and the domain. Renamed to the bare
-- `<app>-<env>`, they send no segment, as a project with no slug always has,
-- and stay on the instance they have.
--
-- ⚠️ Only a copy that is still pointed at the Bay it is named on. One moved
-- away since keeps its name: on a Cloudflare estate that name is a Worker's.
-- ⚠️ Never a stack member: Bay names it after its stack and service.
-- ⚠️ Never when another copy shares the app and environment on that machine:
-- the two already overwrite one instance there, the rows cannot say whose it
-- is, and the bare name can only belong to one of them.
UPDATE `app_instances`
SET `resource_name` = `app` || '-' || `env`
WHERE `resource_name` IS NOT NULL
  AND `stack_environment_id` IS NULL
  AND `estate_id` IN (SELECT `id` FROM `estates` WHERE `type` = 'bay')
  AND (`resource_estate_id` IS NULL OR `resource_estate_id` = `estate_id`)
  AND length(`resource_name`) > length(`app`) + length(`env`) + 2
  AND substr(`resource_name`, -(length(`app`) + length(`env`) + 2)) = '-' || `app` || '-' || `env`
  AND NOT EXISTS (
    SELECT 1 FROM `app_instances` AS `other`
    WHERE `other`.`id` <> `app_instances`.`id`
      AND `other`.`app` = `app_instances`.`app`
      AND `other`.`env` = `app_instances`.`env`
      AND `other`.`stack_environment_id` IS NULL
      AND (`other`.`estate_id` = `app_instances`.`estate_id`
        OR `other`.`resource_estate_id` = `app_instances`.`estate_id`)
  );
