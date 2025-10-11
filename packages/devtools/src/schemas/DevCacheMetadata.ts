import { type Static, t } from "@alepha/core";

export const devCacheMetadataSchema = t.object({
	name: t.text(),
	ttl: t.optional(t.any()),
	disabled: t.optional(t.boolean()),
	provider: t.text(),
});

export type DevCacheMetadata = Static<typeof devCacheMetadataSchema>;
