import { type Infer, z } from "alepha";

export const devStorageMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  mimeTypes: z.array(z.text()).optional(),
  /**
   * Maximum upload size in megabytes.
   */
  maxSize: z.number().optional(),
  /**
   * Default retention for files in this storage, as declared
   * (e.g. `"7 days"`). Absent means files are kept until deleted.
   */
  ttl: z.text().optional(),
  provider: z.text(),
});

export type DevStorageMetadata = Infer<typeof devStorageMetadataSchema>;
