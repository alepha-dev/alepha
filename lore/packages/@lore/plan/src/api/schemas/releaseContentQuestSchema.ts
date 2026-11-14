import { type Infer, z } from "alepha";

import { quests } from "../entities/quests.ts";

/**
 * One quest row of `getReleaseContents`, under an epic or loose beside them.
 *
 * The three timestamps rather than a `status` string, because the release
 * page draws four buckets from them and a string would have to be parsed
 * back apart: `completedAt` is done, `acceptedAt` without `completedAt` is
 * in progress, `shelvedAt` is declined, and a row carrying none of the
 * three is open and untouched. Exactly the partition
 * `ReleaseController.progressOf` counts, so a card's rows and the ratio
 * above them cannot disagree.
 *
 * ⚠️ A shelved row is included in the list and excluded from the ratio, the
 * same way `shelved` sits outside `total` on the rollup. See
 * `releases.total` for why.
 */
export const releaseContentQuestSchema = z.object({
  id: z.integer(),
  /**
   * Per-project reference, rendered as `#42` and linked to the quest.
   */
  shortId: z.integer(),
  title: z.string(),
  area: z.string().optional(),
  priority: z.string(),
  /**
   * The predecessor's id, when the quest has one. A raw id rather than a
   * `shortId`, because this endpoint answers ids everywhere else and the
   * release Flow only needs it to find the other row in the same payload.
   *
   * ⚠️ Declared here because the response schema is what serializes. The
   * entity has carried the column all along and the Flow drew nothing.
   */
  dependsOn: quests.schema.shape.dependsOn,
  completedAt: z.datetime().optional(),
  acceptedAt: z.datetime().optional(),
  shelvedAt: z.datetime().optional(),
});

export type ReleaseContentQuest = Infer<typeof releaseContentQuestSchema>;
