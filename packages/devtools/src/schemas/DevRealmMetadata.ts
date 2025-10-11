import { type Static, t } from "@alepha/core";

export const devRealmMetadataSchema = t.object({
	name: t.text(),
	description: t.optional(t.text()),
	roles: t.optional(t.array(t.any())),
	type: t.enum(["internal", "external"]),
	settings: t.optional(
		t.object({
			accessTokenExpiration: t.optional(t.any()),
			refreshTokenExpiration: t.optional(t.any()),
			hasOnCreateSession: t.boolean(),
			hasOnRefreshSession: t.boolean(),
			hasOnDeleteSession: t.boolean(),
		}),
	),
});

export type DevRealmMetadata = Static<typeof devRealmMetadataSchema>;
