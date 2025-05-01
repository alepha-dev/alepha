import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const pageQuerySchema = t.object({
	page: t.optional(
		t.uchar({
			maximum: 100,
			description: "The page number to retrieve.",
		}),
	),
	size: t.optional(
		t.uint({
			minimum: 1,
			maximum: 100,
			description: "The number of items per page.",
		}),
	),
	sort: t.optional(
		t.string({
			description: "Sort by field, e.g. 'field,asc' or 'field,desc'.",
		}),
	),
});

export type PageQuery = Static<typeof pageQuerySchema>;
