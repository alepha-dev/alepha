import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const createUserSchema = t.object({
	email: t.email(),
	name: t.optional(t.string()),
	firstName: t.optional(t.string()),
	lastName: t.optional(t.string()),
	picture: t.optional(t.string()),
	roles: t.optional(t.array(t.string())),
	enabled: t.optional(t.boolean()),
	emailVerified: t.optional(t.boolean()),
});

export type CreateUser = Static<typeof createUserSchema>;
