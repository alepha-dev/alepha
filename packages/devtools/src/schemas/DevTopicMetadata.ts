import { type Static, t } from "@alepha/core";

export const devTopicMetadataSchema = t.object({
	name: t.text(),
	description: t.optional(t.text()),
	schema: t.optional(t.any()),
	provider: t.text(),
});

export type DevTopicMetadata = Static<typeof devTopicMetadataSchema>;
