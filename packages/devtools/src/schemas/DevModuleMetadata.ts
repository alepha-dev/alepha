import { type Static, t } from "alepha";

export const devModuleMetadataSchema = t.object({
  name: t.text(),
  providers: t.array(t.text()),
});

export type DevModuleMetadata = Static<typeof devModuleMetadataSchema>;
