import { z } from "alepha";

export const questCreateSchema = z.object({
  title: z.string(),
  // Optional — a title-only quest is allowed (sometimes the title says it
  // all). Defaults to "" server-side in createQuest so the NOT-NULL
  // `quests.description` column and `sanitizeHtml` stay happy (no migration).
  description: z.string().meta({ size: "rich" }).optional(),
  area: z.string(),
  priority: z.enum(["optional", "low", "medium", "high"]),
  difficulty: z.integer().min(1).max(5),
  /**
   * Optional, glanceable time estimate in minutes (motivation aid, surfaced
   * as a `~15m` pill in the questlog). `null` clears it on update, a positive
   * integer sets it, omit to leave unchanged. Not tied to rewards.
   *
   * No `.min(1)` here on purpose: the handler treats any non-positive value as
   * "no estimate" (the UI can't produce one), so `0` is accepted and normalized
   * to none rather than rejected.
   */
  estimateMinutes: z.integer().nullable().optional(),
  projectId: z.integer(),
  objectives: z
    .array(
      z.object({
        title: z.string(),
        completed: z.boolean(),
      }),
    )
    .default([])
    .optional(),
  attachments: z.array(z.uuid()).default([]).optional(),
  /**
   * Free-form labels for the nature of the quest (`bug`, `feat`, `chore`,
   * …). Normalized server-side (trim, lowercase, dedupe). Orthogonal to
   * `area` which labels the module / scope.
   */
  tags: z.array(z.string()).default([]).optional(),
  /**
   * Optional feedback this quest was spawned from. When set, the quest is
   * linked back to the feedback so its reporter can follow progression.
   * Validated at handler time: the feedback must belong to the same project,
   * be in `accepted` state, and the caller must be the project owner.
   */
  feedbackId: z.integer().optional(),
  /**
   * Optional predecessor quest. Validated server-side: must belong to the
   * same project and cannot point at the quest itself. While the
   * predecessor's `completedAt` is null, `acceptQuest` refuses to start
   * this quest.
   */
  dependsOn: z.integer().nullable().optional(),
});
