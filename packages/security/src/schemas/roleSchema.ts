import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const roleSchema = t.object({
	name: t.string({
		description: "Name of the role.",
	}),

	description: t.optional(
		t.string({
			description: "Describe the role.",
		}),
	),

	default: t.optional(
		t.boolean({
			description:
				"If true, this role will be assigned to all users by default.",
		}),
	),

	permissions: t.array(
		t.object({
			name: t.string({
				description: "Name of the permission.",
			}),
			ownership: t.optional(
				t.boolean({
					description:
						"If true, user will only have access to it's own resources.",
				}),
			),
			exclude: t.optional(
				t.array(t.string(), {
					description:
						"Exclude some permissions. Useful when 'name' is a wildcard.",
				}),
			),
		}),
	),
});

export type Role = Static<typeof roleSchema>;
