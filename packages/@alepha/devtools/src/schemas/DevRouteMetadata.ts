import { type Static, z } from "alepha";

export const devRouteMetadataSchema = z.object({
  method: z.text(),
  path: z.text(),
});

export type DevRouteMetadata = Static<typeof devRouteMetadataSchema>;
