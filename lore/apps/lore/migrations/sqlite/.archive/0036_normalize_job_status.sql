-- Custom SQL migration file, put your code below! --

-- Normalize legacy `job_executions.status` values to the current enum.
-- The status enum was renamed on 2026-04-24 (alepha 119e7168):
--   completed -> ok, dead -> error, retrying -> scheduled
-- Pre-rename rows were never migrated, so reading them now fails schema
-- decode (TypeBoxError on /status) and 500s the admin "executions" view.
-- Pure UPDATEs — D1-safe (no table rebuild / DROP, so no cascade risk).
UPDATE `job_executions` SET `status` = 'ok' WHERE `status` = 'completed';--> statement-breakpoint
UPDATE `job_executions` SET `status` = 'error' WHERE `status` = 'dead';--> statement-breakpoint
UPDATE `job_executions` SET `status` = 'scheduled' WHERE `status` = 'retrying';
