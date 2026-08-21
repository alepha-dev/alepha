import { type Infer, z } from "alepha";

import { workflowExecutionResourceSchema } from "./workflowExecutionResourceSchema.ts";
import { workflowStepExecutionResourceSchema } from "./workflowStepExecutionResourceSchema.ts";

export const workflowExecutionDetailSchema = workflowExecutionResourceSchema
  .extend({
    steps: z.array(workflowStepExecutionResourceSchema),
  })
  .meta({
    title: "WorkflowExecutionDetail",
    description: "A workflow execution with step details.",
  });

export type WorkflowExecutionDetail = Infer<
  typeof workflowExecutionDetailSchema
>;
