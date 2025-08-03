import { type Static, t } from "@alepha/core";

export const userProfileSchema = t.object({
	id: t.string(),
	name: t.optional(t.string()),
	email: t.optional(t.string()),
	picture: t.optional(t.string()),
});

export type UserProfile = Static<typeof userProfileSchema>;
