import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const jobExecutionQuerySchema = t.extend(pageQuerySchema, {
  job: t.optional(
    t.text({
      description: "Filter by job name",
    }),
  ),
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "dead",
      "cancelled",
    ]),
  ),
  priority: t.optional(t.enum(["critical", "high", "normal", "low"])),
  from: t.optional(
    t.datetime({
      description: "From date (ISO)",
    }),
  ),
  to: t.optional(
    t.datetime({
      description: "To date (ISO)",
    }),
  ),
});

export type JobExecutionQuery = Static<typeof jobExecutionQuerySchema>;
