import { type Infer, z } from "alepha";

import { jobRetentionSchema } from "./jobRetentionSchema.ts";

export const jobRegistrationSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  type: z
    .enum(["cron", "queue", "direct"])
    .describe(
      "Effective runtime mode. 'cron' = scheduled. 'queue' = push-driven, dispatched via AlephaApiJobsQueue. 'direct' = push-driven, processed in-process (no queue infrastructure loaded), with the sweep as the safety net.",
    ),
  cron: z.text().optional(),
  timeout: z.text().optional(),
  retry: z
    .object({
      retries: z.integer(),
    })
    .optional(),
  retention: jobRetentionSchema,
  recent: z.object({
    ok: z.integer(),
    error: z.integer(),
    lastRun: z.datetime().optional(),
  }),
});

export type JobRegistration = Infer<typeof jobRegistrationSchema>;
