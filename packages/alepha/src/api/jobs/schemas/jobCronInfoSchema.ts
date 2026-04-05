import { type Static, t } from "alepha";

export const jobCronInfoSchema = t.object({
  name: t.text(),
  cron: t.text(),
  lock: t.boolean(),
  priority: t.enum(["critical", "high", "normal", "low"]),
  concurrency: t.integer(),
  hasSchema: t.boolean(),
  paused: t.boolean(),
  lastExecution: t.optional(
    t.object({
      id: t.uuid(),
      status: t.text(),
      startedAt: t.optional(t.datetime()),
      completedAt: t.optional(t.datetime()),
      error: t.optional(t.text()),
    }),
  ),
});

export type JobCronInfo = Static<typeof jobCronInfoSchema>;
