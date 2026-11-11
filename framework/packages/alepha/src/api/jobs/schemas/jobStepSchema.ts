import { type Infer, z } from "alepha";

/**
 * One entry of an execution's `steps` record, keyed by the step's name.
 *
 * - A **run entry** (`step.run`) has no `until`. It is written once the
 *   step's function resolved, and its presence is what "completed" means:
 *   `result` is absent when the function returned `undefined`.
 * - A **sleep entry** (`step.sleep`, `step.sleepUntil`) has `until`, the
 *   instant the run wakes, and no `result`.
 *
 * `at` is when the entry was written, `ms` how long the function ran (0 for
 * a sleep).
 */
export const jobStepSchema = z.object({
  at: z.datetime(),
  ms: z.integer(),
  result: z.any().optional(),
  until: z.datetime().optional(),
});

export type JobStep = Infer<typeof jobStepSchema>;
