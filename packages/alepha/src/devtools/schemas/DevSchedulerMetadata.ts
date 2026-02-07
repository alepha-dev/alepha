import { type Static, t } from "alepha";

export const devSchedulerMetadataSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  cron: t.optional(t.text()),
  interval: t.optional(t.any()),
  lock: t.optional(t.boolean()),
});

export type DevSchedulerMetadata = Static<typeof devSchedulerMetadataSchema>;
