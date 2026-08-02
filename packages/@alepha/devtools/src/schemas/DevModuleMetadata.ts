import { type Infer, z } from "alepha";

export const devModuleMetadataSchema = z.object({
  name: z.text(),
  providers: z.array(z.text()),
});

export type DevModuleMetadata = Infer<typeof devModuleMetadataSchema>;
