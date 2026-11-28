import { type Infer, z } from "alepha";

import { quests } from "../entities/quests.ts";
import { questLiveCopySchema } from "./questLiveCopySchema.ts";

/**
 * Quest status derived from completedAt / heldAt / acceptedAt / shelvedAt /
 * draftAt.
 *
 * `draft` is a quest that is specified and not ready to be taken (#E178):
 * it only ever replaces `todo`, and it cannot be accepted or held.
 *
 * `on_hold` is derived like the rest, which is the whole reason it can be a
 * status at all: nothing stores "held from where", because `acceptedAt`
 * stays set underneath a hold and reappears the moment it is lifted.
 */
export const questStatusSchema = z.enum([
  "draft",
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
  /**
   * The deployed copies running the quest's commits (#E154), on a list read
   * that asked for them (`getQuests` with `withLive`). Absent otherwise, and
   * an empty list is "on no copy whose set is known", never "not live".
   */
  live: z.array(questLiveCopySchema).optional(),
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
