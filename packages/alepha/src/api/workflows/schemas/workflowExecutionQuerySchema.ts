import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const workflowExecutionQuerySchema = t.extend(pageQuerySchema, {
  workflow: t.optional(t.text({ description: "Filter by workflow name" })),
  status: t.optional(
    t.enum([
      "pending",
      "running",
      "waiting_for_signal",
      "completed",
      "failed",
      "timed_out",
      "compensating",
      "compensated",
      "compensation_failed",
      "cancelled",
    ]),
  ),
  from: t.optional(t.datetime({ description: "From date (ISO)" })),
  to: t.optional(t.datetime({ description: "To date (ISO)" })),
});

export type WorkflowExecutionQuery = Static<
  typeof workflowExecutionQuerySchema
>;
