import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

// -----------------------------------------------------------------------------
// host_stats
// -----------------------------------------------------------------------------

export const hostStatsParamsSchema = projectParamsSchema.extend({
  host: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The host's slug (`ovh`, `vps-ovh`), among the hosts you can read: those of the projects where your rank grants host:read. With a project, narrowed to that project's own hosts and the ones it borrows.",
    ),
  home: z
    .string()
    .max(100)
    .optional()
    .describe(
      "The host's home project, by slug or title, when two hosts you can read share the slug. A slug is unique per home project.",
    ),
  since: z
    .string()
    .max(40)
    .optional()
    .describe(
      "The first day to read, as an ISO date. Defaults to 30 days ago.",
    ),
});

export const hostStatsResultSchema = z.object({
  host: z.string(),
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
      "Whether the daily series is being recorded. Off by default; somebody with host:update in its home project turns it on from the host page. Off with no points is the common case, not an error.",
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
