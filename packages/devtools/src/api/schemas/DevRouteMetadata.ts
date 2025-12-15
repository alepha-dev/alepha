import { type Static, t } from "alepha";

export const devRouteMetadataSchema = t.object({
  method: t.text(),
  path: t.text(),
});

export type DevRouteMetadata = Static<typeof devRouteMetadataSchema>;
