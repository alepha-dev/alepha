import { type Infer, z } from "alepha";

/**
 * The gauge a machine pushes on its interval, wire format v1. Percentages of
 * the whole host, refused outside 0 to 100 by the schema before any handler
 * sees them. `at` is the machine's own clock, kept for the series; the row's
 * `lastSeenAt` is Lore's clock.
 */
export const estateStatsFrameSchema = z.object({
  type: z.literal("stats"),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
  at: z.string(),
});

export type EstateStatsFrame = Infer<typeof estateStatsFrameSchema>;
