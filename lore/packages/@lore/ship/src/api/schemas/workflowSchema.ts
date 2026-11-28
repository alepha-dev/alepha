import { type Infer, z } from "alepha";

import { workflowInputSchema } from "./workflowInputSchema.ts";

/**
 * A workflow of the connected repository that declares
 * `workflow_dispatch` (#Q4366), with the inputs it takes.
 */
export const workflowSchema = z.object({
  id: z.integer(),
  name: z.string().max(200),
  path: z.string().max(500),
  inputs: z.array(workflowInputSchema).max(25),
});

export type Workflow = Infer<typeof workflowSchema>;
