import { type Static, t } from "@alepha/core";

export const devProviderMetadataSchema = t.object({
	name: t.string(),
	module: t.optional(t.string()),
	dependencies: t.array(t.string()),
	aliases: t.optional(t.array(t.string())),
});

export type DevProviderMetadata = Static<typeof devProviderMetadataSchema>;
