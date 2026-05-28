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
   * Free-form labels for the nature of the quest (`bug`, `feat`, `chore`,
   * …). Normalized server-side (trim, lowercase, dedupe). Orthogonal to
   * `zone` which labels the module / scope.
   */
  tags: t.optional(t.array(t.string(), { default: [] })),
  /**
   * Optional petition this quest was spawned from. When set, the quest is
   * linked back to the petition so its reporter can follow progression.
   * Validated at handler time: the petition must belong to the same campaign,
   * be in `accepted` state, and the caller must be the campaign owner.
   */
  petitionId: t.optional(t.integer()),
  /**
   * Optional predecessor quest. Validated server-side: must belong to the
   * same campaign and cannot point at the quest itself. While the
   * predecessor's `completedAt` is null, `acceptQuest` refuses to start
   * this quest.
   */
  dependsOn: t.optional(t.nullable(t.integer())),
});
