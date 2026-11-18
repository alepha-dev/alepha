import { type Infer, z } from "alepha";

/**
 * The quests part of an artifact push (#E154): what the pusher found walking
 * `base..HEAD` (or the whole history, with no base). Lore adds the base's set
 * and the recorded-sha matches, and keeps the full set of the pushed commit.
 *
 * ⚠️ Sent as JSON text before `file`, like `manifest`: the multipart decode
 * parses any part that opens with `{`, so the field is declared as the object
 * it becomes. `version` lets a later CLI change the shape without an older
 * Lore misreading it.
 */
export const commitQuestSetPushSchema = z.object({
  version: z.literal(1),
  /**
   * The newest ancestor Lore answered a complete set for, when there was one.
   */
  base: z.string().min(7).max(40).optional(),
  numbers: z.array(z.integer().min(1).max(393_215)).max(50_000),
  /**
   * False for a shallow clone with no base, no repository or a failed git.
   */
  complete: z.boolean(),
});

export type CommitQuestSetPush = Infer<typeof commitQuestSetPushSchema>;

/**
 * The same part for the commits that touched the pushed app's paths
 * (#Q3868), with the paths it walked: git pathspecs joined by line breaks.
 */
export const appQuestSetPushSchema = commitQuestSetPushSchema.extend({
  paths: z.string().min(1).max(2000),
});

export type AppQuestSetPush = Infer<typeof appQuestSetPushSchema>;
