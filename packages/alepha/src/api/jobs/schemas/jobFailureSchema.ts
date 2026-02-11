import { type Static, t } from "alepha";

export const jobFailureSchema = t.object({
  jobName: t.text(),
  failures: t.integer(),
  lastError: t.optional(t.text()),
});

export type JobFailure = Static<typeof jobFailureSchema>;
