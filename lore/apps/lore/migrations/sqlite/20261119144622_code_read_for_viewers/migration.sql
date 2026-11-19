-- Build, the fourth pillar (#E162, #Q3927), declares `code:read`,
-- `code:write` and `code:admin`. Data only, no table change.
--
-- Admin and Member read their permissions from the code until somebody edits
-- them (#Q3920), so they gain theirs on deploy. Viewer is a stored row, and
-- `DefaultRankService` never rewrites a rank it finds: a Viewer nobody edited
-- (`version` still 0) gains `code:read` here. An edited one is kept as it is.
UPDATE `organization_ranks`
SET `permissions` = json_insert(`permissions`, '$[#]', 'code:read')
WHERE `key` = 'viewer'
  AND `version` = 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`organization_ranks`.`permissions`)
    WHERE value = 'code:read'
  );
