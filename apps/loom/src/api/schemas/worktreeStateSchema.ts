import { type Infer, z } from "alepha";

import { ciRunSchema } from "./ciRunSchema.ts";
import { claudeSessionSchema } from "./claudeSessionSchema.ts";
import { commitSchema } from "./commitSchema.ts";
import { devServerSchema } from "./devServerSchema.ts";
import { divergenceSchema } from "./divergenceSchema.ts";
import { gitStatusSchema } from "./gitStatusSchema.ts";
import { questRefSchema } from "./questRefSchema.ts";
import { verifyRunSchema } from "./verifyRunSchema.ts";

/**
 * Everything Loom knows about one worktree, the main checkout included.
 *
 * Every source is optional on purpose: a worktree whose directory is gone,
 * a machine without `gh`, a project with no Lore key. Each part that could
 * not be read is absent rather than failing the whole project.
 */
export const worktreeStateSchema = z.object({
  path: z.string(),
  /**
   * The directory's name, which for a Claude worktree is its session name.
   */
  name: z.string(),
  /**
   * The repository's own checkout, as opposed to a linked worktree.
   */
  isMain: z.boolean(),
  /**
   * `undefined` on a detached HEAD.
   */
  branch: z.string().optional(),
  head: z.string(),
  /**
   * Set when git reports the worktree as prunable: its directory is gone.
   */
  prunable: z.string().optional(),
  /**
   * The raw `git worktree lock` reason, whoever wrote it.
   */
  lockReason: z.string().optional(),
  /**
   * When the worktree was added, ISO 8601.
   */
  createdAt: z.string().optional(),
  status: gitStatusSchema.optional(),
  divergence: divergenceSchema.optional(),
  lastCommit: commitSchema.optional(),
  /**
   * Stash entries recorded on this worktree's branch. The stash stack is
   * shared by every worktree, so this is attribution, not ownership.
   */
  stashes: z.integer(),
  /**
   * Whether `node_modules` exists: a worktree without it cannot run a dev
   * server or a test yet.
   */
  installed: z.boolean(),
  quests: z.array(questRefSchema),
  ci: ciRunSchema.optional(),
  /**
   * A local `yarn v` started from this worktree, running or queued.
   */
  verify: verifyRunSchema.optional(),
  claude: claudeSessionSchema,
  devServers: z.array(devServerSchema),
});

export type WorktreeState = Infer<typeof worktreeStateSchema>;
