import { type Static, t } from "@alepha/core";

export const devProviderMetadataSchema = t.object({
	name: t.text(),
	module: t.optional(t.text()),
	dependencies: t.array(t.text()),
	aliases: t.optional(t.array(t.text())),
});

export type DevProviderMetadata = Static<typeof devProviderMetadataSchema>;
