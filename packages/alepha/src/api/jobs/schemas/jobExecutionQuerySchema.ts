import { type Static, z } from "alepha";

export const jobExecutionQuerySchema = z.object({
  status: z
    .enum(["pending", "running", "scheduled", "ok", "error", "cancelled"])
    .optional(),
  limit: z.integer().min(1).max(200).default(20).optional(),
});

export type JobExecutionQuery = Static<typeof jobExecutionQuerySchema>;
