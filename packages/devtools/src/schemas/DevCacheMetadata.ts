import { type Static, t } from "@alepha/core";

export const devCacheMetadataSchema = t.object({
	name: t.string(),
	ttl: t.optional(t.any()),
	disabled: t.optional(t.boolean()),
	provider: t.string(),
});

export type DevCacheMetadata = Static<typeof devCacheMetadataSchema>;
