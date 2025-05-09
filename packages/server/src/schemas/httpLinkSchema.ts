import { type Static, t } from "@alepha/core";

export const httpLinkSchema = t.object({
	name: t.string(),
	method: t.optional(t.string()),
	path: t.optional(t.string()),
	group: t.optional(t.string()),
	protected: t.optional(t.boolean()),
	contentType: t.optional(t.string()),
});

export type HttpLink = Static<typeof httpLinkSchema>;
