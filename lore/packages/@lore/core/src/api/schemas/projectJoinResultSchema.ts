import { type Infer, z } from "alepha";

/**
 * The answer to a self-join (#Q3646).
 */
export const projectJoinResultSchema = z.object({
  /**
   * `true` when this call made the caller a member; `false` when they
   * already were, in which case their rank was left alone.
   */
  joined: z.boolean(),
  /**
   * The key of the rank the caller holds now.
   */
  rank: z.text(),
  slug: z.text(),
});

export type ProjectJoinResult = Infer<typeof projectJoinResultSchema>;
