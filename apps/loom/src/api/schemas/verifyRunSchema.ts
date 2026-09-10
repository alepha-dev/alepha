import { type Infer, z } from "alepha";

/**
 * A local `yarn v` (`alepha verify`) started from inside a worktree, read from
 * the machine-wide queue it takes a slot in.
 */
export const verifyRunSchema = z.object({
  pid: z.integer(),
  /**
   * Holding the slot, as opposed to waiting for it.
   */
  holding: z.boolean(),
  /**
   * 0 for the run holding the slot, else its place in the line (1 = next).
   */
  position: z.integer(),
  /**
   * The step the holder is in: `install`, `lint`, `checks`, `test`,
   * `test:bun`. Absent while waiting, or between steps.
   */
  step: z.string().optional(),
  /**
   * 0 to 100, estimated from the steps' usual durations on this machine.
   */
  progress: z.number().optional(),
  /**
   * When the run joined the queue, ISO 8601.
   */
  startedAt: z.string(),
});

export type VerifyRun = Infer<typeof verifyRunSchema>;
