import { type Static, t } from "alepha";

export const jobRegistrationSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  type: t.enum(["cron", "queue"]),
  priority: t.enum(["critical", "high", "normal", "low"]),
  cron: t.optional(t.text()),
  timeout: t.optional(t.text()),
  retry: t.optional(
    t.object({
      retries: t.integer(),
      hasBackoff: t.boolean(),
    }),
  ),
  recent: t.object({
    ok: t.integer(),
    error: t.integer(),
    lastRun: t.optional(t.datetime()),
  }),
});

export type JobRegistration = Static<typeof jobRegistrationSchema>;
