import { type Infer, z } from "alepha";

import { quests } from "../entities/quests.ts";

/**
 * Quest status derived from acceptedAt / completedAt / shelvedAt.
 */
export const questStatusSchema = z.enum([
  "new",
  "accepted",
  "completed",
  "shelved",
]);

/**
 * Computed metadata attached to every quest resource.
 */
export const questMetadataSchema = z.object({
  status: questStatusSchema,
  /**
   * `completed + waived` need not equal `total`: an objective that is
   * neither is simply still open. A waived one is counted separately
   * rather than folded into `completed` on purpose, because the whole
   * point of a waiver is that the work was not done.
   */
  objectivesProgress: z.object({
    completed: z.integer(),
    waived: z.integer(),
    total: z.integer(),
  }),
  totalTimeSpent: z.integer(),
});

/**
 * An objective as every read hands it out.
 *
 * The entity declares `id` optional, because legacy rows pre-date the field
 * and the column is only backfilled on write. `mapQuestToResource`
 * synthesizes one for those rows on the way out, so a READ always carries an
 * id even when the stored row does not. Restating that here is what lets
 * callers address an objective without a null check that can never fire.
 */
export const questObjectiveResourceSchema = z.object({
  id: z.integer().min(0),
  title: z.string(),
  completed: z.boolean(),
  /**
   * Set when the quest was completed with this objective still unticked.
   * A waived objective stays `completed: false`; the reason is what stands
   * in for the tick. See the entity for why.
   */
  waivedReason: z.string().optional(),
  waivedBy: z.uuid().optional(),
  waivedAt: z.datetime().optional(),
});

/**
 * Quest entity + server-computed metadata.
 */
export const questResourceSchema = quests.schema.extend({
  objectives: z.array(questObjectiveResourceSchema),
  metadata: questMetadataSchema,
});

export type QuestResource = Infer<typeof questResourceSchema>;

/**
 * Lifecycle status of a quest, derived from its timestamp columns by
 * {@link QuestResourceMapper.questStatus}.
 */
export type QuestStatus = Infer<typeof questStatusSchema>;
