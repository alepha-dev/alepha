import { type Infer, z } from "alepha";

/**
 * One deployed copy running a quest's commits (#E154).
 */
export const liveQuestInstanceSchema = z.object({
  instanceId: z.uuid(),
  app: z.string(),
  env: z.string(),
  /**
   * The build was pushed from a working tree with tracked changes: "live
   * (unverified)".
   */
  dirty: z.boolean(),
  /**
   * The finish time of the oldest deployment in the newest unbroken run of
   * succeeded deployments carrying the quest.
   */
  since: z.datetime().optional(),
});

export type LiveQuestInstanceResource = Infer<typeof liveQuestInstanceSchema>;
