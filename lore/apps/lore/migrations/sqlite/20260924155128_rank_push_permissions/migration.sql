-- #Q2501: pushing a build and recording a quality run were gated on
-- `artifact:read` and `quality:read`, so a Viewer could replace `latest`.
-- They now take `artifact:push` and `quality:push`. Permission names are
-- stored as data in every rank row, so a rank that could push yesterday
-- loses it on this deploy unless it is given the new name.
--
-- Given to a rank that holds the read AND at least one write (any permission
-- not ending in `:read`): that is a rank meant to do work, which is what
-- pushing always was. A read-only rank (the Viewer preset) is left without
-- it, which is the fix. The built-in `member` rank, when it has no row, takes
-- `MEMBER_DEFAULT` from code, which carries both.
--
-- Data only, an UPDATE on existing rows: no table is rebuilt.
UPDATE `organization_ranks`
SET `permissions` = json_insert(`permissions`, '$[#]', 'artifact:push')
WHERE EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` = 'artifact:read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` = 'artifact:push'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` NOT LIKE '%:read'
  );
--> statement-breakpoint
UPDATE `organization_ranks`
SET `permissions` = json_insert(`permissions`, '$[#]', 'quality:push')
WHERE EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` = 'quality:read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` = 'quality:push'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`) AS `p`
    WHERE `p`.`value` NOT LIKE '%:read'
  );
