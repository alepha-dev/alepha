import { type Static, t } from "@alepha/core";

export const devQueueMetadataSchema = t.object({
	name: t.string(),
	description: t.optional(t.string()),
	schema: t.optional(t.any()),
	provider: t.string(),
});

export type DevQueueMetadata = Static<typeof devQueueMetadataSchema>;
