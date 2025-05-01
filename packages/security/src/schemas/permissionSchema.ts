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

	url: t.optional(
		t.string({
			description: "URL of the permission. When available.",
		}),
	),
});

export type Permission = Static<typeof permissionSchema>;
