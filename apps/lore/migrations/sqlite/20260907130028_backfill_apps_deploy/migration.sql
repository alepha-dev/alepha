-- ── Backfill: apps.deploy for every project already lent an estate ──────────
--
-- Epic #36 defined `apps.deploy`, persisted it, backfilled it `false`
-- everywhere and rendered it disabled with a Soon badge. Epic #1 built the
-- surface behind it, so the switch is real now - and an owner who has ALREADY
-- lent an estate to a project must not be sent hunting for a switch to turn on
-- something they plainly asked for. Decided with the owner, folio #1226.
--
-- ⚠️ `project_capabilities`, never `projects`. `projects` is the D1 cascade
-- parent that wiped production in 2026-05. An UPDATE on it is not a rebuild
-- and so not the same risk, but the rule this repo keeps is that no migration
-- touches that table when another one will do - and here another one does.
--
-- ⚠️ Read-modify-write, not a column set. `deploy` lives inside a JSON options
-- bag beside `track`, so `options = '{"deploy":true}'` would silently turn
-- somebody's telemetry off. `json_set` writes one path and leaves the rest.
--
-- ⚠️ `json('true')`, not `true` and not `1`. `json_extract` on a JSON boolean
-- returns integer 1, so a naive round-trip writes `1`, which fails
-- `z.boolean()` on read - and a row that cannot decode is the 2026-08-05
-- incident, where every query touching the table threw.
--
-- ⚠️ It flips an option inside a capability the project ALREADY has, or it
-- does nothing for that row. A project holding an `estate_projects` row but
-- no Apps capability is not given one: `WHERE key = 'apps'` matches no row for
-- it, and inserting one would turn a surface on that nobody asked for.
--
-- Additive, idempotent, and no table is created, dropped or rebuilt.
UPDATE `project_capabilities`
SET `options` = json_set(COALESCE(`options`, '{}'), '$.deploy', json('true'))
WHERE `key` = 'apps'
  AND `project_id` IN (SELECT `project_id` FROM `estate_projects`);
