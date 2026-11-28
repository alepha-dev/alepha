import { type Infer, z } from "alepha";

/**
 * What starts a workflow from Lore (#Q4366): which workflow, on which
 * branch or tag, with which inputs, each checked against what the workflow
 * declares.
 */
export const workflowDispatchBodySchema = z.object({
  workflowId: z.integer(),
  ref: z.string().min(1).max(255),
  inputs: z.record(z.string().max(100), z.string().max(1_000)).optional(),
});

export type WorkflowDispatchBody = Infer<typeof workflowDispatchBodySchema>;
