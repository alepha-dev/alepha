import { z } from "alepha";

import { HOST_JOB_STATUSES } from "../../api/schemas/hostJobValues.ts";
import { hostMachineJobSchema } from "../../api/schemas/hostMachineJobSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * How a tool names one host: its slug, among the hosts the caller can read.
 */
export const hostNameParamsSchema = projectParamsSchema.extend({
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
});

// -----------------------------------------------------------------------------
// host_jobs
// -----------------------------------------------------------------------------

export const hostJobsParamsSchema = hostNameParamsSchema.extend({
  status: z
    .enum(HOST_JOB_STATUSES)
    .optional()
    .describe("Only the jobs in this status."),
  limit: z
    .integer()
    .min(1)
    .max(500)
    .optional()
    .describe("How many jobs, newest first. Defaults to 50."),
});

export const hostJobsResultSchema = z.object({
  host: z.string(),
  jobs: z.array(hostMachineJobSchema),
});

// -----------------------------------------------------------------------------
// host_stats
// -----------------------------------------------------------------------------

export const hostStatsParamsSchema = hostNameParamsSchema.extend({
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
        diskPercent: z
          .number()
          .optional()
          .describe("Mean disk use; absent when the host's Bay sends none."),
        load1: z.number().optional().describe("Mean one-minute load."),
        samples: z.integer(),
      }),
    )
    .describe("One mean per day, oldest first."),
});
