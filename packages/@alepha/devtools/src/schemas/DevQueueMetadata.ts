import { type Static, z } from "alepha";

export const devQueueMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  schema: z.any().optional(),
  provider: z.text(),
});

export type DevQueueMetadata = Static<typeof devQueueMetadataSchema>;
