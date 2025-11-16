import { type Static, t } from "alepha";

export const devBucketMetadataSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  mimeTypes: t.optional(t.array(t.text())),
  maxSize: t.optional(t.number()),
  provider: t.text(),
});

export type DevBucketMetadata = Static<typeof devBucketMetadataSchema>;
