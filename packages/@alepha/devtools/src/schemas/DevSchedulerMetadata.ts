import { type Static, z } from "alepha";

export const devSchedulerMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  cron: z.text().optional(),
  interval: z.any().optional(),
  lock: z.boolean().optional(),
});

export type DevSchedulerMetadata = Static<typeof devSchedulerMetadataSchema>;
