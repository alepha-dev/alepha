import { type Static, z } from "alepha";

export const jobRegistrationSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  type: z
    .enum(["cron", "queue", "direct"])
    .describe(
      "Effective runtime mode. 'cron' = scheduled. 'queue' = push-driven, dispatched via AlephaApiJobsQueue. 'direct' = push-driven, processed in-process (no queue infrastructure loaded), with the sweep as the safety net.",
    ),
  priority: z.enum(["critical", "high", "normal", "low"]),
  cron: z.text().optional(),
  timeout: z.text().optional(),
  retry: z
    .object({
      retries: z.integer(),
    })
    .optional(),
  recent: z.object({
    ok: z.integer(),
    error: z.integer(),
    lastRun: z.datetime().optional(),
  }),
});

export type JobRegistration = Static<typeof jobRegistrationSchema>;
