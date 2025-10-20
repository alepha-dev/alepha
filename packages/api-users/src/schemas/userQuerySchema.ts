import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/postgres";

export const userQuerySchema = t.interface([pageQuerySchema], {
	email: t.optional(t.string()),
	enabled: t.optional(t.boolean()),
	emailVerified: t.optional(t.boolean()),
	roles: t.optional(t.array(t.string())),
});

export type UserQuery = Static<typeof userQuerySchema>;
