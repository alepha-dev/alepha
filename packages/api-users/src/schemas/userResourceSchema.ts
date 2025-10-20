import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const userResourceSchema = t.object({
	id: t.uuid(),
	version: t.number(),
	createdAt: t.datetime(),
	updatedAt: t.datetime(),
	email: t.email(),
	roles: t.array(t.string()),
	name: t.optional(t.string()),
	firstName: t.optional(t.string()),
	lastName: t.optional(t.string()),
	picture: t.optional(t.string()),
	enabled: t.boolean(),
	emailVerified: t.boolean(),
});

export type UserResource = Static<typeof userResourceSchema>;
