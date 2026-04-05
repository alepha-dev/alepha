import { type Static, t } from "alepha";
import { workflowExecutionResourceSchema } from "./workflowExecutionResourceSchema.ts";
import { workflowStepExecutionResourceSchema } from "./workflowStepExecutionResourceSchema.ts";

export const workflowExecutionDetailSchema = t.extend(
  workflowExecutionResourceSchema,
  {
    steps: t.array(workflowStepExecutionResourceSchema),
  },
  {
    title: "WorkflowExecutionDetail",
    description: "A workflow execution with step details.",
  },
);

export type WorkflowExecutionDetail = Static<
  typeof workflowExecutionDetailSchema
>;
