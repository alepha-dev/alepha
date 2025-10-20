import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const identityResourceSchema = t.object({
	id: t.uuid(),
	version: t.number(),
	createdAt: t.datetime(),
	updatedAt: t.datetime(),
	userId: t.uuid(),
	provider: t.string(),
	providerUserId: t.string(),
	providerData: t.optional(t.json()),
});

export type IdentityResource = Static<typeof identityResourceSchema>;
