import { type Infer, z } from "alepha";

import { projectSchema } from "./projectSchema.ts";
import { worktreeStateSchema } from "./worktreeStateSchema.ts";

/**
 * A project and all of its worktrees, main first, as collected at one moment.
 */
export const projectStateSchema = z.object({
  project: projectSchema,
  /**
   * The ref every worktree's divergence is measured against.
   */
  base: z.string(),
  /**
   * `owner/repo` on GitHub, when `origin` points there.
   */
  github: z.string().optional(),
  worktrees: z.array(worktreeStateSchema),
  /**
   * Which optional sources answered, so the UI can say why a column is empty
   * instead of leaving it blank.
   */
  sources: z.object({
    gh: z.boolean(),
    lore: z.boolean(),
  }),
  collectedAt: z.string(),
  /**
   * How long the collection took, in milliseconds.
   */
  took: z.integer(),
});

export type ProjectState = Infer<typeof projectStateSchema>;
