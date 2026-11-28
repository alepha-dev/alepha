import { type Infer, z } from "alepha";

/**
 * A recent run of the connected repository's workflows (#Q4366), as GitHub
 * lists it, with the member who started it from Lore when one did.
 */
export const workflowRunSchema = z.object({
  id: z.integer(),
  workflowId: z.integer(),
  name: z.string().max(200),
  branch: z.string().max(255),
  event: z.string().max(50),
  status: z.string().max(20),
  conclusion: z.string().max(20).optional(),
  url: z.string().max(500),
  createdAt: z.string(),
  actor: z.string().max(100).optional(),
  /**
   * The member who dispatched it from Lore, by name.
   */
  requestedBy: z.string().max(200).optional(),
});

export type WorkflowRun = Infer<typeof workflowRunSchema>;
