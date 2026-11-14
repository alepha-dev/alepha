import { type Infer, z } from "alepha";

/**
 * The `questBreakdown` dashboard metric's filters (#Q2653): which of the
 * Reports Quests tab's three breakdowns the tile draws.
 */
export const questBreakdownFiltersSchema = z.object({
  by: z.enum(["area", "tag", "priority"]).default("area"),
});

export type QuestBreakdownFilters = Infer<typeof questBreakdownFiltersSchema>;
