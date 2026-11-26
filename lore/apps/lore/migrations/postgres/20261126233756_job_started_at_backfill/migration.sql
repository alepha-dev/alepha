-- Every job that ran has a start time (#Q4432). Bay sends a job's "running"
-- ack once and never again, while its terminal ack is replayed on the next
-- connection, so a job whose pickup went unheard ended with no "started_at".
-- "HostJobService.startOf" now stamps one at the end; this fills the jobs that
-- ended before it, in the same order: the command's "running_at", else its
-- "sent_at", else, for a job its host says ran (succeeded or timed out), its
-- "queued_at". Commands are pruned per host, so an old job's join may find
-- nothing. A job that never ran (cancelled while queued, refused at dispatch)
-- keeps none.
UPDATE "host_jobs"
SET "started_at" = COALESCE(
  (
    SELECT COALESCE("host_commands"."running_at", "host_commands"."sent_at")
    FROM "host_commands"
    WHERE "host_commands"."id" = "host_jobs"."command_id"
  ),
  CASE WHEN "status" IN ('succeeded', 'timed_out') THEN "queued_at" END
)
WHERE "started_at" IS NULL
  AND "ended_at" IS NOT NULL
  AND "status" IN ('succeeded', 'failed', 'cancelled', 'timed_out');
