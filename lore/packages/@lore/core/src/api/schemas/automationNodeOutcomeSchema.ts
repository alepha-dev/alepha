import { type Infer, z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";

/**
 * What one node did in a run (#Q3807), per row of a `rows` read: it ran,
 * it was skipped (behind the port a condition did not take, or it had
 * nothing to do), it was refused or failed, its outcome is unknown, or a
 * stop upstream left it not reached. A condition also names the port it
 * took. Derived from the plan frozen with the run, never stored twice.
 */
export const automationNodeOutcomeSchema = z
  .object({
    node: automationGraphNodeIdSchema,
    row: z.integer().min(0).max(49).optional(),
    outcome: z.enum([
      "ran",
      "skipped",
      "refused",
      "failed",
      "unknown",
      "not_reached",
      "pending",
    ]),
    port: z.enum(["true", "false"]).optional(),
  })
  .strict();
export type AutomationNodeOutcome = Infer<typeof automationNodeOutcomeSchema>;
