import { type Static, t } from "alepha";

export const jobStatsSchema = t.object({
  registered: t.integer(),
  running: t.integer(),
  pending: t.integer(),
  scheduled: t.integer(),
  retrying: t.integer(),
  dead: t.integer(),
  completed24h: t.integer(),
  failed24h: t.integer(),
});

export type JobStats = Static<typeof jobStatsSchema>;
