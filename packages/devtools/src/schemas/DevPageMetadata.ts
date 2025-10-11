import { type Static, t } from "@alepha/core";

export const devPageMetadataSchema = t.object({
	name: t.text(),
	description: t.optional(t.text()),
	path: t.optional(t.text()),
	params: t.optional(t.any()),
	query: t.optional(t.any()),
	hasComponent: t.boolean(),
	hasLazy: t.boolean(),
	hasResolve: t.boolean(),
	hasChildren: t.boolean(),
	hasParent: t.boolean(),
	hasErrorHandler: t.boolean(),
	static: t.optional(t.boolean()),
	cache: t.optional(t.any()),
	client: t.optional(t.any()),
	animation: t.optional(t.any()),
});

export type DevPageMetadata = Static<typeof devPageMetadataSchema>;
