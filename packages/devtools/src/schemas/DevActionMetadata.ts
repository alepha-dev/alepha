import { type Static, t } from "@alepha/core";

export const devActionMetadataSchema = t.object({
	name: t.string(),
	group: t.string(),
	method: t.string(),
	path: t.string(),
	prefix: t.string(),
	fullPath: t.string(),
	description: t.optional(t.string()),
	summary: t.optional(t.string()),
	disabled: t.optional(t.boolean()),
	secure: t.optional(t.boolean()),
	hide: t.optional(t.boolean()),
	body: t.optional(t.any()),
	params: t.optional(t.any()),
	query: t.optional(t.any()),
	response: t.optional(t.any()),
	bodyContentType: t.optional(t.string()),
});

export type DevActionMetadata = Static<typeof devActionMetadataSchema>;
