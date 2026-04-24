import { type Static, t } from "alepha";

export const jobExecutionQuerySchema = t.object({
  status: t.optional(
    t.enum(["pending", "running", "scheduled", "ok", "error", "cancelled"]),
  ),
  limit: t.optional(t.integer({ minimum: 1, maximum: 200, default: 20 })),
});

export type JobExecutionQuery = Static<typeof jobExecutionQuerySchema>;
