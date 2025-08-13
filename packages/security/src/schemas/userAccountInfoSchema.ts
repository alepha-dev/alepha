import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const userAccountInfoSchema = t.object({
	id: t.string({
		description: "Unique identifier for the user.",
	}),

	name: t.optional(
		t.string({
			description: "Full name of the user.",
		}),
	),

	email: t.optional(
		t.string({
			description: "Email address of the user.",
			format: "email",
		}),
	),

	username: t.optional(
		t.string({
			description: "Preferred username of the user.",
		}),
	),

	picture: t.optional(
		t.string({
			description: "URL to the user's profile picture.",
		}),
	),

	// -------------------------------------------------------------------------------------------------------------------

	organizations: t.optional(
		t.array(t.string(), {
			description: "List of organizations the user belongs to.",
		}),
	),

	roles: t.optional(
		t.array(t.string(), {
			description: "List of roles assigned to the user.",
		}),
	),
});

export type UserAccountInfo = Static<typeof userAccountInfoSchema>;
