import { type Infer, z } from "alepha";

/**
 * The gauge a machine pushes on its interval, wire format v1. Percentages of
 * the whole host, refused outside 0 to 100 by the schema before any handler
 * sees them. `at` is the machine's own clock, kept for the series; the row's
 * `lastSeenAt` is Lore's clock.
 */
export const hostStatsFrameSchema = z.object({
  type: z.literal("stats"),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
  /**
   * The share of the disk holding Bay's root in use. Optional: an older Bay
   * sends none, and a gauge that cannot read the disk leaves it out (#Q4419).
   */
  diskPercent: z.number().min(0).max(100).optional(),
  /** The one-minute load average, unbounded above like the inventory's. */
  load1: z.number().min(0).optional(),
  at: z.string(),
});

export type HostStatsFrame = Infer<typeof hostStatsFrameSchema>;
