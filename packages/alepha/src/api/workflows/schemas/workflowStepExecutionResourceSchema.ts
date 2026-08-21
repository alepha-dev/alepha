import type { Infer } from "alepha";

import { workflowStepExecutions } from "../entities/workflowStepExecutions.ts";

export const workflowStepExecutionResourceSchema =
  workflowStepExecutions.schema.meta({
    title: "WorkflowStepExecutionResource",
    description: "A workflow step execution resource.",
  });

export type WorkflowStepExecutionResource = Infer<
  typeof workflowStepExecutionResourceSchema
>;
