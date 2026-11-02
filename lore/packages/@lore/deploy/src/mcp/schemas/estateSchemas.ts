import { z } from "alepha";

// -----------------------------------------------------------------------------
// estate_stats
// -----------------------------------------------------------------------------

export const estateStatsParamsSchema = z.object({
  estate: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The estate's slug (`ovh`, `vps-ovh`). One of YOUR estates: only an estate's owner reads its stats, and a slug is unique per owner.",
    ),
  since: z
    .string()
    .max(40)
    .optional()
    .describe(
      "The first day to read, as an ISO date. Defaults to 30 days ago.",
    ),
});

export const estateStatsResultSchema = z.object({
  estate: z.string(),
  current: z
    .object({
      cpuPercent: z.number().optional(),
      memoryPercent: z.number().optional(),
      statsAt: z.string().optional(),
    })
    .describe(
      "The machine's last reading, kept whether or not the series is on. Absent fields: it has never reported.",
    ),
  collecting: z
    .boolean()
    .describe(
      "Whether the daily series is being recorded. Off by default; the owner turns it on from the estate page. Off with no points is the common case, not an error.",
    ),
  estimated: z
    .boolean()
    .describe(
      "True when the backend sampled the window: the means are then estimates, 1 row in `sampleInterval`.",
    ),
  sampleInterval: z.number().optional(),
  points: z
    .array(
      z.object({
        day: z.string(),
        cpuPercent: z.number(),
        memoryPercent: z.number(),
        samples: z.integer(),
      }),
    )
    .describe("One mean per day, oldest first."),
});
