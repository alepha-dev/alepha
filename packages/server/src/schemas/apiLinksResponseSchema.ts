import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const apiLinkSchema = t.object({
	name: t.string({
		description: "Name of the API link, used for identification.",
	}),
	path: t.string({
		description: "Pathname used to access the API link.",
	}),
	method: t.optional(
		t.string({
			description:
				"HTTP method used for the API link, e.g., GET, POST, etc. If not specified, defaults to GET.",
		}),
	),
	group: t.optional(
		t.string({
			description:
				"Group to which the API link belongs, used for categorization.",
		}),
	),
	requestBodyType: t.optional(
		t.string({
			description:
				"Type of the request body for the API link. Default is application/json for POST/PUT/PATCH, null for others.",
		}),
	),
	service: t.optional(
		t.string({
			description:
				"Service name associated with the API link, used for service discovery.",
		}),
	),
	schema: t.optional(
		t.object({
			body: t.optional(t.any()),
		}),
	),
});

export const apiLinksResponseSchema = t.object({
	userId: t.optional(t.string()),
	prefix: t.optional(t.string()),
	links: t.array(apiLinkSchema),
});

export type ApiLinksResponse = Static<typeof apiLinksResponseSchema>;
export type ApiLink = Static<typeof apiLinkSchema>;
