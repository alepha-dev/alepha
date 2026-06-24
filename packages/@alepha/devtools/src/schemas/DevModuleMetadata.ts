import { type Static, z } from "alepha";

export const devModuleMetadataSchema = z.object({
  name: z.text(),
  providers: z.array(z.text()),
});

export type DevModuleMetadata = Static<typeof devModuleMetadataSchema>;
