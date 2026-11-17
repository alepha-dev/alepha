import { type Infer, z } from "alepha";

/**
 * One deployed copy running a quest's commits (#E154), as the quest list and
 * `quest_get` carry it. Read from Ship through core's `LiveQuestRegistry`.
 */
export const questLiveCopySchema = z.object({
  app: z.string(),
  env: z.string(),
  /**
   * The build came from a dirty working tree: live, unverified.
   */
  dirty: z.boolean(),
  /**
   * Since when, on `quest_get` only: the finish time of the oldest
   * deployment in the newest unbroken run carrying the quest.
   */
  since: z.datetime().optional(),
});

export type QuestLiveCopy = Infer<typeof questLiveCopySchema>;
