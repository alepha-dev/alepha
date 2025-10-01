import { type Static, t } from "@alepha/core";

export const devModuleMetadataSchema = t.object({
	name: t.string(),
	providers: t.array(t.string()),
});

export type DevModuleMetadata = Static<typeof devModuleMetadataSchema>;
