import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const permissionSchema = t.object({
	name: t.string({
		description: "Name of the permission.",
	}),

	group: t.optional(
		t.string({
			description: "Group of the permission.",
		}),
	),

	description: t.optional(
		t.string({
			description: "Describe the permission.",
		}),
	),

	// HTTP Only

	method: t.optional(
		t.string({
			description: "HTTP method of the permission. When available.",
		}),
	),

	path: t.optional(
		t.string({
			description: "Pathname of the permission. When available.",
		}),
	),

	contentType: t.optional(t.string()),
});

export type Permission = Static<typeof permissionSchema>;
