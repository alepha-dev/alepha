import { type Infer, z } from "alepha";

import { workflowExecutions } from "../entities/workflowExecutions.ts";

/**
 * Public-facing schema for a workflow execution row. `can` derives the
 * available admin actions from the row's status.
 */
export const workflowExecutionResourceSchema = workflowExecutions.schema
  .extend({
    can: z.object({
      retry: z.boolean(),
      cancel: z.boolean(),
      compensate: z.boolean(),
      restart: z.boolean(),
    }),
  })
  .meta({
    title: "WorkflowExecutionResource",
    description: "A workflow execution row with derived actions.",
  });

export type WorkflowExecutionResource = Infer<
  typeof workflowExecutionResourceSchema
>;

export type WorkflowExecutionCan = WorkflowExecutionResource["can"];
