import { type Infer, z } from "alepha";

export const devProviderMetadataSchema = z.object({
  name: z.text(),
  module: z.text().optional(),
  dependencies: z.array(z.text()),
  aliases: z.array(z.text()).optional(),
});

export type DevProviderMetadata = Infer<typeof devProviderMetadataSchema>;
