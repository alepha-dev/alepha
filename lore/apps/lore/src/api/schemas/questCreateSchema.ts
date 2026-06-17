import { t } from "alepha";

export const questCreateSchema = t.object({
  title: t.string(),
  // Optional — a title-only quest is allowed (sometimes the title says it
  // all). Defaults to "" server-side in createQuest so the NOT-NULL
  // `quests.description` column and `sanitizeHtml` stay happy (no migration).
  description: t.optional(t.string({ size: "rich" })),
  zone: t.string(),
  priority: t.enum(["optional", "low", "medium", "high"]),
  difficulty: t.integer({ minimum: 1, maximum: 5 }),
  /**
   * Optional, glanceable time estimate in minutes (motivation aid, surfaced
   * as a `~15m` pill in the questlog). `null` clears it on update, a positive
   * integer sets it, omit to leave unchanged. Not tied to rewards.
   */
  estimateMinutes: t.optional(t.nullable(t.integer({ minimum: 1 }))),
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
