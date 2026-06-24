import { type Static, z } from "alepha";

export const devBucketMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  mimeTypes: z.array(z.text()).optional(),
  maxSize: z.number().optional(),
  provider: z.text(),
});

export type DevBucketMetadata = Static<typeof devBucketMetadataSchema>;
