import { type Static, t } from "alepha";

export const jobRegistrationSchema = t.object({
  name: t.text(),
  type: t.enum(["cron", "push", "both"]),
  priority: t.enum(["critical", "high", "normal", "low"]),
  concurrency: t.integer(),
  hasSchema: t.boolean(),
  cron: t.optional(t.text()),
  timeout: t.optional(t.text()),
  retry: t.optional(
    t.object({
      retries: t.integer(),
      hasBackoff: t.boolean(),
    }),
  ),
  batch: t.optional(
    t.object({
      size: t.integer(),
      window: t.text(),
    }),
  ),
});

export type JobRegistration = Static<typeof jobRegistrationSchema>;
