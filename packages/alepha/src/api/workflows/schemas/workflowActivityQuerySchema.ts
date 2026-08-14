import { type Infer, z } from "alepha";

export const workflowActivityQuerySchema = z.object({
  days: z.integer().min(1).max(90).optional(),
});

export type WorkflowActivityQuery = Infer<typeof workflowActivityQuerySchema>;
