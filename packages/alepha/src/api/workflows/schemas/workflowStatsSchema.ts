import { type Static, t } from "alepha";

export const workflowStatsSchema = t.object({
  registered: t.integer(),
  running: t.integer(),
  pending: t.integer(),
  waiting: t.integer(),
  completed: t.integer(),
  failed: t.integer(),
  compensated: t.integer(),
  compensationFailed: t.integer(),
  cancelled: t.integer(),
  timedOut: t.integer(),
});

export type WorkflowStats = Static<typeof workflowStatsSchema>;
