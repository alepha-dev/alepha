import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const sessionResourceSchema = t.object({
	id: t.uuid(),
	version: t.number(),
	createdAt: t.datetime(),
	updatedAt: t.datetime(),
	refreshToken: t.uuid(),
	userId: t.uuid(),
	expiresAt: t.datetime(),
	ip: t.optional(t.string()),
	userAgent: t.optional(
		t.object({
			os: t.string(),
			browser: t.string(),
			device: t.enum(["MOBILE", "DESKTOP", "TABLET"]),
		}),
	),
});

export type SessionResource = Static<typeof sessionResourceSchema>;
