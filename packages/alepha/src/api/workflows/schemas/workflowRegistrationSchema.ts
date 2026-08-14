import { type Infer, z } from "alepha";

/**
 * A registered workflow with its declared shape and live execution counts.
 */
export const workflowRegistrationSchema = z.object({
  name: z.text(),
  stepCount: z.integer(),
  steps: z.array(
    z.object({
      name: z.text(),
      hasCompensate: z.boolean(),
      hasRetry: z.boolean(),
      timeout: z.text().optional(),
    }),
  ),
  onError: z.enum(["compensate", "fail"]),
  timeout: z.text().optional(),
  priority: z.text(),
  tags: z.array(z.text()).optional(),
  paused: z.boolean(),
  running: z.integer(),
  pending: z.integer(),
  failed: z.integer(),
});

export type WorkflowRegistration = Infer<typeof workflowRegistrationSchema>;
