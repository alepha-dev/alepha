import { type Infer, z } from "alepha";

export const devCacheMetadataSchema = z.object({
  name: z.text(),
  ttl: z.any().optional(),
  disabled: z.boolean().optional(),
  provider: z.text(),
});

export type DevCacheMetadata = Infer<typeof devCacheMetadataSchema>;
