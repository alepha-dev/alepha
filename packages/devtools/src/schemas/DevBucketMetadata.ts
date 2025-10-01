import { type Static, t } from "@alepha/core";

export const devBucketMetadataSchema = t.object({
	name: t.string(),
	description: t.optional(t.string()),
	mimeTypes: t.optional(t.array(t.string())),
	maxSize: t.optional(t.number()),
	provider: t.string(),
});

export type DevBucketMetadata = Static<typeof devBucketMetadataSchema>;
