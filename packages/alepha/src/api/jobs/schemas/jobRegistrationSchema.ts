import { type Static, t } from "alepha";

export const jobRegistrationSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  type: t.enum(["cron", "queue", "direct"], {
    description:
      "Effective runtime mode. 'cron' = scheduled. 'queue' = push-driven, dispatched via AlephaApiJobsQueue. 'direct' = push-driven, processed in-process (no queue infrastructure loaded), with the sweep as the safety net.",
  }),
  priority: t.enum(["critical", "high", "normal", "low"]),
  cron: t.optional(t.text()),
  timeout: t.optional(t.text()),
  retry: t.optional(
    t.object({
      retries: t.integer(),
    }),
  ),
  recent: t.object({
    ok: t.integer(),
    error: t.integer(),
    lastRun: t.optional(t.datetime()),
  }),
});

export type JobRegistration = Static<typeof jobRegistrationSchema>;
