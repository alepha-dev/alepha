-- Read-only dry run of the estate home backfill (#Q3278, epic #E126).
--
-- Run against production BEFORE the merge, and again after the deploy:
--   npx wrangler d1 execute lore-production --remote --file apps/lore/scripts/estate-home-dry-run.sql
-- Every statement is a SELECT. Before the deploy `project_id` does not exist
-- yet, so `home_now` is left out of the first query; after the deploy, add
-- `e.project_id AS home_now` and compare it with `proposed_home`.

-- 1. Each estate, its anchor, its loans and the home the rule gives it.
SELECT
  e.slug,
  e.type,
  (SELECT u.username FROM users AS u WHERE u.id = e.owner_user_id) AS owner,
  (
    SELECT group_concat(p.slug || CASE WHEN p.deleted_at IS NULL THEN '' ELSE ' (deleted)' END, ', ')
    FROM estate_projects AS ep
    JOIN projects AS p ON p.id = ep.project_id
    WHERE ep.estate_id = e.id
  ) AS loans,
  (
    SELECT p.slug FROM projects AS p WHERE p.id = COALESCE(
      (
        SELECT ep.project_id
        FROM estate_projects AS ep
        JOIN projects AS p ON p.id = ep.project_id
        WHERE ep.estate_id = e.id
          AND p.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM project_capabilities AS pc WHERE pc.project_id = p.id AND pc.key = 'apps')
          AND EXISTS (SELECT 1 FROM organization_members AS om WHERE om.organization_id = p.organization_id AND om.user_id = e.owner_user_id AND om.rank = 'owner')
        ORDER BY ep.created_at, ep.id
        LIMIT 1
      ),
      (
        SELECT p.id
        FROM projects AS p
        WHERE p.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM project_capabilities AS pc WHERE pc.project_id = p.id AND pc.key = 'apps')
          AND EXISTS (SELECT 1 FROM organization_members AS om WHERE om.organization_id = p.organization_id AND om.user_id = e.owner_user_id AND om.rank = 'owner')
        ORDER BY p.created_at, p.id
        LIMIT 1
      )
    )
  ) AS proposed_home
FROM estates AS e
ORDER BY proposed_home IS NULL DESC, e.created_at;

-- 2. Row counts of the nine child tables (non-null estate_id for the three
--    set-null ones). They must be equal after the deploy.
SELECT
  (SELECT COUNT(*) FROM estates) AS estates,
  (SELECT COUNT(*) FROM estate_projects) AS estate_projects,
  (SELECT COUNT(*) FROM estate_commands) AS estate_commands,
  (SELECT COUNT(*) FROM estate_events) AS estate_events,
  (SELECT COUNT(*) FROM estate_inventories) AS estate_inventories,
  (SELECT COUNT(*) FROM analytics_estate_stats_raw) AS stats_raw,
  (SELECT COUNT(*) FROM analytics_estate_stats_rolled) AS stats_rolled,
  (SELECT COUNT(*) FROM app_instances WHERE estate_id IS NOT NULL) AS app_instances,
  (SELECT COUNT(*) FROM stacks WHERE estate_id IS NOT NULL) AS stacks,
  (SELECT COUNT(*) FROM stack_environments WHERE estate_id IS NOT NULL) AS stack_environments;

-- 3. #Q3279: a stored rank that already lists an estate permission the
--    change makes grantable. Expected: no row.
SELECT o.name AS organization, r.key, r.name, r.permissions
FROM organization_ranks AS r
JOIN organizations AS o ON o.id = r.organization_id
WHERE r.permissions LIKE '%"estate:create"%'
   OR r.permissions LIKE '%"estate:update"%'
   OR r.permissions LIKE '%"estate:delete"%';
