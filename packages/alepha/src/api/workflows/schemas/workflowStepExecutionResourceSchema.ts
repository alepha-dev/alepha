import { type Static, t } from "alepha";
import { workflowStepExecutions } from "../entities/workflowStepExecutions.ts";

export const workflowStepExecutionResourceSchema = t.extend(
  workflowStepExecutions.schema,
  {},
  {
    title: "WorkflowStepExecutionResource",
    description: "A workflow step execution resource.",
  },
);

export type WorkflowStepExecutionResource = Static<
  typeof workflowStepExecutionResourceSchema
>;
