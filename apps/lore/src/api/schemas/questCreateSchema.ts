import { t } from "alepha";

export const questCreateSchema = t.object({
  title: t.string(),
  description: t.string({ size: "rich" }),
  zone: t.string(),
  priority: t.enum(["optional", "low", "medium", "high"]),
  difficulty: t.integer({ minimum: 1, maximum: 5 }),
  campaignId: t.integer(),
  objectives: t.optional(
    t.array(
      t.object({
        title: t.string(),
        completed: t.boolean(),
      }),
      { default: [] },
    ),
  ),
  attachments: t.optional(t.array(t.uuid(), { default: [] })),
  /**
   * Optional petition this quest was spawned from. When set, the quest is
   * linked back to the petition so its reporter can follow progression.
   * Validated at handler time: the petition must belong to the same campaign,
   * be in `accepted` state, and the caller must be the campaign owner.
   */
  petitionId: t.optional(t.integer()),
});
