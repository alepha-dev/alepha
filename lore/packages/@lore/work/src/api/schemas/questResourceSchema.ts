import { type Infer, z } from "alepha";

import { quests } from "../entities/quests.ts";

/**
 * Quest status derived from completedAt / heldAt / acceptedAt / shelvedAt.
 *
 * `on_hold` is derived like the rest, which is the whole reason it can be a
 * status at all: nothing stores "held from where", because `acceptedAt`
 * stays set underneath a hold and reappears the moment it is lifted.
 */
export const questStatusSchema = z.enum([
  "todo",
  "in_progress",
  "on_hold",
  "completed",
  "shelved",
]);

/**
 * Computed metadata attached to every quest resource.
 */
const questMetadataSchema = z.object({
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
 * Quest entity + server-computed metadata.
 */
export const questResourceSchema = quests.schema.extend({
  metadata: questMetadataSchema,
});

export type QuestResource = Infer<typeof questResourceSchema>;

/**
 * Lifecycle status of a quest, derived from its timestamp columns by
 * {@link QuestResourceMapper.questStatus}.
 */
export type QuestStatus = Infer<typeof questStatusSchema>;
