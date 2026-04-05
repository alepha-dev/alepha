import { type Static, t } from "alepha";

export const workflowActivityPointSchema = t.object({
  date: t.text(),
  completed: t.integer(),
  failed: t.integer(),
});

export type WorkflowActivityPoint = Static<typeof workflowActivityPointSchema>;

export const workflowActivityQuerySchema = t.object({
  days: t.optional(t.integer({ minimum: 1, maximum: 90 })),
});

export type WorkflowActivityQuery = Static<typeof workflowActivityQuerySchema>;
