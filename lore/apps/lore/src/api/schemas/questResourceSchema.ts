import { type Static, t } from "alepha";
import { quests } from "../entities/quests.ts";

/**
 * Quest status derived from acceptedAt / completedAt.
 */
export const questStatusSchema = t.enum(["new", "accepted", "completed"]);

/**
 * Computed metadata attached to every quest resource.
 */
export const questMetadataSchema = t.object({
  status: questStatusSchema,
  objectivesProgress: t.object({
    completed: t.integer(),
    total: t.integer(),
  }),
  totalTimeSpent: t.integer(),
});

/**
 * Quest entity + server-computed metadata.
 */
export const questResourceSchema = t.extend(quests.schema, {
  metadata: questMetadataSchema,
});

export type QuestResource = Static<typeof questResourceSchema>;
