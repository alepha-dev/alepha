import { type Infer, z } from "alepha";

/**
 * What one deployed copy runs, in quests (#E154).
 *
 * ⚠️ `live` and `behind` are absent, never empty, when the set is not known:
 * `state` and `reason` say why (it never deployed, its run names no commit,
 * the commit has no set, or the set rests on a partial history).
 */
export const instanceLiveQuestsSchema = z.object({
  state: z.enum(["known", "partial", "unknown"]),
  reason: z
    .enum(["never-deployed", "no-commit", "no-set", "partial"])
    .optional(),
  deploymentId: z.uuid().optional(),
  commitSha: z.string().optional(),
  dirty: z.boolean().optional(),
  /**
   * The quest numbers the copy's commit carries. Present for a partial set
   * too: each is a true ancestor's.
   */
  live: z.array(z.integer()).optional(),
  /**
   * The project's completed quests with at least one recorded commit, minus
   * {@link live}. Only for a known, complete set.
   */
  behind: z.array(z.integer()).optional(),
  /**
   * Per succeeded deployment, newest first: what it put live and took down
   * against the previous succeeded one. `known` is false when either set is
   * unknown or partial.
   */
  runs: z.array(
    z.object({
      deploymentId: z.uuid(),
      known: z.boolean(),
      added: z.array(z.integer()).optional(),
      removed: z.array(z.integer()).optional(),
    }),
  ),
});

export type InstanceLiveQuests = Infer<typeof instanceLiveQuestsSchema>;
