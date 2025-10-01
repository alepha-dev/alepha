import { type Static, t } from "@alepha/core";

export const devTopicMetadataSchema = t.object({
	name: t.string(),
	description: t.optional(t.string()),
	schema: t.optional(t.any()),
	provider: t.string(),
});

export type DevTopicMetadata = Static<typeof devTopicMetadataSchema>;
