import { type Static, z } from "alepha";
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
  objectivesProgress: z.object({
    completed: z.integer(),
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

export type QuestResource = Static<typeof questResourceSchema>;

/**
 * Lifecycle status of a quest, derived from its timestamp columns by
 * {@link QuestResourceMapper.questStatus}.
 */
export type QuestStatus = Static<typeof questStatusSchema>;
