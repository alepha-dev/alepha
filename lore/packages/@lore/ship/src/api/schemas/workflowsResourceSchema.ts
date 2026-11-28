import { type Infer, z } from "alepha";

import { workflowRunSchema } from "./workflowRunSchema.ts";
import { workflowSchema } from "./workflowSchema.ts";

/**
 * A project's Workflows section (#Q4366): its connected repository, the
 * workflows it can start, and the recent runs. `connected` is false, with
 * nothing else, for a project not connected to GitHub.
 */
export const workflowsResourceSchema = z.object({
  connected: z.boolean(),
  repository: z.string().max(201).optional(),
  defaultBranch: z.string().max(255).optional(),
  workflows: z.array(workflowSchema),
  runs: z.array(workflowRunSchema),
});

export type WorkflowsResource = Infer<typeof workflowsResourceSchema>;
