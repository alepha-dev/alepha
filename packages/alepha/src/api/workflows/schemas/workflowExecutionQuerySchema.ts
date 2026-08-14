import { type Infer, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const workflowExecutionQuerySchema = pageQuerySchema.extend({
  workflow: z.text({ description: "Filter by workflow name" }).optional(),
  status: z
    .enum([
      "pending",
      "running",
      "completed",
      "failed",
      "timed_out",
      "compensating",
      "compensated",
      "compensation_failed",
      "cancelled",
    ])
    .optional(),
  from: z.datetime().describe("From date (ISO)").optional(),
  to: z.datetime().describe("To date (ISO)").optional(),
});

export type WorkflowExecutionQuery = Infer<typeof workflowExecutionQuerySchema>;
