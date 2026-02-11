import { type Static, t } from "alepha";

export const jobQueueDepthSchema = t.object({
  jobName: t.text(),
  pending: t.integer(),
  running: t.integer(),
  scheduled: t.integer(),
  retrying: t.integer(),
  dead: t.integer(),
  concurrency: t.integer(),
});

export type JobQueueDepth = Static<typeof jobQueueDepthSchema>;
