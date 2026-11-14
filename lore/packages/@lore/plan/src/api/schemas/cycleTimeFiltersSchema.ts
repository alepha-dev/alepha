import { type Infer, z } from "alepha";

/**
 * The `cycleTime` dashboard metric's filters (#Q2653): every priority, or
 * one, read from the same per-priority figure the Reports Quests tab draws.
 */
export const cycleTimeFiltersSchema = z.object({
  priority: z.enum(["all", "high", "medium", "low", "optional"]).default("all"),
});

export type CycleTimeFilters = Infer<typeof cycleTimeFiltersSchema>;
