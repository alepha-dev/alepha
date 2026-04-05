import { type Static, t } from "alepha";
import { workflowExecutions } from "../entities/workflowExecutions.ts";

export const workflowExecutionCanSchema = t.object({
  retry: t.boolean(),
  cancel: t.boolean(),
  compensate: t.boolean(),
  restart: t.boolean(),
  signal: t.optional(
    t.object({
      stepName: t.text(),
      schema: t.optional(t.any()),
    }),
  ),
});

export type WorkflowExecutionCan = Static<typeof workflowExecutionCanSchema>;

export const workflowExecutionResourceSchema = t.extend(
  workflowExecutions.schema,
  { can: workflowExecutionCanSchema },
  {
    title: "WorkflowExecutionResource",
    description: "A workflow execution resource.",
  },
);

export type WorkflowExecutionResource = Static<
  typeof workflowExecutionResourceSchema
>;
