import { type Infer, z } from "alepha";

/**
 * One input a workflow declares under `on.workflow_dispatch.inputs`
 * (#Q4366), as Lore read it from the workflow file: what the run form
 * draws, and what a dispatch is checked against.
 */
export const workflowInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  required: z.boolean(),
  type: z.enum(["string", "boolean", "choice", "number", "environment"]),
  default: z.string().max(1_000).optional(),
  options: z.array(z.string().max(200)).max(100).optional(),
});

export type WorkflowInput = Infer<typeof workflowInputSchema>;
