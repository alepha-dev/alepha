import { type Static, t } from "alepha";

export const workflowRegistrationSchema = t.object({
  name: t.text(),
  stepCount: t.integer(),
  steps: t.array(
    t.object({
      name: t.text(),
      type: t.enum(["handler", "signal", "parallel"]),
      hasCompensate: t.boolean(),
      hasRetry: t.boolean(),
      timeout: t.optional(t.text()),
    }),
  ),
  onError: t.enum(["compensate", "fail"]),
  timeout: t.optional(t.text()),
  priority: t.text(),
  tags: t.optional(t.array(t.text())),
  paused: t.boolean(),
  running: t.integer(),
  pending: t.integer(),
  waiting: t.integer(),
  failed: t.integer(),
});

export type WorkflowRegistration = Static<typeof workflowRegistrationSchema>;
